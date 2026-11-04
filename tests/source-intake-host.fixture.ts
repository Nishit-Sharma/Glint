import {afterEach,expect,it} from 'vitest';
import {build} from 'esbuild';
import {mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createCompanion,type Companion} from '../src/core/companion';
import {buildCodexInput} from '../src/host/codex-provider';
import {placeCompanion,type NativeCapture,type NativeWindow} from '../src/host/native';
import type {DocumentSourceFollow} from '../src/host/document-source-follow';
import type {Command} from '../src/shared/bridge';
import {DEFAULT_CHARACTER} from '../src/shared/character-catalog';
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
export function hold(){let release!:()=>void,enter!:()=>void;return {wait:new Promise<void>(resolve=>release=resolve),started:new Promise<void>(resolve=>enter=resolve),release:()=>release(),enter:()=>enter()};}
interface HostHarness{dispatch(c:Command):Promise<unknown>;command(c:Command):Promise<unknown>;validate(c:unknown):Command;documentFollow:DocumentSourceFollow;setCore(core:Companion):Promise<void>;setPanel(panel:unknown):void;selectTask(taskId:string,windowId:string):void;captureCache:Map<string,unknown>;changeConnection():void}
export async function sourceIntakeHostFixture(){
 const root=resolve('.');await mkdir(join(root,'work/continuation'),{recursive:true});const directory=await mkdtemp(join(root,'work/continuation/host-')),key='documentHost'+randomUUID().replaceAll('-','');
 const settings={schemaVersion:1,revision:1,policy:{policyVersion:1,setupApproval:'approved',privateApps:[]}};
 await writeFile(join(directory,'capture-settings.json'),JSON.stringify(settings));await writeFile(join(directory,'character-preferences.json'),JSON.stringify({schemaVersion:1,revision:0,profile:DEFAULT_CHARACTER}));
 const calls={pixels:0,metadata:0,transports:0,confirmations:[] as {message:string;detail?:string}[],events:[] as unknown[]};
 const target:NativeWindow={id:'window:41',osId:41,title:'Same title A and B',owner:{name:'Owned synthetic source',processId:88,bundleId:'local.synthetic.source'},bounds:{x:0,y:0,width:600,height:700},displayId:'1',scaleFactor:1,documentToken:'unchanged-title-geometry',requiresExplicitCapture:true};
 const state={edited:undefined as boolean|undefined,inspectHook:undefined as undefined|(()=>Promise<void>),captureBytes:32,pixelHook:undefined as undefined|((id:string)=>Promise<void>),viewSaveGate:undefined as ReturnType<typeof hold>|undefined,targets:[target],documentHook:undefined as undefined|(()=>Promise<void>),foreground:target as NativeWindow|undefined,digest:'a'.repeat(64),screen:'granted',trusted:true,room:true,response:1,documentGate:undefined as ReturnType<typeof hold>|undefined,pixelGate:undefined as ReturnType<typeof hold>|undefined,account:'synthetic-account',payloads:[] as Array<Record<string,unknown>>,providerOutput:undefined as string|undefined,providerGate:undefined as ReturnType<typeof hold>|undefined};
 const seams={calls,state,placeCompanion,buildCodexInput,confirm:async(_panel:unknown,detail:{message:string;detail?:string})=>{calls.confirmations.push(detail);return {response:state.response}},
  readDocument:async()=>{calls.metadata++;await state.documentHook?.();state.documentGate?.enter();await state.documentGate?.wait;return {kind:'document',processId:88,digest:state.digest,...(state.edited===undefined?{}:{edited:state.edited})}},
  provider:async(input:{captureFence?:{check():Promise<void>;assertCurrent():void};signal?:AbortSignal;expectedAccountScope?:string})=>{state.providerGate?.enter();await state.providerGate?.wait;await input.captureFence?.check();input.captureFence?.assertCurrent();if(input.signal?.aborted||input.expectedAccountScope!==state.account)throw Error('Synthetic request account or context changed');state.payloads.push(input as unknown as Record<string,unknown>);calls.transports++;return state.providerOutput??'Synthetic result'},
  native:{foregroundWindow:async()=>state.foreground,listWindows:async()=>state.targets,inspect:async(id:string)=>{await state.inspectHook?.();const window=state.targets.find(window=>window.id===id);if(!window)throw Error('Synthetic source closed');return window},permissionStatus:async()=>({screen:state.screen,accessibility:state.trusted?'granted':'not-granted',captureSupported:true}),capture:async(id:string,options:{beforeCapture?:()=>Promise<void>;assertCurrent?:()=>void})=>{
   await state.pixelHook?.(id);state.pixelGate?.enter();await state.pixelGate?.wait;await options.beforeCapture?.();options.assertCurrent?.();calls.pixels++;
   const selected=state.targets.find(window=>window.id===id);if(!selected)throw Error('Synthetic source closed');return {source:selected,sourceVersion:'fixture-capture-'+calls.pixels,capturedAt:new Date().toISOString(),png:Buffer.alloc(state.captureBytes,calls.pixels),dataUrl:'data:image/png;base64,AA==',imageSha256:'fixture-image-'+calls.pixels,transform:{fixture:true,sequence:calls.pixels}};
  }},
 };
 Reflect.set(globalThis,key,seams);const seam=`globalThis[${JSON.stringify(key)}]`;
 const electron=`const noop=()=>{};export const app={getPath:()=>process.env.WINDOW_COMPANION_DATA_DIR,setPath:noop,isReady:()=>false,disableHardwareAcceleration:noop,whenReady:()=>new Promise(()=>{}),on:noop};export const Notification={isSupported:()=>false};export class BrowserWindow{};export const clipboard={};export class ClipboardItem{};export const Menu={};export class Tray{};export const dialog={showMessageBox:(...a)=>${seam}.confirm(...a)};export const globalShortcut={unregisterAll:noop};export const ipcMain={};export const nativeImage={};export const safeStorage={};export const systemPreferences={isTrustedAccessibilityClient:()=>false};export const session={};export const screen={getDisplayMatching:()=>({workArea:${seam}.state.room?{x:0,y:0,width:1800,height:1100}:{x:0,y:0,width:600,height:700}})};`;
 const provider=`export const buildCodexInput=(...args)=>${seam}.buildCodexInput(...args);export class MetaProvider{accountScope(){return Promise.resolve(${seam}.state.account)};defaultInference(){return {provider:'codex',model:'synthetic',effort:'medium',tier:'default'}};statusFor(){return this.status()};status(){return Promise.resolve({configured:true,provider:'Codex (temporary)',endpoint:'fixture://no-network',model:'fixture',state:'ready'})};run(input){return ${seam}.provider(input)};reset(){};close(){}};export class CodexProvider extends MetaProvider{}`;
 const native=`export class NativeSourceAdapter{inspectProtection(id,pid){return Promise.resolve({osId:Number(id.split(':')[1]),processId:pid,knownProtected:false})};foregroundWindow(){return ${seam}.native.foregroundWindow()};listWindows(){return ${seam}.native.listWindows()};inspect(id){return ${seam}.native.inspect(id)};capture(id,options){return ${seam}.native.capture(id,options)};permissionStatus(){return ${seam}.native.permissionStatus()}};export const placeCompanion=(...a)=>${seam}.placeCompanion(...a);`;
 const docExec=`import {promisify} from 'node:util';export function execFile(){};execFile[promisify.custom]=async()=>({stdout:JSON.stringify(await ${seam}.readDocument())});`;
 const viewFs=`import * as fs from 'node:fs/promises';export const mkdir=fs.mkdir,open=fs.open,readFile=fs.readFile,rm=fs.rm;export const rename=async(...args)=>{const gate=${seam}.state.viewSaveGate;if(gate){gate.enter();await gate.wait;}return fs.rename(...args)};`;
 const outfile=join(directory,'host.mjs'),hostSource=await readFile(join(root,'src/host/index.ts'),'utf8');
 if(!hostSource.includes("ipcMain.handle('companion:command',dispatchCompanionCommand)"))throw Error('The production companion IPC handler was not found.');
 await build({stdin:{contents:hostSource+`\nexport const dispatch=value=>dispatchCompanionCommand({sender:panel.webContents,senderFrame:panel.webContents.mainFrame},value);\nexport {command,validate,documentFollow};export const changeConnection=()=>{keyEpoch++};export const setCore=async c=>{core=c;captureSettings=await CaptureSettings.open(dataDir);botPreferences=await BotPreferences.open(dataDir,core)};export const setPanel=p=>{panel=p};export const selectTask=(taskId,windowId)=>{currentViewTaskId=taskId;attachedWindowId=windowId};export const captureCache=captures;`,resolveDir:join(root,'src/host'),sourcefile:join(root,'src/host/index.ts'),loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile,plugins:[{name:'owned-os-fixture',setup(b){
  b.onResolve({filter:/^node:fs\/promises$/},a=>a.importer.endsWith('/task-view-preferences.ts')?{path:a.path,namespace:'fixture-view-fs'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture-view-fs'},()=>({contents:viewFs,loader:'js'}));
  b.onResolve({filter:/^node:child_process$/},a=>a.importer.endsWith('/document-source-native.ts')?{path:a.path,namespace:'fixture-doc'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture-doc'},()=>({contents:docExec,loader:'js'}));
  b.onResolve({filter:/^(electron|\.\/provider|\.\/codex-provider|\.\/native)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='electron'?electron:a.path==='./native'?native:provider,loader:'js'}));
 }}]});
 await symlink(join(root,'node_modules'),join(directory,'node_modules'),'dir');
 const previous=process.env.WINDOW_COMPANION_DATA_DIR;process.env.WINDOW_COMPANION_DATA_DIR=directory;let host:HostHarness;
 try{host=await import(/* @vite-ignore */pathToFileURL(outfile).href)}finally{if(previous===undefined)delete process.env.WINDOW_COMPANION_DATA_DIR;else process.env.WINDOW_COMPANION_DATA_DIR=previous;}
 const core=await createCompanion({dataDir:join(directory,'store')});await host.setCore(core);
 host.setPanel({isDestroyed:()=>false,isVisible:()=>true,getSize:()=>[360,440],getBounds:()=>({x:620,y:0,width:360,height:440}),webContents:{send:(_channel:string,event:unknown)=>calls.events.push(event)}});
 const task=await core.createTask({title:'Synthetic task A'});host.selectTask(task.id,target.id);await host.command({type:'context.view',taskId:task.id});
 cleanups.push(async()=>{host.documentFollow.stop();await core.close();Reflect.deleteProperty(globalThis,key);await rm(directory,{recursive:true,force:true});});
 return {host,core,state,calls,target,task,directory,capture:()=>host.command({type:'windows.capture',taskId:task.id,windowId:target.id})};
}
