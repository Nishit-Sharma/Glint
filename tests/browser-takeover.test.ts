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

it('fences a late exact approval until explicit return and a fresh plan',async()=>{
 let visits=0;const server=createServer((req,res)=>{res.setHeader('content-type','text/html');if(req.url==='/next'){visits++;res.end('<h1>Result</h1>');}else res.end('<h1>Owned page</h1><a href="/next">Next</a>');});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw Error('Missing port');
 const origin=`http://127.0.0.1:${address.port}`,dataDir=await mkdtemp(join(tmpdir(),'browser-takeover-')),core=await createCompanion({dataDir}),control=new BrowserControl();
 let ready!:()=>void,late!:(value:{approved:true})=>void,plans=0,approvals=0;const waiting=new Promise<void>(resolve=>{ready=resolve;});
 try{
  const task=await core.createTask({title:'Owned control handoff'}),coordinator=new BrowserCoordinator(core,{endpointKey:'fixture',async plan(input){plans++;return input.observation.targets.length?{kind:'action',reason:'Read the owned next page',action:{kind:'click',targetId:input.observation.targets[0].id}}:{kind:'answer',markdown:'Observed result',modules:[]};}});
  const running=coordinator.run({taskId:task.id,requestId:'handoff',goal:'Read next page',origin,url:origin,transmissionApproved:true,control,approveAction:async()=>{if(++approvals===1){ready();return new Promise(resolve=>{late=resolve;});}return {approved:true};}});
  await waiting;expect(control.take().mode).toBe('pausing');late({approved:true});
  await expect.poll(()=>control.status().mode).toBe('user');expect(visits).toBe(0);expect(plans).toBe(1);
  const paused=await core.getTask(task.id);expect(paused.requests.at(-1)?.status).toBe('running');expect(paused.session?.runs[0].operations[0].status).toBe('retired');
  control.returnToAgent();expect((await running).status).toBe('completed');expect(visits).toBe(1);expect(approvals).toBe(2);expect(plans).toBe(3);expect(control.status().mode).toBe('ended');
 }finally{await core.close();await rm(dataDir,{recursive:true,force:true});server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});


it('re-observes manual edits in the same browser without relaxing site or write restrictions',async()=>{
 let saves=0,foreignVisits=0;const foreign=createServer((_req,res)=>{foreignVisits++;res.end('Foreign owned fixture');});await new Promise<void>((resolve,reject)=>{foreign.once('error',reject);foreign.listen(0,'127.0.0.1',resolve);});const foreignAddress=foreign.address();if(!foreignAddress||typeof foreignAddress==='string')throw Error('Missing foreign port');
 const server=createServer((req,res)=>{res.setHeader('content-type','text/html');if(req.method==='POST'){saves++;res.end('<h1>Saved owned value</h1>');}else res.end(`<h1>Owned form</h1><form method="post" action="/save"><label>Name<input name="name" value="Initial"></label><button>Save</button></form><a href="http://127.0.0.1:${foreignAddress.port}/other">Other owned site</a>`);});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw Error('Missing port');
 const origin=`http://127.0.0.1:${address.port}`,dataDir=await mkdtemp(join(tmpdir(),'browser-manual-')),core=await createCompanion({dataDir}),control=new BrowserControl();
 let browser:Browser|undefined;const launch=chromium.launch.bind(chromium),capture=vi.spyOn(chromium,'launch').mockImplementation(async options=>{browser=await launch(options);return browser;});
 let ready!:()=>void,late!:(value:{kind:'answer';markdown:string;modules:[]})=>void,plans=0;const waiting=new Promise<void>(resolve=>{ready=resolve;});
 const reviewed:string[]=[];
 try{
  const task=await core.createTask({title:'Manual owned form'}),coordinator=new BrowserCoordinator(core,{endpointKey:'fixture',async plan(input){
   if(++plans===1){ready();return new Promise(resolve=>{late=resolve;});}
   const button=input.observation.targets.find(target=>target.label==='Save'),field=input.observation.targets.find(target=>target.label==='Name');
   if(!button)return {kind:'answer',markdown:'The receipt is visible; website effect is not independently verified.',modules:[]};
   expect(field?.value).toBe('User supplied');return {kind:'action',reason:'Submit the newly observed user value',action:{kind:'click',targetId:button.id,expectedFields:[{targetId:field!.id,value:'User supplied'}]}};
  }});
  const running=coordinator.run({taskId:task.id,requestId:'manual',goal:'Review an owned form',origin,url:origin,transmissionApproved:true,control,approveAction:async input=>{reviewed.push(input.review.write!.body);return {approved:true,write:input.review.write};}});
  await waiting;control.take();await expect.poll(()=>control.status().mode).toBe('user');late({kind:'answer',markdown:'Late stale answer',modules:[]});
  const page=browser!.contexts()[0].pages()[0];await page.getByLabel('Name',{exact:true}).fill('User supplied');
  const blocked=await page.evaluate(async foreignUrl=>{
   const write=await fetch('/blocked',{method:'POST',body:'unapproved=1'}).then(()=>false,()=>true);
   const other=await fetch(foreignUrl).then(()=>false,()=>true);return {write,other};
  },`http://127.0.0.1:${foreignAddress.port}/blocked`);
  expect(blocked).toEqual({write:true,other:true});expect(saves).toBe(0);expect(foreignVisits).toBe(0);expect(plans).toBe(1);expect((await core.getTask(task.id)).artifacts).toHaveLength(0);
  control.returnToAgent();expect((await running).status).toBe('completed');expect(saves).toBe(1);expect(reviewed).toEqual(['name=User+supplied']);expect(plans).toBe(3);expect((await core.getTask(task.id)).artifacts[0].revisions[0].content).not.toContain('Late stale answer');
 }finally{capture.mockRestore();await core.close();await browser?.close();await rm(dataDir,{recursive:true,force:true});server.closeAllConnections();foreign.closeAllConnections();await Promise.all([new Promise<void>(resolve=>server.close(()=>resolve())),new Promise<void>(resolve=>foreign.close(()=>resolve()))]);}
});

it('waits for a started interaction to settle, then Stop ends manual control without replay',async()=>{
 let started!:()=>void,release!:()=>void,visits=0;const first=new Promise<void>(resolve=>{started=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
 const server=createServer(async(req,res)=>{res.setHeader('content-type','text/html');if(req.url==='/next'){visits++;started();await held;res.end('<h1>Settled result</h1>');}else res.end('<h1>Owned page</h1><a href="/next">Next</a>');});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw Error('Missing port');
 const origin=`http://127.0.0.1:${address.port}`,directory=await mkdtemp(join(tmpdir(),'browser-pause-execution-')),core=await createCompanion({dataDir:directory}),control=new BrowserControl();let plans=0;
 try{
  const task=await core.createTask({title:'Pause started interaction'}),coordinator=new BrowserCoordinator(core,{endpointKey:'fixture',async plan(input){plans++;return {kind:'action',reason:'Read owned next page',action:{kind:'click',targetId:input.observation.targets[0].id}};}}),running=coordinator.run({taskId:task.id,requestId:'settle',goal:'Read next',origin,url:origin,transmissionApproved:true,control,approveAction:async()=>({approved:true})});
  await first;expect(control.take().mode).toBe('pausing');expect(plans).toBe(1);expect(visits).toBe(1);release();await expect.poll(()=>control.status().mode).toBe('user');expect((await core.getTask(task.id)).session?.runs[0].operations[0].status).toBe('observed');
  await core.cancelRequest(task.id,'settle');expect((await running).status).toBe('cancelled');expect(control.status().mode).toBe('ended');expect(()=>control.returnToAgent()).toThrow();expect(visits).toBe(1);expect(plans).toBe(1);
 }finally{release();await core.close();await rm(directory,{recursive:true,force:true});server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

it('keeps a lost started write uncertain even when pause was requested',async()=>{
 const control=new BrowserControl();let writes=0,plans=0;
 const server=createServer((req,res)=>{res.setHeader('content-type','text/html');if(req.method==='POST'){writes++;control.take();req.socket.destroy();}else res.end('<form method="post" action="/save"><button>Save</button></form>');});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw Error('Missing port');const origin=`http://127.0.0.1:${address.port}`,directory=await mkdtemp(join(tmpdir(),'browser-pause-unknown-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Unknown owned write'}),coordinator=new BrowserCoordinator(core,{endpointKey:'fixture',async plan(input){plans++;return {kind:'action',reason:'Save owned fixture',action:{kind:'click',targetId:input.observation.targets[0].id,expectedFields:[]}};}}),result=await coordinator.run({taskId:task.id,requestId:'unknown',goal:'Save once',origin,url:origin,transmissionApproved:true,control,approveAction:async input=>({approved:true,write:input.review.write})});
  expect(result.status).toBe('failed');expect(writes).toBe(1);expect(plans).toBe(1);expect(control.status().mode).toBe('ended');expect((await core.getTask(task.id)).session?.runs[0].operations[0].status).toBe('uncertain');expect(()=>control.returnToAgent()).toThrow();
 }finally{await core.close();await rm(directory,{recursive:true,force:true});server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});


it('cannot resurrect ended control during browser opening or a pending focus handoff',async()=>{
 const signal=new AbortController().signal,opening=new BrowserControl();opening.close();expect(()=>opening.attach(signal,async()=>{})).toThrow('Stopped');
 const active=new BrowserControl();let release!:()=>void;active.attach(signal,()=>new Promise<void>(resolve=>{release=resolve;}));active.take();const pending=active.waitForAgent();active.close();release();await expect(pending).rejects.toThrow('Stopped');expect(active.status().mode).toBe('ended');
});


it('an abort during target validation consumes the old grant without starting an interaction',async()=>{
 let visits=0;const server=createServer((req,res)=>{res.setHeader('content-type','text/html');if(req.url==='/next')visits++;res.end('<h1>Owned page</h1><a href="/next">Next</a>');});await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw Error('Missing port');const origin=`http://127.0.0.1:${address.port}`;let browser:LocalBrowser|undefined;
 try{
  browser=await LocalBrowser.open({taskId:'owned-target-validation',origin,url:origin});const observation=await browser.observe(),proposal=await browser.propose({kind:'click',snapshotId:observation.id,targetId:observation.targets[0].id}),token=browser.approve(proposal.id),stop=new AbortController();
  const executing=browser.execute(proposal.id,token,stop.signal);stop.abort();await expect(executing).rejects.toThrow('Stopped before browser execution');expect(visits).toBe(0);expect(browser.proposal(proposal.id)?.status).toBe('proposed');await expect(browser.execute(proposal.id,token)).rejects.toThrow('Approval is required');expect(visits).toBe(0);
 }finally{await browser?.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
