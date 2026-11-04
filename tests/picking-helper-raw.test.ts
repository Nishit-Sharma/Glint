import {oldTaskLookup} from './pinned-old-task-lookup';
import {expectPinnedReaderRefusal} from './pinned-reader-refusal.fixture';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {LearningDraftProvider,LearningDraftScope} from '../src/renderer/src/learning-draft-context';
import {parseLearningDraftFile,parseLearningDraftRecord} from '../src/shared/learning-drafts';
import {exampleLesson} from '../src/learning/example';
import {MODULE_MIME} from '../src/shared/module-contract';
import {afterEach,expect,test} from 'vitest';
import {createCompanion} from '../src/core/companion';
import {createTextHelper} from '../src/core/text-helper-host';
import {editModule} from '../src/core/module-state';
import {parseModuleAnswer} from '../src/core/interactive-modules';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {LearningDraftStore as OldStore} from './fixtures/a91/src/host/learning-drafts';
import {helperDraftMode} from '../src/shared/helper-draft-slots';
import {learningDraftJsonPolicy,serializeLearningDraftJson,parseLearningDraftValue,learningDraftKey,type LearningDraftJson,type LearningDraftOwner} from '../src/shared/learning-drafts';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {navigationFormBasis} from '../src/renderer/src/learning-draft-basis';
import {pickingHelperDraftBasis} from '../src/renderer/src/picking-helper-draft-basis';
import {pickingHelper} from '../src/learning/picking-helper';
import {pickingPlan} from './picking-fixture';
import {maxPickingCase,maxPickingDefinition} from './picking-capacity-fixture';
const cleanup:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const fn of cleanup.splice(0))await fn();});
async function owned(){const directory=await mkdtemp(join(tmpdir(),'picking-raw-')),core=await createCompanion({dataDir:directory});cleanup.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});const make=async(index:number,mode=true)=>{const task=await core.createTask({title:'Picking raw '+index}),created=await createTextHelper(core,{taskId:task.id,requestId:'create'+index}),artifact=created.task.artifacts.find(a=>a.id===created.artifactId)!,revision=artifact.revisions[0],module=parseModuleAnswer(JSON.parse(revision.content)).modules[0];if(mode)await editModule(core,{taskId:task.id,artifactId:artifact.id,artifactRevision:1,moduleId:module.id,action:{kind:'begin-table-helper',expectedRevision:0}});return {task,module,owner:{taskId:task.id,artifactId:artifact.id,artifactRevision:1,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version} satisfies LearningDraftOwner};};const lookupTask=async(id:string)=>(await core.listTasks()).find(t=>t.id===id),store=new LearningDraftStore({directory,lookupTask});return {directory,core,make,lookupTask,store};}
function value(owner:LearningDraftOwner,slot:string,data:unknown){const text=serializeLearningDraftJson(data,learningDraftJsonPolicy(owner,slot));return {initial:text,value:text,basis:'inert-picking-form'};}
const synthetic={taskId:'t',artifactId:'a',artifactRevision:1,artifactDigest:'d',moduleId:'m',moduleVersion:1};

