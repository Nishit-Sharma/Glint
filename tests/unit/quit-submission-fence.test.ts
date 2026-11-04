import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,test,vi} from 'vitest';
import {createCompanion} from '../../src/core/companion';
import {editModule} from '../../src/core/module-state';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {createQuitDraftBarrier} from '../../src/host/quit-drafts';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';
import {formSubmission} from '../../src/renderer/src/draft-navigation';
import {learningDraftKey,serializeLearningDraftJson} from '../../src/shared/learning-drafts';
import {MODULE_MIME} from '../../src/shared/module-contract';
import {exampleLesson} from '../../src/learning/example';

afterEach(()=>vi.useRealTimers());
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'quit-submission-fence-')),core=await createCompanion({dataDir:directory});
 const task=await core.createTask({title:'Disposable submission owner'}),artifact=await core.saveArtifact(task.id,{title:'Local join',mimeType:MODULE_MIME,sourceRefs:[],content:JSON.stringify({schemaVersion:1,markdown:'Synthetic.',modules:[{id:'join',version:1,data:exampleLesson,provenance:[]}]})});
 const owner={taskId:task.id,artifactId:artifact.artifactId,artifactRevision:1,artifactDigest:artifact.revision.digest,moduleId:'join',moduleVersion:1},slot='join:prediction:practice',initial={prediction:'',reasoning:''};
 const basis=serializeLearningDraftJson({initial,basis:JSON.stringify(['practice',0]),variableArrays:[]});
 const store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(item=>item.id===id)}),control:{onNull?:()=>Promise<void>}={},writes:unknown[]=[];
 const cache=createLearningDrafts({read:()=>store.read(),save:async(...args)=>{writes.push(args[4]);if(args[4]===null)await control.onNull?.();return store.save(...args);}});
 await cache.load();cache.edit(owner,slot,initial,basis,()=>({prediction:'0',reasoning:'  Submitted before quit.  '}));await cache.flushForm(owner,slot);
 return {core,cache,store,owner,slot,initial,basis,control,writes,
  raw:async()=>JSON.parse(await readFile(join(directory,'learning-drafts.json'),'utf8')),
  close:async()=>{await cache.flush().catch(()=>{});await core.close();await rm(directory,{recursive:true,force:true});},
 };
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
function submitActual(f:Fixture,reply:ReturnType<typeof deferred>){
 const token=f.cache.capture(f.owner,f.slot),hostReady=deferred();if(!token)throw Error('Expected submitted generation.');
 const work=f.cache.runSubmission(async()=>{
  const result=formSubmission(undefined,(async()=>{
   try{await editModule(f.core,{...f.owner,action:{kind:'predict',count:0,reasoning:'  Submitted before quit.  ',expectedRevision:0}});hostReady.resolve();await reply.promise;return true;}
   catch{hostReady.resolve();return false;}
  })());
  if(await result.confirmed)f.cache.acknowledge(token);
 });
 return {work,hostReady};
}
/** Same relevant App event envelope; no Electron or real OS quit is involved. */
function quitHarness(f:Fixture,timeoutMs=5000){
 let currentId:string|undefined;const ids:string[]=[],acknowledgements:{id:string;accepted:boolean;error?:string}[]=[];
 const discard=vi.fn(async()=>false);
 const barrier=createQuitDraftBarrier({timeoutMs,confirmDiscard:discard,send:id=>{
  ids.push(id);currentId=id;f.cache.setFrozen(true);
  void f.cache.flushForQuit().then(()=>{acknowledgements.push({id,accepted:barrier.acknowledge(id)});},()=>{const error='Unsent messages or practice edits could not be saved.';acknowledgements.push({id,accepted:barrier.acknowledge(id,error),error});});
 }});
 return {barrier,ids,acknowledgements,discard,resume(id:string){if(currentId===id){currentId=undefined;f.cache.setFrozen(false);}}};
}

