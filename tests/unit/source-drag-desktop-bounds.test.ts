import {afterEach,expect,it,vi} from 'vitest';
import {createSourceDragPreview} from '../../src/host/source-drag-preview';
import type {NativeWindow} from '../../src/host/native';

const fake=vi.hoisted(()=>{
 class Window{
  static all:Window[]=[]; visible=false;closed=false;bounds={x:0,y:0,width:1,height:1};
  resolve?:()=>void;
  constructor(){Window.all.push(this);}
  setIgnoreMouseEvents(){} setContentProtection(){} setBounds(value:typeof this.bounds){this.bounds={...value};} getBounds(){return {...this.bounds};}
  hide(){this.visible=false;} showInactive(){this.visible=true;} isDestroyed(){return this.closed;} isVisible(){return this.visible;} close(){this.closed=true;this.visible=false;} on(){} getMediaSourceId(){return 'window:7:0';}
  webContents={setWindowOpenHandler:vi.fn(),on:vi.fn(),executeJavaScript:vi.fn(async()=>({fits:true,rect:{x:8,y:8,width:300,height:72}}))};
  loadURL(){return new Promise<void>(resolve=>{this.resolve=resolve;});}
 }
 const display={id:1,scaleFactor:1,workArea:{x:0,y:0,width:1000,height:800}};
 return {Window,display,unavailable:false};
});
vi.mock('electron',()=>({BrowserWindow:fake.Window,screen:{getDisplayMatching:()=>{if(fake.unavailable)throw Error('Display unavailable');return fake.display;}}}));
afterEach(()=>{fake.Window.all=[];fake.unavailable=false;fake.display.id=1;fake.display.scaleFactor=1;fake.display.workArea={x:0,y:0,width:1000,height:800};});

it('does not authorize a locally fitted disclosure wholly outside the current desktop work area',async()=>{
 const target:NativeWindow={id:'window:42',osId:42,title:'Owned source',owner:{name:'Owned editor',processId:123},bounds:{x:-1500,y:100,width:500,height:400},displayId:'1',scaleFactor:1,documentToken:'owned-document',requiresExplicitCapture:true};
 const preview=createSourceDragPreview(()=>({x:0,y:0,width:74,height:64}));
 try{
  preview.show({kind:'target',title:target.title,ownerName:target.owner.name},target);const window=fake.Window.all[0];window.resolve!();
  await vi.waitFor(()=>expect(window.webContents.executeJavaScript).toHaveBeenCalled());await Promise.resolve();
  expect(window.isVisible()).toBe(true);expect(preview.presented()).toBeUndefined();
 }finally{preview.clear();}
});

