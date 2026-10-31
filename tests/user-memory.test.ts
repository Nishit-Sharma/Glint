import {expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';

test('authored memory is off until enabled, follows relevant questions across tasks, and survives opt-out and restart',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-memory-'));let core=await createCompanion({dataDir:directory});
 try{
  expect(await core.getUserMemory()).toEqual({revision:0,enabled:false,facts:[]});
  const first=await core.createTask({title:'Rust ownership'}),second=await core.createTask({title:'Rust practice'}),unrelated=await core.createTask({title:'Cooking'});
  let saved=await core.changeUserMemory({expectedRevision:0,change:{kind:'save',text:'I am learning Rust. Explain ownership with small examples.',topics:['rust']}});
  const fact=saved.current.facts[0];expect(saved.current.enabled).toBe(false);
  expect((await core.leaseUserMemory(first.id,'Explain borrowing')).facts).toEqual([]);
  saved=await core.changeUserMemory({expectedRevision:1,change:{kind:'enabled',enabled:true}});
  const lease=await core.leaseUserMemory(second.id,'Explain borrowing');
  expect(lease.facts.map(item=>item.text)).toEqual(['I am learning Rust. Explain ownership with small examples.']);
  expect((await core.leaseUserMemory(unrelated.id,'How do I cook rice?')).receipt.status).toBe('no-match');
  const result=await core.runRequest({taskId:second.id,requestId:'memory-question',kind:'explain',prompt:'Explain borrowing',sourceIds:[],memory:lease.receipt},async()=>({title:'Borrowing',content:'A small example.'}),lease.assertCurrent);
  expect(result).toMatchObject({status:'completed',memory:{status:'included',facts:[{id:fact.id,revision:fact.revision}]}});
  await core.changeUserMemory({expectedRevision:2,change:{kind:'enabled',enabled:false}});
  expect(lease.signal.aborted).toBe(true);expect(()=>lease.assertCurrent()).toThrow('Memory changed');
  await core.close();core=await createCompanion({dataDir:directory});
  expect(await core.getUserMemory()).toMatchObject({revision:3,enabled:false,facts:[{id:fact.id,text:fact.text}]});
  expect((await core.leaseUserMemory(second.id,'Rust borrowing')).facts).toEqual([]);
  expect((await core.getTask(second.id)).requests[0].memory?.status).toBe('included');
  await core.changeUserMemory({expectedRevision:3,change:{kind:'forget',id:fact.id}});
  expect((await core.getUserMemory()).facts).toEqual([]);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('edits and forgets use one revision-checked ledger, retire stale memory, and preserve unrelated task data',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-memory-edit-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'A design question'}),original=await core.getTask(task.id);
  const saved=await core.changeUserMemory({expectedRevision:0,change:{kind:'save',text:'I design mobile interfaces.',topics:[]}}),fact=saved.current.facts[0];
  await core.changeUserMemory({expectedRevision:1,change:{kind:'enabled',enabled:true}});
  const old=await core.leaseUserMemory(task.id,'Suggest a layout');
  expect(await core.changeUserMemory({expectedRevision:0,change:{kind:'forget',id:fact.id}})).toMatchObject({kind:'conflict',current:{revision:2}});
  await core.changeUserMemory({expectedRevision:2,change:{kind:'save',id:fact.id,text:'I design desktop interfaces.',topics:['design']}});
  expect(()=>old.assertCurrent()).toThrow('Memory changed');
  await expect(core.runRequest({taskId:task.id,requestId:'stale-memory',kind:'explain',prompt:'Suggest a layout',memory:old.receipt},async()=>{throw Error('Must never run');})).rejects.toThrow('Memory changed');
  expect(await core.getTask(task.id)).toEqual(original);
  expect((await core.leaseUserMemory(task.id,'Suggest a layout')).facts.map(fact=>fact.text)).toEqual(['I design desktop interfaces.']);
  expect(()=>core.changeUserMemory({expectedRevision:3,change:{kind:'save',text:'x',topics:[],credentials:'not allowed'}})).toThrow();
  expect((await core.getUserMemory()).revision).toBe(3);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('a saved project account-memory opt-out is authoritative, survives older edits and restart, and never enables global memory',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-project-memory-'));let core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Synthetic design project'}),other=await core.createTask({title:'Synthetic design elsewhere'}),project=await core.projectCommand({type:'projects.create',name:'Design research'});
  await core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});
  await core.changeUserMemory({expectedRevision:0,change:{kind:'save',text:'SYNTHETIC_ACCOUNT_FACT',topics:[]}});await core.changeUserMemory({expectedRevision:1,change:{kind:'enabled',enabled:true}});
  const inherited=await core.leaseUserMemory(task.id,'Review the layout');expect(inherited.facts.map(fact=>fact.text)).toEqual(['SYNTHETIC_ACCOUNT_FACT']);
  await core.putSource(task.id,{kind:'text',label:'Saved design notes',role:'fact',content:'Keep this project source.'});await core.saveComposerDraft(task.id,0,{text:'PRIVATE_UNSENT_PROJECT_DRAFT',kind:'explain'});
  const original=await core.getTask(task.id),browserContext={origin:'https://owned.invalid',url:'https://owned.invalid/current',requestId:'earlier-browser'};await core.replaceSession(task.id,original.session!.revision,{...original.session!,browserContext});const before=await core.getTask(task.id),memory=await core.getUserMemory();
  const offCommand={type:'projects.update' as const,projectId:project.id,expectedRevision:1,name:project.name,instructions:project.instructions,useAccountMemory:false},off=await core.projectCommand(offCommand);
  expect(off.useAccountMemory).toBe(false);expect(off.revision).toBe(2);expect(await core.projectCommand(offCommand)).toEqual(off);expect(()=>inherited.assertCurrent()).toThrow('Memory changed');
  const excluded=await core.leaseUserMemory(task.id,'Review the layout');expect(excluded.facts).toEqual([]);expect(excluded.receipt).toMatchObject({status:'off',facts:[]});expect(excluded.consent).toContain('off for this project');expect(excluded.consent).not.toContain('SYNTHETIC_ACCOUNT_FACT');
  expect((await core.leaseUserMemory(other.id,'Review the layout')).facts.map(fact=>fact.text)).toEqual(['SYNTHETIC_ACCOUNT_FACT']);expect(await core.getUserMemory()).toEqual(memory);expect(await core.getTask(task.id)).toEqual(before);
  await expect(core.runRequest({taskId:task.id,requestId:'forged-memory',kind:'explain',prompt:'Review the layout',memory:inherited.receipt},async()=>{throw Error('Must never reach a runner');})).rejects.toThrow('Memory changed');
  const renamed=await core.projectCommand({type:'projects.update',projectId:project.id,expectedRevision:off.revision,name:'Renamed project',instructions:'Keep this saved guidance.'});expect(renamed.useAccountMemory).toBe(false);
  await expect(core.projectCommand({...offCommand,expectedRevision:1,useAccountMemory:true})).rejects.toThrow('changed');expect(()=>excluded.assertCurrent()).toThrow('Memory changed');
  await core.close();core=await createCompanion({dataDir:directory});expect((await core.projectCommand({type:'projects.list'}))[0]).toEqual(renamed);expect((await core.leaseUserMemory(task.id,'Review the layout')).facts).toEqual([]);expect((await core.getTask(task.id)).sources).toEqual(before.sources);expect((await core.getTask(task.id)).session?.draft).toBe('PRIVATE_UNSENT_PROJECT_DRAFT');expect((await core.getTask(task.id)).session?.browserContext).toEqual(browserContext);
  await core.changeUserMemory({expectedRevision:2,change:{kind:'enabled',enabled:false}});await core.projectCommand({type:'projects.update',projectId:project.id,expectedRevision:renamed.revision,name:renamed.name,instructions:renamed.instructions,useAccountMemory:true});expect((await core.leaseUserMemory(task.id,'Review the layout')).receipt.status).toBe('off');expect((await core.leaseUserMemory(other.id,'Review the layout')).receipt.status).toBe('off');
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('project account-memory changes cancel late results and invalidate moved-task leases while other projects stay current',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-project-memory-late-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Synthetic project question'}),other=await core.createTask({title:'Other project question'}),project=await core.projectCommand({type:'projects.create',name:'One'}),second=await core.projectCommand({type:'projects.create',name:'Two'});
  await core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});await core.projectCommand({type:'projects.assign',taskId:other.id,projectId:second.id,expectedProjectId:null});
  await core.changeUserMemory({expectedRevision:0,change:{kind:'save',text:'SYNTHETIC_ACCOUNT_FACT',topics:[]}});await core.changeUserMemory({expectedRevision:1,change:{kind:'enabled',enabled:true}});
  const lease=await core.leaseUserMemory(task.id,'Explain the plan'),unrelated=await core.leaseUserMemory(other.id,'Explain the plan');let entered!:()=>void,finish!:(value:{title:string;content:string})=>void,signal!:AbortSignal;const ready=new Promise<void>(done=>entered=done);
  const pending=core.runRequest({taskId:task.id,requestId:'pending-policy',kind:'explain',prompt:'Explain the plan',memory:lease.receipt},async ctx=>{signal=ctx.signal;entered();return new Promise(done=>finish=done);},lease.assertCurrent);await ready;
  await core.projectCommand({type:'projects.update',projectId:project.id,expectedRevision:1,name:project.name,instructions:'',useAccountMemory:false});expect(signal.aborted).toBe(true);expect(()=>lease.assertCurrent()).toThrow('Memory changed');expect(()=>unrelated.assertCurrent()).not.toThrow();
  finish({title:'Late output',content:'Must not be saved.'});expect((await pending).status).toBe('cancelled');expect((await core.getTask(task.id)).artifacts).toEqual([]);
  const excluded=await core.leaseUserMemory(task.id,'Explain the plan');await core.projectCommand({type:'projects.assign',taskId:task.id,projectId:second.id,expectedProjectId:project.id});expect(()=>excluded.assertCurrent()).toThrow('Memory changed');expect((await core.leaseUserMemory(task.id,'Explain the plan')).facts.map(fact=>fact.text)).toEqual(['SYNTHETIC_ACCOUNT_FACT']);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
