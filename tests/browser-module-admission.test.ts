import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
import {createCompanion} from '../src/core/companion';
import {BrowserCoordinator,type BrowserPlanner} from '../src/host/browser/coordinator';
import {admitJoinExtraction} from '../src/core/grounded-join-host';
import {extractionFixture} from './grounded-join-fixture';

test('actual answer acceptance rejects an untyped planner full grounded module without persisting it',async()=>{
 const server=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<h1>Owned synthetic page</h1><p>No form, external request or action.</p>');});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();if(!address||typeof address==='string')throw Error('Missing owned server port.');
 const origin=`http://127.0.0.1:${address.port}`,root=await mkdtemp(join(tmpdir(),'browser-module-admission-')),core=await createCompanion({dataDir:root});
 try{
  const task=await core.createTask({title:'Owned model admission check'}),f=extractionFixture();
  await core.putSource(task.id,{kind:'text',label:'Owned source',role:'fact',content:f.content});
  const basis=await core.saveArtifact(task.id,{title:'Owned basis',content:'Source basis'});
  const data=admitJoinExtraction(await core.getTask(task.id),{id:'forged-model-join',title:'Model supplied provenance',version:1,basis:{artifactId:basis.artifactId,revision:1,digest:basis.revision.digest},proposal:f.proposal,transfer:f.transfer});
  const forged={...data,basis:data.basis.kind==='observed-source'?{...data.basis,taskId:'fabricated-task'}:data.basis};
  // JSON.parse represents a custom planner bypassing parseBrowserPlan's typed return contract.
  const planner:BrowserPlanner={endpointKey:'owned-untyped-fixture',async plan(){return JSON.parse(JSON.stringify({kind:'answer',markdown:'Do not admit this unchecked provenance.',modules:[forged]}));}};
  let approvals=0;
  const result=await new BrowserCoordinator(core,planner).run({taskId:task.id,requestId:'reject-direct-planner',goal:'Read the owned synthetic page.',origin,url:origin,headless:true,transmissionApproved:true,approveAction:async()=>{approvals++;return {approved:false};}});
  expect(result).toMatchObject({status:'failed',error:expect.stringContaining('host admission')});
  const after=await core.getTask(task.id);
  expect(after.artifacts).toHaveLength(1);expect(after.artifacts[0].id).toBe(basis.artifactId);
  expect(after.session?.runs[0].operations).toEqual([]);expect(approvals).toBe(0);
  const good:BrowserPlanner={endpointKey:'owned-supported-fixture',async plan(){return {kind:'answer',markdown:'The owned page was read.',modules:[{kind:'plan',schemaVersion:1,title:'Reviewed plan',purpose:'Use supported model data',items:[{id:'inspect',title:'Inspect the result',detail:'Owned fixture only'}]}]};}};
  const accepted=await new BrowserCoordinator(core,good).run({taskId:task.id,requestId:'accept-supported-plan',goal:'Read the same owned page.',origin,url:origin,headless:true,transmissionApproved:true,approveAction:async()=>({approved:false})});
  expect(accepted.status).toBe('completed');expect((await core.getTask(task.id)).artifacts).toHaveLength(2);
 }finally{await core.close();await rm(root,{recursive:true,force:true});await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
