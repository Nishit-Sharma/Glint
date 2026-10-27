import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {createCompanion,type Companion,type RequestContext,type RequestOutput} from '../src/core/companion';

let root:string,core:Companion;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'companion-task-details-'));core=await createCompanion({dataDir:join(root,'store')});});
afterEach(async()=>{await core.close();await rm(root,{recursive:true,force:true});});

describe('local task details',()=>{
 it('persists renamed task details and preserves every unrelated field and other task',async()=>{
  const task=await core.createTask({title:'Original name',goal:'Original goal'}),other=await core.createTask({title:'Other task'});
  await core.putSource(task.id,{kind:'text',label:'Facts',role:'fact',content:'Keep this source.'});
  await core.saveArtifact(task.id,{title:'Saved work',content:'Keep this revision.'});
  await core.checkpoint(task.id,'Keep this checkpoint.');
  await core.pause(task.id);
  const before=await core.getTask(task.id),updated=await core.updateTask(task.id,{title:'  New name  ',goal:'Updated goal'});
  expect(updated).toEqual({...before,title:'New name',goal:'Updated goal',updatedAt:updated.updatedAt});
  expect(await core.getTask(other.id)).toEqual(other);
  updated.sources[0].versions[0].label='Detached result mutation';
  await core.close();core=await createCompanion({dataDir:join(root,'store')});
  expect(await core.getTask(task.id)).toEqual({...before,title:'New name',goal:'Updated goal',updatedAt:updated.updatedAt,session:{...before.session!,revision:before.session!.revision+1}});
 });

 it('keeps frozen running context, request IDs and existing export authority intact',async()=>{
  const task=await core.createTask({title:'Original name',goal:'Original goal'});
  await core.putSource(task.id,{kind:'text',label:'Facts',role:'fact',content:'Frozen evidence.'});
  const artifact=await core.saveArtifact(task.id,{title:'Exportable work',content:'Frozen output.'});
  const proposal=await core.proposeExport(task.id,{artifactId:artifact.artifactId,revision:1,path:join(root,'output.txt')});
  await core.approveExport(task.id,proposal.proposal.id,proposal.proposal.digest);
  let context!:RequestContext,finish!:(value:RequestOutput)=>void,started!:()=>void;
  const ready=new Promise<void>(resolve=>started=resolve);
  const pending=core.runRequest({taskId:task.id,requestId:'retained-request-id',kind:'explain',prompt:'Use the frozen facts.'},value=>{context=value;started();return new Promise(resolve=>finish=resolve);});
  await ready;
  const before=await core.getTask(task.id);
  const updated=await core.updateTask(task.id,{title:'Renamed during request',goal:'New future goal'});
  expect(updated).toEqual({...before,title:'Renamed during request',goal:'New future goal',updatedAt:updated.updatedAt});
  expect(context.task.title).toBe('Original name');expect(context.task.goal).toBe('Original goal');expect(context.signal.aborted).toBe(false);
  expect(updated.actions[0].status).toBe('approved');expect(updated.requests[0].status).toBe('running');
  finish({title:'Completed work',content:'Original context remains usable.'});expect((await pending).status).toBe('completed');
  const completed=await core.getTask(task.id);
  expect(completed.title).toBe('Renamed during request');expect(completed.goal).toBe('New future goal');expect(completed.actions).toEqual(before.actions);
 });

 it('preserves omitted goal and accepts explicit empty goal and maximum field lengths',async()=>{
  const task=await core.createTask({title:'Task',goal:'Keep when omitted'});
  expect((await core.updateTask(task.id,{title:'Renamed'})).goal).toBe('Keep when omitted');
  expect((await core.updateTask(task.id,{title:'x'.repeat(200),goal:'x'.repeat(10000)})).goal).toHaveLength(10000);
  expect((await core.updateTask(task.id,{title:'Task',goal:''})).goal).toBe('');
 });

 it.each([
  ['empty title',{title:''}],['whitespace title',{title:' \n\t '}],['long title',{title:'x'.repeat(201)}],['null title',{title:null}],['null byte title',{title:'a\0b'}],
  ['long goal',{title:'Valid',goal:'x'.repeat(10001)}],['null goal',{title:'Valid',goal:null}],['numeric goal',{title:'Valid',goal:123}],['null byte goal',{title:'Valid',goal:'a\0b'}],
  ['task identity injection',{title:'Valid',id:'replacement'}],['authority injection',{title:'Valid',actions:[]}],['null payload',null],
 ])('rejects %s without changing durable state',async(_label,payload)=>{
  const task=await core.createTask({title:'Unchanged',goal:'Unchanged'}),file=join(root,'store','tasks.json'),before=await readFile(file,'utf8');
  await expect(core.updateTask(task.id,payload as Parameters<Companion['updateTask']>[1])).rejects.toThrow();
  expect(await readFile(file,'utf8')).toBe(before);expect(await core.getTask(task.id)).toEqual(task);
  await expect(core.updateTask(task.id,{title:'Still editable'})).resolves.toMatchObject({id:task.id,title:'Still editable'});
 });

 it('rejects a deleted task without creating or selecting another task',async()=>{
  const task=await core.createTask({title:'Delete me'});await core.deleteTask(task.id);
  await expect(core.updateTask(task.id,{title:'Cannot revive'})).rejects.toThrow('not found');expect(await core.listTasks()).toEqual([]);
 });
});
