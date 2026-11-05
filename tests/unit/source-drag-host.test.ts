import {buildCodexInput} from '../../src/host/codex-provider';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {build} from 'esbuild';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import type {Companion} from '../../src/core/companion';
import {NativeSourceAdapter,placeCompanion,type NativeWindow,type NativeDependencies} from '../../src/host/native';
import {DEFAULT_CHARACTER} from '../../src/shared/character-catalog';
import {CaptureSettings} from '../../src/host/capture-settings';

const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
/** Production host + real core/settings/store; only OS windows and provider transport are inert. */
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'source-drag-host-')),key='sourceDragHost'+randomUUID().replaceAll('-','');
 await writeFile(join(directory,'character-preferences.json'),JSON.stringify({schemaVersion:1,revision:0,profile:DEFAULT_CHARACTER}));
 const target:NativeWindow={id:'window:42',osId:42,title:'Owned synthetic source',owner:{name:'Synthetic',processId:123,bundleId:'local.synthetic.source'},bounds:{x:300,y:100,width:500,height:400},displayId:'1',scaleFactor:2,documentToken:'metadata-42-v1',requiresExplicitCapture:true,knownProtected:false};
 const calls={captures:0,provider:0,dialogs:[] as string[],events:[] as any[]};
 const seams={buildCodexInput,placeCompanion,point:{x:20,y:20},target,workArea:{x:0,y:0,width:1800,height:1100},hit:undefined as undefined|(()=>Promise<NativeWindow|undefined>),inspect:undefined as undefined|((id:string)=>Promise<NativeWindow>),adapter:undefined as NativeSourceAdapter|undefined,previewVisible:false,response:1,permission:'granted',
  list:async()=>[seams.target],nativeInspect:async(id:string)=>seams.inspect?seams.inspect(id):seams.target,
  capture:async(id:string,options:any)=>{await options?.beforeCapture?.();options?.assertCurrent?.();calls.captures++;return {source:seams.target,sourceVersion:'capture-42',capturedAt:new Date().toISOString(),png:Buffer.from('owned-pixels'),dataUrl:'data:image/png;base64,b3duZWQ=',imageSha256:'owned-sha',transform:{fixture:true}};},
  confirm:async(_panel:unknown,detail:any)=>{calls.dialogs.push(detail.message);return {response:seams.response};},
  providerStatus:async()=>({provider:'Codex (temporary)',configured:true,endpoint:'fixture://none',model:'fixture',state:'ready'}),providerRun:async()=>{calls.provider++;return 'Synthetic output';}};
 Reflect.set(globalThis,key,seams);const seam=`globalThis[${JSON.stringify(key)}]`;
 const electron=`const noop=()=>{};export const app={isPackaged:false,getPath:()=>process.env.WINDOW_COMPANION_DATA_DIR,setPath:noop,isReady:()=>false,disableHardwareAcceleration:noop,whenReady:()=>new Promise(()=>{}),on:noop,quit:noop};export const Notification={isSupported:()=>false};export class BrowserWindow{bounds={x:0,y:0,width:1,height:1};webContents={setWindowOpenHandler:noop,on:noop,executeJavaScript:async()=>({fits:true,rect:{x:8,y:8,width:300,height:72}})};isDestroyed(){return false}isVisible(){return ${seam}.previewVisible}setIgnoreMouseEvents(){}setContentProtection(){}setBounds(value){this.bounds={...value}}getBounds(){return {...this.bounds}}hide(){${seam}.previewVisible=false}showInactive(){${seam}.previewVisible=true}close(){${seam}.previewVisible=false}on(){}getMediaSourceId(){return 'window:8:0'}loadURL(){return Promise.resolve()}};export const clipboard={};export class ClipboardItem{};export const Menu=undefined,Tray=class{},ipcMain={},nativeImage={},safeStorage={},session={};export const dialog={showMessageBox:(...args)=>${seam}.confirm(...args)};export const globalShortcut={register:()=>true,isRegistered:()=>false,unregister:noop,unregisterAll:noop};export const systemPreferences={isTrustedAccessibilityClient:()=>false};export const screen={getCursorScreenPoint:()=>${seam}.point,getDisplayMatching:()=>({id:1,scaleFactor:${seam}.adapter?1:2,workArea:${seam}.workArea})};`;
 const native=`export class NativeSourceAdapter{permissionStatus(){return ${seam}.adapter?${seam}.adapter.permissionStatus():Promise.resolve({screen:${seam}.permission,captureSupported:true,accessibility:'not-granted'})}foregroundWindow(){return ${seam}.adapter?${seam}.adapter.foregroundWindow():Promise.resolve(${seam}.target)}listWindows(){return ${seam}.adapter?${seam}.adapter.listWindows():${seam}.list()}inspect(id){return ${seam}.adapter?${seam}.adapter.inspect(id):${seam}.nativeInspect(id)}windowAtPoint(point,ignored){return ${seam}.adapter?${seam}.adapter.windowAtPoint(point,ignored):${seam}.hit?${seam}.hit():Promise.resolve(${seam}.target)}inspectProtection(id,pid){return ${seam}.adapter?${seam}.adapter.inspectProtection(id,pid):Promise.resolve({osId:Number(id.split(':')[1]),processId:pid,knownProtected:false})}capture(id,o){return ${seam}.adapter?${seam}.adapter.capture(id,o):${seam}.capture(id,o)}};export const placeCompanion=(...args)=>${seam}.placeCompanion(...args);`;
 const provider=`export const buildCodexInput=(...args)=>${seam}.buildCodexInput(...args);export class MetaProvider{status(){return ${seam}.providerStatus()}run(){return ${seam}.providerRun()}reset(){}close(){}};export class CodexProvider extends MetaProvider{}`;
 const outfile=join(directory,'production-host.mjs'),source=await readFile('src/host/index.ts','utf8');
 await build({stdin:{contents:source+'\nexport {command,validate,activateShortcut,installNativeSourceDrag,installNativeWindowMove,stopForQuit,attach,monitorAttached,fitCompact};export const placementState=()=>({placementMode,attachedWindowId,attachedOwnerProcessId,attachedSourceInfo,viewMode,panelBounds,compactFit,surfaceEpoch});export const setFloatingSave=value=>{floatingSave=value};export const setCore=async c=>{core=c;captureSettings=await CaptureSettings.open(dataDir);botPreferences=await BotPreferences.open(dataDir,core)};export const setPanel=p=>{panel=p};export const dragSettled=()=>sourceDrag.settled();export const setHealth=value=>{captureSettingsHealth=value};',resolveDir:resolve('src/host'),sourcefile:resolve('src/host/index.ts'),loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile,plugins:[{name:'inert-os-and-provider',setup(builder){builder.onResolve({filter:/^(electron|\.\/native|\.\/provider|\.\/codex-provider)$/},args=>({path:args.path,namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='electron'?electron:args.path==='./native'?native:provider,loader:'js'}));}}]});
 const previous=process.env.WINDOW_COMPANION_DATA_DIR;process.env.WINDOW_COMPANION_DATA_DIR=directory;let host:any;
 try{host=await import(/* @vite-ignore */pathToFileURL(outfile).href);}finally{if(previous===undefined)delete process.env.WINDOW_COMPANION_DATA_DIR;else process.env.WINDOW_COMPANION_DATA_DIR=previous;}
 const {createCompanion}=await import('../../src/core/companion');const core:Companion=await createCompanion({dataDir:join(directory,'store')});await host.setCore(core);
 let bounds={x:0,y:0,width:74,height:64},visible=true;const mouseListeners=new Map<string,Function>(),windowListeners=new Map<string,Function>();
 const panel={isDestroyed:()=>false,isVisible:()=>visible,getBounds:()=>bounds,getSize:()=>[bounds.width,bounds.height],getMediaSourceId:()=>'window:7:0',setMinimumSize:()=>{},setBounds:(value:typeof bounds)=>{bounds=value;},hide:()=>{visible=false;},show:()=>{visible=true;},showInactive:()=>{visible=true;},setAlwaysOnTop:()=>{},on:(name:string,handler:Function)=>{windowListeners.set(name,handler);},webContents:{on:(name:string,handler:Function)=>{mouseListeners.set(name,handler);},send:(_topic:string,event:any)=>{calls.events.push(event);if(event.type==='presentation.enter')void host.command({type:'presentation.show',entranceId:event.entranceId});}}};
 host.setPanel(panel);host.installNativeSourceDrag();host.installNativeWindowMove();
 cleanup.push(async()=>{await host.command({type:'source.drag.cancel'}).catch(()=>{});await core.close();Reflect.deleteProperty(globalThis,key);await rm(directory,{recursive:true,force:true});});
 const command=async(value:unknown):Promise<any>=>host.command(host.validate(value));
 const mouse=(type:string,button='left')=>{const event={preventDefault:vi.fn()};mouseListeners.get('before-mouse-event')?.(event,{type,button});return event;};
 const drop=async()=>{mouse('mouseDown');seams.point={x:400,y:150};mouse('mouseMove');const released=mouse('mouseUp');await host.dragSettled();return released;};
 const manualMove=(next:typeof bounds)=>{windowListeners.get('will-move')?.({},next);bounds={...next};};
 return {core,command,calls,seams,target,directory,shortcut:host.activateShortcut,drop,mouse,settled:host.dragSettled,bounds:()=>bounds,health:host.setHealth,blur:()=>windowListeners.get('blur')?.(),stop:host.stopForQuit,manualMove,position:panel.setBounds,placement:host.placementState,attach:host.attach,monitor:host.monitorAttached,fit:host.fitCompact,floatingSave:host.setFloatingSave};
}
async function showDropPreview(f:Awaited<ReturnType<typeof fixture>>){
 f.mouse('mouseDown');f.seams.point={x:400,y:150};f.mouse('mouseMove');
 await vi.waitFor(()=>{expect(f.calls.events.some(event=>event.type==='source.drag'&&event.state.kind==='target')).toBe(true);expect(f.seams.previewVisible).toBe(true);});
}
describe('native panel movement with production placement and inert OS signals',()=>{
 it('keeps source identity and follow polling while a manual compact move chooses free placement',async()=>{
  const f=await fixture();await f.attach('window:42','companion');const bound=f.placement(),manual={x:70,y:60,width:360,height:300};f.manualMove(manual);await f.monitor();
  expect(f.bounds()).toEqual(manual);expect(f.placement()).toMatchObject({placementMode:'detached',attachedWindowId:bound.attachedWindowId,attachedOwnerProcessId:bound.attachedOwnerProcessId,attachedSourceInfo:bound.attachedSourceInfo});expect(f.calls.captures).toBe(0);expect(f.calls.provider).toBe(0);
 });
 it('rejects an already awaiting automatic monitor reflow after a newer manual native move',async()=>{
  const f=await fixture();await f.attach('window:42','companion');let release!:()=>void,entered!:()=>void,inspections=0;const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  f.seams.inspect=async()=>{if(++inspections===2){entered();await gate;}return f.target;};const reflow=f.monitor();await started;const manual={x:80,y:70,width:360,height:310};f.manualMove(manual);release();await reflow;
  expect(f.bounds()).toEqual(manual);expect(f.placement()).toMatchObject({placementMode:'detached',attachedWindowId:'window:42'});expect(f.calls.captures).toBe(0);expect(f.calls.provider).toBe(0);
 });
 it('fits compact height at the user position when a native move wins source inspection',async()=>{
  const f=await fixture();await f.attach('window:42','companion');let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});f.seams.inspect=async()=>{entered();await gate;return f.target;};
  const fitting=f.fit({type:'surface.fit',fitId:f.placement().compactFit.id,height:330,phase:'settled'});await started;f.manualMove({x:90,y:80,width:360,height:300});release();expect(await fitting).toEqual({height:330,maxHeight:1100});expect(f.bounds()).toEqual({x:90,y:80,width:360,height:330});expect(f.placement()).toMatchObject({placementMode:'detached',attachedWindowId:'window:42'});expect(f.calls.captures).toBe(0);
 });
 it('retains automatic placement before a manual move and resumes it after explicit reopening',async()=>{
  const f=await fixture();await f.attach('window:42','companion');const initial=f.bounds();f.seams.target={...f.target,bounds:{...f.target.bounds,x:400}};await f.monitor();expect(f.bounds()).not.toEqual(initial);expect(f.placement().placementMode).toBe('attached');
  f.manualMove({x:50,y:70,width:360,height:300});await f.command({type:'surface.companion'});expect(f.placement()).toMatchObject({placementMode:'attached',attachedWindowId:'window:42'});expect(f.bounds().x).not.toBe(50);expect(f.calls.captures).toBe(0);expect(f.calls.provider).toBe(0);
 });
 it('records freely moved workspace bounds and leaves the source-drag anchor policy untouched',async()=>{
  const f=await fixture(),before=f.placement();f.manualMove({x:40,y:30,width:74,height:64});expect(f.placement()).toEqual(before);f.position({x:10,y:20,width:430,height:760});expect(f.placement()).toEqual(before);
  const manual={x:110,y:120,width:430,height:760};f.manualMove(manual);expect(f.placement()).toMatchObject({placementMode:'detached',panelBounds:manual});expect(f.calls.events.filter(event=>event.type==='context.activate')).toEqual([]);expect(f.calls.captures).toBe(0);expect(f.calls.provider).toBe(0);
 });
});
describe('production source drop integration, substituted OS only',()=>{
 it('a completed drop on its displayed reviewed target captures once without another manual confirmation',async()=>{
  const f=await fixture(),task=await f.core.createTask({title:'Owned displayed-drop task'});await f.command({type:'context.view',taskId:task.id});
  f.mouse('mouseDown');f.seams.point={x:400,y:150};f.mouse('mouseMove');
  await vi.waitFor(()=>{expect(f.calls.events.some(event=>event.type==='source.drag'&&event.state.kind==='target')).toBe(true);expect(f.seams.previewVisible).toBe(true);});
  f.mouse('mouseUp');await f.settled();const pending=await f.command({type:'context.pending'});
  expect(pending.kind).toBe('ready');const result=await f.command({type:'context.capture',activationId:pending.activation.activationId,windowId:'window:42',taskId:task.id});
  expect(result.state).toBe('captured');expect(f.calls.dialogs).toEqual([]);expect(f.calls.captures).toBe(1);expect(result.task.sources).toHaveLength(1);expect(f.calls.provider).toBe(0);
  expect((await f.command({type:'capture.settings.get'})).current.policy.setupApproval).toBe('not-approved');
 });
 it('never reuses a hidden target preview or silently authorizes a different released target',async()=>{
  for(const change of ['hidden','different-target'] as const){
   const f=await fixture(),task=await f.core.createTask({title:'Owned '+change});await f.command({type:'context.view',taskId:task.id});await showDropPreview(f);
   if(change==='hidden')f.seams.previewVisible=false;
   else f.seams.target={...f.target,id:'window:43',osId:43,title:'Other owned window',documentToken:'metadata-43-v1'};
   f.mouse('mouseUp');await f.settled();const pending=await f.command({type:'context.pending'});expect(pending.kind).toBe('ready');
   const result=await f.command({type:'context.capture',activationId:pending.activation.activationId,windowId:f.seams.target.id,taskId:task.id});
   expect(result.state).toBe('captured');expect(f.calls.dialogs).toEqual(['Take a screenshot of this window?']);expect(f.calls.provider).toBe(0);
  }
 });
 it('falls back to manual capture review when the displayed disclosure becomes clipped before release',async()=>{
  const f=await fixture(),task=await f.core.createTask({title:'Owned clipped-preview task'});await f.command({type:'context.view',taskId:task.id});await showDropPreview(f);
  f.seams.workArea={x:500,y:0,width:1300,height:1100};f.mouse('mouseUp');await f.settled();
  const pending=await f.command({type:'context.pending'});expect(pending.kind).toBe('ready');expect(f.calls.captures).toBe(0);
  const result=await f.command({type:'context.capture',activationId:pending.activation.activationId,windowId:'window:42',taskId:task.id});
  expect(result.state).toBe('captured');expect(f.calls.dialogs).toEqual(['Take a screenshot of this window?']);expect(f.calls.captures).toBe(1);expect(f.calls.provider).toBe(0);
 });
 it('a displayed drop is one-shot and cannot outlive a privacy change',async()=>{
  const f=await fixture(),task=await f.core.createTask({title:'Owned one-shot task'});await f.command({type:'context.view',taskId:task.id});await showDropPreview(f);f.mouse('mouseUp');await f.settled();
  const pending=await f.command({type:'context.pending'}),request={type:'context.capture',activationId:pending.activation.activationId,windowId:'window:42',taskId:task.id};
  expect((await f.command(request)).state).toBe('captured');await expect(f.command(request)).rejects.toThrow();expect(f.calls.captures).toBe(1);
  const next=await fixture(),other=await next.core.createTask({title:'Owned retired-drop task'});await next.command({type:'context.view',taskId:other.id});await showDropPreview(next);next.mouse('mouseUp');await next.settled();const stale=await next.command({type:'context.pending'});await next.command({type:'capture.settings.revoke',expectedRevision:0});
  await expect(next.command({type:'context.capture',activationId:stale.activation.activationId,windowId:'window:42',taskId:other.id})).rejects.toThrow();expect(next.calls.captures).toBe(0);expect(next.calls.provider).toBe(0);
 });
 it('a displayed drop cannot be consumed after its intake expires or is cancelled',async()=>{
  for(const retire of ['expired','cancelled'] as const){
   const f=await fixture(),task=await f.core.createTask({title:'Owned '+retire+' task'});await f.command({type:'context.view',taskId:task.id});await showDropPreview(f);f.mouse('mouseUp');await f.settled();const pending=await f.command({type:'context.pending'});
   const clock=retire==='expired'?vi.spyOn(Date,'now').mockReturnValue(Date.now()+120001):undefined;
   try{
    if(retire==='cancelled')await f.command({type:'context.cancel',activationId:pending.activation.activationId});
    await expect(f.command({type:'context.capture',activationId:pending.activation.activationId,windowId:'window:42',taskId:task.id})).rejects.toThrow();
    expect(f.calls.captures).toBe(0);expect((await f.core.getTask(task.id)).sources).toEqual([]);expect(f.calls.provider).toBe(0);
   }finally{clock?.mockRestore();}
  }
 });
 it('a shortcut-only setup does not silently grant the keyboard picker capture',async()=>{
  const f=await fixture(),task=await f.core.createTask({title:'Owned shortcut-only task'});await f.command({type:'context.view',taskId:task.id});
  const settings=await CaptureSettings.open(f.directory);await settings.update({kind:'approve-setup',expectedRevision:0,policyVersion:1,privateApps:[]});
  await f.command({type:'source.choose'});const pending=await f.command({type:'context.pending'});expect(pending.activation.origin).toBe('source-picker');
  expect((await f.command({type:'context.capture',activationId:pending.activation.activationId,windowId:'window:42',taskId:task.id})).state).toBe('captured');
  expect(f.calls.dialogs).toEqual(['Take a screenshot of this window?']);expect(f.calls.captures).toBe(1);expect(f.calls.provider).toBe(0);
 });
 it('keeps the exact one-snapshot drop through the explicit no-room recovery',async()=>{
  const f=await fixture(),task=await f.core.createTask({title:'Owned no-room task'});f.seams.target={...f.target,bounds:{x:0,y:0,width:1800,height:1100}};await f.command({type:'context.view',taskId:task.id});
  await showDropPreview(f);f.mouse('mouseUp');await f.settled();const pending=await f.command({type:'context.pending'}),request={type:'context.capture',activationId:pending.activation.activationId,windowId:'window:42',taskId:task.id};
  expect((await f.command(request)).state).toBe('no-room');expect(f.calls.captures).toBe(0);expect(f.calls.dialogs).toEqual([]);
  await f.command({type:'surface.standalone'});expect((await f.command(request)).state).toBe('captured');expect(f.calls.captures).toBe(1);expect(f.calls.dialogs).toEqual([]);expect(f.calls.provider).toBe(0);
 });
 it.each(['before-review','at-capture-fence'] as const)('blocks a selected drop if its exact native window becomes protected %s',async timing=>{
  const f=await fixture(),task=await f.core.createTask({title:'Owned protection-change task'});let protectedNow=false;
  const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12);png.writeUInt32BE(10,16);png.writeUInt32BE(10,20);
  const deps:NativeDependencies={platform:'darwin',permissionStatus:()=>({screen:'granted',accessibility:'not-granted',captureSupported:true}),
   openWindows:async()=>[{id:42,title:'Owned synthetic source',owner:{name:'Synthetic',processId:123,bundleId:'local.synthetic.source'},bounds:{x:300,y:100,width:500,height:400}}],
   windowAtPoint:async()=>({osId:42,processId:123,knownProtected:protectedNow}),getSources:async()=>[{id:'window:42:0',name:'Owned synthetic source'}],
   getDisplayMatching:()=>({id:1,bounds:{x:0,y:0,width:1800,height:1100},scaleFactor:1}),
   captureWindow:async(_id,fence)=>{if(timing==='at-capture-fence')protectedNow=true;await fence?.beforeCapture?.();fence?.assertCurrent?.();f.calls.captures++;return png;},resizePng:bytes=>bytes};
  Object.assign(deps,{windowProtection:async()=>({osId:42,processId:123,knownProtected:protectedNow})});
  f.seams.adapter=new NativeSourceAdapter(deps);await f.command({type:'context.view',taskId:task.id});await f.drop();
  const pending=await f.command({type:'context.pending'});expect(pending.kind).toBe('ready');if(timing==='before-review')protectedNow=true;
  const outcome=await f.command({type:'context.capture',activationId:pending.activation.activationId,windowId:'window:42',taskId:task.id}).then(()=>'captured',()=>'blocked');
  expect(outcome).toBe('blocked');expect(f.calls.captures).toBe(0);expect((await f.core.getTask(task.id)).sources).toEqual([]);expect(f.calls.provider).toBe(0);
 });
 it('binds the pinned task metadata and enters the shared one-shot review without shortcut authority or model work',async()=>{
  const f=await fixture(),task=await f.core.createTask({title:'Owned drop task'});await f.command({type:'context.view',taskId:task.id});
  const release=await f.drop();expect(release.preventDefault).toHaveBeenCalled();const pending=await f.command({type:'context.pending'});
  expect(pending.kind).toBe('ready');expect(pending.activation).toMatchObject({origin:'user-drop',intent:'attach',tucked:true,ownerTaskId:task.id,target:{id:'window:42'}});expect(pending.activation.trigger).toBeUndefined();expect(f.calls.captures).toBe(0);expect(f.calls.provider).toBe(0);
  const result=await f.command({type:'context.capture',activationId:pending.activation.activationId,windowId:'window:42',taskId:task.id});
  expect(result.state).toBe('captured');expect(result.task.sources[0].versions[0]).toMatchObject({kind:'window',windowId:'window:42',windowProcessId:123});expect(f.calls.dialogs).toEqual(['Take a screenshot of this window?']);expect(f.calls.captures).toBe(1);expect(f.calls.provider).toBe(0);expect((await f.command({type:'capture.settings.get'})).current.policy.setupApproval).toBe('not-approved');
  expect(f.calls.events.filter(event=>event.type==='surface'&&event.mode==='companion')).toHaveLength(1);
 });
 it.each(['unconfirmed','changing'])('does not arm, preview titles or bind when session health is already %s',async health=>{
  const f=await fixture();f.health(health);await f.drop();expect(await f.command({type:'context.pending'})).toEqual({kind:'none'});expect(f.calls.events.some(event=>event.type==='source.drag'&&event.state.kind==='target')).toBe(false);expect(f.bounds()).toEqual({x:0,y:0,width:74,height:64});expect(f.calls.captures).toBe(0);expect(f.calls.provider).toBe(0);
 });
 it('uses current private-app policy before disclosure or attachment',async()=>{
  const f=await fixture();await f.command({type:'capture.settings.private',expectedRevision:0,keep:[],windowIds:['window:42']});f.calls.dialogs=[];
  await f.drop();expect(await f.command({type:'context.pending'})).toEqual({kind:'none'});expect(f.calls.events.some(event=>event.type==='source.drag'&&event.state.kind==='target')).toBe(false);expect(f.calls.captures).toBe(0);expect(f.calls.provider).toBe(0);expect(f.calls.dialogs).toEqual([]);
 });
 it('preserves exact new-task attach intent through no-room and explicit detached capture',async()=>{
  const f=await fixture();f.seams.target={...f.target,bounds:{x:0,y:0,width:1800,height:1100}};await f.drop();const pending=await f.command({type:'context.pending'});
  expect(pending.activation).toMatchObject({newTask:true,intent:'attach',origin:'user-drop'});
  const command={type:'context.capture',activationId:pending.activation.activationId,windowId:'window:42'};
  expect((await f.command(command)).state).toBe('no-room');expect((await f.command({type:'context.pending'})).activation).toEqual(pending.activation);expect(f.calls.dialogs).toEqual([]);expect(f.calls.captures).toBe(0);
  await f.command({type:'surface.standalone'});expect((await f.command(command)).state).toBe('captured');expect(f.calls.dialogs).toEqual(['Take a screenshot of this window?']);expect(f.calls.provider).toBe(0);
 });
 it('keeps metadata binding honest when manual capture is cancelled and opens an attach-only picker for retry',async()=>{
  const f=await fixture();await f.drop();const pending=await f.command({type:'context.pending'}),attached=f.bounds();f.seams.response=0;
  await expect(f.command({type:'context.capture',activationId:pending.activation.activationId,windowId:'window:42'})).rejects.toThrow('Capture cancelled');expect(f.calls.captures).toBe(0);expect(f.bounds()).toEqual(attached);expect(await f.core.listTasks()).toEqual([]);
  await f.command({type:'source.choose'});const retry=await f.command({type:'context.pending'});expect(retry.activation).toMatchObject({origin:'source-picker',intent:'attach',newTask:true});expect(retry.activation.target).toBeUndefined();expect(retry.activation.choices).toHaveLength(1);expect(f.calls.provider).toBe(0);
 });
 it('rejects every renderer gesture/coordinate/identity/grant variant before any native work',async()=>{
  const f=await fixture();for(const type of ['source.drag.begin','source.drag.move','source.drag.drop'])await expect(f.command({type})).rejects.toThrow();
  for(const type of ['source.choose','source.drag.cancel'])for(const extra of [{point:{x:0,y:0}},{windowId:'window:42'},{target:f.target},{approved:true},{invocation:'shortcut'}])await expect(f.command({type,...extra})).rejects.toThrow();
  expect(f.calls.events).toEqual([]);expect(f.calls.captures).toBe(0);expect(f.calls.provider).toBe(0);
 });
 it.each(['requested-task','context','privacy','connection','focus','quit'])('retires a pending native result on %s without a late bind',async change=>{
  const f=await fixture();let resolveHit!:(target:NativeWindow)=>void;f.seams.hit=()=>new Promise(resolve=>{resolveHit=resolve;});
  f.mouse('mouseDown');f.seams.point={x:400,y:150};f.mouse('mouseMove');f.mouse('mouseUp');
  if(change==='requested-task'){const other=await f.core.createTask({title:'Requested task'});await f.command({type:'context.view',taskId:other.id});}
  if(change==='context')await f.command({type:'source.drag.cancel'});
  if(change==='privacy')await f.command({type:'capture.settings.revoke',expectedRevision:0});
  if(change==='connection')await f.command({type:'connection.disconnect'});
  if(change==='focus')f.blur();if(change==='quit')await f.stop();
  resolveHit(f.target);await f.settled();expect(f.calls.events.some(event=>event.type==='context.activate')).toBe(false);expect(f.calls.captures).toBe(0);expect(f.calls.provider).toBe(0);
 });
 it('fences a health change during an asynchronous exact-target inspection',async()=>{
  const f=await fixture();let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});f.seams.inspect=async()=>{await pending;return f.target;};
  f.mouse('mouseDown');f.seams.point={x:400,y:150};f.mouse('mouseMove');f.mouse('mouseUp');await Promise.resolve();f.health('unconfirmed');release();await f.settled();expect(f.calls.events.some(event=>event.type==='context.activate')).toBe(false);expect(f.calls.captures).toBe(0);expect(f.calls.provider).toBe(0);
 });
 it.each(['health','permission'])('opens readable recovery without enumerating targets when keyboard choice is blocked by %s',async reason=>{
  const f=await fixture(),list=vi.fn(f.seams.list);f.seams.list=list;if(reason==='health')f.health('unconfirmed');else f.seams.permission='denied';
  await expect(f.command({type:'source.choose'})).rejects.toThrow();expect(list).not.toHaveBeenCalled();expect(f.bounds().width).toBeGreaterThan(100);expect(f.calls.events.some(event=>event.type==='context.activate')).toBe(false);expect(f.calls.captures).toBe(0);expect(f.calls.provider).toBe(0);
 });
 it.each(['task','health','connection'])('does not recover a cached drop activation after its %s scope retires',async change=>{
  const f=await fixture();await f.drop();expect((await f.command({type:'context.pending'})).kind).toBe('ready');
  if(change==='task'){const task=await f.core.createTask({title:'New requested owner'});await f.command({type:'context.view',taskId:task.id});}
  if(change==='health')f.health('unconfirmed');if(change==='connection')await f.command({type:'connection.disconnect'});
  expect(await f.command({type:'context.pending'})).toEqual({kind:'none'});expect(f.calls.captures).toBe(0);expect(f.calls.provider).toBe(0);
 });
 it.each(['drop','picker'])('permanently retires a cached %s activation after task A to B to A without a recovery read between selections',async origin=>{
  const f=await fixture(),a=await f.core.createTask({title:'Original task A'}),b=await f.core.createTask({title:'Other task B'});
  await f.command({type:'context.view',taskId:a.id});if(origin==='drop')await f.drop();else await f.command({type:'source.choose'});
  expect((await f.command({type:'context.pending'})).kind).toBe('ready');
  await f.command({type:'context.view',taskId:b.id});await f.command({type:'context.view',taskId:a.id});
  expect(await f.command({type:'context.pending'})).toEqual({kind:'none'});expect(f.calls.dialogs).toEqual([]);expect(f.calls.captures).toBe(0);expect(f.calls.provider).toBe(0);
 });
 it.each(['drop','picker'])('rejects the old %s capture before any dialog or pixels after task A to B to A',async origin=>{
  const f=await fixture(),a=await f.core.createTask({title:'Original task A'}),b=await f.core.createTask({title:'Other task B'});
  await f.command({type:'context.view',taskId:a.id});if(origin==='drop')await f.drop();else await f.command({type:'source.choose'});
  const activation=(await f.command({type:'context.pending'})).activation;
  await f.command({type:'context.view',taskId:b.id});await f.command({type:'context.view',taskId:a.id});
  const outcome=await f.command({type:'context.capture',activationId:activation.activationId,windowId:'window:42',taskId:a.id}).then(()=>'accepted',()=>'rejected');
  expect({outcome,dialogs:f.calls.dialogs,captures:f.calls.captures,provider:f.calls.provider}).toEqual({outcome:'rejected',dialogs:[],captures:0,provider:0});
 });
 it.each(['drop','picker'])('rejects an awaiting %s capture when task A to B to A occurs during exact-target inspection',async origin=>{
  const f=await fixture(),a=await f.core.createTask({title:'Original task A'}),b=await f.core.createTask({title:'Other task B'});
  await f.command({type:'context.view',taskId:a.id});if(origin==='drop')await f.drop();else await f.command({type:'source.choose'});
  const activation=(await f.command({type:'context.pending'})).activation;
  let release!:()=>void,entered!:()=>void,held=true;
  const gate=new Promise<void>(resolve=>{release=resolve;}),inspectionStarted=new Promise<void>(resolve=>{entered=resolve;});
  f.seams.inspect=async()=>{if(held){held=false;entered();await gate;}return f.target;};
  const capture=f.command({type:'context.capture',activationId:activation.activationId,windowId:'window:42',taskId:a.id}).then(()=>'accepted',()=>'rejected');
  await inspectionStarted;await f.command({type:'context.view',taskId:b.id});await f.command({type:'context.view',taskId:a.id});release();
  expect({outcome:await capture,dialogs:f.calls.dialogs,captures:f.calls.captures,provider:f.calls.provider}).toEqual({outcome:'rejected',dialogs:[],captures:0,provider:0});
 });
 it.each(['drop','picker'])('keeps an idempotent same-task %s selection valid for its manual capture review',async origin=>{
  const f=await fixture(),a=await f.core.createTask({title:'Unchanged owner A'});await f.command({type:'context.view',taskId:a.id});
  if(origin==='drop')await f.drop();else await f.command({type:'source.choose'});
  const activation=(await f.command({type:'context.pending'})).activation;await f.command({type:'context.view',taskId:a.id});
  expect((await f.command({type:'context.pending'})).activation).toEqual(activation);
  expect((await f.command({type:'context.capture',activationId:activation.activationId,windowId:'window:42',taskId:a.id})).state).toBe('captured');expect(f.calls.dialogs).toEqual(['Take a screenshot of this window?']);expect(f.calls.captures).toBe(1);expect(f.calls.provider).toBe(0);
 });
});

 describe('source picker expansion waits preserve the current surface owner',()=>{
  it.each(['ready','unconfirmed'] as const)('retains its own expansion across pending floating placement with %s privacy',async health=>{
   const f=await fixture();f.health(health);let enter!:()=>void,release!:()=>void;const started=new Promise<void>(done=>enter=done),wait=new Promise<void>(done=>release=done);
   f.floatingSave({then(resolve:()=>void){enter();return wait.then(resolve);}});
   const choosing=f.command({type:'source.choose'}).then(()=>undefined,error=>error);await started;release();const error=await choosing;
   if(health==='ready'){expect(error).toBeUndefined();expect((await f.command({type:'context.pending'})).activation.origin).toBe('source-picker');}
   else{expect(error?.message).toContain('Review the current settings');expect(await f.command({type:'context.pending'})).toEqual({kind:'none'});}
   expect(f.bounds().width).toBeGreaterThan(100);expect(f.calls.captures).toBe(0);expect(f.calls.provider).toBe(0);
  });
  it('never lets a picker waiting on floating placement overwrite a newer attached surface',async()=>{
   const f=await fixture();let enter!:()=>void,release!:()=>void;const started=new Promise<void>(done=>enter=done),wait=new Promise<void>(done=>release=done);
   f.floatingSave({then(resolve:()=>void){enter();return wait.then(resolve);}});
   const choosing=f.command({type:'source.choose'}).then(()=>undefined,error=>error);await started;await f.attach('window:42','companion');const newer=f.bounds(),epoch=f.placement().surfaceEpoch;release();const error=await choosing;
   expect(error?.message).toBe('Source attachment cancelled.');expect(f.bounds()).toEqual(newer);expect(f.placement()).toMatchObject({viewMode:'companion',surfaceEpoch:epoch,attachedWindowId:'window:42'});expect(f.calls.events.some(event=>event.type==='context.activate')).toBe(false);expect(f.calls.captures).toBe(0);expect(f.calls.provider).toBe(0);
  });
 });

