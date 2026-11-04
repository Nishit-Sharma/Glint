import {afterEach,expect,it,vi} from 'vitest';
const electron=vi.hoisted(()=>{
 class Window{
  static all:Window[]=[];
  protection:boolean[]=[];destroyed=false;visible=false;bounds={x:0,y:0,width:1,height:1};events=new Map<string,Function>();
  webContents={setWindowOpenHandler(){},on(){},getOSProcessId:()=>731,executeJavaScript:async()=>({fits:true,rect:{x:8,y:8,width:250,height:72}})};
  constructor(public options:any){Window.all.push(this);}
  get protected(){return this.protection.at(-1);}
  setContentProtection(value:boolean){this.protection.push(value);}
  setIgnoreMouseEvents(){} setBounds(value:typeof this.bounds){this.bounds={...value};} getBounds(){return {...this.bounds};}
  isDestroyed(){return this.destroyed;} isVisible(){return this.visible;} hide(){this.visible=false;} showInactive(){this.visible=true;}
  close(){this.destroyed=true;this.visible=false;this.events.get('closed')?.();}
  on(name:string,handler:Function){this.events.set(name,handler);}
  getMediaSourceId(){return 'window:731:0';}
  async loadURL(){}
 }
 return {Window};
});
vi.mock('electron',()=>({BrowserWindow:electron.Window,screen:{getPrimaryDisplay:()=>({workArea:{x:0,y:0,width:1200,height:800}}),getDisplayMatching:()=>({id:1,scaleFactor:2,workArea:{x:0,y:0,width:1920,height:1080}})}}));
import {createScreenRecordingProtection} from '../../src/host/screen-recording';
import {NotificationToast} from '../../src/host/notification-toast';
import {createSourceDragPreview} from '../../src/host/source-drag-preview';
import {readScreenRecordingCommand,readScreenRecordingState} from '../../src/shared/screen-recording';
afterEach(()=>{electron.Window.all=[];});
const fake=()=>new electron.Window({});

it('starts protected, applies a change immediately to every tracked window and to windows created later, and restores protection',()=>{
 const protection=createScreenRecordingProtection(),panel=fake(),toast=fake();
 expect(protection.state()).toEqual({allowed:false,confirmed:true,scope:'this-session'});
 protection.track(panel);protection.track(toast);expect([panel.protected,toast.protected]).toEqual([true,true]);
 expect(protection.set(true)).toEqual({allowed:true,confirmed:true,scope:'this-session'});expect([panel.protected,toast.protected]).toEqual([false,false]);
 const later=fake();protection.track(later);expect(later.protection).toEqual([false]);
 protection.set(false);expect([panel.protected,toast.protected,later.protected]).toEqual([true,true,true]);
 const afterOff=fake();protection.track(afterOff);expect(afterOff.protection).toEqual([true]);
});

it('keeps credential windows protected whatever the choice, including credential windows opened while capture is allowed',()=>{
 const protection=createScreenRecordingProtection(),panel=fake(),credential=fake();
 protection.track(panel);protection.track(credential,'credential');protection.set(true);
 expect(panel.protected).toBe(false);expect(credential.protection).toEqual([true,true]);
 const laterCredential=fake();protection.track(laterCredential,'credential');expect(laterCredential.protection).toEqual([true]);
 protection.set(false);protection.set(true);expect(credential.protection.every(Boolean)).toBe(true);expect(laterCredential.protection.every(Boolean)).toBe(true);
});

it('resets to protected on every launch because the choice is held only in memory',()=>{
 const first=createScreenRecordingProtection();first.set(true);expect(first.state().allowed).toBe(true);
 const relaunch=createScreenRecordingProtection(),panel=fake();relaunch.track(panel);
 expect(relaunch.state()).toEqual({allowed:false,confirmed:true,scope:'this-session'});expect(panel.protection).toEqual([true]);
});

