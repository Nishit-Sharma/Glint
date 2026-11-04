import {afterEach,expect,it,vi} from 'vitest';
import * as fileSystem from 'node:fs/promises';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';
import {exampleLesson} from '../../src/learning/example';
import {LEARNING_DRAFT_LIMITS,parseLearningDraftFile,learningDraftJsonPolicy,learningDraftKey,parseLearningDraftOwner,serializeLearningDraftJson,type LearningDraftOwner} from '../../src/shared/learning-drafts';

vi.mock('node:fs/promises',{spy:true});
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{vi.restoreAllMocks();for(const action of cleanups.splice(0).reverse())await action();});
const owner=(form:'text'|'draft')=>({kind:'local-task-form',form}) as unknown as LearningDraftOwner;
const slot='local-task:input',initial={title:'',content:'',intentId:'',binding:''};
const basis=(form:'text'|'draft')=>serializeLearningDraftJson({basis:'local-task-form:v1:'+form,variableArrays:[]});
const envelope=(form:'text'|'draft',raw=initial)=>({initial:serializeLearningDraftJson(initial),value:serializeLearningDraftJson(raw,learningDraftJsonPolicy(owner(form),slot)),basis:basis(form)});
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'local-task-durable-store-')),core=await createCompanion({dataDir:directory});
 cleanups.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 const store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(task=>task.id===id)});
 const cache=()=>createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args),cleanup:()=>store.cleanup(),recover:token=>store.recover(token)});
 return {directory,core,store,cache};
}
it('saves exact invalid-but-in-limit precreation raw without a task or fake module owner',async()=>{
 const f=await fixture(),raw={...initial,title:' \0 ',content:'  \n'};
 expect(await f.store.save(owner('text'),slot,'initial',0,envelope('text',raw))).toMatchObject({kind:'saved',record:{revision:1}});
 expect(await f.core.listTasks()).toEqual([]);
 expect(await f.store.read()).toMatchObject({kind:'available',records:[{owner:owner('text'),value:envelope('text',raw)}]});
 expect(()=>parseLearningDraftOwner({...owner('text'),taskId:'pretend-task'})).toThrow();
});
it('retains both taskless records through actual unrelated task deletion, purge and cleanup',async()=>{
 const f=await fixture(),task=await f.core.createTask({title:'Unrelated task'});
 for(const form of ['text','draft'] as const)await f.store.save(owner(form),slot,'initial',0,envelope(form,{...initial,content:form}));
 await f.core.deleteTask(task.id);await f.store.purgeTask(task.id);
 expect(await f.store.cleanup()).toMatchObject({kind:'cleaned',removed:0});
 const read=await f.store.read();expect(read.kind).toBe('available');
 if(read.kind==='available')expect(read.records.map(record=>learningDraftKey(record.owner,record.slot))).toEqual(['text','draft'].map(form=>learningDraftKey(owner(form as 'text'|'draft'),slot)));
 expect(await f.core.listTasks()).toEqual([]);
});
it('admits the legal six-byte escape worst case only through the exact named owner and slot',async()=>{
 const f=await fixture(),raw={...initial,title:'\u0001'.repeat(200),content:'\u0001'.repeat(100_000)};
 const text=serializeLearningDraftJson(raw,learningDraftJsonPolicy(owner('draft'),slot));
 expect(Buffer.byteLength(text)).toBe(601252); // Four empty fixed fields; body+keys, before an intent is allocated.
 expect(()=>serializeLearningDraftJson(raw)).toThrow();
 expect(()=>serializeLearningDraftJson(raw,learningDraftJsonPolicy(owner('draft'),'other'))).toThrow();
 await f.store.save(owner('draft'),slot,'initial',0,envelope('draft',raw));
 const saved=await readFile(join(f.directory,'learning-drafts.json'));
 const reopened=new LearningDraftStore({directory:f.directory,lookupTask:async()=>undefined});
 expect(await reopened.read()).toMatchObject({kind:'available',records:[{value:{value:text}}]});
 expect(await readFile(join(f.directory,'learning-drafts.json'))).toEqual(saved);
});
it('shares taskless raw through the real cache and store, including reopen and exact discard',async()=>{
 const f=await fixture(),cache=f.cache();await cache.load();
 expect(cache.edit(owner('text'),slot,initial,basis('text'),raw=>({...raw,title:'  Keep title  ',content:'Exact local input.'}))).toBe(true);
 await cache.flushForm(owner('text'),slot);
 const reopened=f.cache();await reopened.load();
 expect(reopened.readForm(owner('text'),slot,initial,basis('text')).value).toEqual({...initial,title:'  Keep title  ',content:'Exact local input.'});
 const entry=reopened.getSnapshot().entries[learningDraftKey(owner('text'),slot)];
 expect(reopened.discard(owner('text'),slot,entry.generation)).toBe(true);await reopened.flushForm(owner('text'),slot);
 expect(await f.store.read()).toMatchObject({kind:'available',records:[{revision:2,value:null}]});
 expect(await f.core.listTasks()).toEqual([]);
});

