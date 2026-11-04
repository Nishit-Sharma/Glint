import {afterEach,describe,expect,it,vi} from 'vitest';
import {createSourceDragPreview} from '../../src/host/source-drag-preview';
import type {NativeWindow} from '../../src/host/native';

const electron=vi.hoisted(()=>{
 class Window{
  static all:Window[]=[];
  closed=0;shown=0;hidden=0;protected=false;clickThrough=false;visible=false;
  loads:Array<{url:string;resolve:()=>void;reject:()=>void}>=[];
  bounds={x:0,y:0,width:1,height:1};events=new Map<string,()=>void>();
  constructor(public options:Electron.BrowserWindowConstructorOptions){Window.all.push(this);}
  setIgnoreMouseEvents(value:boolean){this.clickThrough=value;}
  setContentProtection(value:boolean){this.protected=value;}
  setBounds(value:typeof this.bounds){this.bounds={...value};} getBounds(){return {...this.bounds};}
  hide(){this.hidden++;this.visible=false;}
  isDestroyed(){return this.closed>0;}
  isVisible(){return this.visible;}
  close(){this.closed++;this.visible=false;this.events.get('closed')?.();}
  showInactive(){this.shown++;this.visible=true;}
  getMediaSourceId(){return 'window:7:0';}
  on(event:string,handler:()=>void){this.events.set(event,handler);}
  webContents={setWindowOpenHandler:vi.fn(),on:vi.fn(),executeJavaScript:vi.fn(async()=>({fits:true,rect:{x:8,y:8,width:250,height:72}}))};
  loadURL(url:string){return new Promise<void>((resolve,reject)=>{this.loads.push({url,resolve,reject:()=>reject(Error('superseded navigation'))});});}
 }
 return {Window};
});
vi.mock('electron',()=>({BrowserWindow:electron.Window,screen:{getDisplayMatching:()=>({id:1,scaleFactor:2,workArea:{x:0,y:0,width:1920,height:1080}})}}));
afterEach(()=>{electron.Window.all=[];});
const target:NativeWindow={id:'window:42',osId:42,title:'<script>private & escaped</script>',owner:{name:'Synthetic',processId:123},bounds:{x:300,y:100,width:500,height:400},displayId:'1',scaleFactor:2,documentToken:'metadata-v1',requiresExplicitCapture:true};
describe('owned source metadata preview, Electron substitute only',()=>{
 it('exposes the exact target only while its reviewed preview is loaded and visible',async()=>{
  const preview=createSourceDragPreview(()=>({x:0,y:0,width:74,height:64}));
  preview.show({kind:'target',title:target.title,ownerName:'Synthetic'},target);const window=electron.Window.all[0];
  expect(preview.presented()).toBeUndefined();window.loads[0].resolve();await vi.waitFor(()=>expect(preview.presented()).toEqual(target));
  window.hide();expect(preview.presented()).toBeUndefined();preview.clear();expect(preview.presented()).toBeUndefined();
 });
 it('does not reuse visible consent for a different window with the same displayed text',async()=>{
  const preview=createSourceDragPreview(()=>({x:0,y:0,width:74,height:64})),state={kind:'target' as const,title:target.title,ownerName:'Synthetic'};
  preview.show(state,target);const window=electron.Window.all[0];window.loads[0].resolve();await vi.waitFor(()=>expect(preview.presented()).toEqual(target));
  preview.show(state,{...target,id:'window:43',osId:43,documentToken:'metadata-43'});expect(preview.presented()).toBeUndefined();expect(window.loads).toHaveLength(2);
  window.loads[1].resolve();await vi.waitFor(()=>expect(preview.presented()?.id).toBe('window:43'));preview.clear();
 });
 it('does not authorize a clipped label or one whose full identity cannot fit the displayed limit',async()=>{
  const preview=createSourceDragPreview(()=>({x:0,y:0,width:74,height:64})),state={kind:'target' as const,title:'Short title',ownerName:'Synthetic'};
  preview.show(state,{...target,title:state.title});const window=electron.Window.all[0];window.webContents.executeJavaScript.mockResolvedValueOnce({fits:false,rect:{x:8,y:8,width:250,height:72}});window.loads[0].resolve();await vi.waitFor(()=>expect(window.webContents.executeJavaScript).toHaveBeenCalled());await Promise.resolve();expect(preview.presented()).toBeUndefined();
  preview.show({...state,title:'x'.repeat(161)},{...target,title:'x'.repeat(161)});window.loads[1].resolve();await Promise.resolve();expect(preview.presented()).toBeUndefined();preview.clear();
 });
 it('creates one nonactivating click-through protected window with escaped metadata and no remote content',async()=>{
  const preview=createSourceDragPreview(()=>({x:0,y:0,width:74,height:64}));
  preview.show({kind:'target',title:target.title,ownerName:'Synthetic'},target);const window=electron.Window.all[0];
  expect(window.options).toMatchObject({show:false,focusable:false,skipTaskbar:true,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});
  expect(window.clickThrough).toBe(true);expect(window.protected).toBe(true);expect(window.shown).toBe(0);
  const html=decodeURIComponent(window.loads[0].url);expect(html).toContain('&lt;script&gt;private &amp; escaped&lt;/script&gt;');expect(html).toContain('Release to attach and capture one local snapshot');expect(html).toContain('Nothing is sent or followed automatically.');expect(html).toContain('Esc to cancel');expect(html).toContain('Synthetic');expect(html).toContain("default-src 'none'");expect(html).not.toContain('<script>');
  window.loads[0].resolve();await Promise.resolve();expect(window.shown).toBe(1);expect(preview.ids()).toEqual(['window:7']);preview.clear();expect(preview.ids()).toEqual([]);
 });
 it('does not let an older rejected load close or show a newer preview',async()=>{
  const preview=createSourceDragPreview(()=>({x:0,y:0,width:74,height:64}));
  preview.show({kind:'searching'});preview.show({kind:'blocked',message:'Choose another source.'});const window=electron.Window.all[0];
  window.loads[0].reject();await Promise.resolve();await Promise.resolve();expect(window.closed).toBe(0);expect(window.shown).toBe(0);
  window.loads[1].resolve();await Promise.resolve();expect(window.shown).toBe(1);preview.clear();
 });
 it('does not show a pending load after cancellation or replace the new owned window',async()=>{
  const preview=createSourceDragPreview(()=>({x:0,y:0,width:74,height:64}));
  preview.show({kind:'searching'});const old=electron.Window.all[0];preview.clear();preview.show({kind:'blocked',message:'Choose another source.'});const current=electron.Window.all[1];
  old.loads[0].resolve();await Promise.resolve();expect(old.shown).toBe(0);expect(current.closed).toBe(0);
  current.loads[0].resolve();await Promise.resolve();expect(current.shown).toBe(1);preview.clear();
 });
 it('deduplicates pending content and never shows it before its owned load finishes',async()=>{
  const preview=createSourceDragPreview(()=>({x:0,y:0,width:74,height:64}));
  preview.show({kind:'searching'});preview.show({kind:'searching'});const window=electron.Window.all[0];
  expect(window.loads).toHaveLength(1);expect(window.shown).toBe(0);window.loads[0].resolve();await Promise.resolve();preview.show({kind:'searching'});expect(window.shown).toBe(2);expect(electron.Window.all).toHaveLength(1);preview.clear();
 });
 it('fails closed if target status has no exact native metadata',()=>{
  const preview=createSourceDragPreview(()=>({x:0,y:0,width:74,height:64}));preview.show({kind:'target',title:'Unbound title',ownerName:'Unknown'});expect(electron.Window.all).toEqual([]);preview.clear();
 });
 it('denies remote windows and clears on unexpected navigation or renderer failure',async()=>{
  const preview=createSourceDragPreview(()=>({x:0,y:0,width:74,height:64}));preview.show({kind:'searching'});const window=electron.Window.all[0];
  const open=window.webContents.setWindowOpenHandler.mock.calls[0]?.[0];if(typeof open!=='function')throw Error('Missing window-open rejection.');expect(open()).toEqual({action:'deny'});
  const registrations=window.webContents.on.mock.calls;
  const navigation=registrations.find(([event])=>event==='will-navigate')?.[1];const preventDefault=vi.fn();
  if(typeof navigation!=='function')throw Error('Missing navigation rejection.');navigation({preventDefault});expect(preventDefault).toHaveBeenCalled();expect(window.closed).toBe(1);expect(preview.ids()).toEqual([]);
  window.loads[0].resolve();await Promise.resolve();expect(window.shown).toBe(0);preview.clear();
 });
 it('clears on renderer failure and rejects its later successful load',async()=>{
  const preview=createSourceDragPreview(()=>({x:0,y:0,width:74,height:64}));preview.show({kind:'searching'});const window=electron.Window.all[0];
  const crashed=window.webContents.on.mock.calls.find(([event])=>event==='render-process-gone')?.[1];if(typeof crashed!=='function')throw Error('Missing renderer-failure cleanup.');crashed();
  window.loads[0].resolve();await Promise.resolve();expect(window.closed).toBe(1);expect(window.shown).toBe(0);expect(preview.ids()).toEqual([]);preview.clear();
 });
});