async function loaded(bounds={x:100,y:100,width:500,height:400},displayId='1'){
 const target:NativeWindow={id:'window:42',osId:42,title:'Owned source',owner:{name:'Owned editor',processId:123},bounds,displayId,scaleFactor:1,documentToken:'owned-document',requiresExplicitCapture:true};
 const preview=createSourceDragPreview(()=>({x:0,y:0,width:74,height:64}));
 preview.show({kind:'target',title:target.title,ownerName:target.owner.name},target);const window=fake.Window.all.at(-1)!;window.resolve!();
 await vi.waitFor(()=>expect(window.webContents.executeJavaScript).toHaveBeenCalled());await Promise.resolve();
 return {preview,window,target};
}
it('never authorizes a disclosure whose matching display identity is unknown (-1)',async()=>{
 fake.display.id=-1;const {preview}=await loaded(undefined,'-1');
 try{expect(preview.presented()).toBeUndefined();expect(preview.presented()).toBeUndefined();}finally{preview.clear();}
});
it('accepts a valid virtual unified desktop identity (-10) and rechecks it on release',async()=>{
 fake.display.id=-10;const {preview,target}=await loaded(undefined,'-10');
 try{expect(preview.presented()).toEqual(target);fake.display.id=-1;expect(preview.presented()).toBeUndefined();}finally{preview.clear();}
});
it('accepts a fully contained paragraph on a display with negative desktop coordinates',async()=>{
 fake.display.workArea={x:-1600,y:-900,width:1000,height:800};
 const {preview,target}=await loaded({x:-1500,y:-800,width:500,height:400});
 try{expect(preview.presented()).toEqual(target);}finally{preview.clear();}
});
it('refuses a partly clipped paragraph even if the remainder of the window is on the display',async()=>{
 const {preview}=await loaded({x:-100,y:100,width:500,height:400});
 try{expect(preview.presented()).toBeUndefined();}finally{preview.clear();}
});
it('rechecks the work area at release and never revives an invalidated preview',async()=>{
 const {preview,target}=await loaded();
 try{
  expect(preview.presented()).toEqual(target);fake.display.workArea={x:500,y:0,width:500,height:800};
  expect(preview.presented()).toBeUndefined();fake.display.workArea={x:0,y:0,width:1000,height:800};
  expect(preview.presented()).toBeUndefined();
 }finally{preview.clear();}
});
it('rejects a moved overlay, even when its paragraph still fits the desktop',async()=>{
 const {preview,window,target}=await loaded();
 try{expect(preview.presented()).toEqual(target);window.bounds.x++;expect(preview.presented()).toBeUndefined();}finally{preview.clear();}
});
it('rejects changed display identity, scale, and malformed work area on release',async()=>{
 for(const change of [()=>{fake.display.id=2;},()=>{fake.display.scaleFactor=2;},()=>{fake.display.workArea.width=NaN;},()=>{fake.display.workArea.width=0; }]){
  fake.display.id=1;fake.display.scaleFactor=1;fake.display.workArea={x:0,y:0,width:1000,height:800};
  const {preview,target}=await loaded();
  try{expect(preview.presented()).toEqual(target);change();expect(preview.presented()).toBeUndefined();}finally{preview.clear();}
 }
});
it('rejects a display query that becomes unavailable at release',async()=>{
 const {preview,target}=await loaded();
 try{expect(preview.presented()).toEqual(target);fake.unavailable=true;expect(preview.presented()).toBeUndefined();}finally{preview.clear();}
});
it('rejects a malformed local disclosure rectangle',async()=>{
 const target:NativeWindow={id:'window:42',osId:42,title:'Owned source',owner:{name:'Owned editor',processId:123},bounds:{x:100,y:100,width:500,height:400},displayId:'1',scaleFactor:1,documentToken:'owned-document',requiresExplicitCapture:true};
 const preview=createSourceDragPreview(()=>({x:0,y:0,width:74,height:64}));
 try{
  preview.show({kind:'target',title:target.title,ownerName:target.owner.name},target);const window=fake.Window.all.at(-1)!;
  window.webContents.executeJavaScript.mockResolvedValueOnce({fits:true,rect:{x:NaN,y:8,width:300,height:72}});window.resolve!();
  await vi.waitFor(()=>expect(window.webContents.executeJavaScript).toHaveBeenCalled());await Promise.resolve();expect(preview.presented()).toBeUndefined();
 }finally{preview.clear();}
});
it('rejects an overlay moved while its fit result is pending',async()=>{
 const target:NativeWindow={id:'window:42',osId:42,title:'Owned source',owner:{name:'Owned editor',processId:123},bounds:{x:100,y:100,width:500,height:400},displayId:'1',scaleFactor:1,documentToken:'owned-document',requiresExplicitCapture:true};
 const preview=createSourceDragPreview(()=>({x:0,y:0,width:74,height:64}));
 try{
  preview.show({kind:'target',title:target.title,ownerName:target.owner.name},target);const window=fake.Window.all.at(-1)!;
  let finish!:(value:{fits:boolean;rect:{x:number;y:number;width:number;height:number}})=>void;
  window.webContents.executeJavaScript.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));window.resolve!();
  await vi.waitFor(()=>expect(window.webContents.executeJavaScript).toHaveBeenCalled());window.bounds.x++;
  finish({fits:true,rect:{x:8,y:8,width:300,height:72}});await Promise.resolve();await Promise.resolve();expect(preview.presented()).toBeUndefined();
 }finally{preview.clear();}
});
