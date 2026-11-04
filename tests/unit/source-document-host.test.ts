import {prepareWindowWorkflowSourceContext} from '../../src/core/window-workflow-host';
import {parseWindowWorkflowProposal} from '../../src/learning/window-workflow-proposal';
import {WINDOW_WORKFLOW_MIME} from '../../src/shared/window-workflow-artifact';
import {windowWorkflowReviewSnapshot} from '../../src/learning/window-workflow-review';
import {syntheticCandidate,syntheticReviewDraft} from '../support/window-learning.fixture';
import {buildCodexInput} from '../../src/host/codex-provider';
import {afterEach,expect,it,vi} from 'vitest';
import {build} from 'esbuild';
import {mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createCompanion,type Companion} from '../../src/core/companion';
import {parseScreenBriefModel} from '../../src/core/screen-brief';
import {placeCompanion,type NativeCapture,type NativeWindow} from '../../src/host/native';
import type {DocumentSourceFollow} from '../../src/host/document-source-follow';
import type {Command} from '../../src/shared/bridge';
import {DEFAULT_CHARACTER} from '../../src/shared/character-catalog';
import {artifactContextUncertain} from '../../src/core/request-context';
import {sourceAffectedWork} from '../../src/renderer/src/source-affected-work';
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
function hold(){let release!:()=>void,enter!:()=>void;return {wait:new Promise<void>(resolve=>release=resolve),started:new Promise<void>(resolve=>enter=resolve),release:()=>release(),enter:()=>enter()};}
interface HostHarness{dispatch(c:Command):Promise<unknown>;command(c:Command):Promise<unknown>;validate(c:unknown):Command;documentFollow:DocumentSourceFollow;setCore(core:Companion):Promise<void>;setPanel(panel:unknown):void;selectTask(taskId:string,windowId:string):void;captureCache:Map<string,unknown>;beginQuit():Promise<void>;stopForQuit():Promise<void>}
async function fixture(){
 const root=resolve('..'),directory=await mkdtemp(join(tmpdir(),'document-source-host-')),key='documentHost'+randomUUID().replaceAll('-','');
 const settings={schemaVersion:1,revision:1,policy:{policyVersion:1,setupApproval:'approved',privateApps:[]}};
 await writeFile(join(directory,'capture-settings.json'),JSON.stringify(settings));await writeFile(join(directory,'character-preferences.json'),JSON.stringify({schemaVersion:1,revision:0,profile:DEFAULT_CHARACTER}));
 const calls={pixels:0,metadata:0,transports:0,confirmations:[] as {message:string;detail?:string;buttons?:string[];defaultId?:number;cancelId?:number}[],events:[] as unknown[],protection:[] as {windowId:string;processId:number;knownProtected:boolean}[],providerEntries:0,outgoing:[] as string[],signals:[] as AbortSignal[]};
 const target:NativeWindow={id:'window:41',osId:41,title:'Same title A and B',owner:{name:'Owned synthetic source',processId:88,bundleId:'local.synthetic.source'},bounds:{x:0,y:0,width:600,height:700},displayId:'1',scaleFactor:1,documentToken:'unchanged-title-geometry',requiresExplicitCapture:true};
 const state={captureHash:undefined as string|undefined,captureTransform:undefined as Record<string,unknown>|undefined,knownProtected:false,protectionHook:undefined as undefined|(()=>Promise<void>),rejectQuit:false,resultGate:undefined as ReturnType<typeof hold>|undefined,edited:undefined as boolean|undefined,inspectHook:undefined as undefined|(()=>Promise<void>),captureBytes:32,pixelHook:undefined as undefined|((id:string)=>Promise<void>),viewSaveGate:undefined as ReturnType<typeof hold>|undefined,targets:[target],documentHook:undefined as undefined|(()=>Promise<void>),foreground:target as NativeWindow|undefined,digest:'a'.repeat(64),screen:'granted',trusted:true,room:true,response:1,documentGate:undefined as ReturnType<typeof hold>|undefined,pixelGate:undefined as ReturnType<typeof hold>|undefined,providerGate:undefined as ReturnType<typeof hold>|undefined};
 const seams={calls,state,placeCompanion,buildCodexInput,confirm:async(_panel:unknown,detail:{message:string;detail?:string})=>{calls.confirmations.push(detail);return {response:state.response}},
  readDocument:async()=>{calls.metadata++;await state.documentHook?.();state.documentGate?.enter();await state.documentGate?.wait;return {kind:'document',processId:88,digest:state.digest,...(state.edited===undefined?{}:{edited:state.edited})}},
  provider:async(input:any)=>{calls.providerEntries++;calls.signals.push(input.signal);state.providerGate?.enter();await state.providerGate?.wait;await input.captureFence?.check();input.captureFence?.assertCurrent();calls.transports++;calls.outgoing.push(JSON.stringify(buildCodexInput(input)));state.resultGate?.enter();await state.resultGate?.wait;return 'Synthetic result'},
  native:{inspectProtection:async(id:string,pid:number)=>{await state.protectionHook?.();const target=state.targets.find(target=>target.id===id);if(!target||target.owner.processId!==pid)throw Error('Synthetic exact protection owner unavailable');const result={osId:target.osId,processId:pid,knownProtected:state.knownProtected};calls.protection.push({windowId:id,processId:pid,knownProtected:result.knownProtected});return result;},foregroundWindow:async()=>state.foreground,listWindows:async()=>state.targets,inspect:async(id:string)=>{await state.inspectHook?.();const window=state.targets.find(window=>window.id===id);if(!window)throw Error('Synthetic source closed');return window},permissionStatus:async()=>({screen:state.screen,accessibility:state.trusted?'granted':'not-granted',captureSupported:true}),capture:async(id:string,options:{beforeCapture?:()=>Promise<void>;assertCurrent?:()=>void})=>{
   await state.pixelHook?.(id);state.pixelGate?.enter();await state.pixelGate?.wait;await options.beforeCapture?.();options.assertCurrent?.();calls.pixels++;
   const selected=state.targets.find(window=>window.id===id);if(!selected)throw Error('Synthetic source closed');return {source:selected,sourceVersion:'fixture-capture-'+calls.pixels,capturedAt:new Date(Date.now()).toISOString(),png:Buffer.alloc(state.captureBytes,calls.pixels),dataUrl:'data:image/png;base64,AA==',imageSha256:state.captureHash??'fixture-image-'+calls.pixels,transform:state.captureTransform??{fixture:true,sequence:calls.pixels}};
  }},
 };
 Reflect.set(globalThis,key,seams);const seam=`globalThis[${JSON.stringify(key)}]`;
 const electron=`const noop=()=>{};export const app={getPath:()=>process.env.WINDOW_COMPANION_DATA_DIR,setPath:noop,isReady:()=>false,disableHardwareAcceleration:noop,whenReady:()=>new Promise(()=>{}),on:noop};export const Notification={isSupported:()=>false};export class BrowserWindow{};export const clipboard={};export class ClipboardItem{};export const Menu={};export class Tray{};export const dialog={showMessageBox:(...a)=>${seam}.confirm(...a)};export const globalShortcut={unregisterAll:noop};export const ipcMain={};export const nativeImage={};export const safeStorage={};export const systemPreferences={isTrustedAccessibilityClient:()=>false};export const session={};export const screen={getDisplayMatching:()=>({workArea:${seam}.state.room?{x:0,y:0,width:1800,height:1100}:{x:0,y:0,width:600,height:700}})};`;
 const provider=`export const buildCodexInput=(...args)=>${seam}.buildCodexInput(...args);export class MetaProvider{accountScope(){return Promise.resolve('synthetic-account')};defaultInference(){return {provider:'codex',model:'synthetic',effort:'medium',tier:'default'}};statusFor(){return this.status()};status(){return Promise.resolve({configured:true,provider:'Codex (temporary)',endpoint:'fixture://no-network',model:'fixture',state:'ready'})};run(input){return ${seam}.provider(input)};reset(){};close(){}};export class CodexProvider extends MetaProvider{}`;
 const native=`export class NativeSourceAdapter{inspectProtection(id,pid){return ${seam}.native.inspectProtection(id,pid)};foregroundWindow(){return ${seam}.native.foregroundWindow()};listWindows(){return ${seam}.native.listWindows()};inspect(id){return ${seam}.native.inspect(id)};capture(id,options){return ${seam}.native.capture(id,options)};permissionStatus(){return ${seam}.native.permissionStatus()}};export const placeCompanion=(...a)=>${seam}.placeCompanion(...a);`;
 const docExec=`import {promisify} from 'node:util';export function execFile(){};execFile[promisify.custom]=async()=>({stdout:JSON.stringify(await ${seam}.readDocument())});`;
 const viewFs=`import * as fs from 'node:fs/promises';export const mkdir=fs.mkdir,open=fs.open,readFile=fs.readFile,rm=fs.rm;export const rename=async(...args)=>{const gate=${seam}.state.viewSaveGate;if(gate){gate.enter();await gate.wait;}return fs.rename(...args)};`;
 const outfile=join(directory,'host.mjs'),hostSource=await readFile(join(root,'src/host/index.ts'),'utf8');
 if(!hostSource.includes("ipcMain.handle('companion:command',dispatchCompanionCommand)"))throw Error('The production companion IPC handler was not found.');
 await build({stdin:{contents:hostSource+`\nexport const dispatch=value=>dispatchCompanionCommand({sender:panel.webContents,senderFrame:panel.webContents.mainFrame},value);\nexport {command,validate,documentFollow,beginQuit,stopForQuit};export const setCore=async c=>{core=c;captureSettings=await CaptureSettings.open(dataDir);botPreferences=await BotPreferences.open(dataDir,core)};export const setPanel=p=>{panel=p};export const selectTask=(taskId,windowId)=>{currentViewTaskId=taskId;attachedWindowId=windowId};export const captureCache=captures;`,resolveDir:join(root,'src/host'),sourcefile:join(root,'src/host/index.ts'),loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile,plugins:[{name:'owned-os-fixture',setup(b){
  b.onResolve({filter:/^node:fs\/promises$/},a=>a.importer.endsWith('/task-view-preferences.ts')?{path:a.path,namespace:'fixture-view-fs'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture-view-fs'},()=>({contents:viewFs,loader:'js'}));
  b.onResolve({filter:/^node:child_process$/},a=>a.importer.endsWith('/document-source-native.ts')?{path:a.path,namespace:'fixture-doc'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture-doc'},()=>({contents:docExec,loader:'js'}));
  b.onResolve({filter:/^(electron|\.\/provider|\.\/codex-provider|\.\/native)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='electron'?electron:a.path==='./native'?native:provider,loader:'js'}));
 }}]});
 await symlink(join(root,'node_modules'),join(directory,'node_modules'),'dir');
 const previous=process.env.WINDOW_COMPANION_DATA_DIR,previousGlobalInput=process.env.WINDOW_COMPANION_TEST_NO_GLOBAL_INPUT;process.env.WINDOW_COMPANION_DATA_DIR=directory;process.env.WINDOW_COMPANION_TEST_NO_GLOBAL_INPUT='1';let host:HostHarness;
 try{host=await import(/* @vite-ignore */pathToFileURL(outfile).href)}finally{if(previous===undefined)delete process.env.WINDOW_COMPANION_DATA_DIR;else process.env.WINDOW_COMPANION_DATA_DIR=previous;if(previousGlobalInput===undefined)delete process.env.WINDOW_COMPANION_TEST_NO_GLOBAL_INPUT;else process.env.WINDOW_COMPANION_TEST_NO_GLOBAL_INPUT=previousGlobalInput;}
 const core=await createCompanion({dataDir:join(directory,'store')});await host.setCore(core);
 host.setPanel({isDestroyed:()=>false,isVisible:()=>true,getSize:()=>[360,440],getBounds:()=>({x:620,y:0,width:360,height:440}),webContents:{send:(_channel:string,event:any)=>{calls.events.push(event);if(state.rejectQuit&&event.type==='draft.flush')void host.command({type:'draft.flushed',quitId:event.quitId,error:'Synthetic retained draft keeps the test app open'});}}});
 const task=await core.createTask({title:'Synthetic task A'});host.selectTask(task.id,target.id);await host.command({type:'context.view',taskId:task.id});
 let monitorStarted=false;
 cleanups.push(async()=>{if(monitorStarted)await host.stopForQuit();host.documentFollow.stop();await core.close();Reflect.deleteProperty(globalThis,key);await rm(directory,{recursive:true,force:true});});
 async function startMonitor(){
  let tick:undefined|(()=>void);const registrations:number[]=[],originalInterval=globalThis.setInterval;
  const intervals=vi.spyOn(globalThis,'setInterval').mockImplementation((handler:any,delay?:number,...args:any[])=>{registrations.push(delay??0);if(delay===2000){if(typeof handler!=='function')throw Error('Expected the actual production monitor callback.');tick=()=>handler(...args);}const timer=originalInterval(()=>{},2_147_483_647);timer.unref();return timer;});
  state.rejectQuit=true;state.response=0;
  try{await host.beginQuit();monitorStarted=true;}finally{state.rejectQuit=false;state.response=1;intervals.mockRestore();}
  if(!tick)throw Error('The production Keep app open path did not register its monitor.');
  return {tick,registrations};
 }
 return {host,core,state,calls,target,task,directory,startMonitor,capture:()=>host.command({type:'windows.capture',taskId:task.id,windowId:target.id})};
}
it('normal host initialization reads no document metadata, captures nothing, and v1 setup grants no follow',async()=>{
 const f=await fixture();expect(await f.host.command({type:'source.follow.get'})).toMatchObject({kind:'off',capabilityVersion:1});expect(f.calls.metadata).toBe(0);expect(f.calls.pixels).toBe(0);expect(f.calls.transports).toBe(0);
 await expect(f.host.command({type:'source.follow.enable'})).rejects.toThrow('Choose a window');
 expect(()=>f.host.validate({type:'source.follow.enable',approved:true,windowId:f.target.id})).toThrow('Unknown document follow field');
});
it.each([0,1])('visible-content snapshots require their distinct native choice, not cancel/address choice %s',async response=>{
 const f=await fixture();f.state.captureHash='a'.repeat(64);f.state.captureTransform={fixture:true};await f.capture();f.state.response=response;
 await f.host.dispatch({type:'source.follow.enable'});await f.host.documentFollow.poll();
 expect(f.calls.pixels).toBe(1);expect((await f.core.getTask(f.task.id)).sources[0].currentVersion).toBe(1);
 const review=f.calls.confirmations.at(-1)!;expect(review).toMatchObject({buttons:['Cancel','Follow address changes','Follow visible content'],defaultId:0,cancelId:0});expect(review.detail).toContain('capture pixels even at an unchanged address');expect(review.detail).toContain('hidden/offscreen');
 expect(()=>f.host.validate({type:'source.follow.enable',scope:'visible-content'})).toThrow('Unknown document follow field');expect(f.calls.transports).toBe(0);
});
it('visible-content monitor publishes same-address pixel changes with inherited impact but no automatic recompute or send',async()=>{
 const f=await fixture();f.state.captureHash='a'.repeat(64);f.state.captureTransform={fixture:true};const monitor=await f.startMonitor();await f.capture();const original=await f.core.getTask(f.task.id),source=original.sources[0],reference={sourceId:source.id,version:1,digest:source.versions[0].digest};
 await f.core.saveArtifact(f.task.id,{title:'Direct result',content:'Old direct result',sourceRefs:[reference]});const inherited=await f.core.saveArtifact(f.task.id,{title:'Inherited result',content:'Old inherited result',sourceRefs:[reference]});await f.core.saveArtifact(f.task.id,{artifactId:inherited.artifactId,expectedRevision:1,title:'Inherited result',content:'Exact inherited text',sourceRefs:[]});
 await f.host.dispatch({type:'source-selection.set',taskId:f.task.id,expectedRevision:0,sourceIds:[]});const before=await f.core.getTask(f.task.id),window=structuredClone(f.target);
 f.state.response=2;await f.host.dispatch({type:'source.follow.enable'});f.state.captureHash='b'.repeat(64);monitor.tick();
 await vi.waitFor(async()=>expect((await f.core.getTask(f.task.id)).sources[0].currentVersion).toBe(2));const task=await f.core.getTask(f.task.id);
 expect(task.sources[0].versions[1].documentStamp?.digest).toBe(source.versions[0].documentStamp?.digest);expect(task.sources[0].freshness).toBe('fresh');expect(task.artifacts).toEqual(before.artifacts);expect(task.session?.sourceSelection?.sourceIds).toEqual([]);expect(task.requests).toEqual([]);expect(task.actions).toEqual([]);expect(f.target).toEqual(window);
 const affected=sourceAffectedWork(task,source.id);expect(affected).toHaveLength(2);expect(affected.find(entry=>entry.item.id===inherited.artifactId)).toMatchObject({refs:[],inheritedRefs:[reference]});expect(f.calls.pixels).toBe(2);expect(f.calls.transports).toBe(0);expect(f.calls.providerEntries).toBe(0);expect(f.calls.outgoing).toEqual([]);
});
it('identical visible pixels retain exact unexpired binding and expiry, then renew an expired snapshot as a new version',async()=>{
 const f=await fixture();f.state.captureHash='a'.repeat(64);f.state.captureTransform={fixture:true};await f.capture();const before=await f.core.getTask(f.task.id),source=before.sources[0],key=`${f.task.id}:${source.id}`,bound=f.host.captureCache.get(key);
 f.state.response=2;await f.host.dispatch({type:'source.follow.enable'});await f.host.documentFollow.poll();expect(await f.core.getTask(f.task.id)).toEqual(before);expect(f.host.captureCache.get(key)).toBe(bound);expect(f.calls.pixels).toBe(2);expect(f.host.documentFollow.read().reason).toContain('unexpired');
 const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+300001);
 try{await f.host.documentFollow.poll();const task=await f.core.getTask(f.task.id);expect(task.sources[0].currentVersion).toBe(2);expect(task.sources[0].versions[0]).toEqual(source.versions[0]);expect(JSON.parse(task.sources[0].versions[1].content).imageSha256).toBe('a'.repeat(64));expect(f.host.captureCache.get(key)).not.toBe(bound);expect(f.host.documentFollow.read().reason).toContain('expired-snapshot renewal');expect(f.calls.pixels).toBe(3);expect(await f.host.dispatch({type:'source.preview',taskId:f.task.id,sourceId:source.id})).toMatchObject({reference:{sourceId:source.id,version:2}});expect(f.calls.transports).toBe(0);}finally{clock.mockRestore();}
});
it.each(['stop','privacy','pause','foreground','permission','protected'] as const)('visible-content capture held in flight cannot publish after %s retires eligibility',async change=>{
 const f=await fixture();f.state.captureHash='a'.repeat(64);f.state.captureTransform={fixture:true};await f.capture();const before=await f.core.getTask(f.task.id);f.state.response=2;await f.host.dispatch({type:'source.follow.enable'});f.state.captureHash='b'.repeat(64);const gate=hold();f.state.pixelGate=gate;const pending=f.host.documentFollow.poll();await gate.started;
 try{if(change==='stop')await f.host.dispatch({type:'source.follow.stop'});if(change==='privacy')await f.host.dispatch({type:'capture.settings.revoke',expectedRevision:1});if(change==='pause')await f.host.dispatch({type:'tasks.pause',taskId:f.task.id});if(change==='foreground')f.state.foreground=undefined;if(change==='permission')f.state.trusted=false;if(change==='protected')f.state.knownProtected=true;}finally{gate.release();}
 await pending;expect((await f.core.getTask(f.task.id)).sources[0].versions).toEqual(before.sources[0].versions);expect(f.calls.pixels).toBe(1);expect(f.host.documentFollow.read()).not.toMatchObject({automaticSnapshots:'on'});expect(f.calls.transports).toBe(0);expect(f.calls.providerEntries).toBe(0);
});
it('the production follow command requires its separate host review then refreshes through the shared capture sink',async()=>{
 const f=await fixture();await f.capture();const first=(await f.core.getTask(f.task.id)).sources[0];expect(first.versions[0].documentStamp?.digest).toBe('a'.repeat(64));
 await f.host.command({type:'source.follow.enable'});f.state.digest='b'.repeat(64);await f.host.documentFollow.poll();
 const task=await f.core.getTask(f.task.id);expect(task.sources[0]).toMatchObject({currentVersion:2,freshness:'fresh'});expect(task.sources[0].versions.map(v=>v.documentStamp?.digest)).toEqual(['a'.repeat(64),'b'.repeat(64)]);
 expect(f.calls.pixels).toBe(2);expect(f.calls.transports).toBe(0);expect(f.calls.confirmations.map(c=>c.message)).toEqual(['Capture this window?','Follow this selected window for this session?']);
 expect(JSON.parse(task.sources[0].versions[1].content)).toMatchObject({captureId:'fixture-capture-2',transform:{sequence:2}});
 expect(JSON.parse(await readFile(join(f.directory,'capture-settings.json'),'utf8')).policy).toEqual({policyVersion:1,setupApproval:'approved',privateApps:[]});
});
it('metadata-only document changes invalidate stale snapshots without a follow grant or provider send',async()=>{
 const f=await fixture();await f.capture();f.state.digest='b'.repeat(64);await f.host.documentFollow.poll();
 const task=await f.core.getTask(f.task.id);expect(task.sources[0]).toMatchObject({freshness:'refresh-required',currentVersion:1,documentChange:{observedDigest:'b'.repeat(64)}});expect(f.host.captureCache.size).toBe(0);expect(f.calls.pixels).toBe(1);expect(f.calls.transports).toBe(0);
});
it('no-room placement and unrelated background C prevent a new snapshot',async()=>{
 const f=await fixture();await f.capture();await f.host.command({type:'source.follow.enable'});const reads=f.calls.metadata;
 f.state.foreground={...f.target,id:'window:99',osId:99};f.state.digest='b'.repeat(64);await f.host.documentFollow.poll();expect(f.calls.metadata).toBe(reads);expect(f.calls.pixels).toBe(1);
 f.state.foreground=f.target;f.state.room=false;await f.host.documentFollow.poll();expect(f.calls.pixels).toBe(1);expect(f.host.documentFollow.read()).toMatchObject({automaticSnapshots:'paused'});expect((await f.core.getTask(f.task.id)).sources[0].freshness).toBe('refresh-required');
});
it.each(['stop','privacy','task-switch'])('retires follow synchronously during delayed pixel preparation: %s',async change=>{
 const f=await fixture();await f.capture();await f.host.command({type:'source.follow.enable'});const gate=hold();f.state.pixelGate=gate;f.state.digest='b'.repeat(64);const pending=f.host.documentFollow.poll();await gate.started;
 if(change==='stop')await f.host.command({type:'source.follow.stop'});
 if(change==='privacy')await f.host.command({type:'capture.settings.revoke',expectedRevision:1});
 if(change==='task-switch'){const other=await f.core.createTask({title:'Other task'});await f.host.command({type:'context.view',taskId:other.id});}
 gate.release();await pending;expect(f.calls.pixels).toBe(1);expect(f.calls.transports).toBe(0);expect(f.host.documentFollow.read().kind).toBe('off');expect((await f.core.getTask(f.task.id)).sources[0].currentVersion).toBe(1);
});
it('document invalidation blocks a model prepared with the old frozen snapshot at the send fence',async()=>{
 const f=await fixture();await f.capture();const gate=hold();f.state.providerGate=gate;
 const pending=f.host.command({type:'model.run',taskId:f.task.id,requestId:'reading-before-navigation',kind:'explain',prompt:'Synthetic question'}),assertion=expect(pending).rejects.toThrow();await gate.started;
 f.state.digest='b'.repeat(64);await f.host.documentFollow.poll();gate.release();await assertion;
 expect(f.calls.transports).toBe(0);const task=await f.core.getTask(f.task.id);expect(task.requests[0].status).toBe('cancelled');expect(task.artifacts).toHaveLength(0);
});

it.each(['foreground','document','room','permission'])('checks the actual pixel boundary again after delayed preparation: %s',async change=>{
 const f=await fixture();await f.capture();await f.host.command({type:'source.follow.enable'});const gate=hold();f.state.pixelGate=gate;f.state.digest='b'.repeat(64);const pending=f.host.documentFollow.poll();await gate.started;
 if(change==='foreground')f.state.foreground={...f.target,id:'window:99',osId:99};
 if(change==='document')f.state.digest='c'.repeat(64);
 if(change==='room')f.state.room=false;
 if(change==='permission')f.state.screen='denied';
 gate.release();await pending;expect(f.calls.pixels).toBe(1);expect((await f.core.getTask(f.task.id)).sources[0].currentVersion).toBe(1);expect(f.host.captureCache.size).toBe(0);expect(f.calls.transports).toBe(0);
});
it('the reviewed follow choice can obtain its first comparable snapshot after the selected window becomes active',async()=>{
 const f=await fixture();f.state.foreground={...f.target,id:'window:99',osId:99};await f.capture();
 expect((await f.core.getTask(f.task.id)).sources[0].versions[0].documentStamp).toBeUndefined();
 await f.host.command({type:'source.follow.enable'});expect(f.host.documentFollow.read()).toMatchObject({automaticSnapshots:'paused'});
 f.state.foreground=f.target;await f.host.documentFollow.poll();const source=(await f.core.getTask(f.task.id)).sources[0];
 expect(f.calls.pixels).toBe(2);expect(source.currentVersion).toBe(2);expect(source.versions[1].documentStamp?.digest).toBe('a'.repeat(64));
});
it('source publication rejects a changed source reference and keeps the independent replacement',async()=>{
 const f=await fixture();await f.capture();await f.host.command({type:'source.follow.enable'});const gate=hold();f.state.pixelGate=gate;f.state.digest='b'.repeat(64);const pending=f.host.documentFollow.poll();await gate.started;
 const source=(await f.core.getTask(f.task.id)).sources[0];await f.core.putSource(f.task.id,{id:source.id,kind:'window',label:'New independent snapshot',content:'Independent replacement',role:'fact',windowId:f.target.id,windowProcessId:88,documentToken:f.target.documentToken});
 gate.release();await pending;const current=(await f.core.getTask(f.task.id)).sources[0];expect(current.currentVersion).toBe(2);expect(current.versions[1].content).toBe('Independent replacement');expect(f.host.captureCache.size).toBe(0);
});

it('binding a second window preserves both exact frozen snapshots for a reviewed multi-window request',async()=>{
 const f=await fixture();await f.capture();const second={...f.target,id:'window:42',osId:42,title:'Second synthetic window',documentToken:'metadata-second'};f.state.targets.push(second);f.state.foreground=second;f.state.digest='b'.repeat(64);
 await f.host.command({type:'windows.capture',taskId:f.task.id,windowId:second.id});
 const task=await f.core.getTask(f.task.id);expect(task.sources).toHaveLength(2);expect(f.host.captureCache.size).toBe(2);
 await f.host.command({type:'model.run',taskId:f.task.id,requestId:'read-both-frozen-windows',kind:'explain',prompt:'Compare both synthetic snapshots',sourceIds:task.sources.map(source=>source.id)});
 expect(f.calls.transports).toBe(1);expect((await f.core.getTask(f.task.id)).requests[0].sourceRefs).toHaveLength(2);
});
it('a delayed manual snapshot cannot recreate an old task metadata binding after task A to B to A',async()=>{
 const f=await fixture(),gate=hold();f.state.pixelGate=gate;const pending=f.capture();await gate.started;
 const other=await f.core.createTask({title:'Task B'});await f.host.command({type:'context.view',taskId:other.id});await f.host.command({type:'context.view',taskId:f.task.id});gate.release();await pending;
 expect(f.host.documentFollow.read().kind).toBe('off');
 const reads=f.calls.metadata;await f.host.documentFollow.poll();expect(f.calls.metadata).toBe(reads);
});
it('A to B with no room then back to A refreshes the invalidated A snapshot when room returns',async()=>{
 const f=await fixture();await f.capture();await f.host.command({type:'source.follow.enable'});f.state.room=false;f.state.digest='b'.repeat(64);await f.host.documentFollow.poll();expect((await f.core.getTask(f.task.id)).sources[0].freshness).toBe('refresh-required');
 f.state.room=true;f.state.digest='a'.repeat(64);await f.host.documentFollow.poll();const source=(await f.core.getTask(f.task.id)).sources[0];
 expect(f.calls.pixels).toBe(2);expect(source).toMatchObject({freshness:'fresh',currentVersion:2});expect(f.host.captureCache.size).toBe(1);
});
it('late follow cleanup cannot invalidate the newer explicit C capture saved during the old post-save fence',async()=>{
 const f=await fixture();await f.capture();await f.host.command({type:'source.follow.enable'});const sourceId=(await f.core.getTask(f.task.id)).sources[0].id,gate=hold();let held=false;
 f.state.documentHook=async()=>{const current=(await f.core.getTask(f.task.id)).sources[0];if(!held&&current.currentVersion===2){held=true;gate.enter();await gate.wait;}};
 f.state.digest='b'.repeat(64);const following=f.host.documentFollow.poll();await gate.started;
 f.state.digest='c'.repeat(64);await f.host.command({type:'windows.capture',taskId:f.task.id,windowId:f.target.id,sourceId});
 gate.release();await following;const source=(await f.core.getTask(f.task.id)).sources[0];
 expect(source).toMatchObject({freshness:'fresh',currentVersion:3});expect(source.versions[2].documentStamp?.digest).toBe('c'.repeat(64));expect(f.host.captureCache.size).toBe(1);
});
it.each(['stop','pause'])('a pending manual capture cannot recreate metadata follow after explicit %s',async change=>{
 const f=await fixture(),gate=hold();f.state.pixelGate=gate;const pending=f.capture();await gate.started;
 if(change==='stop')await f.host.command({type:'source.follow.stop'});else await f.host.command({type:'tasks.pause',taskId:f.task.id});
 gate.release();await pending;expect(f.host.documentFollow.read().kind).toBe('off');
});

it('geometry-only stale state does not broaden the reviewed document-address snapshot trigger',async()=>{
 const f=await fixture();await f.capture();await f.host.command({type:'source.follow.enable'});
 f.target.documentToken='geometry-only';f.target.bounds={...f.target.bounds,x:20};await f.core.observeWindow(f.task.id,{windowId:f.target.id,documentToken:f.target.documentToken,title:f.target.title,boundsToken:JSON.stringify(f.target.bounds)});
 await f.host.documentFollow.poll();expect(f.calls.pixels).toBe(1);expect(f.host.documentFollow.read()).toMatchObject({automaticSnapshots:'paused'});
 f.state.digest='b'.repeat(64);await f.host.documentFollow.poll();expect(f.calls.pixels).toBe(2);expect((await f.core.getTask(f.task.id)).sources[0].freshness).toBe('fresh');
});
it('missing existing AX trust preserves the reviewed explicit frozen snapshot fallback',async()=>{
 const f=await fixture();f.state.trusted=false;await f.capture();await f.host.documentFollow.poll();
 expect(f.calls.metadata).toBe(0);expect(f.host.captureCache.size).toBe(1);expect((await f.core.getTask(f.task.id)).sources[0]).toMatchObject({currentVersion:1,freshness:'fresh'});
 await f.host.command({type:'model.run',taskId:f.task.id,requestId:'review-frozen-snapshot',kind:'explain',prompt:'Review the explicitly captured synthetic snapshot'});expect(f.calls.transports).toBe(1);expect(f.calls.pixels).toBe(1);
});
it('over-memory follow rejection cannot invalidate C already saved during its own post-save fence',async()=>{
 const f=await fixture();await f.capture();await f.host.command({type:'source.follow.enable'});const sourceId=(await f.core.getTask(f.task.id)).sources[0].id,beforeB=hold(),afterC=hold();let heldB=false,heldC=false;
 f.state.pixelHook=async()=>{if(!heldB){heldB=true;beforeB.enter();await beforeB.wait;}};
 f.state.digest='b'.repeat(64);const following=f.host.documentFollow.poll();await beforeB.started;
 f.state.documentHook=async()=>{const source=(await f.core.getTask(f.task.id)).sources[0];if(source.currentVersion===2&&!heldC){heldC=true;afterC.enter();await afterC.wait;}};
 const explicit=f.host.command({type:'windows.capture',taskId:f.task.id,sourceId,windowId:f.target.id});await afterC.started;
 f.state.captureBytes=9*1024*1024;beforeB.release();await following;afterC.release();await explicit;
 const source=(await f.core.getTask(f.task.id)).sources[0];expect(source).toMatchObject({currentVersion:2,freshness:'fresh'});expect(f.host.captureCache.size).toBe(1);
});
it('a queued task selection owns capture admission before its earlier preference write completes',async()=>{
 const f=await fixture(),b=await f.core.createTask({title:'Queued task B'}),c=await f.core.createTask({title:'Queued task C'}),gate=hold();f.state.viewSaveGate=gate;
 const first=f.host.command({type:'context.view',taskId:b.id});await gate.started;const next=f.host.command({type:'context.view',taskId:c.id});
 await f.host.command({type:'windows.capture',taskId:b.id,windowId:f.target.id});gate.release();await Promise.all([first,next]);
 expect(f.host.documentFollow.read().kind).toBe('off');const reads=f.calls.metadata;await f.host.documentFollow.poll();expect(f.calls.metadata).toBe(reads);
});

it.each(['follow','manual'])('an old IPC preview cannot delete the newer %s snapshot while native validation is pending',async mode=>{
 const f=await fixture();await f.host.dispatch({type:'windows.capture',taskId:f.task.id,windowId:f.target.id});if(mode==='follow')await f.host.dispatch({type:'source.follow.enable'});
 const sourceId=(await f.core.getTask(f.task.id)).sources[0].id,gate=hold();let held=false;
 f.state.inspectHook=async()=>{if(!held){held=true;gate.enter();await gate.wait;}};
 const preview=f.host.dispatch({type:'source.preview',taskId:f.task.id,sourceId});await gate.started;
 try{f.state.digest='b'.repeat(64);if(mode==='follow')await f.host.documentFollow.poll();else await f.host.dispatch({type:'windows.capture',taskId:f.task.id,sourceId,windowId:f.target.id});expect((await f.core.getTask(f.task.id)).sources[0]).toMatchObject({currentVersion:2,freshness:'fresh'});expect(f.host.captureCache.size).toBe(1);}finally{gate.release();}
 expect(await preview).toBeNull();expect(f.host.captureCache.size).toBe(1);
 expect(await f.host.dispatch({type:'source.preview',taskId:f.task.id,sourceId})).toMatchObject({reference:{sourceId,version:2},transform:{sequence:2}});
 expect(f.calls.pixels).toBe(2);expect(f.calls.transports).toBe(0);
});

it('document change cancels the exact saved SQL brief action before transmission without replaying it',async()=>{
 const f=await fixture();await f.capture();const source=(await f.core.getTask(f.task.id)).sources[0],version=source.versions[0],refs=[{sourceId:source.id,version:version.version,digest:version.digest}];
 const brief=parseScreenBriefModel('Two visible tables need transcription review.\n<!-- companion-actions -->\n'+JSON.stringify({actions:[{label:'Review these tables',outcome:'Review the cited table transcription',requestKind:'experiment',seedPrompt:'Prepare these cited tables for a reviewed join.',sourceRefs:['S1'],capability:'sql-join'}]}),refs);
 const unknown=await f.core.saveArtifact(f.task.id,{title:'Unknown table brief',content:JSON.stringify(brief),mimeType:'application/json',sourceRefs:refs}),action=brief.actions[0];
 expect(artifactContextUncertain(await f.core.getTask(f.task.id),unknown.artifactId,unknown.revision)).toBe(true);
 await expect(f.host.command({type:'model.run',taskId:f.task.id,requestId:'unknown-brief-refused',kind:'experiment',prompt:action.seedPrompt,sourceIds:[source.id],expectedSourceRefs:refs,briefAction:{artifact:{artifactId:unknown.artifactId,revision:1,digest:unknown.revision.digest},actionIndex:0}})).rejects.toThrow();expect(f.calls.providerEntries).toBe(0);
 expect((await f.core.runRequest({taskId:f.task.id,requestId:'qualified-brief',kind:'brief',prompt:'Read the captured tables.',sourceIds:[source.id]},async()=>({title:'Saved table brief',content:JSON.stringify(brief),mimeType:'application/json'}))).status).toBe('completed');
 const seeded=await f.core.getTask(f.task.id),artifact=seeded.artifacts.at(-1)!,basis={artifactId:artifact.id,revision:artifact.revisions.at(-1)!};expect(artifactContextUncertain(seeded,basis.artifactId,basis.revision)).toBe(false);
 const command:Command={type:'model.run',taskId:f.task.id,requestId:'source-bound-join',kind:'experiment',prompt:action.seedPrompt,sourceIds:[source.id],expectedSourceRefs:action.sourceRefs,briefAction:{artifact:{artifactId:basis.artifactId,revision:basis.revision.revision,digest:basis.revision.digest},actionIndex:0}};
 const gate=hold();f.state.providerGate=gate;const pending=f.host.dispatch(command),assertion=expect(pending).rejects.toThrow();await gate.started;
 try{f.state.digest='b'.repeat(64);await f.host.documentFollow.poll();}finally{gate.release();}await assertion;
 const task=await f.core.getTask(f.task.id);expect(task.requests).toHaveLength(2);expect(task.requests.find(request=>request.id==='source-bound-join')).toMatchObject({id:'source-bound-join',status:'cancelled',sourceRefs:refs});expect(task.sources[0].freshness).toBe('refresh-required');
 expect(task.artifacts).toHaveLength(2);expect(task.artifacts.find(artifact=>artifact.id===basis.artifactId)!.revisions[0].digest).toBe(basis.revision.digest);expect(task.artifacts.find(artifact=>artifact.id===unknown.artifactId)!.revisions[0]).toEqual(unknown.revision);expect(f.calls.pixels).toBe(1);expect(f.calls.transports).toBe(0);
 const reviews=f.calls.confirmations.length;await expect(f.host.dispatch(command)).rejects.toThrow();expect((await f.core.getTask(f.task.id)).requests).toHaveLength(2);expect(f.calls.confirmations).toHaveLength(reviews);expect(f.calls.transports).toBe(0);
});

it.each([false,true])('same-address edited-state transition invalidates without extending the reviewed address follow grant: %s',async initial=>{
 const f=await fixture();f.state.edited=initial;await f.host.dispatch({type:'windows.capture',taskId:f.task.id,windowId:f.target.id});
 await f.host.dispatch({type:'source.follow.enable'});f.state.edited=!initial;await f.host.documentFollow.poll();
 const source=(await f.core.getTask(f.task.id)).sources[0];
 expect(source).toMatchObject({currentVersion:1,freshness:'refresh-required',documentChange:{kind:'changed',observedDigest:'a'.repeat(64)}});
 const invalidated=await f.core.getTask(f.task.id);await f.host.documentFollow.poll();expect(await f.core.getTask(f.task.id)).toEqual(invalidated);expect(f.host.documentFollow.read()).toMatchObject({automaticSnapshots:'paused'});
 expect(f.host.captureCache.size).toBe(0);expect(f.calls.pixels).toBe(1);expect(f.calls.transports).toBe(0);
});

it('an edited-state pause retains only the existing address-change follow authority',async()=>{
 const f=await fixture();f.state.edited=false;await f.capture();await f.host.dispatch({type:'source.follow.enable'});
 const reads=f.calls.metadata;f.state.foreground={...f.target,id:'window:99',osId:99};f.state.edited=true;await f.host.documentFollow.poll();expect(f.calls.metadata).toBe(reads);expect((await f.core.getTask(f.task.id)).sources[0].freshness).toBe('fresh');
 f.state.foreground=f.target;await f.host.documentFollow.poll();expect(f.calls.pixels).toBe(1);
 f.state.digest='b'.repeat(64);await f.host.documentFollow.poll();
 expect((await f.core.getTask(f.task.id)).sources[0]).toMatchObject({currentVersion:2,freshness:'fresh'});expect(f.calls.pixels).toBe(2);expect(f.calls.transports).toBe(0);expect(f.calls.confirmations).toHaveLength(2);
});
it.each([[undefined,undefined],[true,true],[false,false],[undefined,true],[false,undefined]] as const)('same-address optional hint %s to %s leaves content unknown and snapshot frozen',async(initial,next)=>{
 const f=await fixture();f.state.edited=initial;await f.capture();const saved=await f.core.getTask(f.task.id);f.state.edited=next;await f.host.documentFollow.poll();
 expect(await f.core.getTask(f.task.id)).toEqual(saved);expect(f.host.captureCache.size).toBe(1);expect(f.calls.pixels).toBe(1);expect(f.calls.transports).toBe(0);
});
it('explicit refresh resets the dirty-state baseline and old observations cannot stale the new exact version',async()=>{
 const f=await fixture();f.state.edited=false;await f.capture();const original=(await f.core.getTask(f.task.id)).sources[0],old=original.versions[0];
 f.state.edited=true;await f.host.documentFollow.poll();await f.host.dispatch({type:'windows.capture',taskId:f.task.id,windowId:f.target.id,sourceId:original.id});
 const fresh=await f.core.getTask(f.task.id);expect(fresh.sources[0]).toMatchObject({currentVersion:2,freshness:'fresh'});expect(fresh.sources[0].versions[1].documentStamp).not.toHaveProperty('edited');
 expect((await f.core.reconcileDocumentSource({taskId:f.task.id,ref:{sourceId:original.id,version:old.version,digest:old.digest},windowId:f.target.id,processId:88},{kind:'document',stamp:{...old.documentStamp!,edited:true}})).kind).toBe('superseded');
 await f.host.documentFollow.poll();expect(await f.core.getTask(f.task.id)).toEqual(fresh);expect(f.host.captureCache.size).toBe(1);f.state.edited=false;await f.host.documentFollow.poll();expect((await f.core.getTask(f.task.id)).sources[0].freshness).toBe('refresh-required');expect(f.calls.pixels).toBe(2);expect(f.calls.transports).toBe(0);
});

it('a verified same-source explicit refresh continues the approved session follow without another follow review',async()=>{
 const f=await fixture();f.state.edited=false;await f.host.dispatch({type:'windows.capture',taskId:f.task.id,windowId:f.target.id});await f.host.dispatch({type:'source.follow.enable'});
 const original=(await f.core.getTask(f.task.id)).sources[0];await f.core.saveComposerDraft(f.task.id,0,{text:'Keep this unsent correction',kind:'explain'});await f.core.saveArtifact(f.task.id,{title:'Original result',content:'Keep original reasoning',sourceRefs:[{sourceId:original.id,version:1,digest:original.versions[0].digest}]});
 f.state.edited=true;await f.host.documentFollow.poll();expect(f.host.documentFollow.read()).toMatchObject({automaticSnapshots:'paused'});
 await f.host.dispatch({type:'windows.capture',taskId:f.task.id,windowId:f.target.id,sourceId:original.id});expect(f.host.documentFollow.read()).toMatchObject({automaticSnapshots:'on'});
 await f.host.dispatch({type:'source.follow.enable'});f.state.digest='b'.repeat(64);await f.host.documentFollow.poll();
 const saved=await f.core.getTask(f.task.id);expect(saved.sources[0]).toMatchObject({currentVersion:3,freshness:'fresh'});expect(f.calls.pixels).toBe(3);expect(f.calls.transports).toBe(0);expect(f.calls.confirmations.map(confirmation=>confirmation.message)).toEqual(['Capture this window?','Follow this selected window for this session?','Capture this window?']);
 expect(saved.session?.draft).toBe('Keep this unsent correction');expect(saved.artifacts[0].revisions[0].sourceRefs[0].version).toBe(1);
 const reads=f.calls.metadata;f.state.foreground={...f.target,id:'window:99',osId:99};await f.host.documentFollow.poll();expect(f.calls.metadata).toBe(reads);expect(f.calls.pixels).toBe(3);
});

it('stop during a held explicit refresh cannot restore the earlier session follow choice',async()=>{
 const f=await fixture();await f.capture();await f.host.dispatch({type:'source.follow.enable'});const sourceId=(await f.core.getTask(f.task.id)).sources[0].id,gate=hold();f.state.pixelGate=gate;
 const pending=f.host.dispatch({type:'windows.capture',taskId:f.task.id,windowId:f.target.id,sourceId});await gate.started;await f.host.dispatch({type:'source.follow.stop'});gate.release();await pending;
 expect(f.host.documentFollow.read().kind).toBe('off');const pixels=f.calls.pixels;f.state.digest='b'.repeat(64);await f.host.documentFollow.poll();expect(f.calls.pixels).toBe(pixels);expect(f.calls.transports).toBe(0);
});
it.each(['manual','follow'] as const)('refuses a known edited-state transition during %s pixel preparation',async mode=>{
 const f=await fixture();f.state.edited=false;await f.capture();const source=(await f.core.getTask(f.task.id)).sources[0];
 if(mode==='follow'){await f.host.dispatch({type:'source.follow.enable'});f.state.digest='b'.repeat(64);}
 const gate=hold();f.state.pixelGate=gate;
 const pending=mode==='follow'?f.host.documentFollow.poll():f.host.dispatch({type:'windows.capture',taskId:f.task.id,windowId:f.target.id,sourceId:source.id});
 const outcome=pending.catch(()=>null);await gate.started;f.state.edited=true;gate.release();await outcome;
 expect((await f.core.getTask(f.task.id)).sources[0].currentVersion).toBe(1);expect(f.calls.pixels).toBe(1);expect(f.calls.transports).toBe(0);
});
it('refuses publication when edited state changes after the durable capture save',async()=>{
 const f=await fixture();f.state.edited=false;await f.capture();const sourceId=(await f.core.getTask(f.task.id)).sources[0].id;
 f.state.documentHook=async()=>{if((await f.core.getTask(f.task.id)).sources[0].currentVersion===2)f.state.edited=true;};
 await expect(f.host.dispatch({type:'windows.capture',taskId:f.task.id,windowId:f.target.id,sourceId})).rejects.toThrow();
 expect((await f.core.getTask(f.task.id)).sources[0]).toMatchObject({currentVersion:2,freshness:'refresh-required'});expect(f.host.captureCache.size).toBe(0);expect(f.calls.pixels).toBe(2);expect(f.calls.transports).toBe(0);
});

it('capture fences retain the first known edited hint across later missing hints and refuse a transition',async()=>{
 const f=await fixture();let reads=0;
 // Admission has no hint, the pre-pixel check learns false, a later check omits
 // the hint, and the first post-pixel check observes true at the same address.
 const hints=[undefined,false,undefined,true];
 f.state.documentHook=async()=>{f.state.edited=hints[Math.min(reads++,hints.length-1)];};
 await expect(f.host.dispatch({type:'windows.capture',taskId:f.task.id,windowId:f.target.id})).rejects.toThrow();
 expect(reads).toBe(4);expect((await f.core.getTask(f.task.id)).sources).toHaveLength(0);expect(f.host.captureCache.size).toBe(0);expect(f.calls.pixels).toBe(1);expect(f.calls.transports).toBe(0);
});

it.each([true,false])('follow capture shares known edited hints from its validated follow checks before publication: transition=%s',async transition=>{
 const f=await fixture();await f.host.dispatch({type:'windows.capture',taskId:f.task.id,windowId:f.target.id});await f.host.dispatch({type:'source.follow.enable'});
 f.state.digest='b'.repeat(64);let reads=0;
 // Poll, grant check and capture admission have no hint. The follow check then
 // learns false, an intervening observation omits it, and a later check sees true.
 // With duplicate reads, only follow.check sees the known hints.
 f.state.documentHook=async()=>{reads++;f.state.edited=reads===4?false:reads>=6&&reads%2===0?transition:undefined;};
 await f.host.documentFollow.poll();
 const source=(await f.core.getTask(f.task.id)).sources[0];
 if(transition){expect(source).toMatchObject({currentVersion:1,freshness:'refresh-required'});expect(f.host.captureCache.size).toBe(0);}
 else{expect(source).toMatchObject({currentVersion:2,freshness:'fresh'});expect(source.versions[1].documentStamp).not.toHaveProperty('edited');expect(f.host.captureCache.size).toBe(1);f.state.documentHook=undefined;f.state.edited=true;await f.host.documentFollow.poll();expect((await f.core.getTask(f.task.id)).sources[0].freshness).toBe('refresh-required');}
 expect(f.calls.pixels).toBe(2);expect(f.calls.transports).toBe(0);
});

it('keeps edited hints live-only while the captured source and stale change retain the old ledger shape',async()=>{
 const f=await fixture();f.state.edited=false;await f.host.dispatch({type:'windows.capture',taskId:f.task.id,windowId:f.target.id});
 let source=(await f.core.getTask(f.task.id)).sources[0];expect(source.versions[0].documentStamp).toEqual({method:'ax-document',evidence:'foreground-application-correlation',digest:'a'.repeat(64)});
 expect(JSON.parse(source.versions[0].content)).not.toHaveProperty('documentHint');
 f.state.edited=true;await f.host.documentFollow.poll();source=(await f.core.getTask(f.task.id)).sources[0];
 expect(source).toMatchObject({freshness:'refresh-required',documentChange:{kind:'changed',observedDigest:'a'.repeat(64)}});expect(source.documentChange).not.toHaveProperty('observedEdited');expect(f.calls.pixels).toBe(1);expect(f.calls.transports).toBe(0);
});

async function followedProtectionFixture(){
 const f=await fixture(),monitor=await f.startMonitor();expect(monitor.registrations).toContain(2000);
 await f.host.dispatch({type:'windows.capture',taskId:f.task.id,windowId:f.target.id});await f.host.dispatch({type:'source.follow.enable'});
 const source=(await f.core.getTask(f.task.id)).sources[0],reference={sourceId:source.id,version:source.currentVersion,digest:source.versions.at(-1)!.digest};
 expect(f.host.documentFollow.read()).toMatchObject({kind:'bound',windowId:f.target.id,automaticSnapshots:'on'});expect(f.calls.pixels).toBe(1);expect(f.host.captureCache.size).toBe(1);
 return {...f,monitor,source,reference};
}
it('production follow-protection transition keeps a safe positive refresh on the actually registered 2000ms monitor',async()=>{
 const f=await followedProtectionFixture(),checks=f.calls.protection.length;f.state.digest='b'.repeat(64);f.monitor.tick();
 await vi.waitFor(async()=>expect((await f.core.getTask(f.task.id)).sources[0]).toMatchObject({currentVersion:2,freshness:'fresh'}));
 expect(f.calls.pixels).toBe(2);expect(f.calls.protection.length).toBeGreaterThan(checks);expect(f.calls.protection.every(check=>check.windowId===f.target.id&&check.processId===88&&!check.knownProtected)).toBe(true);expect(f.calls.transports).toBe(0);expect(f.calls.outgoing).toEqual([]);
});
it.each(['same-address','changed-address'] as const)('production follow-protection transition retires the same exact admitted window when only sampled protection changes: %s',async address=>{
 const f=await followedProtectionFixture(),metadata=structuredClone(f.target),versions=structuredClone(f.source.versions),historical=await f.core.saveArtifact(f.task.id,{title:'Historical safe reasoning',content:'Keep this earlier source-bound result.',sourceRefs:[f.reference]}),reads=f.calls.metadata;
 f.state.knownProtected=true;if(address==='changed-address')f.state.digest='b'.repeat(64);f.monitor.tick();
 await vi.waitFor(async()=>expect((await f.core.getTask(f.task.id)).sources[0].freshness).toBe('refresh-required'));
 const current=await f.core.getTask(f.task.id);expect(f.target).toEqual(metadata);expect(f.target.knownProtected).not.toBe(true);expect(f.calls.protection.at(-1)).toEqual({windowId:f.target.id,processId:88,knownProtected:true});expect(f.calls.metadata).toBe(reads);expect(current.sources[0].currentVersion).toBe(1);expect(current.sources[0].versions).toEqual(versions);expect(current.artifacts.find(artifact=>artifact.id===historical.artifactId)!.revisions).toEqual([historical.revision]);expect(f.calls.pixels).toBe(1);expect(f.host.captureCache.size).toBe(0);expect(f.host.documentFollow.read()).toMatchObject({automaticSnapshots:'paused'});
 expect(await f.host.dispatch({type:'source.preview',taskId:f.task.id,sourceId:f.source.id,reference:f.reference})).toBeNull();await expect(f.host.dispatch({type:'model.run',taskId:f.task.id,requestId:'protected-after-monitor',kind:'explain',prompt:'Do not send this retired snapshot',sourceIds:[f.source.id]})).rejects.toThrow();expect(f.calls.providerEntries).toBe(0);expect(f.calls.transports).toBe(0);expect(f.calls.outgoing).toEqual([]);
});
it('production follow-protection transition rejects cached preview and a new send even before the next monitor tick',async()=>{
 const f=await followedProtectionFixture();expect(await f.host.dispatch({type:'source.preview',taskId:f.task.id,sourceId:f.source.id})).toMatchObject({reference:f.reference});f.state.knownProtected=true;
 expect(await f.host.dispatch({type:'source.preview',taskId:f.task.id,sourceId:f.source.id,reference:f.reference})).toBeNull();expect(f.host.captureCache.size).toBe(0);await expect(f.host.dispatch({type:'model.run',taskId:f.task.id,requestId:'protected-cached-window',kind:'explain',prompt:'The old pixels must stay local',sourceIds:[f.source.id]})).rejects.toThrow();
 expect(f.calls.pixels).toBe(1);expect(f.calls.transports).toBe(0);expect(f.calls.outgoing).toEqual([]);f.monitor.tick();await vi.waitFor(async()=>expect((await f.core.getTask(f.task.id)).sources[0].freshness).toBe('refresh-required'));expect((await f.core.getTask(f.task.id)).sources[0].versions).toEqual(f.source.versions);
});
it('production follow-protection transition blocks a protected window at a delayed automatic pixel fence without appending a version',async()=>{
 const f=await followedProtectionFixture(),gate=hold();f.state.pixelGate=gate;f.state.digest='b'.repeat(64);f.monitor.tick();await gate.started;
 f.state.knownProtected=true;gate.release();await vi.waitFor(()=>expect(f.host.documentFollow.read()).toMatchObject({automaticSnapshots:'paused'}));const source=(await f.core.getTask(f.task.id)).sources[0];expect(source.currentVersion).toBe(1);expect(source.versions).toEqual(f.source.versions);expect(f.calls.pixels).toBe(1);expect(f.host.captureCache.size).toBe(0);expect(f.calls.outgoing).toEqual([]);
});
it('production follow-protection transition aborts an active request held before transport with zero outgoing byte records',async()=>{
 const f=await followedProtectionFixture(),gate=hold();f.state.providerGate=gate;
 const pending=f.host.dispatch({type:'model.run',taskId:f.task.id,requestId:'held-before-transport',kind:'explain',prompt:'The exact safe window was admitted',sourceIds:[f.source.id]}),rejected=expect(pending).rejects.toThrow();await gate.started;expect(f.calls.providerEntries).toBe(1);expect(f.calls.transports).toBe(0);expect(f.calls.outgoing).toEqual([]);
 f.state.knownProtected=true;f.monitor.tick();await vi.waitFor(async()=>expect((await f.core.getTask(f.task.id)).requests.find(request=>request.id==='held-before-transport')?.status).toBe('cancelled'));expect(f.calls.signals[0].aborted).toBe(true);gate.release();await rejected;
 const task=await f.core.getTask(f.task.id);expect(task.artifacts).toEqual([]);expect(task.sources[0].versions).toEqual(f.source.versions);expect(f.calls.pixels).toBe(1);expect(f.calls.transports).toBe(0);expect(f.calls.outgoing).toEqual([]);
});
it('production follow-protection transition rejects a held result after one admitted transport without erasing history or claiming recall',async()=>{
 const f=await followedProtectionFixture(),history=await f.core.saveArtifact(f.task.id,{title:'Previously saved result',content:'Historical safe interpretation.',sourceRefs:[f.reference]}),gate=hold();f.state.resultGate=gate;
 const pending=f.host.dispatch({type:'model.run',taskId:f.task.id,requestId:'held-after-transport',kind:'explain',prompt:'An admitted send cannot be recalled',sourceIds:[f.source.id]}),rejected=expect(pending).rejects.toThrow();await gate.started;expect(f.calls.transports).toBe(1);expect(f.calls.outgoing).toHaveLength(1);expect(f.calls.outgoing[0]).toContain('data:image/png;base64,AA==');const sent=f.calls.outgoing[0];
 f.state.knownProtected=true;f.monitor.tick();await vi.waitFor(async()=>expect((await f.core.getTask(f.task.id)).requests.find(request=>request.id==='held-after-transport')?.status).toBe('cancelled'));expect(f.calls.signals[0].aborted).toBe(true);gate.release();await rejected;
 const task=await f.core.getTask(f.task.id);expect(task.artifacts).toHaveLength(1);expect(task.artifacts[0].revisions).toEqual([history.revision]);expect(task.sources[0].versions).toEqual(f.source.versions);expect(f.host.captureCache.size).toBe(0);expect(f.calls.pixels).toBe(1);expect(f.calls.transports).toBe(1);expect(f.calls.outgoing).toEqual([sent]);
});
it('production follow-protection transition independently blocks direct send from an admitted cache before preview or timer retirement',async()=>{
 const f=await followedProtectionFixture(),metadata=structuredClone(f.target);expect(f.host.captureCache.size).toBe(1);f.state.knownProtected=true;
 await expect(f.host.dispatch({type:'model.run',taskId:f.task.id,requestId:'protected-direct-send',kind:'explain',prompt:'Check protection while the original cache still exists',sourceIds:[f.source.id]})).rejects.toThrow();
 expect(f.target).toEqual(metadata);expect(f.calls.protection.some(check=>check.windowId===f.target.id&&check.processId===88&&check.knownProtected)).toBe(true);expect(f.calls.providerEntries).toBe(0);expect(f.calls.transports).toBe(0);expect(f.calls.outgoing).toEqual([]);expect(f.host.captureCache.size).toBe(0);const task=await f.core.getTask(f.task.id);expect(task.requests.find(request=>request.id==='protected-direct-send')?.status).toBe('cancelled');expect(task.sources[0].versions).toEqual(f.source.versions);expect(f.calls.pixels).toBe(1);
});

it('local reviewed WINDOW materialization keeps a bound production follower without core queue reentry',async()=>{
 const f=await fixture();f.state.captureHash='a'.repeat(64);await f.capture();await f.host.command({type:'source.follow.enable'});
 const task=await f.core.getTask(f.task.id),source=task.sources[0],v=source.versions.at(-1)!,ref={sourceId:source.id,version:v.version,digest:v.digest},saved=await f.core.saveArtifact(task.id,{title:'Owned screen brief',mimeType:'application/json',sourceRefs:[ref],content:JSON.stringify({schemaVersion:1,kind:'screen-brief',insight:'Owned finite diagram.',actions:[]})}),basis={artifactId:saved.artifactId,revision:1,digest:saved.revision.digest},candidate=parseWindowWorkflowProposal(JSON.stringify(syntheticCandidate().proposal),prepareWindowWorkflowSourceContext(await f.core.getTask(task.id),basis));
 if(candidate.kind!=='window-workflow-review-candidate')throw Error('Expected owned candidate');
 const proposal=await f.core.saveArtifact(task.id,{title:'Owned review',mimeType:WINDOW_WORKFLOW_MIME,sourceRefs:[ref],content:JSON.stringify(candidate)}),draft=syntheticReviewDraft();await f.core.setSourceSelection({type:'source-selection.set',taskId:task.id,expectedRevision:0,sourceIds:[]});
 const result:any=await f.host.dispatch({type:'workflow.window.review',taskId:task.id,requestId:'followed-local-review',candidate:{artifactId:proposal.artifactId,revision:1,digest:proposal.revision.digest},review:{draft,confirmation:{kind:'reviewed-window-transcription',snapshot:windowWorkflowReviewSnapshot(candidate,draft)}}});
 expect(result.task.requests.at(-1).status).toBe('completed');expect(f.calls.metadata).toBeGreaterThan(2);expect(f.calls.protection.every(call=>call.windowId==='window:41'&&call.processId===88)).toBe(true);expect(f.calls.pixels).toBe(1);expect(f.calls.transports).toBe(0);expect(await f.host.command({type:'source.follow.get'})).toMatchObject({kind:'bound'});
});
