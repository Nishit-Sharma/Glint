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
