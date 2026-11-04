import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createCompanion} from '../src/core/companion';
import {saveSourceFormula} from '../src/core/source-formula-host';
import {createExperimentPractice,inspectExperimentPractice} from '../src/core/experiment-practice-host';
import {sourceFormulaFixture} from './source-formula.fixture';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {serializeLearningDraftJson,parseLearningDraftValue,parseLearningDraftFile,learningDraftKey} from '../src/shared/learning-drafts';
import {EXPERIMENT_PRACTICE_SLOT as slot,EXPERIMENT_PRACTICE_INTENT_SLOT as intentSlot,emptyExperimentPractice as empty,emptyExperimentPracticeIntent as emptyIntent,readExperimentPracticeDraft,readExperimentPracticeIntent,experimentPracticeDraftBasis as basis,type ExperimentPracticeOwner} from '../src/shared/experiment-practice-draft';
import {parseLearningDraftFile as oldParse} from './fixtures/a91/src/shared/learning-drafts';

const owner:ExperimentPracticeOwner={kind:'experiment-practice',taskId:'task',artifactId:'artifact',artifactRevision:1,artifactDigest:'digest'};
const value=(owner:ExperimentPracticeOwner,raw=empty)=>({initial:serializeLearningDraftJson(empty),value:serializeLearningDraftJson(raw),basis:basis(owner)});

it('retains incomplete raw numbers and exact reasoning while rejecting changed initialization, basis, slots and hostile descriptors',()=>{
 const raw={...empty,inputsText:'{"rate":"2e-"}',prediction:' - ',reasoning:'  raw\n``` ungraded ```  '};
 expect(readExperimentPracticeDraft(raw)).toEqual(raw);
 expect(parseLearningDraftValue(value(owner,raw),owner,slot)).toEqual(value(owner,raw));
 for(const changed of [{...value(owner),basis:'other'},{...value(owner),initial:serializeLearningDraftJson(raw)}])expect(()=>parseLearningDraftValue(changed,owner,slot)).toThrow();
 expect(()=>parseLearningDraftValue(value(owner,raw),owner,intentSlot)).toThrow();
 expect(()=>parseLearningDraftValue(value(owner,raw),owner,'other')).toThrow();
 for(const [field,limit] of Object.entries({inputsText:4096,prediction:80,reasoning:2000,examplesText:16384})){
  expect(readExperimentPracticeDraft({...empty,[field]:'x'.repeat(limit)})).toHaveProperty(field,'x'.repeat(limit));
  expect(()=>readExperimentPracticeDraft({...empty,[field]:'x'.repeat(limit+1)})).toThrow();
 }
 expect(readExperimentPracticeIntent({pendingText:'x'.repeat(32768)}).pendingText).toHaveLength(32768);
 expect(()=>readExperimentPracticeIntent({pendingText:'x'.repeat(32769)})).toThrow();
 let reads=0;const accessor={...empty};Object.defineProperty(accessor,'prediction',{enumerable:true,get(){reads++;return '2';}});
 for(const invalid of [accessor,{...empty,authority:true},Object.assign(Object.create({inherited:true}),empty),Object.defineProperty({...empty},'hidden',{value:'secret'}),{...empty,[Symbol('secret')]:'value'}])expect(()=>readExperimentPracticeDraft(invalid)).toThrow();
 expect(reads).toBe(0);
});

it('reopens exact historical raw fields with independent revision ownership, but never grants stale submission authority',async()=>{
 const f=await sourceFormulaFixture();try{
  const artifactSave=await f.core.saveArtifact(f.task.id,{title:f.preview.draft.title,content:JSON.stringify(f.preview.draft),mimeType:'application/json',sourceRefs:[f.input.sourceRef]}),saved={artifactId:artifactSave.artifactId,revision:artifactSave.revision.revision,digest:artifactSave.revision.digest},original:ExperimentPracticeOwner={kind:'experiment-practice',taskId:f.task.id,artifactId:saved.artifactId,artifactRevision:saved.revision,artifactDigest:saved.digest};
  const makeStore=()=>new LearningDraftStore({directory:f.directory,lookupTask:async id=>(await f.core.listTasks()).find(t=>t.id===id)}),store=makeStore(),cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});
  await cache.load();const raw={...empty,inputsText:'{"rate":"2e-","time":" 3 ","fee":"2"}',prediction:'2e-',reasoning:'  keep\nexact incomplete text  '};
  expect(cache.tryEdit(original,slot,empty,basis(original),()=>raw).kind).toBe('accepted');await cache.flush();
  const staleToken=cache.capture(original,slot)!;const newer={...raw,reasoning:'  newer raw reasoning  '};cache.tryEdit(original,slot,empty,basis(original),()=>newer);expect(cache.acknowledge(staleToken)).toBe(false);await cache.flush();
  const artifact=(await f.core.getTask(f.task.id)).artifacts.find(item=>item.id===saved.artifactId)!,revision=artifact.revisions[0];
  const revised=await f.core.saveArtifact(f.task.id,{artifactId:artifact.id,expectedRevision:1,title:revision.title,content:revision.content,mimeType:revision.mimeType,sourceRefs:revision.sourceRefs});
  const current={...original,artifactRevision:revised.revision.revision,artifactDigest:revised.revision.digest};
  expect(cache.tryEdit(current,slot,empty,basis(current),()=>({...empty,prediction:'NEW'})).kind).toBe('accepted');await cache.flush();
  await f.core.putSource(f.task.id,{id:f.source.id,kind:'text',role:'fact',label:'Later source',content:'Changed source'});
  const reopenedStore=makeStore(),reopened=createLearningDrafts({read:()=>reopenedStore.read(),save:(...args)=>reopenedStore.save(...args)});await reopened.load();
  expect(reopened.readForm(original,slot,empty,basis(original))).toMatchObject({status:'ready',value:newer});
  expect(reopened.readForm(current,slot,empty,basis(current))).toMatchObject({status:'ready',value:{...empty,prediction:'NEW'}});
  const variants=[original,current,{...original,taskId:'other'},{...original,artifactId:'other'},{...original,artifactDigest:'other'}];expect(new Set(variants.map(o=>learningDraftKey(o,slot))).size).toBe(variants.length);
  await expect(createExperimentPractice(f.core,{taskId:f.task.id,basis:{artifactId:saved.artifactId,revision:saved.revision,digest:saved.digest},expectedSourceRefs:[f.input.sourceRef],inputs:{rate:5,time:3,fee:2},prediction:15,reasoning:'no stale save'})).rejects.toThrow(/changed/);
  const bytes=await readFile(f.directory+'/learning-drafts.json'),file=JSON.parse(bytes.toString());expect(parseLearningDraftFile(file).records).toHaveLength(2);expect(()=>oldParse(file)).toThrow();expect(await readFile(f.directory+'/learning-drafts.json')).toEqual(bytes);
  expect((await f.core.getTask(f.task.id)).requests.filter(request=>request.id.startsWith('experiment-practice-v1-'))).toHaveLength(0);
 }finally{await f.close();}
});

