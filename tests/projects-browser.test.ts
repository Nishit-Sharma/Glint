import {createServer} from 'node:http';
import {expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {BrowserCoordinator} from '../src/host/browser/coordinator';
import {installLoopbackTestEngine} from './loopback-browser.fixture';
installLoopbackTestEngine();

it.each(['source-copy','instructions','membership'] as const)('a %s change cancels a pending browser interaction without consuming a late approval',async change=>{
 let visits=0;
 const server=createServer((request,response)=>{response.setHeader('content-type','text/html');if(request.url==='/next'){visits++;response.end('<h1>Result</h1>');}else response.end('<h1>Owned project page</h1><a href="/next">Next</a>');});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const address=server.address();if(!address||typeof address==='string')throw Error('Missing owned server');
 const origin=`http://127.0.0.1:${address.port}`,dataDir=await mkdtemp(join(tmpdir(),'projects-browser-')),core=await createCompanion({dataDir});
 let entered!:()=>void,approve!:(decision:{approved:true})=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;});
 try{
  const owner=await core.createTask({title:'Source owner'}),target=await core.createTask({title:'Browser task'}),project=await core.projectCommand({type:'projects.create',name:'Shared research'});
  for(const task of [owner,target])await core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});
  const sourced=await core.putSource(owner.id,{kind:'text',label:'Shared guide',role:'fact',content:'PRIVATE_PROJECT_SOURCE'}),source=sourced.sources[0],shared=await core.projectCommand({type:'projects.sources.add',projectId:project.id,expectedRevision:1,taskId:owner.id,reference:{sourceId:source.id,version:1,digest:source.versions[0].digest}});
  const coordinator=new BrowserCoordinator(core,{endpointKey:'fixture',async plan(input){expect(input.context).not.toContain('PRIVATE_PROJECT_SOURCE');return {kind:'action',reason:'Read the owned next page',action:{kind:'click',targetId:input.observation.targets[0].id}};}});
  const running=coordinator.run({taskId:target.id,requestId:'pending-browser',goal:'Read next page',origin,url:origin,transmissionApproved:true,approveAction:async()=>{entered();return new Promise(resolve=>{approve=resolve;});}});
  await waiting;const before=await core.getTask(target.id),route=before.session!.browserContext;
  if(change==='source-copy')await core.projectCommand({type:'projects.sources.use',projectId:project.id,expectedRevision:shared.revision,sourceKey:shared.sources[0].id,taskId:target.id});
  else if(change==='instructions')await core.projectCommand({type:'projects.update',projectId:project.id,expectedRevision:shared.revision,name:project.name,instructions:'Revised project guidance.'});
  else await core.projectCommand({type:'projects.assign',taskId:target.id,projectId:null,expectedProjectId:project.id});
  approve({approved:true});expect((await running).status).toBe('cancelled');
  const saved=await core.getTask(target.id);expect(visits).toBe(0);expect(saved.session?.browserContext).toEqual(route);expect(saved.session?.runs[0].operations[0].status).toBe('retired');expect(saved.artifacts).toEqual([]);
 }finally{
  await core.close();await rm(dataDir,{recursive:true,force:true});server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
 }
});
