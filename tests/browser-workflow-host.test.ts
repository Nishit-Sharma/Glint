import {afterEach,expect,it} from 'vitest';
import {build} from 'esbuild';
import {mkdtemp,readFile,rm,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createCompanion} from '../src/core/companion';
import {browserWorkflowStarter,type BrowserWorkflowSaved,type BrowserWorkflowRunResult} from '../src/shared/browser-workflow';
import type {BrowserControlReply} from '../src/shared/browser-control';
import {workflowSite} from './browser-workflow-site';

const cleanups:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
async function fixture(){
 const root=resolve('.'),directory=await mkdtemp(join(tmpdir(),'browser-workflow-production-host-')),key='workflowHost'+randomUUID().replaceAll('-',''),site=await workflowSite();
 const calls:{dialogs:{message:string;detail:string;buttons:string[];signal:AbortSignal}[];providers:number}={dialogs:[],providers:0};
 const seam={confirm:async(_panel:unknown,dialog:typeof calls.dialogs[number])=>{calls.dialogs.push(dialog);return {response:1};},provider:()=>{calls.providers++;throw Error('A saved authored workflow must not call a provider.');}};
 Reflect.set(globalThis,key,seam);const reference=`globalThis[${JSON.stringify(key)}]`;
 const electron=`const noop=()=>{};export const app={getPath:()=>process.env.WINDOW_COMPANION_DATA_DIR,setPath:noop,whenReady:()=>new Promise(()=>{}),on:noop};export class BrowserWindow{};export const Menu={};export class Tray{};export const dialog={showMessageBox:(...args)=>${reference}.confirm(...args)};export const globalShortcut={unregisterAll:noop};export const ipcMain={};export const nativeImage={};export const safeStorage={};export const systemPreferences={isTrustedAccessibilityClient:()=>false};export const session={};export const screen={getDisplayMatching:()=>({workArea:{x:0,y:0,width:1800,height:1100}})};`;
 const provider=`export class MetaProvider{status(){return ${reference}.provider()};run(){return ${reference}.provider()};reset(){};close(){}};export class CodexProvider extends MetaProvider{}`;
 const native='export class NativeSourceAdapter{};export const placeCompanion=()=>undefined;';
 const source=await readFile(join(root,'src/host/index.ts'),'utf8'),ipc=source.match(/ipcMain\.handle\('companion:command',(async\(event,value\)=>\{[\s\S]*?\n  \})\)\n  ipcMain\.handle\('credential:save'/)?.[1];
 if(!ipc)throw Error('The production companion IPC handler was not found.');
 const outfile=join(directory,'host.mjs');
 await build({stdin:{contents:source+`\nexport const dispatch=(value,trusted=true)=>(${ipc})({sender:trusted?panel.webContents:{},senderFrame:panel.webContents.mainFrame},value);export {validate};export const setCore=async value=>{core=value;captureSettings=await CaptureSettings.open(dataDir);botPreferences=await BotPreferences.open(dataDir,core)};export const setPanel=value=>{panel=value};export const shutdown=()=>{browserService?.close();if(monitor)clearInterval(monitor)};`,resolveDir:join(root,'src/host'),sourcefile:join(root,'src/host/index.ts'),loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile,plugins:[{name:'owned-os-boundaries',setup(builder){builder.onResolve({filter:/^(electron|\.\/provider|\.\/codex-provider|\.\/native)$/},args=>({path:args.path,namespace:'fixture'}));builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='electron'?electron:args.path==='./native'?native:provider,loader:'js'}));}}]});
 await symlink(join(root,'node_modules'),join(directory,'node_modules'),'dir');
 const oldDirectory=process.env.WINDOW_COMPANION_DATA_DIR,oldHeadless=process.env.WINDOW_COMPANION_BROWSER_HEADLESS;process.env.WINDOW_COMPANION_DATA_DIR=directory;process.env.WINDOW_COMPANION_BROWSER_HEADLESS='1';
 const host=await import(/* @vite-ignore */pathToFileURL(outfile).href) as {dispatch(input:unknown,trusted?:boolean):Promise<any>;validate(input:unknown):unknown;setCore(core:unknown):Promise<void>;setPanel(panel:unknown):void;shutdown():void};
 const core=await createCompanion({dataDir:join(directory,'store')});await host.setCore(core);host.setPanel({isDestroyed:()=>false,webContents:{mainFrame:{},send:()=>{}}});
 const task=await core.createTask({title:'Production authored browser host'}),save={type:'browser.workflow.save',taskId:task.id,requestId:'save',definition:{...browserWorkflowStarter,origin:site.origin}};
 cleanups.push(async()=>{host.shutdown();await core.close();await site.close();Reflect.deleteProperty(globalThis,key);await rm(directory,{recursive:true,force:true});if(oldDirectory===undefined)delete process.env.WINDOW_COMPANION_DATA_DIR;else process.env.WINDOW_COMPANION_DATA_DIR=oldDirectory;if(oldHeadless===undefined)delete process.env.WINDOW_COMPANION_BROWSER_HEADLESS;else process.env.WINDOW_COMPANION_BROWSER_HEADLESS=oldHeadless;});
 const saved=await host.dispatch(save) as BrowserWorkflowSaved,revision=saved.task.artifacts[0].revisions[0],run={type:'browser.workflow.run',taskId:task.id,requestId:'run',workflow:{artifactId:saved.artifactId,revision:revision.revision,digest:revision.digest},url:site.origin+'/requests/host',inputs:{title:'Production boundary request',delivery:'courier'}};
 const status=()=>host.dispatch({type:'browser.control.status',taskId:task.id,requestId:run.requestId}) as Promise<BrowserControlReply>;
 return {host,core,site,calls,seam,task,save,run,status};
}