async function moduleOwner(f:Awaited<ReturnType<typeof fixture>>){
 const task=await f.core.createTask({title:'Real installed lesson'}),saved=await f.core.saveArtifact(task.id,{title:'Real lesson',mimeType:'application/vnd.window-companion.modules+json',sourceRefs:[],content:JSON.stringify({schemaVersion:1,markdown:'Owned synthetic.',modules:[{id:'join',version:1,data:exampleLesson,provenance:[]}]})});
 return {task,owner:{taskId:task.id,artifactId:saved.artifactId,artifactRevision:1,artifactDigest:saved.revision.digest,moduleId:'join',moduleVersion:1}};
}
it('preserves every exact prior live record and file byte when a legal large local form exceeds the whole-store cap',async()=>{
 const f=await fixture(),owned=await moduleOwner(f),value={initial:'""',value:serializeLearningDraftJson({a:'x'.repeat(32000),b:'x'.repeat(32000),c:'x'.repeat(32000)}),basis:'owned-v1'};
 const records=Array.from({length:84},(_,i)=>({owner:owned.owner,slot:'large-prior-'+i,revision:1,value}));
 const file={schemaVersion:2 as const,epoch:'initial',records};parseLearningDraftFile(file);
 const bytes=Buffer.from(JSON.stringify(file));expect(bytes.length).toBeLessThan(LEARNING_DRAFT_LIMITS.fileBytes);await writeFile(join(f.directory,'learning-drafts.json'),bytes);
 const raw={...initial,title:'\u0001'.repeat(200),content:'\u0001'.repeat(100_000)};
 await expect(f.store.save(owner('draft'),slot,'initial',0,envelope('draft',raw))).rejects.toThrow('storage is full');
 expect(await readFile(join(f.directory,'learning-drafts.json'))).toEqual(bytes);
 expect(await f.store.read()).toEqual({kind:'available',epoch:'initial',records});
});
it('compacts only tombstones, rotates epoch and refuses a delayed taskless revision-zero write',async()=>{
 const f=await fixture(),owned=await moduleOwner(f),value={initial:'""',value:'"live"',basis:'owned-v1'};
 const records=Array.from({length:256},(_,i)=>({owner:owned.owner,slot:'prior-'+i,revision:1,value:i===0?null:value}));
 await writeFile(join(f.directory,'learning-drafts.json'),JSON.stringify({schemaVersion:2,epoch:'initial',records}));
 const result=await f.store.save(owner('text'),slot,'initial',0,envelope('text',{...initial,content:'Pending'}));expect(result.kind).toBe('stale-epoch');
 if(result.kind!=='stale-epoch')throw Error('Expected compaction');
 expect(result.epoch).not.toBe('initial');expect(await f.store.save(owner('text'),slot,'initial',0,envelope('text',{...initial,content:'Late'}))).toEqual(result);
 expect(await f.store.read()).toEqual({kind:'available',epoch:result.epoch,records:records.slice(1)});
});
it('mixed-owner cleanup reconciles the surviving taskless epoch before its next normal edit',async()=>{
 const f=await fixture(),owned=await moduleOwner(f),value={initial:'""',value:'"orphan"',basis:'owned-v1'};
 await f.store.save(owned.owner,'prediction','initial',0,value);
 const cache=f.cache();await cache.load();cache.edit(owner('text'),slot,initial,basis('text'),raw=>({...raw,content:'Surviving form'}));await cache.flush();
 await f.core.deleteTask(owned.task.id);cache.forgetTask(owned.task.id);expect(await cache.cleanupDeleted()).toMatchObject({removed:1});
 cache.edit(owner('text'),slot,initial,basis('text'),raw=>({...raw,content:'First edit after cleanup'}));await cache.flush();
 const read=await f.store.read();expect(read).toMatchObject({kind:'available',records:[{owner:owner('text'),value:{value:serializeLearningDraftJson({...initial,content:'First edit after cleanup'})}}]});
 expect(cache.getSnapshot().entries[learningDraftKey(owner('text'),slot)].error).toBeUndefined();
});
it('retains default, unknown-slot, basis, field and owner boundaries',async()=>{
 const f=await fixture(),owned=await moduleOwner(f),before=await f.core.getTask((await f.core.listTasks())[0].id);
 for(const hostile of [{kind:'local-task-form',form:'other'},{kind:'local-task-form',form:'text',taskId:owned.task.id},{kind:'local-task-form',form:'text',permissions:['capture']}])expect(()=>parseLearningDraftOwner(hostile)).toThrow();
 expect(()=>serializeLearningDraftJson({text:'x'.repeat(32769)})).toThrow();
 expect(()=>serializeLearningDraftJson({a:'x'.repeat(32768),b:'x'.repeat(32768),c:'x'.repeat(32768),d:'x'.repeat(32768)})).toThrow();
 expect(()=>envelope('text',{...initial,title:'x'.repeat(201)})).not.toThrow(); // Raw envelope serializer alone is not admission.
 expect(()=>f.store.save(owner('text'),slot,'initial',0,envelope('text',{...initial,title:'x'.repeat(201)}))).toThrow();
 expect(()=>f.store.save(owner('text'),'unknown','initial',0,{initial:'""',value:'"x"',basis:'v1'})).toThrow();
 expect(()=>f.store.save(owner('text'),slot,'initial',0,{...envelope('text',{...initial,content:'x'}),basis:'x'.repeat(16*1024+1)})).toThrow();
 expect(()=>serializeLearningDraftJson({content:'x'.repeat(100001)},learningDraftJsonPolicy(owner('text'),slot))).toThrow();
 expect(()=>parseLearningDraftFile({schemaVersion:2,epoch:'initial',records:[{owner:owner('text'),slot:'unknown',revision:1,value:null}]})).toThrow();
 expect(await f.core.getTask(owned.task.id)).toEqual(before);
});

it('actual atomic replacement failure preserves every prior local record byte through fresh reopen',async()=>{
 const f=await fixture();
 for(const form of ['text','draft'] as const)await f.store.save(owner(form),slot,'initial',0,envelope(form,{...initial,content:'Keep '+form}));
 const path=join(f.directory,'learning-drafts.json'),before=await readFile(path),original=await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
 const failure=vi.spyOn(fileSystem,'rename').mockImplementation(async(...args)=>{if(args[1]===path)throw Error('Owned atomic raw replacement failure');return original.rename(...args);});
 await expect(f.store.save(owner('text'),slot,'initial',1,envelope('text',{...initial,content:'Unconfirmed replacement'}))).rejects.toThrow('Owned atomic raw replacement failure');
 expect(await readFile(path)).toEqual(before);failure.mockRestore();
 const reopened=new LearningDraftStore({directory:f.directory,lookupTask:async()=>undefined});expect(await reopened.read()).toMatchObject({kind:'available',records:[{owner:owner('text'),value:envelope('text',{...initial,content:'Keep text'})},{owner:owner('draft'),value:envelope('draft',{...initial,content:'Keep draft'})}]});
 expect(await readFile(path)).toEqual(before);expect(await f.core.listTasks()).toEqual([]);
});
