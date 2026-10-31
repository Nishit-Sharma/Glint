import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it,vi} from 'vitest';
import {createCompanion} from '../src/core/companion';
import {BrowserService} from '../src/host/browser/service';
const external=vi.hoisted(()=>({dialog:vi.fn()}));
vi.mock('electron',()=>({dialog:{showMessageBox:external.dialog}}));

it.each(['deny-then-return','stop-during-return','service-close','route-change'] as const)('live host control identity and native return remain exact: %s',async mode=>{
 const server=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<h1>Owned current page</h1>');});await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw Error('Missing port');
 const origin=`http://127.0.0.1:${address.port}`,directory=await mkdtemp(join(tmpdir(),'browser-control-host-')),core=await createCompanion({dataDir:directory}),task=await core.createTask({title:'Owned host control'});let plans=0,key='owned',ready!:()=>void,resolveReturn!:(value:{response:number})=>void;
 const waiting=new Promise<void>(resolve=>{ready=resolve;});external.dialog.mockReset().mockResolvedValue({response:1});
 const provider={status:async()=>({configured:true,provider:'Codex (temporary)' as const,endpoint:'owned-fixture',model:'scripted',state:'ready' as const,detail:'No model call',specialized:{sam:'off',computer:'off'}}),run:async(input:{signal:AbortSignal})=>{if(++plans===1){ready();return new Promise<string>((_resolve,reject)=>input.signal.addEventListener('abort',()=>reject(Error('Paused scripted transport')),{once:true}));}return JSON.stringify({kind:'answer',markdown:'Fresh owned page observed.'});}};
 const service=new BrowserService(core,{panel:()=>({}) as never,route:()=>({key,provider}),changed:()=>{},progress:()=>{},headless:true}),input={taskId:task.id,requestId:'host'};
 let running:Promise<unknown>|undefined;
 try{
  running=service.run({...input,prompt:'Read owned page',url:origin});void running.catch(()=>{});await waiting;
  const status=service.controlStatus(input);if(!('id' in status))throw Error('Missing live owned control');const command={...input,id:status.id};
  expect(service.controlStatus({...input,requestId:'another'})).toEqual({mode:'unavailable'});await expect(service.changeControl({...command,id:'stale-control',action:'take'})).rejects.toThrow('no longer active');expect(external.dialog).toHaveBeenCalledTimes(1);
  expect((await service.changeControl({...command,action:'take'})).mode).toBe('pausing');await expect.poll(()=>service.controlStatus(input).mode).toBe('user');expect(plans).toBe(1);
  if(mode==='route-change'){
   key='changed';await expect(service.changeControl({...command,action:'return'})).rejects.toThrow('changed');expect(service.controlStatus(input).mode).toBe('user');expect(external.dialog).toHaveBeenCalledTimes(1);await core.cancelRequest(task.id,input.requestId);await expect(running).rejects.toThrow();
  }else if(mode==='deny-then-return'){
   external.dialog.mockResolvedValueOnce({response:0});expect((await service.changeControl({...command,action:'return'})).mode).toBe('user');expect(plans).toBe(1);
   const consent=external.dialog.mock.calls[1][1];expect(consent.message).toBe('Return browser control to Glint?');expect(consent.detail).toContain(origin);expect(consent.detail).toContain('Manual same-site navigation and GET forms can change the website without another Glint approval.');expect(consent.detail).toContain('including requests started or scheduled earlier');expect(consent.detail).not.toContain('Form submissions still need');expect(external.dialog.mock.calls[0][1].detail).toContain('Manual same-site navigation and GET forms');expect(consent.detail).toContain('Every new agent interaction still needs its own exact approval');expect(consent.buttons).toEqual(['Keep control','Return control']);
   await service.changeControl({...command,action:'return'});await running;expect(plans).toBe(2);
  }else{
   external.dialog.mockImplementationOnce(()=>new Promise(resolve=>{resolveReturn=resolve;}));const returning=service.changeControl({...command,action:'return'});void returning.catch(()=>{});await expect(service.changeControl({...command,action:'return'})).rejects.toThrow('already being reviewed');
   const signal=external.dialog.mock.calls[1][1].signal as AbortSignal;if(mode==='service-close')service.close();else await core.cancelRequest(task.id,input.requestId);await expect(running).rejects.toThrow();expect(signal.aborted).toBe(true);resolveReturn({response:1});await expect(returning).rejects.toThrow('no longer active');expect(plans).toBe(1);
  }
  expect(service.controlStatus(input)).toEqual({mode:'unavailable'});await expect(service.changeControl({...command,action:'take'})).rejects.toThrow('no longer active');
 }finally{service.close();await core.cancelRequest(task.id,input.requestId).catch(()=>{});await running?.catch(()=>{});await core.close();await rm(directory,{recursive:true,force:true});server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

it('offers the same pause fence from a modal exact-action review without approving it',async()=>{
 let visits=0;const server=createServer((req,res)=>{res.setHeader('content-type','text/html');if(req.url==='/next'){visits++;res.end('<h1>Owned next page</h1>');}else res.end('<h1>Owned page</h1><a href="/next">Next</a>');});await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw Error('Missing port');
 const origin=`http://127.0.0.1:${address.port}`,directory=await mkdtemp(join(tmpdir(),'browser-modal-pause-')),core=await createCompanion({dataDir:directory}),task=await core.createTask({title:'Modal owned handoff'});let plans=0;
 external.dialog.mockReset().mockResolvedValueOnce({response:1}).mockResolvedValueOnce({response:2}).mockResolvedValue({response:1});
 const provider={status:async()=>({configured:true,provider:'Codex (temporary)' as const,endpoint:'owned-fixture',model:'scripted',state:'ready' as const,detail:'No model call',specialized:{sam:'off',computer:'off'}}),run:async(input:{sources:readonly {content:string}[]})=>{plans++;const current=JSON.parse(input.sources[0].content).currentObservation,target=current.targets.find((item:{label:string})=>item.label==='Next');return JSON.stringify(target?{kind:'action',reason:'Read next owned page',action:{kind:'click',targetId:target.id}}:{kind:'answer',markdown:'The next owned page is visible.'});}};
 const service=new BrowserService(core,{panel:()=>({}) as never,route:()=>({key:'owned',provider}),changed:()=>{},progress:()=>{},headless:true}),input={taskId:task.id,requestId:'modal'};let running:Promise<unknown>|undefined;
 try{
  running=service.run({...input,prompt:'Read next owned page',url:origin});void running.catch(()=>{});await expect.poll(()=>service.controlStatus(input).mode,{timeout:3000}).toBe('user');expect(visits).toBe(0);expect(plans).toBe(1);expect((await core.getTask(task.id)).session?.runs[0].operations[0].status).toBe('retired');
  const review=external.dialog.mock.calls[1][1];expect(review.buttons).toEqual(['Cancel','Allow once','Pause and take control']);expect(review.defaultId).toBe(0);expect(review.cancelId).toBe(0);
  const status=service.controlStatus(input);if(!('id' in status))throw Error('Missing control');await service.changeControl({...input,id:status.id,action:'return'});await running;expect(visits).toBe(1);expect(plans).toBe(3);expect(external.dialog.mock.calls.map(call=>call[1].message)).toEqual(['Use an isolated browser for this task?','Allow this browser interaction?','Return browser control to Glint?','Allow this browser interaction?']);
 }finally{service.close();await core.cancelRequest(task.id,input.requestId).catch(()=>{});await running?.catch(()=>{});await core.close();await rm(directory,{recursive:true,force:true});server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