async function protectionFixture(){
 const f=await fixture(),task=await f.core.createTask({title:'Exact protected capture'});let protectedNow=false,checks=0;
 const window={id:42,title:'Owned synthetic source',owner:{name:'Synthetic',processId:123,bundleId:'local.synthetic.source'},bounds:{x:300,y:100,width:500,height:400}};
 const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12);png.writeUInt32BE(10,16);png.writeUInt32BE(10,20);
 const deps:NativeDependencies={platform:'darwin',permissionStatus:()=>({screen:'granted',accessibility:'not-granted',captureSupported:true}),openWindows:async()=>[window],activeWindow:async()=>window,getSources:async()=>[{id:'window:42:0',name:window.title}],getDisplayMatching:()=>({id:1,bounds:{x:0,y:0,width:1800,height:1100},scaleFactor:1}),captureWindow:async(_id,fence)=>{await fence?.beforeCapture?.();fence?.assertCurrent?.();f.calls.captures++;return png;},resizePng:bytes=>bytes};
 const protection=vi.fn(async()=>{checks++;return {osId:42,processId:123,knownProtected:protectedNow};});Object.assign(deps,{windowProtection:protection});
 f.seams.adapter=new NativeSourceAdapter(deps);await f.command({type:'context.view',taskId:task.id});
 const selectShortcut=async()=>{await f.shortcut();const pending=await f.command({type:'context.pending'});if(pending.kind!=='ready')throw Error('Missing focused shortcut');return {type:'context.capture',activationId:pending.activation.activationId,windowId:'window:42',taskId:task.id};};
 return {...f,task,deps,protection,selectShortcut,protect:()=>{protectedNow=true;},changeTitle:()=>{window.title='Different document after protection wait';},checks:()=>checks};
}

