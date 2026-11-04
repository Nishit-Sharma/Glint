import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {Task} from '../../src/core/types';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {exampleLesson} from '../../src/learning/example';
import {createLearningDrafts,type LearningDraftTransport} from '../../src/renderer/src/learning-drafts';
import {learningDraftKey,parseLearningDraftFile,serializeLearningDraftJson,type LearningDraftOwner,type LearningDraftSaveResult} from '../../src/shared/learning-drafts';

const owner={taskId:'live-task',artifactId:'answer',artifactRevision:1,artifactDigest:'answer-digest',moduleId:'join',moduleVersion:1} satisfies LearningDraftOwner;
const deletedOwner={...owner,taskId:'deleted-task'},slot='prediction',initial={count:'',reason:''},basis='state-1';
const value=(reason:string)=>({initial:serializeLearningDraftJson(initial),value:serializeLearningDraftJson({count:'0',reason}),basis});
const directories:string[]=[];
afterEach(async()=>{await Promise.all(directories.splice(0).map(directory=>rm(directory,{recursive:true,force:true})));});
function deferred<T>(){
 let resolve!:(value:T)=>void;
 const promise=new Promise<T>(accept=>{resolve=accept;});
 return {promise,resolve};
}
function task(id:string):Task{
 return {id,title:'Synthetic practice',goal:'',status:'active',createdAt:'2026-10-27T00:00:00Z',updatedAt:'2026-10-27T00:00:00Z',sources:[],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false},artifacts:[{id:'answer',revisions:[{revision:1,title:'Synthetic lesson',mimeType:'application/vnd.window-companion.modules+json',content:JSON.stringify({schemaVersion:1,markdown:'Synthetic practice.',modules:[{id:'join',version:1,data:exampleLesson,provenance:[]}]}),sourceRefs:[],digest:'answer-digest',createdAt:'2026-10-27T00:00:00Z'}]}]};
}
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'learning-drafts-cache-cleanup-'));directories.push(directory);
 const tasks=new Map([[owner.taskId,task(owner.taskId)],[deletedOwner.taskId,task(deletedOwner.taskId)]]);let failLookup=false;
 const store=new LearningDraftStore({directory,lookupTask:async id=>{if(failLookup&&id===deletedOwner.taskId)throw Error('Synthetic task lookup failure.');return tasks.get(id);}});
 await store.save(owner,slot,'initial',0,value('  original\n'));
 await store.save(deletedOwner,slot,'initial',0,value('orphaned raw text'));
 tasks.delete(deletedOwner.taskId);
 const remote={read:()=>store.read(),cleanup:vi.fn(()=>store.cleanup()),save:vi.fn((...args:Parameters<LearningDraftTransport['save']>)=>store.save(...args))};
 const drafts=createLearningDrafts(remote);await drafts.load();
 return {directory,store,remote,drafts,tasks,failLookup:(next:boolean)=>{failLookup=next;}};
}
function holdFirstSave(context:Awaited<ReturnType<typeof fixture>>){
 const persisted=deferred<LearningDraftSaveResult>(),release=deferred<void>();
 context.remote.save.mockImplementationOnce(async(...args)=>{const result=await context.store.save(...args);persisted.resolve(result);await release.promise;return result;});
 return {persisted,release};
}
const entry=(drafts:ReturnType<typeof createLearningDrafts>)=>drafts.getSnapshot().entries[learningDraftKey(owner,slot)];