it('admits only strict workflow save/run payloads through the actual production IPC handler and dispatcher',async()=>{
 const f=await fixture();
 for(const input of [{...f.save,approved:true},{...f.save,definition:{...f.save.definition,script:'untrusted'}},{...f.run,headless:true},{...f.run,workflow:{...f.run.workflow,approved:true}},{...f.run,workflow:{...f.run.workflow,revision:1.5}},{...f.run,inputs:{title:{text:'wrong type'},delivery:'courier'}},{...f.run,url:'https://user:secret@example.invalid/requests/'},{...f.run,taskId:''}]){
  expect(()=>f.host.validate(input)).toThrow();await expect(f.host.dispatch(input)).rejects.toThrow();
 }
 await expect(f.host.dispatch(f.run,false)).rejects.toThrow();expect(f.calls.dialogs).toEqual([]);expect(f.site.effects).toEqual([]);
 const result=await f.host.dispatch(f.run) as BrowserWorkflowRunResult;expect(result.status,result.error).toBe('completed');expect(f.calls.providers).toBe(0);expect(f.calls.dialogs).toHaveLength(4);expect(f.site.effects).toEqual([{target:'/requests/host',title:'Production boundary request',delivery:'courier'}]);
 expect((await f.host.dispatch(f.run)).requestId).toBe(result.requestId);expect(f.site.effects).toHaveLength(1);expect(f.calls.dialogs).toHaveLength(4);expect(await f.status()).toEqual({mode:'unavailable'});
});

it.each(['modal','workspace'] as const)('authored %s pause uses the shared host registry and native Return before fresh approved steps',async source=>{
 const f=await fixture();let paused=false,releaseLate:(()=>void)|undefined;
 f.seam.confirm=async(_panel,dialog)=>{f.calls.dialogs.push(dialog);if(dialog.message==='Allow this workflow step?'&&!paused){paused=true;if(source==='modal')return {response:2};return new Promise(resolve=>{releaseLate=()=>resolve({response:1});});}return {response:1};};
 const running=f.host.dispatch(f.run);void running.catch(()=>{});
 if(source==='workspace'){
  await expect.poll(()=>!!releaseLate).toBe(true);const current=await f.status();if(!('id' in current))throw Error('Missing authored control');await f.host.dispatch({type:'browser.control',taskId:f.task.id,requestId:f.run.requestId,id:current.id,action:'take'});
 }
 await expect.poll(async()=>(await f.status()).mode).toBe('user');releaseLate?.();expect(f.site.effects).toEqual([]);const current=await f.status();if(!('id' in current))throw Error('Missing authored control');
 await expect(f.host.dispatch(f.run)).rejects.toThrow();await expect(f.host.dispatch({type:'browser.control',taskId:f.task.id,requestId:f.run.requestId,id:'stale',action:'return'})).rejects.toThrow();
 await f.host.dispatch({type:'browser.control',taskId:f.task.id,requestId:f.run.requestId,id:current.id,action:'return'});const result=await running as BrowserWorkflowRunResult;expect(result.status,result.error).toBe('completed');
 const review=f.calls.dialogs.find(dialog=>dialog.message==='Return browser control to Glint?')!;expect(review.detail).toContain('No model request is made');expect(review.detail).toContain('saved path /requests/');expect(review.detail).not.toContain('previously approved AI service');expect(review.buttons).toEqual(['Keep control','Return control']);
 expect(f.calls.providers).toBe(0);expect(f.site.effects).toHaveLength(1);const operations=(await f.core.getTask(f.task.id)).session!.runs[0].operations;expect(operations.filter(operation=>operation.status==='retired')).toHaveLength(1);expect(operations.filter(operation=>operation.status==='observed')).toHaveLength(3);expect(await f.status()).toEqual({mode:'unavailable'});
});

it.each(['stop','recipe-edit','service-close'] as const)('a late native authored Return cannot revive the run after %s',async change=>{
 const f=await fixture();let paused=false,releaseReturn:(()=>void)|undefined;
 f.seam.confirm=async(_panel,dialog)=>{f.calls.dialogs.push(dialog);if(dialog.message==='Allow this workflow step?'&&!paused){paused=true;return {response:2};}if(dialog.message==='Return browser control to Glint?')return new Promise(resolve=>{releaseReturn=()=>resolve({response:1});});return {response:1};};
 const running=f.host.dispatch(f.run);void running.catch(()=>{});await expect.poll(async()=>(await f.status()).mode).toBe('user');const current=await f.status();if(!('id' in current))throw Error('Missing authored control');
 const returning=f.host.dispatch({type:'browser.control',taskId:f.task.id,requestId:f.run.requestId,id:current.id,action:'return'});void returning.catch(()=>{});await expect.poll(()=>!!releaseReturn).toBe(true);
 if(change==='recipe-edit')await f.host.dispatch({...f.save,requestId:'edit',artifact:f.run.workflow,definition:{...f.save.definition,name:'Edited exact recipe'}});else if(change==='service-close')f.host.shutdown();else await f.host.dispatch({type:'model.cancel',taskId:f.task.id,requestId:f.run.requestId});
 releaseReturn!();await expect(returning).rejects.toThrow();if(change==='recipe-edit')await f.host.dispatch({type:'model.cancel',taskId:f.task.id,requestId:f.run.requestId});const result=await running as BrowserWorkflowRunResult;expect(result.status).not.toBe('completed');expect(f.site.effects).toEqual([]);expect(f.calls.providers).toBe(0);expect(await f.status()).toEqual({mode:'unavailable'});
});