test('only six exact V2 slots select policies and their closed payloads reject unknown fields',()=>{
 for(const family of ['candidate','context','recording','cases','correction','run'])expect(helperDraftMode('helper:table:'+family)).toBe('table');
 for(const slot of ['helper:table:future','helper:table:cases:other','helper:other:cases']){expect(helperDraftMode(slot)).toBeUndefined();expect(learningDraftJsonPolicy(synthetic,slot)).toBeUndefined();}
 const slot='helper:table:cases',valid={cases:[maxPickingCase(0)]};expect(()=>parseLearningDraftValue(value(synthetic,slot,valid),synthetic,slot)).not.toThrow();
 for(const invalid of [{...valid,receipt:{}},{cases:[{...maxPickingCase(0),capturedPixels:'x'}]},{cases:[{...maxPickingCase(0),request:{key:'x',secret:'no'}}]}])expect(()=>value(synthetic,slot,invalid)).toThrow();
});
test('closed cases support heterogeneous typed edits while old generic form shape stays strict',async()=>{
 const f=await owned(),{owner}=await f.make(0),cache=createLearningDrafts({read:()=>f.store.read(),save:(...args)=>f.store.save(...args)});await cache.load();const slot='helper:table:cases',initial=JSON.parse(JSON.stringify({cases:[maxPickingCase(0)]})) as LearningDraftJson,basis=navigationFormBasis(initial,{slot,basisMode:'explicit',basis:'v2-cases'});
 expect(cache.tryEdit(owner,slot,initial,basis,()=>({cases:[{id:'missing',role:'counterexample',table:{id:'empty',rows:[]},request:{},expected:{status:'invalid-input',stage:'input'}}]})).kind).toBe('accepted');await cache.flush();const token=cache.capture(owner,slot)!;expect(cache.tryEdit(owner,slot,initial,basis,()=>({cases:[]})).kind).toBe('accepted');expect(cache.acknowledge(token)).toBe(false);await cache.flush();expect(cache.readForm(owner,slot,initial,basis).value).toEqual({cases:[]});
 expect(cache.tryEdit(owner,'helper:text:check',{a:'old'},'old-shape',()=>({b:'new'}) as never).kind).toBe('rejected');
});
test('large named raw cases need the exact installed V2 helper and never alter committed helper state',async()=>{
 const f=await owned(),a=await f.make(0),old=await f.make(1,false),slot='helper:table:cases',large=value(a.owner,slot,{cases:Array.from({length:20},(_,i)=>maxPickingCase(i))});expect(Buffer.byteLength(large.value)).toBeGreaterThan(128*1024);const before=await f.core.getTask(a.task.id);
 expect(await f.store.save(a.owner,slot,'initial',0,large)).toMatchObject({kind:'saved'});expect(await f.core.getTask(a.task.id)).toEqual(before);
 await expect(f.store.save(old.owner,slot,'initial',0,large)).rejects.toThrow();for(const changed of [{moduleId:'wrong'},{artifactDigest:'wrong'},{taskId:old.task.id}])await expect(f.store.save({...a.owner,...changed},slot,'initial',0,large)).rejects.toThrow();await expect(f.store.save(a.owner,'helper:table:future','initial',0,{initial:'{}',value:'{}',basis:'x'})).rejects.toThrow();
 expect(await f.store.save(a.owner,'helper:text:run','initial',0,{initial:'""',value:'"  earlier raw  "',basis:'legacy'})).toMatchObject({kind:'saved'});
});
test('maximum inert candidate budget survives and one additional character is refused without widening other owners',()=>{
 const definition=maxPickingDefinition(),slot='helper:table:candidate',payload={definitionText:JSON.stringify(definition),changeReason:'raw only'};expect(()=>value(synthetic,slot,payload)).not.toThrow();
 const tooLarge=structuredClone(definition);tooLarge.intent+='x';expect(()=>value(synthetic,slot,{...payload,definitionText:JSON.stringify(tooLarge)})).toThrow();
 expect(()=>value(synthetic,'helper:text:check',{definitionText:payload.definitionText})).toThrow();
 const oldPlan=pickingPlan(),unfinished={...oldPlan,body:{...oldPlan.body,preconditions:oldPlan.body.preconditions.map((c,i)=>i===0?{...c,reason:''}:c)}};expect(()=>value(synthetic,slot,{definitionText:JSON.stringify(unfinished),changeReason:''})).not.toThrow();
});
// Refusal contract: the old sidecar can no longer read the small raw or save the unrelated join form, because its pinned task lookup refuses the provenance-bearing store; the current sidecar makes the unrelated save instead.
test('pinned old sidecar fails closed on the provenance-bearing task store for small and expanded raw without rewriting, while the current sidecar keeps both',async()=>{
 const f=await owned(),{owner}=await f.make(0),old=new OldStore({directory:f.directory,lookupTask:oldTaskLookup(f.directory)});await f.store.save(owner,'helper:table:run','initial',0,value(owner,'helper:table:run',{runId:'run-local',note:'  retain this  '}));const path=join(f.directory,'learning-drafts.json'),small=await readFile(path);await expectPinnedReaderRefusal(f.directory,()=>oldTaskLookup(f.directory)(owner.taskId));expect((await old.read()).kind).toBe('unavailable');expect(await readFile(path)).toEqual(small);
 const joinTask=await f.core.createTask({title:'Unrelated historical SQL raw'}),joined=await f.core.saveArtifact(joinTask.id,{title:'Join',mimeType:MODULE_MIME,content:JSON.stringify({schemaVersion:1,markdown:'Join.',modules:[{id:'join',version:1,data:exampleLesson,provenance:[]}]})}),joinOwner={taskId:joinTask.id,artifactId:joined.artifactId,artifactRevision:1,artifactDigest:joined.revision.digest,moduleId:'join',moduleVersion:1};await expect(old.save(joinOwner,'prediction','initial',0,{initial:'""',value:'"0"',basis:'old-join'})).rejects.toThrow();expect(await readFile(path)).toEqual(small);await f.store.save(joinOwner,'prediction','initial',0,{initial:'""',value:'"0"',basis:'old-join'});const preserved=await f.store.read();if(preserved.kind!=='available')throw Error('Small V2 raw lost');expect(preserved.records.find(r=>r.slot==='helper:table:run')!.value?.value).toContain('  retain this  ');await f.store.save(owner,'helper:table:run','initial',1,value(owner,'helper:table:run',{runId:'run-later',note:'Continue later'}));
 await f.store.save(owner,'helper:table:cases','initial',0,value(owner,'helper:table:cases',{cases:Array.from({length:20},(_,i)=>maxPickingCase(i))}));const large=await readFile(path);expect((await old.read()).kind).toBe('unavailable');expect(await readFile(path)).toEqual(large);
 const read=await f.store.read();if(read.kind!=='available')throw Error('Current raw unavailable');expect(read.records.some(r=>r.slot==='helper:table:run')).toBe(true);expect(await f.store.save(owner,'helper:table:run','11111111-1111-4111-8111-111111111111',2,null)).toMatchObject({kind:'stale-epoch'});
 await f.core.deleteTask(owner.taskId);await expect(f.store.save(owner,'helper:table:run','initial',2,null)).rejects.toThrow();const deleted=await f.store.read();expect(deleted).toMatchObject({kind:'available',cleanup:'needed'});if(deleted.kind!=='available')throw Error('Cleanup read unavailable');expect(deleted.records.some(r=>'taskId' in r.owner&&r.owner.taskId===owner.taskId)).toBe(false);expect(deleted.records.some(r=>'taskId' in r.owner&&r.owner.taskId===joinTask.id)).toBe(true);
});
test('V2 basis changes isolate activation and preserve unrelated old-mode drafts',()=>{const initial=pickingHelper.initial('helper'),later={...initial,activation:{generation:1,version:null,digest:null}};expect(pickingHelperDraftBasis(initial,'run')).not.toBe(pickingHelperDraftBasis(later,'run'));expect(pickingHelperDraftBasis(initial,'candidate')).toBe(pickingHelperDraftBasis(later,'candidate'));expect(helperDraftMode('helper:text:check')).toBe('text');expect(helperDraftMode('helper:semantic:steps')).toBe('semantic');});