describe('real draft store and cache cleanup reconciliation',()=>{
 it('saves the first ordinary edit to a surviving open form under the cleaned epoch',async()=>{
  const {drafts,remote,store,tasks}=await fixture(),before=structuredClone(tasks.get(owner.taskId));
  expect(drafts.getSnapshot().cleanupNeeded).toBe(true);
  const cleaned=await drafts.cleanupDeleted();expect(cleaned.removed).toBe(1);
  expect(drafts.edit(owner,slot,initial,basis,latest=>({...latest,reason:'  after cleanup\n'}))).toBe(true);
  await expect(drafts.flushForm(owner,slot)).resolves.toBeUndefined();
  expect(remote.save).toHaveBeenCalledTimes(1);
  expect(remote.save.mock.calls[0]).toEqual([owner,slot,cleaned.epoch,1,value('  after cleanup\n')]);
  expect(entry(drafts)).toMatchObject({epoch:cleaned.epoch,status:'clean',remote:{revision:2}});
  const reopened=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await reopened.load();
  expect(reopened.readForm(owner,slot,initial,basis).value).toEqual({count:'0',reason:'  after cleanup\n'});
  expect(tasks.get(owner.taskId)).toEqual(before);
 });
 it('automatically saves a newer generation held behind an in-flight save and maintenance',async()=>{
  const context=await fixture(),{drafts,remote}=context,held=holdFirstSave(context);
  drafts.edit(owner,slot,initial,basis,latest=>({...latest,reason:'first in flight'}));await held.persisted.promise;
  const older=drafts.capture(owner,slot);if(!older)throw Error('Missing first generation.');
  drafts.edit(owner,slot,initial,basis,latest=>({...latest,reason:'  newer before cleanup\n'}));
  const cleaning=drafts.cleanupDeleted();
  expect(drafts.acknowledge(older)).toBe(false);
  expect(drafts.discard(owner,slot,2)).toBe(false);
  expect(drafts.edit(owner,slot,initial,basis,latest=>({...latest,reason:'blocked'}))).toBe(false);
  expect(remote.cleanup).not.toHaveBeenCalled();held.release.resolve();const cleaned=await cleaning;
  await vi.waitFor(()=>expect(remote.save).toHaveBeenCalledTimes(2));
  expect(remote.save.mock.calls[1]).toEqual([owner,slot,cleaned.epoch,2,value('  newer before cleanup\n')]);
  await drafts.flushForm(owner,slot);
  expect(entry(drafts)).toMatchObject({status:'clean',generation:2,remote:{revision:3,value:value('  newer before cleanup\n')}});
 });
 it('persists an exact acknowledgement made during maintenance instead of stranding its tombstone',async()=>{
  const context=await fixture(),{drafts,remote,store}=context,held=holdFirstSave(context);
  drafts.edit(owner,slot,initial,basis,latest=>({...latest,reason:'submitted'}));await held.persisted.promise;
  const token=drafts.capture(owner,slot);if(!token)throw Error('Missing submitted generation.');
  const cleaning=drafts.cleanupDeleted();expect(drafts.acknowledge(token)).toBe(true);
  held.release.resolve();const cleaned=await cleaning;
  await vi.waitFor(()=>expect(remote.save).toHaveBeenCalledTimes(2));
  expect(remote.save.mock.calls[1]).toEqual([owner,slot,cleaned.epoch,2,null]);await drafts.flushForm(owner,slot);
  expect(await store.read()).toEqual({kind:'available',epoch:cleaned.epoch,records:[{owner,slot,revision:3,value:null}]});
 });
 it('still detects a foreign save by CAS after cleanup without overwriting either side',async()=>{
  const {drafts,remote,store}=await fixture(),cleaned=await drafts.cleanupDeleted();
  await store.save(owner,slot,cleaned.epoch,1,value('foreign saved edit'));
  drafts.edit(owner,slot,initial,basis,latest=>({...latest,reason:'local edit'}));
  await expect(drafts.flushForm(owner,slot)).rejects.toThrow(/changed elsewhere/);
  expect(remote.save.mock.calls[0]).toEqual([owner,slot,cleaned.epoch,1,value('local edit')]);
  expect(entry(drafts)).toMatchObject({status:'conflict',local:value('local edit'),remote:{revision:2,value:value('foreign saved edit')},canResolve:false});
  await expect(drafts.retry(owner,slot)).rejects.toThrow(/changed elsewhere/);
  expect(drafts.resolve(owner,slot,entry(drafts).generation,'remote')).toBe(true);
  expect(remote.save).toHaveBeenCalledTimes(1);
  expect(drafts.readForm(owner,slot,initial,basis).value).toEqual({count:'0',reason:'foreign saved edit'});
 });
 it('reconciles an already changed surviving record before migrating its namespace',async()=>{
  const {drafts,remote,store}=await fixture(),token=drafts.capture(owner,slot);if(!token)throw Error('Missing original generation.');
  await store.save(owner,slot,'initial',1,value('foreign before cleanup'));
  await drafts.cleanupDeleted();
  expect(drafts.readForm(owner,slot,initial,basis)).toMatchObject({status:'recovery',value:{count:'0',reason:'  original\n'},recovery:{remote:{revision:2,value:value('foreign before cleanup')},canResolve:true}});
  expect(drafts.edit(owner,slot,initial,basis,latest=>({...latest,reason:'unreviewed overwrite'}))).toBe(false);
  expect(drafts.acknowledge(token)).toBe(false);
  expect(remote.save).not.toHaveBeenCalled();
 });
 it('resumes newer safe edits after a failed cleanup and keeps the orphan notice visible',async()=>{
  const context=await fixture(),{drafts,remote,directory}=context,held=holdFirstSave(context);
  drafts.edit(owner,slot,initial,basis,latest=>({...latest,reason:'first'}));await held.persisted.promise;
  drafts.edit(owner,slot,initial,basis,latest=>({...latest,reason:'newer after failure'}));
  context.failLookup(true);const cleaning=drafts.cleanupDeleted(),failure=expect(cleaning).rejects.toThrow(/could not be confirmed/);
  held.release.resolve();await failure;
  await vi.waitFor(()=>expect(remote.save).toHaveBeenCalledTimes(2));
  expect(remote.save.mock.calls[1]).toEqual([owner,slot,'initial',2,value('newer after failure')]);await drafts.flushForm(owner,slot);
  expect(drafts.getSnapshot()).toMatchObject({epoch:'initial',cleanupNeeded:true,maintenanceError:expect.any(String)});
  const file=parseLearningDraftFile(JSON.parse(await readFile(join(directory,'learning-drafts.json'),'utf8')));
  expect(file.records.find(record=>('taskId' in record.owner)&&record.owner.taskId===deletedOwner.taskId)?.value).toEqual(value('orphaned raw text'));
  expect(entry(drafts)).toMatchObject({status:'clean',remote:{revision:3,value:value('newer after failure')}});
 });
 it('holds a newer edit when cleanup committed but its response was lost until explicit reconciliation',async()=>{
  const context=await fixture(),{drafts,remote,store}=context,held=holdFirstSave(context);
  remote.cleanup.mockImplementationOnce(async()=>{await store.cleanup();throw Error('Cleanup response lost.');});
  drafts.edit(owner,slot,initial,basis,latest=>({...latest,reason:'first'}));await held.persisted.promise;
  drafts.edit(owner,slot,initial,basis,latest=>({...latest,reason:'newer uncertain cleanup'}));
  const cleaning=drafts.cleanupDeleted(),failure=expect(cleaning).rejects.toThrow(/could not be confirmed/);held.release.resolve();await failure;
  await vi.waitFor(()=>expect(remote.save).toHaveBeenCalledTimes(2));
  await expect(drafts.flushForm(owner,slot)).rejects.toThrow(/storage changed/);
  expect(entry(drafts)).toMatchObject({epoch:'initial',status:'error',local:value('newer uncertain cleanup'),remote:{revision:2},canResolve:false});
  expect(drafts.edit(owner,slot,initial,basis,latest=>({...latest,reason:'blocked'}))).toBe(false);
  const before=await store.read();expect(before).toMatchObject({kind:'available',records:[{value:value('first'),revision:2}]});
  await drafts.retry(owner,slot);await drafts.flushForm(owner,slot);
  expect(remote.save).toHaveBeenCalledTimes(3);expect(entry(drafts)).toMatchObject({status:'clean',remote:{revision:3,value:value('newer uncertain cleanup')}});
 });
 it('holds unsaved generations if the post-cleanup snapshot cannot be read',async()=>{
  const context=await fixture(),{drafts,remote}=context,held=holdFirstSave(context);
  drafts.edit(owner,slot,initial,basis,latest=>({...latest,reason:'first'}));await held.persisted.promise;
  drafts.edit(owner,slot,initial,basis,latest=>({...latest,reason:'newer unreadable reconciliation'}));
  remote.read=async()=>({kind:'unavailable',message:'Reconciliation unavailable.'});
  const cleaning=drafts.cleanupDeleted(),failure=expect(cleaning).rejects.toThrow(/could not be confirmed/);held.release.resolve();await failure;
  expect(remote.save).toHaveBeenCalledTimes(1);
  expect(entry(drafts)).toMatchObject({status:'unsaved',local:value('newer unreadable reconciliation'),remote:{revision:2}});
  expect(drafts.readForm(owner,slot,initial,basis)).toMatchObject({status:'unavailable',value:{count:'0',reason:'newer unreadable reconciliation'}});
  await expect(drafts.flushForm(owner,slot)).rejects.toThrow('Reconciliation unavailable.');
 });
 it('keeps an uncertain accepted write held until explicit retry proves its exact saved value',async()=>{
  const {drafts,remote,store}=await fixture();
  remote.save.mockImplementationOnce(async(...args)=>{await store.save(...args);throw Error('Save response lost.');});
  drafts.edit(owner,slot,initial,basis,latest=>({...latest,reason:'uncertain raw text'}));
  await expect(drafts.flushForm(owner,slot)).rejects.toThrow('Save response lost.');
  await drafts.cleanupDeleted();expect(remote.save).toHaveBeenCalledTimes(1);
  expect(entry(drafts)).toMatchObject({status:'error',local:value('uncertain raw text'),canResolve:false});
  await drafts.retry(owner,slot);expect(remote.save).toHaveBeenCalledTimes(1);
  expect(entry(drafts)).toMatchObject({status:'clean',remote:{revision:2,value:value('uncertain raw text')}});
 });
 it('also migrates an unchanged live form when explicit retry reads a newer global epoch',async()=>{
  const {drafts,remote,store}=await fixture();
  remote.save.mockRejectedValueOnce(Error('Unsent other form.'));
  drafts.edit(owner,'other-form',initial,basis,()=>({count:'0',reason:'other local'}));
  await expect(drafts.flushForm(owner,'other-form')).rejects.toThrow('Unsent other form.');
  const cleaned=await store.cleanup();
  await expect(drafts.retry(owner,'other-form')).rejects.toThrow(/changed elsewhere/);
  expect(drafts.edit(owner,slot,initial,basis,latest=>({...latest,reason:'healthy after global read'}))).toBe(true);
  await expect(drafts.flushForm(owner,slot)).resolves.toBeUndefined();
  expect(remote.save.mock.calls[1]).toEqual([owner,slot,cleaned.epoch,1,value('healthy after global read')]);
  expect(entry(drafts)).toMatchObject({epoch:cleaned.epoch,status:'clean',remote:{revision:2}});
 });
 it('reconciles another form’s global read after an accepted in-flight response before saving its newer edit',async()=>{
  const context=await fixture(),{drafts,remote,store}=context;
  remote.save.mockRejectedValueOnce(Error('Unsent other form.'));
  drafts.edit(owner,'other-form',initial,basis,()=>({count:'0',reason:'other local'}));
  await expect(drafts.flushForm(owner,'other-form')).rejects.toThrow('Unsent other form.');
  const held=holdFirstSave(context);drafts.edit(owner,slot,initial,basis,latest=>({...latest,reason:'in flight'}));await held.persisted.promise;
  drafts.edit(owner,slot,initial,basis,latest=>({...latest,reason:'newer after global read'}));
  const cleaned=await store.cleanup();await expect(drafts.retry(owner,'other-form')).rejects.toThrow(/changed elsewhere/);
  held.release.resolve();await vi.waitFor(()=>expect(remote.save).toHaveBeenCalledTimes(3));
  expect(remote.save.mock.calls[2]).toEqual([owner,slot,cleaned.epoch,2,value('newer after global read')]);await drafts.flushForm(owner,slot);
  expect(entry(drafts)).toMatchObject({epoch:cleaned.epoch,status:'clean',remote:{revision:3,value:value('newer after global read')}});
 });
});
