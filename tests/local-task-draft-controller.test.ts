import {afterEach,expect,it,vi} from 'vitest';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {createQuitDraftBarrier} from '../src/host/quit-drafts';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {createLocalTaskDraftController,localTaskResult} from '../src/renderer/src/local-task-draft-controller';
import {emptyLocalTaskDraft,localTaskDraftOwner,localTaskDraftBasis,LOCAL_TASK_DRAFT_SLOT} from '../src/shared/local-task-draft';
import {learningDraftKey} from '../src/shared/learning-drafts';
import type {LocalTaskStartInput} from '../src/shared/local-task-start';
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const action of cleanups.splice(0).reverse())await action();});
function hold(){let release!:()=>void;const promise=new Promise<void>(done=>release=done);return {promise,release};}
async function fixture(form:'text'|'draft'='text'){
 const directory=await mkdtemp(join(tmpdir(),'local-durable-controller-'));let core=await createCompanion({dataDir:directory});
 const openStore=()=>new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(task=>task.id===id)});let store=openStore();
 const fault:{null?:()=>Promise<void>;save?:()=>Promise<void>}={};
 const makeCache=()=>createLearningDrafts({read:()=>store.read(),save:async(...args)=>{await fault.save?.();if(args[4]===null)await fault.null?.();return store.save(...args);},cleanup:()=>store.cleanup()});
 let cache=makeCache();await cache.load();
 cleanups.push(async()=>{await cache.flush().catch(()=>{});await core.close();await rm(directory,{recursive:true,force:true});});
 const inputs:Readonly<LocalTaskStartInput>[]=[],created:unknown[]=[];let current=true;
 const options=()=>({cache,form,isCurrent:()=>current,onCreated:(value:unknown)=>created.push(value),send:async(input:Readonly<LocalTaskStartInput>)=>{inputs.push(input);return core.startLocalTask(input,'owned-bot');}});
 return {directory,get store(){return store},fault,inputs,created,form,get core(){return core},get cache(){return cache},options,
  setCurrent:(value:boolean)=>{current=value},controller:()=>createLocalTaskDraftController(options()),
  key:learningDraftKey(localTaskDraftOwner(form),LOCAL_TASK_DRAFT_SLOT),
  restart:async()=>{await core.close();core=await createCompanion({dataDir:directory});store=openStore();cache=makeCache();await cache.load();},
  raw:async()=>JSON.parse(await readFile(join(directory,'learning-drafts.json'),'utf8'))};
}
it('keeps invalid raw exact and rejects submission before allocating an intent or creating a task',async()=>{
 const f=await fixture(),newId=vi.fn(()=>crypto.randomUUID()),c=createLocalTaskDraftController({...f.options(),newId});
 c.edit({title:' \0 ',content:' \n'});await f.cache.flush();expect(c.snapshot().draft).toEqual({...emptyLocalTaskDraft,title:' \0 ',content:' \n'});
 expect(await c.submit()).toBe(false);expect(newId).not.toHaveBeenCalled();expect(f.inputs).toHaveLength(0);
 expect(await c.discard()).toBe(true);expect(await f.core.listTasks()).toEqual([]);expect((await f.raw()).records[0].value).toBeNull();
});
it('persists the exact body and intent before dispatch and freezes immediately on Create',async()=>{
 const f=await fixture('draft');let sawPersisted=false;
 const c=createLocalTaskDraftController({...f.options(),send:async input=>{const value=JSON.parse((await f.raw()).records[0].value.value);expect(value).toMatchObject({title:'  My raw title  ',content:'Exact \n body ',intentId:input.intentId});expect(value.binding).toMatch(/^local-task-start-form:v1:[a-f0-9]{64}$/);sawPersisted=true;f.inputs.push(input);return f.core.startLocalTask(input,'owned-bot');}});
 c.edit({title:'  My raw title  ',content:'Exact \n body '});await f.cache.flush();const pending=c.submit();
 expect(c.snapshot().phase).toBe('preparing');expect(c.edit({content:'blocked'}).kind).toBe('held');await pending;
 expect(sawPersisted).toBe(true);expect(f.inputs[0]).toMatchObject({title:'My raw title',content:'Exact \n body '});expect(f.created).toHaveLength(1);expect((await f.raw()).records[0].value).toBeNull();
});
it.each(['text','draft'] as const)('reopens uncertain %s and explicitly retries the same ID after legitimate later edits',async form=>{
 const f=await fixture(form),c=createLocalTaskDraftController({...f.options(),send:async input=>{f.inputs.push(input);await f.core.startLocalTask(input,'original-bot');throw Error('Owned postcommit reply loss');}});
 c.edit({title:'  Original raw  ',content:'Original body.'});await f.cache.flush();await c.submit();
 const original=(await f.core.listTasks())[0],intentId=f.inputs[0].intentId;expect(c.snapshot().phase).toBe('uncertain');
 if(form==='text')await f.core.putSource(original.id,{id:original.sources[0].id,kind:'text',role:'fact',label:'Later label',content:'Legitimate later source edit.'});
 else await f.core.saveArtifact(original.id,{artifactId:original.artifacts[0].id,expectedRevision:1,title:'Later title',content:'Legitimate later document edit.',sourceRefs:[]});
 await f.restart();const reopened=f.controller();expect(reopened.snapshot().phase).toBe('uncertain');expect(f.inputs).toHaveLength(1);
 expect(await reopened.retry()).toBe(true);expect(f.inputs[1].intentId).toBe(intentId);expect(await f.core.listTasks()).toHaveLength(1);expect(f.created).toHaveLength(1);expect((await f.raw()).records[0].value).toBeNull();
});
it('old preparation cannot overwrite a newer uncertain mirror attempt after a controlled generation race',async()=>{
 const f=await fixture(),gate=hold(),newId=vi.fn(()=>crypto.randomUUID());
 const old=createLocalTaskDraftController({...f.options(),newId,digest:async text=>{await gate.promise;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');}});
 old.edit({content:'Original raw'});await f.cache.flush();const pending=old.submit();
 // Public fields are already frozen; this models an already queued/foreign generation.
 f.cache.edit(localTaskDraftOwner('text'),LOCAL_TASK_DRAFT_SLOT,emptyLocalTaskDraft,localTaskDraftBasis('text'),raw=>({...raw,content:'Newer mirror input'}));await f.cache.flush();
 const newer=createLocalTaskDraftController({...f.options(),send:async input=>{f.inputs.push(input);await f.core.startLocalTask(input,'owned-bot');throw Error('Owned reply loss');}});
 await newer.submit();const savedBefore=(await f.raw()).records[0].value;gate.release();await pending;
 expect(newId).not.toHaveBeenCalled();expect(f.inputs).toHaveLength(1);expect((await f.raw()).records[0].value).toEqual(savedBefore);expect(newer.snapshot().draft?.content).toBe('Newer mirror input');
});
it('controlled edit then undo retires captured generation before dispatch',async()=>{
 const f=await fixture(),gate=hold(),c=createLocalTaskDraftController({...f.options(),digest:async()=>{await gate.promise;return 'a'.repeat(64);}});
 c.edit({content:'Same bytes'});await f.cache.flush();const pending=c.submit();
 for(const content of ['Different','Same bytes'])f.cache.edit(localTaskDraftOwner('text'),LOCAL_TASK_DRAFT_SLOT,emptyLocalTaskDraft,localTaskDraftBasis('text'),raw=>({...raw,content}));
 gate.release();expect(await pending).toBe(false);expect(f.inputs).toEqual([]);expect(c.snapshot().draft?.content).toBe('Same bytes');
});
it('held actual postcommit confirmation and ack drain through frozen quit after unmount',async()=>{
 const f=await fixture(),reply=hold(),committed=hold(),c=createLocalTaskDraftController({...f.options(),send:async input=>{f.inputs.push(input);const result=await f.core.startLocalTask(input,'owned-bot');committed.release();await reply.promise;return result;}});
 c.edit({content:'Captured local body.'});await f.cache.flush();const pending=c.submit();await committed.promise;
 f.setCurrent(false);f.cache.setFrozen(true);let flushed=false;const quit=f.cache.flushForQuit().then(()=>{flushed=true;});await Promise.resolve();expect(flushed).toBe(false);
 reply.release();await pending;await quit;expect(f.created).toEqual([]);expect((await f.raw()).records[0].value).toBeNull();expect(await f.core.listTasks()).toHaveLength(1);
});
it('late null failure holds quit without claiming the core task was not saved',async()=>{
 const f=await fixture(),reply=hold(),committed=hold();f.fault.null=async()=>{throw Error('Owned null transport failure');};
 const c=createLocalTaskDraftController({...f.options(),send:async input=>{const result=await f.core.startLocalTask(input,'owned-bot');committed.release();await reply.promise;return result;}});
 c.edit({content:'Keep original body'});await f.cache.flush();const pending=c.submit();await committed.promise;f.cache.setFrozen(true);
 const assertion=expect(f.cache.flushForQuit()).rejects.toThrow('Owned null transport failure');reply.release();await pending;await assertion;
 expect(await f.core.listTasks()).toHaveLength(1);expect(c.snapshot().message).toContain('task was saved');expect(f.created).toEqual([]);expect((await f.raw()).records[0].value).not.toBeNull();
 f.cache.setFrozen(false);f.fault.null=undefined;await f.cache.retry(c.owner,c.slot);f.cache.setFrozen(true);await f.cache.flushForQuit();expect((await f.raw()).records[0].value).toBeNull();
});
it.each([undefined,{kind:'text',task:{id:'forged'},sourceId:'forged'}])('unconfirmed reply %j retains the durable attempt and permits safe quit',async result=>{
 const f=await fixture(),c=createLocalTaskDraftController({...f.options(),send:async()=>result});c.edit({content:'Pending'});await f.cache.flush();await c.submit();
 expect(c.snapshot().phase).toBe('uncertain');expect(c.snapshot().draft?.intentId).not.toBe('');expect(f.created).toEqual([]);f.cache.setFrozen(true);await f.cache.flushForQuit();expect((await f.raw()).records[0].value).not.toBeNull();
});
it('cancelled freeze rejects its older drain and resume does not resend',async()=>{
 const f=await fixture(),reply=hold(),committed=hold(),c=createLocalTaskDraftController({...f.options(),send:async input=>{f.inputs.push(input);const result=await f.core.startLocalTask(input,'owned-bot');committed.release();await reply.promise;return result;}});
 c.edit({content:'Pending quit'});await f.cache.flush();const pending=c.submit();await committed.promise;f.cache.setFrozen(true);
 const assertion=expect(f.cache.flushForQuit()).rejects.toThrow('cancelled');f.cache.setFrozen(false);reply.release();await pending;await assertion;expect(f.inputs).toHaveLength(1);
 f.cache.setFrozen(true);await f.cache.flushForQuit();expect(f.inputs).toHaveLength(1);
});
it.each(['text','draft'] as const)('quit resume retires old %s presentation while exact ack drains and a fresh submission opens',async form=>{
 const f=await fixture(form),reply=hold(),committed=hold(),c=createLocalTaskDraftController({...f.options(),send:async input=>{f.inputs.push(input);const result=await f.core.startLocalTask(input,'owned-bot');committed.release();await reply.promise;return result;}});
 c.edit({title:'Old submitted title',content:'Committed before cancelled closing'});await f.cache.flush();const pending=c.submit();
 try{
  await committed.promise;const coreBefore=await readFile(join(f.directory,'tasks.json')),rawBefore=await readFile(join(f.directory,'learning-drafts.json')),epoch=f.cache.getFreezeEpoch();
  f.cache.setFrozen(true);let drained=false;const oldQuit=f.cache.flushForQuit().then(()=>{drained=true;return '';},error=>error.message as string);await Promise.resolve();expect(drained).toBe(false);
  f.cache.setFrozen(false);expect(f.cache.getFreezeEpoch()).toBeGreaterThan(epoch);reply.release();expect(await pending).toBe(true);expect(await oldQuit).toContain('cancelled');
  expect(await readFile(join(f.directory,'tasks.json'))).toEqual(coreBefore);expect((await f.raw()).records[0].value).toBeNull();expect(f.inputs).toHaveLength(1);expect(await f.core.listTasks()).toHaveLength(1);
  if(f.created.length){const path='evidence/local-task-presentation-epoch';await mkdir(path,{recursive:true});await writeFile(join(path,'red-'+form+'-core-before.json'),coreBefore);await writeFile(join(path,'red-'+form+'-core-after.json'),await readFile(join(f.directory,'tasks.json')));await writeFile(join(path,'red-'+form+'-raw-before.json'),rawBefore);await writeFile(join(path,'red-'+form+'-raw-after.json'),await readFile(join(f.directory,'learning-drafts.json')));await writeFile(join(path,'red-'+form+'-presentations.json'),JSON.stringify(f.created,null,2)+'\n');}
  expect(f.created).toEqual([]);
  // A later deliberate Create in this same still-current controller has fresh authority.
  c.edit({title:'Fresh submitted title',content:'Created deliberately after resume'});await f.cache.flush();expect(await c.submit()).toBe(true);expect(f.created).toHaveLength(1);expect(f.inputs).toHaveLength(2);expect(f.inputs[1].intentId).not.toBe(f.inputs[0].intentId);expect(await f.core.listTasks()).toHaveLength(2);expect((await f.raw()).records[0].value).toBeNull();
 }finally{reply.release();await pending;}
});
it('a still-current frozen entry drains exact acknowledgement without presenting on freeze or later resume',async()=>{
 const f=await fixture(),reply=hold(),committed=hold(),c=createLocalTaskDraftController({...f.options(),send:async input=>{f.inputs.push(input);const result=await f.core.startLocalTask(input,'owned-bot');committed.release();await reply.promise;return result;}});
 c.edit({content:'Current entry remains frozen'});await f.cache.flush();const pending=c.submit();
 try{await committed.promise;f.cache.setFrozen(true);let drained=false;const quit=f.cache.flushForQuit().then(()=>{drained=true;});await Promise.resolve();expect(drained).toBe(false);reply.release();expect(await pending).toBe(true);await quit;expect(drained).toBe(true);expect(f.created).toEqual([]);expect((await f.raw()).records[0].value).toBeNull();expect(await f.core.listTasks()).toHaveLength(1);f.cache.setFrozen(false);await Promise.resolve();expect(f.created).toEqual([]);expect(f.inputs).toHaveLength(1);
 }finally{reply.release();await pending;}
});
it('freeze resume preserves a controlled newer generation while old committed work finishes',async()=>{
 const f=await fixture(),reply=hold(),committed=hold(),c=createLocalTaskDraftController({...f.options(),send:async input=>{f.inputs.push(input);const result=await f.core.startLocalTask(input,'owned-bot');committed.release();await reply.promise;return result;}});
 c.edit({content:'Exact submitted original'});await f.cache.flush();const pending=c.submit();
 try{await committed.promise;f.cache.setFrozen(true);const oldQuit=f.cache.flushForQuit().catch(error=>error.message as string);f.cache.setFrozen(false);
  // Controlled already-queued/foreign cache mutation, not typing into locked UI.
  f.cache.edit(c.owner,c.slot,emptyLocalTaskDraft,c.basis,raw=>({...raw,content:'Newer controlled raw'}));await f.cache.flush();const newer=await readFile(join(f.directory,'learning-drafts.json'));reply.release();await pending;expect(await oldQuit).toContain('cancelled');expect(await readFile(join(f.directory,'learning-drafts.json'))).toEqual(newer);expect(f.created).toEqual([]);expect(f.inputs).toHaveLength(1);expect(await f.core.listTasks()).toHaveLength(1);
  expect(await c.retry()).toBe(false);expect(c.snapshot().message).toContain('does not match');expect(f.inputs).toHaveLength(1);expect(await readFile(join(f.directory,'learning-drafts.json'))).toEqual(newer);
 }finally{reply.release();await pending;}
});
it('freeze resume never bypasses a failed exact tombstone or claims an unconfirmed raw removal saved',async()=>{
 const f=await fixture(),reply=hold(),committed=hold();f.fault.null=async()=>{throw Error('Owned ABA exact tombstone failure');};
 const c=createLocalTaskDraftController({...f.options(),send:async input=>{f.inputs.push(input);const result=await f.core.startLocalTask(input,'owned-bot');committed.release();await reply.promise;return result;}});
 c.edit({content:'Core saved, original raw retained'});await f.cache.flush();const pending=c.submit();
 try{await committed.promise;const coreBefore=await readFile(join(f.directory,'tasks.json'));f.cache.setFrozen(true);const oldQuit=f.cache.flushForQuit().catch(error=>error.message as string);f.cache.setFrozen(false);reply.release();expect(await pending).toBe(true);expect(await oldQuit).toContain('cancelled');expect(f.created).toEqual([]);expect(await readFile(join(f.directory,'tasks.json'))).toEqual(coreBefore);expect((await f.raw()).records[0].value).not.toBeNull();expect(c.snapshot().message).toContain('clearing its local input was not confirmed');
  f.cache.setFrozen(true);await expect(f.cache.flushForQuit()).rejects.toThrow('Owned ABA exact tombstone failure');f.cache.setFrozen(false);f.fault.null=undefined;await f.cache.retry(c.owner,c.slot);expect((await f.raw()).records[0].value).toBeNull();expect(f.created).toEqual([]);expect(f.inputs).toHaveLength(1);expect(await readFile(join(f.directory,'tasks.json'))).toEqual(coreBefore);
 }finally{reply.release();await pending;}
});
it('Cancel waits for raw removal and holds when its null write fails',async()=>{
 const f=await fixture(),c=f.controller();c.edit({content:'Unsaved local choice'});await f.cache.flush();f.fault.null=async()=>{throw Error('Owned discard write failure');};
 expect(await c.discard()).toBe(false);expect(c.snapshot().form.error).toContain('Owned discard write failure');expect(await f.core.listTasks()).toEqual([]);
 expect(JSON.parse((await f.raw()).records[0].value.value).content).toBe('Unsaved local choice');f.fault.null=undefined;expect(await c.discard()).toBe(true);
});
it('deleted committed target stays retired after restart and explicit same-ID retry',async()=>{
 const f=await fixture(),c=createLocalTaskDraftController({...f.options(),send:async input=>{f.inputs.push(input);await f.core.startLocalTask(input,'owned-bot');throw Error('Owned reply loss');}});
 c.edit({content:'Delete this task'});await f.cache.flush();await c.submit();await f.core.deleteTask((await f.core.listTasks())[0].id);await f.restart();
 const reopened=f.controller();expect(await reopened.retry()).toBe(false);expect(await f.core.listTasks()).toEqual([]);expect(reopened.snapshot().draft?.intentId).toBe(f.inputs[0].intentId);expect((await f.raw()).records[0].value).not.toBeNull();
});
it('valid host commit cannot acknowledge a controlled newer cache generation',async()=>{
 const f=await fixture(),reply=hold(),committed=hold(),c=createLocalTaskDraftController({...f.options(),send:async input=>{const result=await f.core.startLocalTask(input,'owned-bot');committed.release();await reply.promise;return result;}});
 c.edit({content:'Submitted'});await f.cache.flush();const pending=c.submit();await committed.promise;
 f.cache.edit(c.owner,c.slot,emptyLocalTaskDraft,c.basis,raw=>({...raw,content:'Newer retained body'}));await f.cache.flush();reply.release();await pending;
 expect(JSON.parse((await f.raw()).records[0].value.value).content).toBe('Newer retained body');expect(f.created).toEqual([]);
});
it('checks actual host target shape rather than matching submitted content',async()=>{
 const f=await fixture('draft'),saved=await f.core.startLocalTask({intentId:'shape-fixture',kind:'draft',content:'First'},'owned-bot');
 expect(localTaskResult(saved,'draft')).toEqual(saved);expect(localTaskResult({...saved,artifactId:crypto.randomUUID()},'draft')).toBeUndefined();expect(localTaskResult(saved,'text')).toBeUndefined();
});

it('cancelled quit retires old digest preparation and does not dispatch after resume',async()=>{
 const f=await fixture(),gate=hold(),c=createLocalTaskDraftController({...f.options(),digest:async text=>{await gate.promise;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');}});
 c.edit({content:'Prepared before closing'});await f.cache.flush();const before=await readFile(join(f.directory,'tasks.json'));const pending=c.submit();
 f.cache.setFrozen(true);await f.cache.flushForQuit();f.cache.setFrozen(false);gate.release();await pending;
 if(f.inputs.length){await mkdir('evidence/local-task-durable-drafts',{recursive:true});await writeFile('evidence/local-task-durable-drafts/red-prepare-freeze-tasks-before.json',before);await writeFile('evidence/local-task-durable-drafts/red-prepare-freeze-tasks-after.json',await readFile(join(f.directory,'tasks.json')));await writeFile('evidence/local-task-durable-drafts/red-prepare-freeze-raw-after.json',await readFile(join(f.directory,'learning-drafts.json')));}
 expect(f.inputs).toEqual([]);expect(await f.core.listTasks()).toEqual([]);expect(c.snapshot().draft?.intentId).toBe('');
});

it.each(['text','draft'] as const)('persists the complete601377-byte worst-case %s attempt and submits through actual core',async form=>{
 const f=await fixture(form),c=createLocalTaskDraftController({...f.options(),send:async input=>{
  expect(Buffer.byteLength((await f.raw()).records[0].value.value)).toBe(601377);
  return f.core.startLocalTask(input,'owned-bot');
 }});
 expect(c.edit({title:'\u0001'.repeat(200),content:'\u0001'.repeat(100_000)}).kind).toBe('accepted');await f.cache.flush();
 expect(await c.submit()).toBe(true);expect(await f.core.listTasks()).toHaveLength(1);expect((await f.raw()).records[0].value).toBeNull();
});
it('an over-limit whole edit is immediately refused and explicit discard retires its UI-only rejection',async()=>{
 const f=await fixture(),c=f.controller();c.edit({content:'Prior accepted raw'});await f.cache.flush();
 expect(c.edit({content:'x'.repeat(100001)}).kind).toBe('rejected');expect(c.snapshot().draft?.content).toBe('Prior accepted raw');expect(await c.submit()).toBe(false);expect(f.inputs).toEqual([]);
 expect(await c.discard()).toBe(true);expect(c.snapshot().rejection).toBeUndefined();expect(c.snapshot().draft).toEqual(emptyLocalTaskDraft);
});

it('actual quit barrier timeout/resume rejects old acknowledgements and waits its repeated quit ID',async()=>{
 const f=await fixture(),reply=hold(),committed=hold(),c=createLocalTaskDraftController({...f.options(),send:async input=>{f.inputs.push(input);const result=await f.core.startLocalTask(input,'owned-bot');committed.release();await reply.promise;return result;}});
 c.edit({content:'Submitted before quit timeout'});await f.cache.flush();const pending=c.submit();await committed.promise;
 const ids:string[]=[],acks:{id:string;accepted:boolean}[]=[];
 vi.useFakeTimers();
 try{
  const barrier=createQuitDraftBarrier({timeoutMs:10,confirmDiscard:async()=>false,send:id=>{ids.push(id);f.cache.setFrozen(true);void f.cache.flushForQuit().then(()=>{acks.push({id,accepted:barrier.acknowledge(id)});},()=>{acks.push({id,accepted:barrier.acknowledge(id,'Old or unconfirmed flush')});});}});
  const first=barrier.request();await vi.advanceTimersByTimeAsync(10);const cancelled=await first;expect(cancelled).toMatchObject({allowQuit:false,saved:false});expect((await f.raw()).records[0].value).not.toBeNull();
  f.cache.setFrozen(false);const second=barrier.request();for(let i=0;i<10;i++)await Promise.resolve();expect(ids).toHaveLength(2);expect(ids[0]).not.toBe(ids[1]);
  reply.release();await pending;expect(await second).toMatchObject({id:ids[1],allowQuit:true,saved:true});expect(acks).toContainEqual({id:ids[0],accepted:false});expect(acks).toContainEqual({id:ids[1],accepted:true});expect(f.inputs).toHaveLength(1);expect(f.created).toEqual([]);
 }finally{reply.release();vi.useRealTimers();}
});

it('an older held discard preserves a newer raw generation and never reports it discarded',async()=>{
 const f=await fixture(),started=hold(),release=hold(),c=f.controller();c.edit({content:'Older form'});await f.cache.flush();
 f.fault.null=async()=>{started.release();await release.promise;};const removing=c.discard();await started.promise;
 // A separately opened owner can receive a queued edit while old removal waits.
 f.cache.edit(c.owner,c.slot,emptyLocalTaskDraft,c.basis,raw=>({...raw,content:'Newer form input'}));release.release();
 expect(await removing).toBe(false);await f.cache.flush();expect(JSON.parse((await f.raw()).records[0].value.value).content).toBe('Newer form input');expect(c.snapshot().message).toContain('Newer local input is kept');expect(await f.core.listTasks()).toEqual([]);
});

it('a frozen raw/binding mismatch stays inspectable and cannot replay or mint a new ID',async()=>{
 const f=await fixture(),newId=vi.fn(()=>crypto.randomUUID()),owner=localTaskDraftOwner('text'),basis=localTaskDraftBasis('text');
 f.cache.edit(owner,LOCAL_TASK_DRAFT_SLOT,emptyLocalTaskDraft,basis,()=>({...emptyLocalTaskDraft,title:'Earlier',content:'Changed frozen body',intentId:crypto.randomUUID(),binding:'local-task-start-form:v1:'+'0'.repeat(64)}));await f.cache.flush();
 const c=createLocalTaskDraftController({...f.options(),newId});expect(c.snapshot().phase).toBe('uncertain');expect(f.inputs).toEqual([]);
 expect(await c.retry()).toBe(false);expect(newId).not.toHaveBeenCalled();expect(f.inputs).toEqual([]);expect(c.snapshot().message).toContain('does not match');expect(c.snapshot().draft?.content).toBe('Changed frozen body');
 expect(await c.discard()).toBe(true);expect(await f.core.listTasks()).toEqual([]);
});
it('a foreign saved generation holds both versions until an explicit choice and never auto submits',async()=>{
 const f=await fixture(),held=hold(),started=hold(),c=f.controller();let first=true;
 f.fault.save=async()=>{if(first){first=false;started.release();await held.promise;}};
 c.edit({content:'Local accepted body'});await started.promise;
 const remote={...emptyLocalTaskDraft,content:'Foreign saved body'},value={initial:JSON.stringify({binding:'',content:'',intentId:'',title:''}),value:JSON.stringify({binding:'',content:remote.content,intentId:'',title:''}),basis:c.basis};
 await f.store.save(c.owner,c.slot,'initial',0,value);held.release();await expect(f.cache.flush()).rejects.toThrow('elsewhere');expect(await c.submit()).toBe(false);
 expect(c.snapshot().draft?.content).toBe('Local accepted body');expect(c.snapshot().entry?.remote?.value).toEqual(value);expect(f.inputs).toEqual([]);
 await expect(f.cache.retry(c.owner,c.slot)).rejects.toThrow('elsewhere');const entry=c.snapshot().entry!;
 expect(entry.canResolve).toBe(true);expect(f.cache.resolve(c.owner,c.slot,entry.generation,'remote')).toBe(true);expect(c.snapshot().draft?.content).toBe('Foreign saved body');expect(f.inputs).toEqual([]);
 expect(await c.discard()).toBe(true);expect(await f.core.listTasks()).toEqual([]);
});