test('whole-file refusal preserves bytes and unsaved input; explicit recovery after deletion succeeds',async()=>{
 const f=await owned();const owners:Array<Awaited<ReturnType<typeof f.make>>>=[];for(let i=0;i<4;i++)owners.push(await f.make(i));const slot='helper:table:cases',initial={cases:[]} as LearningDraftJson,payload=JSON.parse(JSON.stringify({cases:Array.from({length:20},(_,i)=>maxPickingCase(i))})) as LearningDraftJson;
 for(let i=0;i<3;i++)await f.store.save(owners[i].owner,slot,'initial',0,value(owners[i].owner,slot,payload));
 const path=join(f.directory,'learning-drafts.json'),before=await readFile(path),cache=createLearningDrafts({read:()=>f.store.read(),save:(...args)=>f.store.save(...args)});await cache.load();const owner=owners[3].owner,basis=navigationFormBasis(initial,{slot,basisMode:'explicit',basis:'pending-full'});
 expect(cache.tryEdit(owner,slot,initial,basis,()=>payload).kind).toBe('accepted');await expect(cache.flush()).rejects.toThrow(/storage is full/i);expect(await readFile(path)).toEqual(before);const key=learningDraftKey(owner,slot),entry=cache.getSnapshot().entries[key];expect(entry.error).toBeTruthy();expect(entry.local?.value).toBe(serializeLearningDraftJson(payload,learningDraftJsonPolicy(owner,slot)));
 const html=renderToStaticMarkup(createElement(LearningDraftProvider,{cache,children:createElement(LearningDraftScope,{owner,children:createElement('span',null,'Form kept')})}));expect(html).toContain('Unfinished practice could not be saved');expect(html).not.toContain('Unapplied edits saved on this Mac');
 await f.core.deleteTask(owners[2].task.id);cache.forgetTask(owners[2].task.id);await f.store.purgeTask(owners[2].task.id);await cache.retry(owner,slot);await cache.flush();const read=await f.store.read();if(read.kind!=='available')throw Error('Current file unavailable');expect(read.records.some(r=>learningDraftKey(r.owner,r.slot)===key)).toBe(true);expect(read.records.some(r=>'taskId' in r.owner&&r.owner.taskId===owners[2].task.id)).toBe(false);expect((await readFile(path)).length).toBeLessThanOrEqual(8*1024*1024);
});
test('other installed modules cannot obtain V2 slots and default UTF8 limit remains exact',async()=>{
 const f=await owned(),task=await f.core.createTask({title:'Other module'}),saved=await f.core.saveArtifact(task.id,{title:'Join',mimeType:MODULE_MIME,content:JSON.stringify({schemaVersion:1,markdown:'Join.',modules:[{id:'join',version:1,data:exampleLesson,provenance:[]}]})}),owner={taskId:task.id,artifactId:saved.artifactId,artifactRevision:1,artifactDigest:saved.revision.digest,moduleId:'join',moduleVersion:1};
 await expect(f.store.save(owner,'helper:table:run','initial',0,value(owner,'helper:table:run',{runId:'run-local',note:'inert'}))).rejects.toThrow();
 const payload={a:'é'.repeat(32768),b:'é'.repeat(32760)+'a'},text=serializeLearningDraftJson(payload);expect(Buffer.byteLength(text)).toBe(128*1024);expect(()=>serializeLearningDraftJson({...payload,b:payload.b+'a'})).toThrow();
 const declared=maxPickingCase(0);declared.request.key='é'.repeat(160);expect(()=>value(synthetic,'helper:table:cases',{cases:[declared]})).not.toThrow();declared.request.key+='é';expect(()=>value(synthetic,'helper:table:cases',{cases:[declared]})).toThrow();
});
test('closed record/file traversal rejects accessors and extra fields without invoking them',()=>{
 let reads=0;const record={owner:synthetic,slot:'helper:table:run',revision:1,value:null};Object.defineProperty(record,'value',{enumerable:true,get(){reads++;return null;}});expect(()=>parseLearningDraftRecord(record)).toThrow();expect(reads).toBe(0);
 const records=new Array(1);Object.defineProperty(records,'0',{enumerable:true,get(){reads++;return record;}});expect(()=>parseLearningDraftFile({schemaVersion:2,epoch:'initial',records})).toThrow();expect(reads).toBe(0);expect(()=>parseLearningDraftFile({schemaVersion:2,epoch:'initial',records:[],extra:true})).toThrow();
});

test('V2 raw admission requires the installed state owner to agree with the actual task/artifact/module',async()=>{
 const f=await owned(),entry=await f.make(0),task=await f.core.getTask(entry.task.id),module=entry.module;if(module.data.kind!=='helper-studio')throw Error('Expected helper');const actual={...entry.owner,helperId:module.data.id},state=task.session!.moduleStates[0].state;await f.core.replaceSession(task.id,task.session!.revision,{...task.session!,moduleStates:[{...task.session!.moduleStates[0],state:{...state,owner:{...actual,taskId:'different-owned-task'}}}]});const path=join(f.directory,'learning-drafts.json');await expect(f.store.save(entry.owner,'helper:table:run','initial',0,value(entry.owner,'helper:table:run',{runId:'run-local',note:'Must remain refused'}))).rejects.toThrow();await expect(readFile(path)).rejects.toMatchObject({code:'ENOENT'});
});
