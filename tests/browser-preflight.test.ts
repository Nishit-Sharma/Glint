import {it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {BrowserService} from '../src/host/browser/service';
import {LocalBrowser} from '../src/host/browser/local-browser';
import type {ConnectionStatus} from '../src/shared/bridge';
import {createServer} from 'node:http';
import {emptyTaskSession} from '../src/core/task-session';
import {installLoopbackTestEngine} from './loopback-browser.fixture';
installLoopbackTestEngine();
const {showMessageBox}=vi.hoisted(()=>({showMessageBox:vi.fn()}));
vi.mock('electron',()=>({dialog:{showMessageBox}}));

it.each([false,true])('Stop during provider preflight retires startup and preserves prior context (%s)',async previous=>{
 const dataDir=await mkdtemp(join(tmpdir(),'companion-preflight-')),core=await createCompanion({dataDir});
 let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>entered=resolve),waiting=new Promise<void>(resolve=>release=resolve);
 showMessageBox.mockReset();showMessageBox.mockResolvedValue({response:0});
 const browserOpen=vi.spyOn(LocalBrowser,'open'),providerRun=vi.fn(async()=>{throw Error('No model request expected.');});
 const service=new BrowserService(core,{panel:()=>({}) as never,route:()=>({key:'fixture',provider:{accountScope:async()=> 'synthetic-account',status:async()=>{entered();await waiting;return {configured:true,provider:'Codex (temporary)'} as ConnectionStatus;},run:providerRun}}),changed:()=>{},progress:()=>{}});
 const task=await core.createTask({title:'Preflight cancellation'}),prior={origin:'http://127.0.0.1:2',url:'http://127.0.0.1:2/previous',requestId:'prior'};
 if(previous)await core.replaceSession(task.id,0,{...emptyTaskSession(),browserContext:prior});
 const running=service.run({taskId:task.id,requestId:'preflight',prompt:'Read a synthetic page',url:'http://127.0.0.1:1'});
 const settled=running.catch(error=>error);
 try{
  await started;await expect(core.cancelRequest(task.id,'preflight')).resolves.toMatchObject({status:'cancelled'});
  release();await settled;expect(showMessageBox).not.toHaveBeenCalled();expect(browserOpen).not.toHaveBeenCalled();expect(providerRun).not.toHaveBeenCalled();expect((await core.getTask(task.id)).session?.runs??[]).toEqual([]);expect((await core.getTask(task.id)).session?.browserContext).toEqual(previous?prior:undefined);
 }finally{release();await settled;service.close();await core.close();await rm(dataDir,{recursive:true,force:true});browserOpen.mockRestore();}
});

it.each(['source','detach'] as const)('a %s switch during provider preflight cannot be overwritten when startup completes',async change=>{
 const server=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<h1>Owned page</h1>');});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('Missing port');const url=`http://127.0.0.1:${address.port}`;
 const dataDir=await mkdtemp(join(tmpdir(),'companion-preflight-context-')),core=await createCompanion({dataDir});let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>entered=resolve),waiting=new Promise<void>(resolve=>release=resolve);
 showMessageBox.mockReset();showMessageBox.mockResolvedValue({response:1});
 const browserOpen=vi.spyOn(LocalBrowser,'open'),providerStatus=vi.fn(async()=>{entered();await waiting;return {configured:true,provider:'Codex (temporary)'} as ConnectionStatus;}),providerRun=vi.fn(async()=>JSON.stringify({kind:'answer',markdown:'The observed page is retained.',modules:[]}));
 const service=new BrowserService(core,{headless:true,panel:()=>({}) as never,route:()=>({key:'fixture',provider:{accountScope:async()=> 'synthetic-account',status:providerStatus,run:providerRun}}),changed:()=>{},progress:()=>{}});
 const task=await core.createTask({title:'Startup context ownership'}),running=service.run({taskId:task.id,requestId:'preflight-context',prompt:'Read this page',url});const settled=running.catch(error=>error);
 try{
  await started;const admitted=await core.getTask(task.id),contextRevision=admitted.session?.contextRevision??0;expect(admitted.requests).toMatchObject([{id:'preflight-context',status:'running',sourceRefs:[]}]);expect(admitted.sources).toEqual([]);
  expect(showMessageBox).not.toHaveBeenCalled();expect(browserOpen).not.toHaveBeenCalled();expect(providerRun).not.toHaveBeenCalled();expect(admitted.session?.runs??[]).toEqual([]);
  if(change==='source')await core.putSource(task.id,{kind:'text',role:'fact',label:'New source',content:'Explicit newer context'});else await core.clearBrowserContext(task.id);
  expect((await core.getTask(task.id)).session!.contextRevision).toBeGreaterThan(contextRevision);expect(browserOpen).not.toHaveBeenCalled();expect(providerRun).not.toHaveBeenCalled();
  release();expect(await settled).toMatchObject({id:task.id});const after=await core.getTask(task.id);expect(after.session?.browserContext).toBeUndefined();expect(after.requests[0].status).toBe('completed');expect(after.session?.runs).toHaveLength(1);expect(after.session!.runs[0].operations).toEqual([]);
  expect(providerStatus).toHaveBeenCalledTimes(1);expect(providerRun).toHaveBeenCalledTimes(1);expect(browserOpen).toHaveBeenCalledTimes(1);expect(browserOpen.mock.calls[0][0].onWindowOwner).toBeUndefined();expect(browserOpen.mock.calls[0][0].headless).toBe(true);expect(JSON.stringify(providerRun.mock.calls)).not.toContain('Explicit newer context');
  if(change==='source')expect(after.sources).toMatchObject([{currentVersion:1,versions:[{label:'New source',content:'Explicit newer context'}]}]);else expect(after.sources).toEqual([]);
 }finally{release();await settled;service.close();await core.close();await rm(dataDir,{recursive:true,force:true});await new Promise<void>(resolve=>server.close(()=>resolve()));browserOpen.mockRestore();}
});
