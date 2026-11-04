import {afterEach,expect,it} from 'vitest';
import {build} from 'esbuild';
import {mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createCompanion,type Companion} from '../src/core/companion';
import {parseScreenBriefModel} from '../src/core/screen-brief';
import {placeCompanion,type NativeCapture,type NativeWindow} from '../src/host/native';
import type {DocumentSourceFollow} from '../src/host/document-source-follow';
import type {Command} from '../src/shared/bridge';
import {DEFAULT_CHARACTER} from '../src/shared/character-catalog';
import {createComposerDrafts} from '../src/renderer/src/composer-drafts';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {LearningDraftStore} from '../src/host/learning-drafts';
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
function hold(){let release!:()=>void,enter!:()=>void;return {wait:new Promise<void>(resolve=>release=resolve),started:new Promise<void>(resolve=>enter=resolve),release:()=>release(),enter:()=>enter()};}
interface HostHarness{dispatch(c:Command):Promise<unknown>;command(c:Command):Promise<unknown>;validate(c:unknown):Command;documentFollow:DocumentSourceFollow;setCore(core:Companion):Promise<void>;setPanel(panel:unknown):void;selectTask(taskId:string,windowId:string):void;captureCache:Map<string,unknown>;beginQuit():Promise<void>;stopMonitor():void}
async function fixture(){
 const root=resolve('.'),directory=await mkdtemp(join(tmpdir(),'document-source-host-')),key='documentHost'+randomUUID().replaceAll('-','');
 const settings={schemaVersion:1,revision:1,policy:{policyVersion:1,setupApproval:'approved',privateApps:[]}};
 await writeFile(join(directory,'capture-settings.json'),JSON.stringify(settings));await writeFile(join(directory,'character-preferences.json'),JSON.stringify({schemaVersion:1,revision:0,profile:DEFAULT_CHARACTER}));
 const calls={pixels:0,metadata:0,transports:0,providerSignals:[] as AbortSignal[],confirmations:[] as {message:string;detail?:string}[],events:[] as unknown[]};
 const target:NativeWindow={id:'window:41',osId:41,title:'Same title A and B',owner:{name:'Owned synthetic source',processId:88,bundleId:'local.synthetic.source'},bounds:{x:0,y:0,width:600,height:700},displayId:'1',scaleFactor:1,documentToken:'unchanged-title-geometry',requiresExplicitCapture:true};
 const state={edited:undefined as boolean|undefined,inspectHook:undefined as undefined|(()=>Promise<void>),captureBytes:32,pixelHook:undefined as undefined|((id:string)=>Promise<void>),viewSaveGate:undefined as ReturnType<typeof hold>|undefined,targets:[target],documentHook:undefined as undefined|(()=>Promise<void>),foreground:target as NativeWindow|undefined,digest:'a'.repeat(64),screen:'granted',trusted:true,room:true,response:1,rendererEvent:undefined as undefined|((event:any)=>void),quitFlush:undefined as undefined|((id:string)=>void),documentGate:undefined as ReturnType<typeof hold>|undefined,pixelGate:undefined as ReturnType<typeof hold>|undefined,providerGate:undefined as ReturnType<typeof hold>|undefined};
 const seams={calls,state,placeCompanion,confirm:async(_panel:unknown,detail:{message:string;detail?:string})=>{calls.confirmations.push(detail);return {response:state.response}},
  readDocument:async()=>{calls.metadata++;await state.documentHook?.();state.documentGate?.enter();await state.documentGate?.wait;return {kind:'document',processId:88,digest:state.digest,...(state.edited===undefined?{}:{edited:state.edited})}},
  provider:async(input:{signal:AbortSignal;captureFence?:{check():Promise<void>;assertCurrent():void}})=>{calls.providerSignals.push(input.signal);state.providerGate?.enter();await state.providerGate?.wait;await input.captureFence?.check();input.captureFence?.assertCurrent();calls.transports++;return 'Synthetic result'},
  native:{foregroundWindow:async()=>state.foreground,listWindows:async()=>state.targets,inspect:async(id:string)=>{await state.inspectHook?.();const window=state.targets.find(window=>window.id===id);if(!window)throw Error('Synthetic source closed');return window},permissionStatus:async()=>({screen:state.screen,accessibility:state.trusted?'granted':'not-granted',captureSupported:true}),capture:async(id:string,options:{beforeCapture?:()=>Promise<void>;assertCurrent?:()=>void})=>{
   await state.pixelHook?.(id);state.pixelGate?.enter();await state.pixelGate?.wait;await options.beforeCapture?.();options.assertCurrent?.();calls.pixels++;
   const selected=state.targets.find(window=>window.id===id);if(!selected)throw Error('Synthetic source closed');return {source:selected,sourceVersion:'fixture-capture-'+calls.pixels,capturedAt:new Date().toISOString(),png:Buffer.alloc(state.captureBytes,calls.pixels),dataUrl:'data:image/png;base64,AA==',imageSha256:'fixture-image-'+calls.pixels,transform:{fixture:true,sequence:calls.pixels}};
  }},
 };
 Reflect.set(globalThis,key,seams);const seam=`globalThis[${JSON.stringify(key)}]`;
 const electron=`const noop=()=>{};export const app={getPath:()=>process.env.WINDOW_COMPANION_DATA_DIR,setPath:noop,isReady:()=>false,disableHardwareAcceleration:noop,whenReady:()=>new Promise(()=>{}),on:noop};export const Notification={isSupported:()=>false};export class BrowserWindow{};export const Menu={};export class Tray{};export const dialog={showMessageBox:(...a)=>${seam}.confirm(...a)};export const globalShortcut={unregisterAll:noop,isRegistered:()=>false};export const ipcMain={};export const nativeImage={};export const clipboard={write:()=>{throw Error('Clipboard is outside this fixture action.')}};export const ClipboardItem=class{};export const safeStorage={};export const systemPreferences={isTrustedAccessibilityClient:()=>false};export const session={};export const screen={getDisplayMatching:()=>({workArea:${seam}.state.room?{x:0,y:0,width:1800,height:1100}:{x:0,y:0,width:600,height:700}})};`;
 const provider=`export {buildCodexInput} from ${JSON.stringify(join(root,'src/host/codex-provider.ts'))};export class MetaProvider{accountScope(){return Promise.resolve('inert-fixture-account')};status(){return Promise.resolve({configured:true,provider:'Codex (temporary)',endpoint:'fixture://no-network',model:'fixture',state:'ready'})};run(input){return ${seam}.provider(input)};reset(){};close(){}};export class CodexProvider extends MetaProvider{defaultInference(){return {provider:"codex",model:"gpt-6-luna",effort:"medium",tier:"priority"}};cachedCatalog(){return {kind:"unavailable",message:"Inert fixture catalogue"}};async statusFor(selection){return {...await this.status(),model:selection.model,reasoning:selection.effort,tier:selection.tier}}}`;
 const native=`export class NativeSourceAdapter{inspectProtection(id,pid){return Promise.resolve({osId:Number(id.split(':')[1]),processId:pid,knownProtected:false})};foregroundWindow(){return ${seam}.native.foregroundWindow()};listWindows(){return ${seam}.native.listWindows()};inspect(id){return ${seam}.native.inspect(id)};capture(id,options){return ${seam}.native.capture(id,options)};permissionStatus(){return ${seam}.native.permissionStatus()}};export const placeCompanion=(...a)=>${seam}.placeCompanion(...a);`;
 const docExec=`import {promisify} from 'node:util';export function execFile(){};execFile[promisify.custom]=async()=>({stdout:JSON.stringify(await ${seam}.readDocument())});`;
 const viewFs=`import * as fs from 'node:fs/promises';export const mkdir=fs.mkdir,open=fs.open,readFile=fs.readFile,rm=fs.rm;export const rename=async(...args)=>{const gate=${seam}.state.viewSaveGate;if(gate){gate.enter();await gate.wait;}return fs.rename(...args)};`;
 const outfile=join(directory,'host.mjs'),hostSource=await readFile(join(root,'src/host/index.ts'),'utf8');
 if(!hostSource.includes("ipcMain.handle('companion:command',dispatchCompanionCommand)"))throw Error('The production companion IPC handler was not found.');
 await build({stdin:{contents:hostSource+`\nexport const dispatch=value=>dispatchCompanionCommand({sender:panel.webContents,senderFrame:panel.webContents.mainFrame},value);\nexport {command,validate,documentFollow,beginQuit};export const stopMonitor=()=>{if(monitor)clearInterval(monitor)};export const setCore=async c=>{core=c;captureSettings=await CaptureSettings.open(dataDir);botPreferences=await BotPreferences.open(dataDir,core)};export const setPanel=p=>{panel=p};export const selectTask=(taskId,windowId)=>{currentViewTaskId=taskId;attachedWindowId=windowId};export const captureCache=captures;`,resolveDir:join(root,'src/host'),sourcefile:join(root,'src/host/index.ts'),loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile,plugins:[{name:'owned-os-fixture',setup(b){
  b.onResolve({filter:/^node:fs\/promises$/},a=>a.importer.endsWith('/task-view-preferences.ts')?{path:a.path,namespace:'fixture-view-fs'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture-view-fs'},()=>({contents:viewFs,loader:'js'}));
  b.onResolve({filter:/^node:child_process$/},a=>a.importer.endsWith('/document-source-native.ts')?{path:a.path,namespace:'fixture-doc'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture-doc'},()=>({contents:docExec,loader:'js'}));
  b.onResolve({filter:/^(electron|\.\/provider|\.\/codex-provider|\.\/native)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='electron'?electron:a.path==='./native'?native:provider,loader:'js',resolveDir:join(root,'src/host')}));
 }}]});
 await symlink(join(root,'node_modules'),join(directory,'node_modules'),'dir');
 const previousNoInput=process.env.WINDOW_COMPANION_TEST_NO_GLOBAL_INPUT;process.env.WINDOW_COMPANION_TEST_NO_GLOBAL_INPUT='1';const previous=process.env.WINDOW_COMPANION_DATA_DIR;process.env.WINDOW_COMPANION_DATA_DIR=directory;let host:HostHarness;
 try{host=await import(/* @vite-ignore */pathToFileURL(outfile).href)}finally{if(previous===undefined)delete process.env.WINDOW_COMPANION_DATA_DIR;else process.env.WINDOW_COMPANION_DATA_DIR=previous;if(previousNoInput===undefined)delete process.env.WINDOW_COMPANION_TEST_NO_GLOBAL_INPUT;else process.env.WINDOW_COMPANION_TEST_NO_GLOBAL_INPUT=previousNoInput;}
 const core=await createCompanion({dataDir:join(directory,'store')});await host.setCore(core);
 host.setPanel({isDestroyed:()=>false,isVisible:()=>true,getSize:()=>[360,440],getBounds:()=>({x:620,y:0,width:360,height:440}),webContents:{send:(_channel:string,event:any)=>{calls.events.push(event);state.rendererEvent?.(event);if(event.type==='draft.flush')state.quitFlush?.(event.quitId)}}});
 const task=await core.createTask({title:'Synthetic task A'});host.selectTask(task.id,target.id);await host.command({type:'context.view',taskId:task.id});
 cleanups.push(async()=>{host.stopMonitor();host.documentFollow.stop();await core.close();Reflect.deleteProperty(globalThis,key);await rm(directory,{recursive:true,force:true});});
 return {host,core,state,calls,target,task,directory,capture:()=>host.command({type:'windows.capture',taskId:task.id,windowId:target.id})};
}

async function cancelQuit(f:Awaited<ReturnType<typeof fixture>>){
 f.state.response=0;f.state.quitFlush=id=>{void f.host.command({type:'draft.flushed',quitId:id,error:'Synthetic unfinished local draft'});};
 await f.host.beginQuit();f.state.response=1;
 return (f.calls.events as {type:string;quitId?:string}[]).filter(event=>event.type==='draft.flush').at(-1)!.quitId!;
}
it('actual App live unsaved error passes strict quit IPC into Keep app open and resumes without mutation',async()=>{
 const f=await fixture(),store=new LearningDraftStore({directory:f.directory,lookupTask:async id=>(await f.core.listTasks()).find(task=>task.id===id)}),cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await cache.load();
 const composer=createComposerDrafts((taskId,revision,value)=>f.core.saveComposerDraft(taskId,revision,value)),source=await readFile('src/renderer/src/App.tsx','utf8'),start=source.indexOf("e => { if(e.type==='draft.flush')"),end=source.indexOf("if(e.type==='capture.retired')",start);if(start<0||end<start)throw Error('Actual App quit callback missing.');
 const before=await f.core.contentSnapshot(),acks:Command[]=[],quitDraftId={current:undefined as string|undefined};let dirty=true;
 const handler=new Function('quitDraftId','drafts','learningDrafts','setDraftFrozen','bridge','draftNavigation','return e=>{'+source.slice(start+'e => {'.length,end)+'};')(quitDraftId,composer,cache,()=>{},{invoke:async(command:Command)=>{acks.push(command);return f.host.dispatch(command);}},{api:{hasDirty:()=>dirty}});
 f.state.rendererEvent=handler;f.state.response=0;await f.host.beginQuit();
 expect(f.calls.confirmations.at(-1)).toMatchObject({message:'Quit without saving unfinished work?',detail:expect.stringContaining('Some form edits are still unsaved.')});expect(acks).toHaveLength(1);expect(acks[0]).toMatchObject({type:'draft.flushed',error:expect.stringContaining('unsaved')});expect(cache.getSnapshot().frozen).toBe(false);expect(quitDraftId.current).toBeUndefined();expect(dirty).toBe(true);expect(await f.core.contentSnapshot()).toEqual(before);
 await expect(f.host.dispatch({...acks[0],saved:true} as unknown as Command)).rejects.toThrow();dirty=false;expect(f.calls.pixels).toBe(0);expect(f.calls.metadata).toBe(0);expect(f.calls.transports).toBe(0);
});
it('admits a new explicit context capture after Keep app open without reviving old follow or captures',async()=>{
 const f=await fixture();await f.capture();await f.host.command({type:'source.follow.enable'});
 const before={metadata:f.calls.metadata,pixels:f.calls.pixels,transports:f.calls.transports};
 await cancelQuit(f);await f.host.documentFollow.poll();
 expect(f.host.captureCache.size).toBe(0);expect(f.host.documentFollow.read().kind).toBe('off');
 expect({metadata:f.calls.metadata,pixels:f.calls.pixels,transports:f.calls.transports}).toEqual(before);
 await f.host.dispatch({type:'context.start',ownerTaskId:f.task.id});
 const pending=await f.host.command({type:'context.pending'}) as {kind:string;activation:{activationId:string}};expect(pending.kind).toBe('ready');
 const captured=await f.host.dispatch({type:'context.capture',activationId:pending.activation.activationId,windowId:f.target.id,taskId:f.task.id}) as {state:string};
 expect(captured.state).toBe('captured');expect(f.calls.pixels).toBe(before.pixels+1);expect(f.calls.transports).toBe(0);
 expect(f.host.documentFollow.read()).toMatchObject({kind:'bound',automaticSnapshots:'off'});
 expect(f.calls.confirmations.at(-1)?.message).toBe('Capture this window?');
});


it.each(['metadata','pixels'] as const)('a pre-quit %s capture stays retired after a fresh post-cancel gesture',async boundary=>{
 const f=await fixture(),gate=hold();if(boundary==='metadata')f.state.documentGate=gate;else f.state.pixelGate=gate;
 const old=f.capture(),rejected=expect(old).rejects.toThrow();await gate.started;
 await cancelQuit(f);f.state.documentGate=undefined;f.state.pixelGate=undefined;
 expect(f.calls.pixels).toBe(0);expect(f.calls.transports).toBe(0);expect(f.host.captureCache.size).toBe(0);
 try{await f.capture();expect(f.calls.pixels).toBe(1);}finally{gate.release();await rejected;}
 const task=await f.core.getTask(f.task.id);expect(task.sources).toHaveLength(1);expect(f.calls.pixels).toBe(1);expect(f.calls.transports).toBe(0);
});
it('retires the old model signal and accepts only a fresh capture plus separately confirmed future request',async()=>{
 const f=await fixture();await f.capture();const oldSource=(await f.core.getTask(f.task.id)).sources[0],gate=hold();f.state.providerGate=gate;
 const old=f.host.command({type:'model.run',taskId:f.task.id,requestId:'before-quit',kind:'explain',prompt:'Owned old request'}),rejected=expect(old).rejects.toThrow();await gate.started;
 const oldSignal=f.calls.providerSignals[0];expect(oldSignal.aborted).toBe(false);await cancelQuit(f);
 expect(oldSignal.aborted).toBe(true);expect(f.calls.transports).toBe(0);expect(f.host.captureCache.size).toBe(0);expect(f.host.documentFollow.read().kind).toBe('off');
 expect(await f.host.command({type:'source.preview',taskId:f.task.id,sourceId:oldSource.id})).toBe(null);
 gate.release();await rejected;expect(f.calls.transports).toBe(0);
 f.state.providerGate=undefined;try{await f.capture();const refreshed=await f.core.getTask(f.task.id),source=refreshed.sources.at(-1)!,version=source.versions.at(-1)!;
 await f.host.dispatch({type:'model.run',taskId:f.task.id,requestId:'after-quit',kind:'explain',prompt:'Owned fresh request',sourceIds:[source.id],expectedSourceRefs:[{sourceId:source.id,version:version.version,digest:version.digest}]});
 expect(f.calls.transports).toBe(1);expect(f.calls.providerSignals[1].aborted).toBe(false);expect(oldSignal.aborted).toBe(true);
 }finally{gate.release();await rejected;}const task=await f.core.getTask(f.task.id);
 expect(task.requests.find(r=>r.id==='before-quit')?.status).toBe('cancelled');expect(task.requests.find(r=>r.id==='after-quit')?.status).toBe('completed');expect(task.artifacts).toHaveLength(1);expect(f.calls.transports).toBe(1);
 expect(f.calls.confirmations.filter(c=>c.message.startsWith('Send this request'))).toHaveLength(2);
});
it('late quit IDs cannot resume a second quit or authorize a gesture while its barrier is pending',async()=>{
 const f=await fixture(),oldId=await cancelQuit(f);f.state.quitFlush=undefined;f.state.response=0;
 let settled=false;const second=f.host.beginQuit().then(()=>{settled=true;});
 await expect.poll(()=>f.calls.events.filter((e:any)=>e.type==='draft.flush').length).toBe(2);
 const newId=(f.calls.events.filter((e:any)=>e.type==='draft.flush').at(-1) as {quitId:string}).quitId;expect(newId).not.toBe(oldId);
 await f.host.command({type:'draft.flushed',quitId:oldId});await Promise.resolve();expect(settled).toBe(false);
 await expect(f.host.dispatch({type:'context.start',ownerTaskId:f.task.id})).rejects.toThrow();expect(f.calls.pixels).toBe(0);expect(f.calls.metadata).toBe(0);
 await f.host.command({type:'draft.flushed',quitId:newId,error:'Second owned local draft held'});await second;f.state.response=1;
 expect(f.calls.events.filter((e:any)=>e.type==='draft.resume').map((e:any)=>e.quitId)).toEqual([oldId,newId]);
 await f.capture();expect(f.calls.pixels).toBe(1);expect(f.calls.transports).toBe(0);
});
it('Keep app open retains current private-app exclusions and never restores snapshots or a follow grant',async()=>{
 const f=await fixture();const result=await f.host.dispatch({type:'capture.settings.private',expectedRevision:1,keep:[],windowIds:[f.target.id]}) as {kind:string};expect(result.kind).toBe('saved');
 const settings=await readFile(join(f.directory,'capture-settings.json'),'utf8');await cancelQuit(f);
 expect(await readFile(join(f.directory,'capture-settings.json'),'utf8')).toBe(settings);expect(await f.host.command({type:'capture.settings.get'})).toMatchObject({sessionPaused:false,current:{revision:2,policy:{privateApps:[{kind:'bundle-id',value:'local.synthetic.source'}]}}});
 await expect(f.capture()).rejects.toThrow('This app is private.');expect(f.calls.metadata).toBe(0);expect(f.calls.pixels).toBe(0);expect(f.calls.transports).toBe(0);expect(f.host.documentFollow.read().kind).toBe('off');
});
it.each(['permission','protected','consent'] as const)('a new post-cancel gesture still refuses a current %s denial',async reason=>{
 const f=await fixture();await cancelQuit(f);if(reason==='permission')f.state.screen='not-granted';if(reason==='protected')f.state.targets=[{...f.target,knownProtected:true}];if(reason==='consent')f.state.response=0;
 await expect(f.capture()).rejects.toThrow();expect(f.calls.metadata).toBe(0);expect(f.calls.pixels).toBe(0);expect(f.calls.transports).toBe(0);
});

it('retires an earlier context gesture and requires a fresh one after cancelled quit',async()=>{
 const f=await fixture();await f.host.dispatch({type:'context.start',ownerTaskId:f.task.id});
 const old=await f.host.command({type:'context.pending'}) as {kind:string;activation:{activationId:string}};expect(old.kind).toBe('ready');await cancelQuit(f);
 expect(await f.host.command({type:'context.pending'})).toEqual({kind:'none'});
 await expect(f.host.dispatch({type:'context.capture',activationId:old.activation.activationId,windowId:f.target.id,taskId:f.task.id})).rejects.toThrow();expect(f.calls.pixels).toBe(0);expect(f.calls.metadata).toBe(0);expect(f.calls.transports).toBe(0);
 await f.host.dispatch({type:'context.start',ownerTaskId:f.task.id});const fresh=await f.host.command({type:'context.pending'}) as typeof old;expect(fresh.activation.activationId).not.toBe(old.activation.activationId);
 expect(await f.host.dispatch({type:'context.capture',activationId:fresh.activation.activationId,windowId:f.target.id,taskId:f.task.id})).toMatchObject({state:'captured'});expect(f.calls.pixels).toBe(1);expect(f.calls.transports).toBe(0);
});
