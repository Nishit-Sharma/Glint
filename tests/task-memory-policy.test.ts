import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCompanion} from '../src/core/companion';
import {composeOrdinaryRequest} from '../src/host/ordinary-request-composition';

it('applies one task policy to real memory preview and the production composer without changing global memory or another task',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'task-memory-'));let core=await createCompanion({dataDir:directory});
 try{
  const a=await core.createTask({title:'Owned A'}),b=await core.createTask({title:'Owned B'});await core.saveComposerDraft(a.id,0,{text:'Keep this question',kind:'explain'});
  await core.changeUserMemory({expectedRevision:0,change:{kind:'save',text:'OWNED_ACCOUNT_FACT',topics:[]}});await core.changeUserMemory({expectedRevision:1,change:{kind:'enabled',enabled:true}});const project=await core.projectCommand({type:'projects.create',name:'Owned project'});await core.projectCommand({type:'projects.assign',taskId:a.id,projectId:project.id,expectedProjectId:null});await core.projectCommand({type:'projects.memory.change',projectId:project.id,expectedRevision:0,change:{kind:'save',text:'OWNED_PROJECT_FACT',topics:[]}});await core.projectCommand({type:'projects.memory.change',projectId:project.id,expectedRevision:1,change:{kind:'enabled',enabled:true}});const memory=await core.getUserMemory(),before=await core.getTask(a.id),other=await core.getTask(b.id),lease=await core.leaseUserMemory(a.id,'Explain');expect(lease.facts).toHaveLength(1);expect(lease.projectFacts).toHaveLength(1);
  await core.setTaskMemoryPolicy({type:'memory.task.set',taskId:a.id,expectedRevision:0,mode:'off'});expect(()=>lease.assertCurrent()).toThrow();
  const selected=await core.previewUserMemory({taskId:a.id,prompt:'Explain'});expect(selected).toMatchObject({globalEnabled:true,taskPolicy:{revision:1,mode:'off'},facts:[],projectFacts:[],receipt:{status:'off',facts:[]}});
  const next=await core.leaseUserMemory(a.id,'Explain'),composed=composeOrdinaryRequest({prompt:'Explain',sources:[],memory:next});expect(JSON.stringify(composed)).not.toContain('OWNED_ACCOUNT_FACT');expect(JSON.stringify(composed)).not.toContain('OWNED_PROJECT_FACT');expect(next.consent).toContain('off for this task');expect((await core.previewUserMemory({taskId:b.id,prompt:'Explain'})).facts).toHaveLength(1);expect(await core.getUserMemory()).toEqual(memory);expect(await core.getTask(b.id)).toEqual(other);
  const after=await core.getTask(a.id);expect(after.session?.draft).toBe(before.session?.draft);expect(after.session?.draftRevision).toBe(before.session?.draftRevision);expect(after.requests).toEqual(before.requests);await expect(core.setTaskMemoryPolicy({type:'memory.task.set',taskId:a.id,expectedRevision:0,mode:'inherit'})).rejects.toThrow();
  await core.close();core=await createCompanion({dataDir:directory});expect((await core.getTask(a.id)).session?.memoryPolicy).toEqual({revision:1,mode:'off'});await core.setTaskMemoryPolicy({type:'memory.task.set',taskId:a.id,expectedRevision:1,mode:'inherit'});expect((await core.previewUserMemory({taskId:a.id,prompt:'Explain'})).facts).toHaveLength(1);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

it('holds exact queued context on a policy change and keeps the global OFF gate stronger than inherit',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'task-memory-queue-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Queued task'}),basis=await core.queuedFollowupBasis(task.id,[],[]),item={id:randomUUID(),revision:1,prompt:'Exact queued message',kind:'explain' as const,createdAt:new Date().toISOString(),sourceRefs:[],status:'queued' as const,basis,scope:'c'.repeat(64),precedingRequestIds:[]};await core.saveQueuedFollowup(task.id,item,0);
  await core.setTaskMemoryPolicy({type:'memory.task.set',taskId:task.id,expectedRevision:0,mode:'off'});const saved=(await core.getTask(task.id)).session!.queuedFollowups![0];expect(saved).toMatchObject({...item,status:'held'});expect(saved.reason).toContain('memory');expect(await core.queuedFollowupBasis(task.id,[],[])).not.toBe(basis);
  await core.setTaskMemoryPolicy({type:'memory.task.set',taskId:task.id,expectedRevision:1,mode:'inherit'});expect(await core.previewUserMemory({taskId:task.id,prompt:'Explain'})).toMatchObject({globalEnabled:false,facts:[],projectFacts:[],receipt:{status:'off'}});expect((await core.getUserMemory()).enabled).toBe(false);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
