import {afterEach,expect,test} from 'vitest';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {serializeLearningDraftJson,learningDraftJsonPolicy} from '../src/shared/learning-drafts';
import {tableWorkflowFormBasis,validateTableWorkflowRaw,TABLE_WORKFLOW_RAW_BYTES} from '../src/shared/table-workflow-draft';
import {navigationFormBasis} from '../src/renderer/src/learning-draft-basis';
import {tableWorkflowFixture} from './table-workflow.fixture';
import {createDocumentRecipe} from '../src/core/document-recipe-host';
import {parseModuleAnswer} from '../src/core/interactive-modules';
const close:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const f of close.splice(0))await f();});
async function fixture(){const f=await tableWorkflowFixture();close.push(f.close);const {helperId:_helper,...owner}=f.owner,store=new LearningDraftStore({directory:f.directory,lookupTask:async id=>(await f.core.listTasks()).find(task=>task.id===id)});return {...f,owner,store};}

test('complete maximum check fields and exact blanks survive existing durable raw cache reopen without authorizing execution',async()=>{
 const f=await fixture(),state=await f.read(),slot='table-workflow:check',initial={input:'',expected:'',kind:'output'},raw={input:'\0'.repeat(32000),expected:'\0'.repeat(32000),kind:'output'},policy=learningDraftJsonPolicy(f.owner,slot),basis=navigationFormBasis(null,{slot,basisMode:'explicit',basis:tableWorkflowFormBasis(state,'check')}),value={initial:serializeLearningDraftJson(initial,policy),value:serializeLearningDraftJson(raw,policy),basis};expect(Buffer.byteLength(value.value)).toBeLessThan(TABLE_WORKFLOW_RAW_BYTES);const read=await f.store.read();if(read.kind!=='available')throw Error();expect(await f.store.save(f.owner,slot,read.epoch,0,value)).toMatchObject({kind:'saved'});const cache=createLearningDrafts({read:()=>f.store.read(),save:(...args)=>f.store.save(...args)});await cache.load();expect(cache.readForm(f.owner,slot,initial,basis).value).toEqual(raw);cache.tryEdit(f.owner,slot,initial,basis,()=>initial);await cache.flush();const reopen=createLearningDrafts({read:()=>f.store.read(),save:(...args)=>f.store.save(...args)});await reopen.load();expect(reopen.readForm(f.owner,slot,initial,basis).value).toEqual(initial);expect((await f.read()).workspace).toBeNull();expect((await f.core.getTask(f.owner.taskId)).requests).toHaveLength(1);
});

test('closed raw policies reject extra authority fields, overlong values, unknown slots and another module family',async()=>{
 const f=await fixture(),read=await f.store.read();if(read.kind!=='available')throw Error();const initial={source:''},policy='table-workflow-form' as const,value={initial:serializeLearningDraftJson(initial,policy),value:serializeLearningDraftJson({source:'  exact unfinished selection  '},policy),basis:'owned-raw-basis'};
 expect(()=>validateTableWorkflowRaw({source:'',execute:true},'table-workflow:run')).toThrow();expect(()=>serializeLearningDraftJson({input:'x'.repeat(32001),expected:'',kind:'output'},policy)).toThrow();await expect(Promise.resolve().then(()=>f.store.save(f.owner,'table-workflow:unknown',read.epoch,0,value))).rejects.toThrow();
 const created=await createDocumentRecipe(f.core,{taskId:f.owner.taskId,requestId:'other-module'}),artifact=created.task.artifacts.find(a=>a.id===created.artifactId)!,revision=artifact.revisions[0],module=parseModuleAnswer(JSON.parse(revision.content)).modules[0],other={taskId:f.owner.taskId,artifactId:artifact.id,artifactRevision:1,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:1};await expect(f.store.save(other,'table-workflow:run',read.epoch,0,value)).rejects.toThrow();expect((await f.store.read()).kind).toBe('available');
});

test('late legacy helper fields remain recoverable without being treated as applicable table-workflow fields',async()=>{
 const f=await fixture(),read=await f.store.read();if(read.kind!=='available')throw Error();const value={initial:serializeLearningDraftJson({name:'Original',invocation:'old'}),value:serializeLearningDraftJson({name:'  Unsent earlier helper name  ',invocation:''}),basis:'earlier-text-owner-basis'};expect(await f.store.save(f.owner,'helper:text:details',read.epoch,0,value)).toMatchObject({kind:'saved'});const next=await f.store.read();if(next.kind!=='available')throw Error();expect(next.records[0].value).toEqual(value);expect(next.records[0].owner).toEqual(f.owner);expect((await f.read()).format).toBe('table-workflow-v1');
});

test('new named-input form slots retain exact blanks and unknown values without changing original form shapes or authorizing a run',async()=>{
 const f=await fixture(),state=await f.read(),read=await f.store.read();if(read.kind!=='available')throw Error();
 const forms=[{family:'bindings',initial:{target:'',name:''},raw:{target:'  Earlier exact target  ',name:'  Unsent name  '}},{family:'inputcheck',initial:{input:'',expected:'',kind:'output',valuesText:'[]',replaces:''},raw:{input:'  Unfinished CSV  ',expected:'',kind:'invalid-input',valuesText:'[{"name":"Earlier","value":"  "}]',replaces:''}},{family:'inputrun',initial:{source:'',valuesText:'[]'},raw:{source:'',valuesText:'[{"name":"Rate","value":""}]'}}]as const;
 for(const item of forms){const slot='table-workflow:'+item.family,basis=navigationFormBasis(null,{slot,basisMode:'explicit',basis:tableWorkflowFormBasis(state,item.family)}),value={initial:serializeLearningDraftJson(item.initial,'table-workflow-form'),value:serializeLearningDraftJson(item.raw,'table-workflow-form'),basis};expect(await f.store.save(f.owner,slot,read.epoch,0,value)).toMatchObject({kind:'saved'});}
 const cache=createLearningDrafts({read:()=>f.store.read(),save:(...args)=>f.store.save(...args)});await cache.load();for(const item of forms){const slot='table-workflow:'+item.family,basis=navigationFormBasis(null,{slot,basisMode:'explicit',basis:tableWorkflowFormBasis(state,item.family)});expect(cache.readForm(f.owner,slot,item.initial,basis).value).toEqual(item.raw);}
 expect(()=>validateTableWorkflowRaw({source:'',valuesText:'[]',run:true},'table-workflow:inputrun')).toThrow();expect(()=>validateTableWorkflowRaw({target:'',name:'x'.repeat(41)},'table-workflow:bindings')).toThrow();expect((await f.read()).lastRun).toBeNull();expect((await f.core.getTask(f.owner.taskId)).requests).toHaveLength(1);
});
