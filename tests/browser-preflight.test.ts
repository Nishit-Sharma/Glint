import {it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {BrowserService} from '../src/host/browser/service';
import type {ConnectionStatus} from '../src/shared/bridge';
import {createServer} from 'node:http';
import {emptyTaskSession} from '../src/core/task-session';
const {showMessageBox}=vi.hoisted(()=>({showMessageBox:vi.fn()}));
vi.mock('electron',()=>({dialog:{showMessageBox}}));

it.each([false,true])('Stop during provider preflight retires startup and preserves prior context (%s)',async previous=>{
 const dataDir=await mkdtemp(join(tmpdir(),'companion-preflight-')),core=await createCompanion({dataDir});
 let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>entered=resolve),waiting=new Promise<void>(resolve=>release=resolve);
 showMessageBox.mockReset();showMessageBox.mockResolvedValue({response:0});
 const service=new BrowserService(core,{panel:()=>({}) as never,route:()=>({key:'fixture',provider:{status:async()=>{entered();await waiting;return {configured:true,provider:'Codex (temporary)'} as ConnectionStatus;},run:async()=>{throw Error('No model request expected.');}}}),changed:()=>{},progress:()=>{}});
 const task=await core.createTask({title:'Preflight cancellation'}),prior={origin:'http://127.0.0.1:2',url:'http://127.0.0.1:2/previous',requestId:'prior'};
 if(previous)await core.replaceSession(task.id,0,{...emptyTaskSession(),browserContext:prior});
 const running=service.run({taskId:task.id,requestId:'preflight',prompt:'Read a synthetic page',url:'http://127.0.0.1:1'});
 const settled=running.catch(error=>error);
 try{
  await started;await expect(core.cancelRequest(task.id,'preflight')).resolves.toMatchObject({status:'cancelled'});
  release();await settled;expect(showMessageBox).not.toHaveBeenCalled();expect((await core.getTask(task.id)).session?.runs??[]).toEqual([]);expect((await core.getTask(task.id)).session?.browserContext).toEqual(previous?prior:undefined);
 }finally{release();await settled;service.close();await core.close();await rm(dataDir,{recursive:true,force:true});}
});

it.each(['source','detach'] as const)('a %s switch during provider preflight cannot be overwritten when startup completes',async change=>{
 const server=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<h1>Owned page</h1>');});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('Missing port');const url=`http://127.0.0.1:${address.port}`;
 const dataDir=await mkdtemp(join(tmpdir(),'companion-preflight-context-')),core=await createCompanion({dataDir});let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>entered=resolve),waiting=new Promise<void>(resolve=>release=resolve);
 showMessageBox.mockReset();showMessageBox.mockResolvedValue({response:1});
 const service=new BrowserService(core,{headless:true,panel:()=>({}) as never,route:()=>({key:'fixture',provider:{status:async()=>{entered();await waiting;return {configured:true,provider:'Codex (temporary)'} as ConnectionStatus;},run:async()=>JSON.stringify({kind:'answer',markdown:'The observed page is retained.',modules:[]})}}),changed:()=>{},progress:()=>{}});
 const task=await core.createTask({title:'Startup context ownership'}),running=service.run({taskId:task.id,requestId:'preflight-context',prompt:'Read this page',url});const settled=running.catch(error=>error);
 try{
  if(change==='source')await core.putSource(task.id,{kind:'text',role:'fact',label:'New source',content:'Explicit newer context'});await started;if(change==='detach')await core.clearBrowserContext(task.id);
  release();expect(await settled).toMatchObject({id:task.id});expect((await core.getTask(task.id)).session?.browserContext).toBeUndefined();
 }finally{release();await settled;service.close();await core.close();await rm(dataDir,{recursive:true,force:true});await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