it('requires an exact admitted artifact, task, revision and digest before persisting practice drafts',async()=>{
 const f=await sourceFormulaFixture();try{
  const saved=await saveSourceFormula(f.core,{input:f.input}),original:ExperimentPracticeOwner={kind:'experiment-practice',taskId:f.task.id,artifactId:saved.artifactId,artifactRevision:saved.revision,artifactDigest:saved.digest},store=new LearningDraftStore({directory:f.directory,lookupTask:async id=>(await f.core.listTasks()).find(t=>t.id===id)});
  const other=await f.core.createTask({title:'Other task'}),plain=await f.core.saveArtifact(f.task.id,{title:'Plain text',content:'not an experiment'});
  for(const invalid of [{...original,taskId:other.id},{...original,artifactId:plain.artifactId,artifactDigest:plain.revision.digest},{...original,artifactRevision:2},{...original,artifactDigest:'wrong'}])await expect(store.save(invalid,slot,'initial',0,value(invalid,{...empty,prediction:'2e-'}))).rejects.toThrow(/no longer available/);
  expect(await store.save(original,slot,'initial',0,value(original,{...empty,prediction:'2e-'}))).toMatchObject({kind:'saved'});
 }finally{await f.close();}
});

it('reconciles a lost reply from persisted original intent after real core and sidecar reconstruction',async()=>{
 const f=await sourceFormulaFixture();let reopenedCore:Awaited<ReturnType<typeof createCompanion>>|undefined;
 try{
  const saved=await saveSourceFormula(f.core,{input:f.input}),original:ExperimentPracticeOwner={kind:'experiment-practice',taskId:f.task.id,artifactId:saved.artifactId,artifactRevision:saved.revision,artifactDigest:saved.digest},store=new LearningDraftStore({directory:f.directory,lookupTask:async id=>(await f.core.listTasks()).find(t=>t.id===id)}),cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await cache.load();
  const raw={inputsText:'{"rate":"5","time":"3","fee":"2"}',prediction:'15',reasoning:'  I forgot the fee.\n``` keep literal ```  ',examplesText:'{"inputs":[{"rate":4,"time":3,"fee":2}],"exampleContext":"open-review-v1"}'},pending={pendingText:JSON.stringify(raw)};
  cache.tryEdit(original,slot,empty,basis(original),()=>raw);cache.tryEdit(original,intentSlot,emptyIntent,basis(original,intentSlot),()=>pending);await cache.flush();
  const request={taskId:f.task.id,basis:{artifactId:saved.artifactId,revision:saved.revision,digest:saved.digest},expectedSourceRefs:[f.input.sourceRef],inputs:{rate:5,time:3,fee:2},prediction:15,reasoning:raw.reasoning,demonstratedInputs:[{rate:4,time:3,fee:2}],exampleContext:'open-review-v1'};
  const receipt=await createExperimentPractice(f.core,request); // Treat the response as lost; only disk survives below.
  await f.core.close();reopenedCore=await createCompanion({dataDir:f.directory});const core=reopenedCore,reopenedStore=new LearningDraftStore({directory:f.directory,lookupTask:async id=>(await core.listTasks()).find(t=>t.id===id)}),reopened=createLearningDrafts({read:()=>reopenedStore.read(),save:(...args)=>reopenedStore.save(...args)});await reopened.load();
  expect(reopened.readForm(original,intentSlot,emptyIntent,basis(original,intentSlot))).toMatchObject({status:'ready',value:pending});
  expect(reopened.readForm(original,slot,empty,basis(original))).toMatchObject({status:'ready',value:raw});
  const {prediction,reasoning,...inspection}=request;expect(await inspectExperimentPractice(core,inspection)).toMatchObject({kind:'completed',...receipt});
  expect(await createExperimentPractice(core,{...request,prediction:17,reasoning:'replacement is not authoritative'})).toEqual(receipt);
  const task=await core.getTask(f.task.id),answer=task.artifacts.find(item=>item.id===receipt.artifactId)!.revisions[0].content;
  expect(answer).toContain('Your first prediction: 15 USD');expect(answer).toContain(raw.reasoning);expect(answer).toContain('(15 USD) + (2 USD) = 17 USD');expect(answer).toContain('below the computed result by 2 USD');expect(answer).toContain('reasoning is not graded');expect(task.requests.filter(r=>r.id.startsWith('experiment-practice-v1-'))).toHaveLength(1);
 }finally{await reopenedCore?.close();await f.close();}
});