it('skips destroyed windows and restores protection everywhere if any window cannot be changed',()=>{
 const protection=createScreenRecordingProtection(),gone=fake(),healthy=fake(),broken=fake();
 protection.track(gone);protection.track(healthy);protection.track(broken);gone.destroyed=true;
 protection.set(true);expect(gone.protection).toEqual([true]);expect(healthy.protected).toBe(false);
 protection.set(false);broken.setContentProtection=function(value:boolean){if(!value)throw Error('native failure');this.protection.push(value);};
 expect(()=>protection.set(true)).toThrow('Glint windows are protected.');
 expect(protection.state()).toEqual({allowed:false,confirmed:true,scope:'this-session'});expect(healthy.protected).toBe(true);expect(broken.protected).toBe(true);
});

it('reports unconfirmed protection, never a protected state, when re-protecting a window also fails',()=>{
 const protection=createScreenRecordingProtection(),healthy=fake(),stuck=fake();
 protection.track(healthy);protection.track(stuck);protection.set(true);
 stuck.setContentProtection=function(){throw Error('native failure');};
 expect(()=>protection.set(false)).toThrow('may be visible to screen recording');
 expect(protection.state()).toEqual({allowed:false,confirmed:false,scope:'this-session'});expect(healthy.protected).toBe(true);expect(stuck.protected).toBe(false);
 stuck.setContentProtection=function(value:boolean){this.protection.push(value);};
 expect(protection.set(false)).toEqual({allowed:false,confirmed:true,scope:'this-session'});expect(stuck.protected).toBe(true);
});

it('routes the production toast and drag-preview windows through the shared choice, and keeps their protected defaults',async()=>{
 const protection=createScreenRecordingProtection();protection.set(true);
 const toast=new NotificationToast(()=>{},()=>()=>{},window=>protection.track(window));toast.show('notice','Title','Body');
 const toastWindow=electron.Window.all.at(-1)!;expect(toastWindow.protection).toEqual([false]);
 const preview=createSourceDragPreview(()=>({x:0,y:0,width:74,height:64}),window=>protection.track(window));preview.show({kind:'searching'});
 const previewWindow=electron.Window.all.at(-1)!;expect(previewWindow).not.toBe(toastWindow);expect(previewWindow.protection).toEqual([false]);
 protection.set(false);expect([toastWindow.protected,previewWindow.protected]).toEqual([true,true]);
 toast.clear();preview.clear();
 const defaultToast=new NotificationToast(()=>{},()=>()=>{});defaultToast.show('notice','Title','Body');expect(electron.Window.all.at(-1)!.protection).toEqual([true]);
 const defaultPreview=createSourceDragPreview(()=>({x:0,y:0,width:74,height:64}));defaultPreview.show({kind:'searching'});expect(electron.Window.all.at(-1)!.protection).toEqual([true]);
 defaultToast.clear();defaultPreview.clear();await defaultToast.close();
});

it('accepts only exact screen recording commands and host replies',()=>{
 expect(readScreenRecordingCommand({type:'screen-recording.get'})).toEqual({type:'screen-recording.get'});
 expect(readScreenRecordingCommand({type:'screen-recording.set',allowed:true})).toEqual({type:'screen-recording.set',allowed:true});
 for(const input of [null,[],'screen-recording.set',{type:'screen-recording.set'},{type:'screen-recording.set',allowed:'true'},{type:'screen-recording.set',allowed:1},{type:'screen-recording.set',allowed:true,window:'all'},{type:'screen-recording.get',allowed:true},{type:'screen-recording.persist',allowed:true}])
  expect(()=>readScreenRecordingCommand(input)).toThrow('Invalid screen recording setting.');
 expect(readScreenRecordingState({allowed:true,confirmed:true,scope:'this-session'})).toEqual({allowed:true,confirmed:true,scope:'this-session'});expect(readScreenRecordingState({allowed:false,confirmed:false,scope:'this-session'})).toEqual({allowed:false,confirmed:false,scope:'this-session'});
 for(const input of [{allowed:true},{allowed:true,scope:'this-session'},{allowed:'yes',confirmed:true,scope:'this-session'},{allowed:true,confirmed:'yes',scope:'this-session'},{allowed:true,confirmed:true,scope:'saved'},{allowed:true,confirmed:true,scope:'this-session',extra:1}])
  expect(()=>readScreenRecordingState(input)).toThrow();
});
