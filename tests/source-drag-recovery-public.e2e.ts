import {test,expect} from '@playwright/test';
import {BrowserFixture} from './browser-fixture';
import type {Command,ContextActivation,WindowChoice} from '../src/shared/bridge';

test('unavailable drop offers keyboard recovery to the explicit window picker',async({page},info)=>{
 const fixture=await BrowserFixture.open(page,'anchor');
 try{
  const target:WindowChoice={id:'window:42',title:'Synthetic source',owner:{name:'Synthetic editor'},bounds:{x:300,y:100,width:500,height:400}};
  let pending:ContextActivation|undefined,captures=0;const commands:Command[]=[];
  await page.exposeFunction('__recoveryInvoke',async(command:Command)=>{
   commands.push(structuredClone(command));
   if(command.type==='source.drag.cancel')return null;
   if(command.type==='context.pending')return pending?{kind:'ready',activation:pending}:{kind:'none'};
   if(command.type==='source.choose'){
    pending={activationId:crypto.randomUUID(),tucked:true,origin:'source-picker',intent:'attach',ownerTaskId:fixture.taskA.id,choices:[target]};
    await fixture.enter('workspace');await fixture.emit({type:'context.activate',activation:pending});return null;
   }
   if(command.type==='context.capture'){
    if(!pending||command.activationId!==pending.activationId||command.windowId!==target.id||command.taskId!==fixture.taskA.id)throw Error('Selection expired.');
    const activationId=pending.activationId;pending=undefined;captures++;const task=await fixture.core.putSource(fixture.taskA.id,{kind:'window',label:target.title,role:'fact',content:'synthetic metadata',windowId:target.id,windowProcessId:123,documentToken:'synthetic-document'});
    await fixture.changed(task.id);await fixture.enter('companion');return {state:'captured',activationId,tucked:true,task,sourceId:task.sources.at(-1)!.id};
   }
   throw Error('Unexpected recovery command.');
  });
  await page.evaluate(()=>{
   const bridge=window.companion,invoke=bridge.invoke.bind(bridge);
   Object.defineProperty(bridge,'invoke',{configurable:true,value:(command:Command)=>{if(['source.drag.cancel','source.choose','context.pending','context.capture'].includes(command.type))return Reflect.get(window,'__recoveryInvoke')(command);if(command.type==='export.propose'||command.type==='export.approve'||command.type==='export.inspect')return invoke(command);return invoke(command);}});
  });
  const anchor=page.getByRole('button',{name:'Open Window Companion',exact:true});
  await fixture.emit({type:'source.drag',state:{kind:'blocked',message:'No eligible window here. Press Down Arrow to choose one.'}});
  await expect(anchor.getByRole('status')).toHaveText('No eligible window here. Press Down Arrow to choose one.');
  await anchor.focus();await page.keyboard.press('ArrowDown');
  const choices=page.getByRole('group',{name:'Window to inspect',exact:true});await expect(choices).toBeVisible();expect(captures).toBe(0);
  await info.attach('keyboard-recovery-window-chooser',{body:await page.screenshot(),contentType:'image/png'});
  await choices.locator('.context-window-choice').click();await expect.poll(()=>captures).toBe(1);
  expect(commands.filter(command=>command.type==='source.choose')).toHaveLength(1);expect(fixture.commands.filter(command=>command.type==='model.run')).toEqual([]);expect(fixture.externalRequests).toEqual([]);
 }finally{await fixture.close();}
});

test('unavailable-drop guidance fits the production preview',async({page},info)=>{
 const {build}=await import('esbuild'),{runInNewContext}=await import('node:vm'),{resolve}=await import('node:path');
 class PreviewWindow{
  visible=false;closed=false;bounds={x:0,y:0,width:1,height:1};
  webContents={setWindowOpenHandler:()=>{},on:()=>{}};
  setIgnoreMouseEvents(){} setContentProtection(){} setBounds(value:typeof this.bounds){this.bounds={...value};} getBounds(){return {...this.bounds};}
  hide(){this.visible=false;} showInactive(){this.visible=true;} isDestroyed(){return this.closed;} isVisible(){return this.visible;}
  close(){this.closed=true;this.visible=false;} on(){} getMediaSourceId(){return 'window:7:0';}
  async loadURL(url:string){await page.setViewportSize({width:this.bounds.width,height:this.bounds.height});await page.goto(url);}
 }
 const bundle=await build({entryPoints:[resolve(import.meta.dirname,'../src/host/source-drag-preview.ts')],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'inert-electron',setup(builder){
  builder.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'stub'}));
  builder.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const BrowserWindow=globalThis.__PreviewWindow;export const screen=globalThis.__PreviewScreen;',loader:'js'}));
 }}]});
 const module={exports:{} as {createSourceDragPreview:(anchor:()=>unknown)=>{show:(state:unknown)=>void;clear:()=>void}}};
 runInNewContext(bundle.outputFiles[0].text,{module,exports:module.exports,__PreviewWindow:PreviewWindow,__PreviewScreen:{},structuredClone});
 const preview=module.exports.createSourceDragPreview(()=>({x:0,y:0,width:74,height:64}));
 try{
  preview.show({kind:'blocked',message:'No eligible window here. Press Down Arrow to choose one.'});
  const guidance=page.locator('p');await expect(guidance).toHaveText('No eligible window here. Press Down Arrow to choose one.');await expect(guidance).toBeInViewport({ratio:1});
  expect(await guidance.evaluate(p=>p.scrollWidth<=p.clientWidth&&p.scrollHeight<=p.clientHeight)).toBe(true);
  await info.attach('no-eligible-window-preview',{body:await page.screenshot(),contentType:'image/png'});
 }finally{preview.clear();}
});