test('quit waits a delayed real module confirmation and its later successful tombstone',async()=>{
 const f=await fixture(),reply=deferred(),write=deferred(),writeStarted=deferred();
 try{
  f.control.onNull=async()=>{writeStarted.resolve();await write.promise;};
  const submission=submitActual(f,reply);await submission.hostReady.promise;
  // The real core drain sees the committed result while the renderer reply waits.
  expect((await f.core.listTasks())[0].session!.moduleStates[0].state.revision).toBe(1);
  const quit=quitHarness(f);let finished=false;const decision=quit.barrier.request().then(value=>{finished=true;return value;});await settle();
  expect(finished).toBe(false);expect(quit.acknowledgements).toEqual([]);
  reply.resolve();await writeStarted.promise;expect(finished).toBe(false);expect((await f.raw()).records[0].value).not.toBeNull();
  write.resolve();await submission.work;expect(await decision).toMatchObject({allowQuit:true,saved:true});expect((await f.raw()).records[0].value).toBeNull();
 }finally{reply.resolve();write.resolve();await f.close();}
});

test('a late tombstone failure holds quit while retaining both the raw draft and committed core result',async()=>{
 const f=await fixture(),reply=deferred();let fail=true;
 try{
  f.control.onNull=async()=>{if(fail)throw Error('Controlled late null-write failure.');};
  const submission=submitActual(f,reply);await submission.hostReady.promise;
  const quit=quitHarness(f),decision=quit.barrier.request();await settle();reply.resolve();await submission.work;
  const result=await decision;expect(result).toMatchObject({allowQuit:false,saved:false});expect(quit.discard).toHaveBeenCalledOnce();
  expect((await f.raw()).records[0].value.value).toContain('  Submitted before quit.  ');
  expect((await f.core.getTask(f.owner.taskId)).session!.moduleStates[0].state.revision).toBe(1);
  quit.resume('different-id');expect(f.cache.getSnapshot().frozen).toBe(true);quit.resume(result.id);expect(f.cache.getSnapshot().frozen).toBe(false);
  fail=false;await f.cache.retry(f.owner,f.slot);await f.cache.flush();expect((await f.raw()).records[0].value).toBeNull();
 }finally{reply.resolve();await f.close();}
});

test('a newer local generation survives the older successful submission during quit',async()=>{
 const f=await fixture(),reply=deferred();
 try{
  const submission=submitActual(f,reply);await submission.hostReady.promise;
  expect(f.cache.edit(f.owner,f.slot,f.initial,f.basis,latest=>({...latest,reasoning:'  NEWER input remains.  '}))).toBe(true);
  const quit=quitHarness(f),decision=quit.barrier.request();await settle();reply.resolve();await submission.work;
  expect(await decision).toMatchObject({allowQuit:true,saved:true});expect((await f.raw()).records[0].value.value).toContain('  NEWER input remains.  ');
  expect(f.cache.getSnapshot().entries[learningDraftKey(f.owner,f.slot)].local).not.toBeNull();
 }finally{reply.resolve();await f.close();}
});

test('false and rejected confirmations retain already durable raw input without trapping quit',async()=>{
 for(const rejects of [false,true]){
  const f=await fixture(),reply=deferred();
  try{
   const token=f.cache.capture(f.owner,f.slot)!;
   const submission=f.cache.runSubmission(async()=>{const result=formSubmission(undefined,(async()=>{await reply.promise;if(rejects)throw Error('Refused core mutation.');return false;})());if(await result.confirmed)f.cache.acknowledge(token);}).catch(()=>{});
   const quit=quitHarness(f),decision=quit.barrier.request();await settle();reply.resolve();await submission;
   expect(await decision).toMatchObject({allowQuit:true,saved:true});expect(quit.discard).not.toHaveBeenCalled();expect((await f.raw()).records[0].value.value).toContain('  Submitted before quit.  ');expect(f.writes.filter(value=>value===null)).toEqual([]);
  }finally{reply.resolve();await f.close();}
 }
});

