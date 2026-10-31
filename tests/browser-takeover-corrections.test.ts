import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it,vi} from 'vitest';
import {chromium,type Browser} from 'playwright-core';
import {createCompanion} from '../src/core/companion';
import {BrowserCoordinator} from '../src/host/browser/coordinator';
import {BrowserControl} from '../src/host/browser/control';
import {LocalBrowser} from '../src/host/browser/local-browser';

// Deliberate read-error injection; real store/browser, scripted planner and no provider.
it.each(['observe','propose','review'] as const)('Pause wins over a rejected pre-execution %s while the same page remains usable',async phase=>{
 const server=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<h1>Owned read failure</h1><label>Note<input value="Before"></label><button>Local action</button>');});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw Error('Missing port');const origin=`http://127.0.0.1:${address.port}`,directory=await mkdtemp(join(tmpdir(),'browser-read-pause-')),core=await createCompanion({dataDir:directory}),control=new BrowserControl();
 let browser:Browser|undefined,ready!:()=>void,rejectRead!:()=>void,calls=0,plans=0,approvals=0,resumed=false;const waiting=new Promise<void>(resolve=>{ready=resolve;}),rejection=new Promise<void>(resolve=>{rejectRead=resolve;});
 const launch=chromium.launch.bind(chromium),capture=vi.spyOn(chromium,'launch').mockImplementation(async options=>{browser=await launch(options);return browser;});
 const original=LocalBrowser.prototype[phase];const fault=vi.spyOn(LocalBrowser.prototype,phase).mockImplementation(async function(this:LocalBrowser,...args:any[]){
  if(++calls===(phase==='observe'?2:1)){ready();await rejection;throw Error('Owned injected read rejection');}
  return (original as (...args:any[])=>Promise<any>).apply(this,args);
 });
 let running:Promise<unknown>|undefined;
 try{
  const task=await core.createTask({title:'Pause rejected read'}),coordinator=new BrowserCoordinator(core,{endpointKey:'owned-scripted',async plan(input){plans++;if(resumed){expect(input.observation.targets.find(target=>target.label==='Note')?.value).toBe('After failed read');return {kind:'answer',markdown:'The manual note was freshly observed.',modules:[]};}return {kind:'action',reason:'Owned local button',action:{kind:'click',targetId:input.observation.targets.find(target=>target.label==='Local action')!.id}};}});
  running=coordinator.run({taskId:task.id,requestId:'read-pause',goal:'Read owned note',origin,url:origin,transmissionApproved:true,control,approveAction:async()=>{approvals++;return {approved:true};}});void running.catch(()=>{});
  await waiting;control.take();rejectRead();await expect.poll(()=>control.status().mode,{timeout:1500}).toBe('user');expect(browser!.isConnected()).toBe(true);expect(approvals).toBe(0);expect(plans).toBe(phase==='observe'?0:1);
  await browser!.contexts()[0].pages()[0].getByLabel('Note',{exact:true}).fill('After failed read');resumed=true;control.returnToAgent();expect(await running).toMatchObject({status:'completed'});expect(approvals).toBe(0);
  const saved=await core.getTask(task.id);expect(saved.session?.runs[0].operations.every(operation=>operation.status==='retired')).toBe(true);
 }finally{rejectRead();fault.mockRestore();capture.mockRestore();for(const task of await core.listTasks())for(const request of task.requests)if(request.status==='running')await core.cancelRequest(task.id,request.id);await running?.catch(()=>{});await core.close();await browser?.close();await rm(directory,{recursive:true,force:true});server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

it('blocks stale agent operations during user control while a manual same-site GET form remains allowed',async()=>{
 let getForms=0,posts=0;const server=createServer((req,res)=>{res.setHeader('content-type','text/html');if(req.method==='POST')posts++;if(req.url?.startsWith('/manual?'))getForms++;res.end('<h1>Owned manual GET</h1><form action="/manual" method="get"><input name="note" value="owned"><button>Send GET form</button></form>');});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw Error('Missing port');const origin=`http://127.0.0.1:${address.port}`;let browser:Browser|undefined,local:LocalBrowser|undefined;const launch=chromium.launch.bind(chromium),capture=vi.spyOn(chromium,'launch').mockImplementation(async options=>{browser=await launch(options);return browser;});
 try{
  local=await LocalBrowser.open({taskId:'manual-get',origin,url:origin});const observation=await local.observe(),proposal=await local.propose({kind:'click',snapshotId:observation.id,targetId:observation.targets.find(target=>target.label==='Send GET form')!.id}),token=local.approve(proposal.id);
  local.yieldToUser();await expect(local.observe()).rejects.toThrow('paused');await expect(local.propose(proposal.intent)).rejects.toThrow('paused');await expect(local.review(proposal.id)).rejects.toThrow('paused');expect(()=>local!.approve(proposal.id)).toThrow('paused');await expect(local.execute(proposal.id,token)).rejects.toThrow('paused');expect(getForms).toBe(0);
  const page=browser!.contexts()[0].pages()[0];await page.getByRole('button',{name:'Send GET form',exact:true}).click();await expect.poll(()=>getForms).toBe(1);expect(await page.evaluate(()=>fetch('/unapproved',{method:'POST'}).then(()=>false,()=>true))).toBe(true);expect(posts).toBe(0);
  local.resumeAgent();await expect(local.execute(proposal.id,token)).rejects.toThrow('Approval is required');const fresh=await local.observe();expect(fresh.url).toContain('/manual?note=owned');
 }finally{capture.mockRestore();await local?.close();await browser?.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

it('fences new agent input while prior page-scheduled same-site traffic can continue after handoff',async()=>{
 let start!:()=>void,release!:()=>void,starts=0,late=0,plans=0,approvals=0;const initiated=new Promise<void>(resolve=>{start=resolve;}),pending=new Promise<void>(resolve=>{release=resolve;}),control=new BrowserControl();
 const server=createServer(async(req,res)=>{res.setHeader('content-type','text/html');if(req.url==='/started'){starts++;start();await pending;res.end('Continue owned page callback');return;}if(req.url==='/late'){late++;res.end('Owned delayed request');return;}res.end('<h1>Owned scripted page</h1><button onclick="fetch(\'/started\').then(()=>fetch(\'/late\'))">Schedule owned request</button>');});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw Error('Missing port');const origin=`http://127.0.0.1:${address.port}`,directory=await mkdtemp(join(tmpdir(),'browser-late-page-')),core=await createCompanion({dataDir:directory});let running:Promise<unknown>|undefined;
 try{
  const task=await core.createTask({title:'Owned delayed page traffic'}),coordinator=new BrowserCoordinator(core,{endpointKey:'owned-scripted',async plan(input){plans++;return {kind:'action',reason:'One owned page interaction',action:{kind:'click',targetId:input.observation.targets[0].id}};}});
  running=coordinator.run({taskId:task.id,requestId:'late-page',goal:'One owned interaction then manual control',origin,url:origin,transmissionApproved:true,control,approveAction:async()=>{approvals++;return {approved:true};}});void running.catch(()=>{});
  await initiated;control.take();await expect.poll(()=>control.status().mode).toBe('user');expect(starts).toBe(1);expect(late).toBe(0);expect(plans).toBe(1);expect(approvals).toBe(1);
  release();await expect.poll(()=>late).toBe(1);expect(control.status().mode).toBe('user');expect(plans).toBe(1);expect(approvals).toBe(1);expect(starts).toBe(1);expect((await core.getTask(task.id)).session?.runs[0].operations[0].status).toBe('observed');
  await core.cancelRequest(task.id,'late-page');expect(await running).toMatchObject({status:'cancelled'});
 }finally{release();for(const task of await core.listTasks())for(const request of task.requests)if(request.status==='running')await core.cancelRequest(task.id,request.id);await running?.catch(()=>{});await core.close();await rm(directory,{recursive:true,force:true});server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
