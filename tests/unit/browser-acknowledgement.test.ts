import {it,expect,vi} from 'vitest';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {BrowserCoordinator} from '../../src/host/browser/coordinator';
import {installLoopbackTestEngine} from '../support/loopback-browser.fixture';
installLoopbackTestEngine();

it('a committed action with an unsavable observation stays uncertain across restart and blocks another write',async()=>{
 let commits=0;const server=createServer((req,res)=>{res.setHeader('content-type','text/html');if(req.method==='POST'){commits++;res.end('<title>'+('x'.repeat(100001))+'</title><h1>Draft saved once</h1>');}else res.end('<title>Draft form</title><form method="post" action="/save"><button>Save</button></form>');});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('Missing port');
 const origin=`http://127.0.0.1:${address.port}`,dataDir=await mkdtemp(join(tmpdir(),'companion-ack-proof-'));let core=await createCompanion({dataDir});
 try{
  const task=await core.createTask({title:'Durable acknowledgement'});
  const planner={endpointKey:'fixture',async plan(input:Parameters<import('../../src/host/browser/coordinator').BrowserPlanner['plan']>[0]){return {kind:'action' as const,reason:'Save the exact synthetic form',action:{kind:'click' as const,targetId:input.observation.targets[0]!.id,expectedFields:[]}};}};
  const run=(requestId:string)=>new BrowserCoordinator(core,planner).run({taskId:task.id,requestId,goal:'Save one draft',url:origin,origin,transmissionApproved:true,approveAction:async()=>({approved:true,write:{method:'POST',url:origin+'/save',body:''}})});
  expect((await run('first')).status).toBe('failed');expect(commits).toBe(1);expect((await core.getTask(task.id)).session?.runs[0].operations[0].status).toBe('uncertain');
  await core.close();core=await createCompanion({dataDir});expect((await core.getTask(task.id)).session?.runs[0].operations[0].status).toBe('uncertain');
  const retry=await run('new-request');expect(retry.status).toBe('failed');expect(retry.error).toContain('uncertain');expect(commits).toBe(1);
 }finally{await core.close();await rm(dataDir,{recursive:true,force:true});await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