describe('exact native protection across capture entry points',()=>{
 it.each(['protected','backend-failure','missing','changed-owner'] as const)('focused shortcut refuses %s before setup, source or pixels',async reason=>{
  const f=await protectionFixture();if(reason==='protected')f.protect();else if(reason==='backend-failure')f.protection.mockRejectedValue(Error('Synthetic protection backend failed'));else if(reason==='missing')Reflect.deleteProperty(f.deps,'windowProtection');else f.protection.mockResolvedValue({osId:42,processId:124,knownProtected:false});
  const request=await f.selectShortcut();await expect(f.command(request)).rejects.toThrow();expect(f.calls.dialogs).toEqual([]);expect(f.calls.captures).toBe(0);expect((await f.core.getTask(f.task.id)).sources).toEqual([]);expect(f.calls.provider).toBe(0);expect((await f.command({type:'capture.settings.get'})).current.policy.setupApproval).toBe('not-approved');
 });
 it('unprotected focused shortcut succeeds through setup and repeated exact protection checks',async()=>{
  const f=await protectionFixture(),request=await f.selectShortcut(),result=await f.command(request);expect(result.state).toBe('captured');expect(f.calls.dialogs).toEqual(['Set up shortcut screenshots?']);expect(f.calls.captures).toBe(1);expect(result.task.sources[0].versions[0]).toMatchObject({windowId:'window:42',windowProcessId:123});expect(f.checks()).toBeGreaterThan(2);expect(f.calls.provider).toBe(0);
 });
 it('a protection change at the native capture fence refuses pixels after reviewed setup',async()=>{
  const f=await protectionFixture(),capture=f.deps.captureWindow!;f.deps.captureWindow=async(id,fence)=>{f.protect();return capture(id,fence);};
  await expect(f.command(await f.selectShortcut())).rejects.toThrow('protected');expect(f.calls.dialogs).toEqual(['Set up shortcut screenshots?']);expect(f.calls.captures).toBe(0);expect((await f.core.getTask(f.task.id)).sources).toEqual([]);expect(f.calls.provider).toBe(0);
 });
 it.each(['manual','update'] as const)('the %s capture entry point shares exact protection refusal',async mode=>{
  const f=await protectionFixture();let sourceId:string|undefined;if(mode==='update'){const saved=await f.command({type:'windows.capture',taskId:f.task.id,windowId:'window:42'});sourceId=saved.sources[0].id;}
  const before=await f.core.getTask(f.task.id),pixels=f.calls.captures,dialogs=f.calls.dialogs.length;f.protect();await expect(f.command({type:'windows.capture',taskId:f.task.id,windowId:'window:42',...(sourceId?{sourceId}:{})})).rejects.toThrow('protected');expect(f.calls.captures).toBe(pixels);expect(f.calls.dialogs).toHaveLength(dialogs);expect(await f.core.getTask(f.task.id)).toEqual(before);expect(f.calls.provider).toBe(0);
 });
});

it('cached preview rechecks exact metadata after an awaited protection result',async()=>{
 const f=await protectionFixture(),saved=await f.command({type:'windows.capture',taskId:f.task.id,windowId:'window:42'}),source=saved.sources[0];
 f.protection.mockImplementationOnce(async()=>{f.changeTitle();return {osId:42,processId:123,knownProtected:false};});
 expect(await f.command({type:'source.preview',taskId:f.task.id,sourceId:source.id})).toBeNull();expect((await f.core.getTask(f.task.id)).sources[0]).toEqual(source);const checks=f.checks();expect(await f.command({type:'source.preview',taskId:f.task.id,sourceId:source.id})).toBeNull();expect(f.checks()).toBe(checks);expect(f.calls.captures).toBe(1);expect(f.calls.provider).toBe(0);
});
