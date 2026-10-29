import {test,expect,type Page} from '@playwright/test';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';

const here=dirname(fileURLToPath(import.meta.url));
const candidate=resolve(here,'../src/host/source-drag-preview.ts');
const evidence=process.env.SOURCE_DROP_VISUAL_EVIDENCE;
if(!evidence)throw Error('SOURCE_DROP_VISUAL_EVIDENCE must name a new owned evidence directory.');

/** The production preview supplies both HTML and the fit expression. Electron's
 * window is inert; the DOM and expression run in the actual disposable browser. */
async function previewBoundary(page:Page){
 const cdp=await page.context().newCDPSession(page);
 const observations:{expression:string;value:unknown}[]=[];
 class Window{
  visible=false;closed=false;bounds={x:0,y:0,width:1,height:1};
  webContents={
   setWindowOpenHandler:()=>{},on:()=>{},
   executeJavaScript:async(expression:string)=>{
    const result=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails)throw Error('The production preview fit expression failed.');
    observations.push({expression,value:result.result.value});return result.result.value;
   },
  };
  setIgnoreMouseEvents(){} setContentProtection(){}
  setBounds(bounds:typeof this.bounds){this.bounds={...bounds};} getBounds(){return {...this.bounds};}
  hide(){this.visible=false;} showInactive(){this.visible=true;}
  isDestroyed(){return this.closed;} isVisible(){return this.visible;}
  close(){this.closed=true;this.visible=false;} on(){}
  getMediaSourceId(){return 'window:7:0';}
  async loadURL(url:string){await page.setViewportSize({width:this.bounds.width,height:this.bounds.height});await page.goto(url);}
 }
 const bundle=await build({entryPoints:[candidate],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'inert-electron-window',setup(builder){
  builder.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'stub'}));
  builder.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const BrowserWindow=globalThis.__PreviewWindow;export const screen=globalThis.__PreviewScreen;',loader:'js'}));
 }}]});
 const module={exports:{} as {createSourceDragPreview:(anchor:()=>unknown)=>any}};
 const screen={getDisplayMatching:()=>({id:1,scaleFactor:1,workArea:{x:0,y:0,width:1920,height:1080}})};
 runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,__PreviewWindow:Window,__PreviewScreen:screen,structuredClone});
 const preview=module.exports.createSourceDragPreview(()=>({x:0,y:0,width:74,height:64}));
 return {preview,observations,close:async()=>{preview.clear();await cdp.detach();}};
}

const target=(width:number,height:number,title='Owned document',owner='Owned editor')=>({id:'window:42',osId:42,title,owner:{name:owner,processId:123},bounds:{x:0,y:0,width,height},displayId:'1',scaleFactor:1,documentToken:'owned-document-token',requiresExplicitCapture:true as const});
const state=(t:ReturnType<typeof target>)=>({kind:'target' as const,title:t.title,ownerName:t.owner.name});

test.beforeAll(async()=>{await mkdir(evidence!,{recursive:true});});
test('actual production preview shows the complete named target, one-shot scope and cancellation',async({page})=>{
 const boundary=await previewBoundary(page),selected=target(640,480,'Owned design notes','Owned editor');
 try{
  boundary.preview.show(state(selected),selected);
  await expect.poll(()=>boundary.preview.presented()?.id).toBe(selected.id);
  expect(boundary.observations).toHaveLength(1);expect(boundary.observations[0].value).toMatchObject({fits:true,rect:expect.objectContaining({x:expect.any(Number),y:expect.any(Number),width:expect.any(Number),height:expect.any(Number)})});
  const disclosure=page.locator('p');await expect(disclosure).toBeVisible();await expect(disclosure).toBeInViewport({ratio:1});
  await expect(disclosure).toContainText('Owned design notes');await expect(disclosure).toContainText('Owned editor');
  await expect(disclosure).toContainText('Release to attach and capture one local snapshot');await expect(disclosure).toContainText('Esc to cancel');await expect(disclosure).toContainText('Nothing is sent or followed automatically.');
  await page.screenshot({path:join(evidence!,'preview-fitting.png'),fullPage:false});
 }finally{await boundary.close();}
});

for(const [name,width,height] of [['tiny',40,40],['narrow',90,80]] as const)test(`actual production fit refuses a ${name} clipped disclosure`,async({page})=>{
 const boundary=await previewBoundary(page),selected=target(width,height,'Owned document with a meaningful title','Owned editor');
 try{
  boundary.preview.show(state(selected),selected);await expect.poll(()=>boundary.observations.length).toBe(1);
  expect(boundary.observations[0].value).toMatchObject({fits:false,rect:expect.objectContaining({x:expect.any(Number),y:expect.any(Number),width:expect.any(Number),height:expect.any(Number)})});expect(boundary.preview.presented()).toBeUndefined();
  await page.screenshot({path:join(evidence!,`preview-${name}-fallback.png`),fullPage:false});
 }finally{await boundary.close();}
});

for(const [name,title,owner] of [['title','A'.repeat(161),'Owned editor'],['owner','Owned document','B'.repeat(101)]] as const)test(`overlong ${name} remains in manual-review fallback`,async({page})=>{
 const boundary=await previewBoundary(page),selected=target(640,480,title,owner);
 try{
  boundary.preview.show(state(selected),selected);await expect(page.locator('p')).toBeVisible();await expect(page.locator('p')).toContainText('Release to attach and capture one local snapshot');
  expect(boundary.observations).toHaveLength(0);expect(boundary.preview.presented()).toBeUndefined();
  await page.screenshot({path:join(evidence!,`preview-long-${name}-fallback.png`),fullPage:false});
 }finally{await boundary.close();}
});