test('an actual closed owner returns false and keeps its previously durable raw draft',async()=>{
 const f=await fixture(),reply=deferred();
 try{
  await f.core.close();const submission=submitActual(f,reply);await submission.hostReady.promise;await submission.work;
  f.cache.setFrozen(true);await f.cache.flushForQuit();expect((await f.raw()).records[0].value.value).toContain('  Submitted before quit.  ');expect(f.writes.filter(value=>value===null)).toEqual([]);
 }finally{reply.resolve();await f.close();}
});

test('registered work remains tracked after the initiating owner scope returns',async()=>{
 const f=await fixture(),reply=deferred();
 try{
  // The cache owns registration rather than a mounted-component set. This
  // portable lifetime test does not claim to mount/unmount a React renderer.
  const ownerScope=()=>submitActual(f,reply);const submission=ownerScope();await submission.hostReady.promise;
  f.cache.setFrozen(true);let drained=false;const drain=f.cache.flushForQuit().then(()=>{drained=true;});await settle();expect(drained).toBe(false);
  reply.resolve();await submission.work;await drain;expect((await f.raw()).records[0].value).toBeNull();
 }finally{reply.resolve();await f.close();}
});

test('timeout and matching resume retire the old drain without acknowledging a later quit id',async()=>{
 const f=await fixture(),reply=deferred();
 try{
  const submission=submitActual(f,reply);await submission.hostReady.promise;vi.useFakeTimers();
  const quit=quitHarness(f,10),first=quit.barrier.request();await vi.advanceTimersByTimeAsync(10);const cancelled=await first;
  expect(cancelled).toMatchObject({allowQuit:false,saved:false});expect(quit.acknowledgements).toEqual([]);quit.resume('wrong');expect(f.cache.getSnapshot().frozen).toBe(true);quit.resume(cancelled.id);
  expect(f.cache.getSnapshot().frozen).toBe(false);const second=quit.barrier.request();await settle();expect(quit.ids).toHaveLength(2);expect(quit.ids[1]).not.toBe(cancelled.id);
  reply.resolve();await submission.work;const completed=await second;expect(completed).toMatchObject({id:quit.ids[1],allowQuit:true,saved:true});
  expect(quit.acknowledgements).toContainEqual(expect.objectContaining({id:cancelled.id,accepted:false,error:expect.any(String)}));expect(quit.acknowledgements).toContainEqual({id:completed.id,accepted:true});
 }finally{reply.resolve();vi.useRealTimers();await f.close();}
});

test('ordinary nested form flushes cannot wait on their own submission registration',async()=>{
 const f=await fixture();
 try{await f.cache.runSubmission(async()=>{await f.cache.flushForm(f.owner,f.slot);await f.cache.flush();});f.cache.setFrozen(true);await f.cache.flushForQuit();}
 finally{await f.close();}
});

test('quit drain requires the same frozen interval and frozen caches refuse fresh work',async()=>{
 const f=await fixture(),reply=deferred(),called=vi.fn();
 try{
  await expect(f.cache.flushForQuit()).rejects.toThrow(/resumed/);
  const submission=f.cache.runSubmission(()=>reply.promise);f.cache.setFrozen(true);const drain=f.cache.flushForQuit();await settle();
  await expect(f.cache.runSubmission(called)).rejects.toThrow(/held/);expect(called).not.toHaveBeenCalled();expect(f.cache.capture(f.owner,f.slot)).toBeUndefined();expect(f.cache.edit(f.owner,f.slot,f.initial,f.basis,()=>({prediction:'1',reasoning:'Blocked'}))).toBe(false);
  f.cache.setFrozen(false);f.cache.setFrozen(true);reply.resolve();await submission;await expect(drain).rejects.toThrow(/resumed/);
 }finally{reply.resolve();await f.close();}
});
