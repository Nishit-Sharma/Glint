import {oldTaskLookup} from './pinned-old-task-lookup';
import {Effect,Schema} from 'effect';
import {StoredModuleStateSchema as OldStoredSchema} from './fixtures/a91/src/core/module-registry';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
import {createCompanion} from '../src/core/companion';
import {createTextHelper} from '../src/core/text-helper-host';
import {editModule} from '../src/core/module-state';
import {parseModuleAnswer} from '../src/core/interactive-modules';
import {pickingHelper} from '../src/learning/picking-helper';
import {pickingExampleDefinition,pickingExampleInventory,pickingExampleRequest,suggestedPickingCases} from '../src/learning/picking-example';
import {pickingHelper as oldPicking} from './fixtures/contrast-source977/src/learning/picking-helper';
import {admitPickingAction as oldAdmit} from './fixtures/contrast-source977/src/core/picking-helper-host';
import {readState as oldRead} from './fixtures/a91/src/core/store';
import {expectPinnedReaderRefusal} from './pinned-reader-refusal.fixture';
import {LearningDraftStore as OldDraftStore} from './fixtures/a91/src/host/learning-drafts';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {serializeLearningDraftJson,learningDraftKey,learningDraftJsonPolicy} from '../src/shared/learning-drafts';
import {exampleLesson} from '../src/learning/example';
import {MODULE_MIME} from '../src/shared/module-contract';

// Refusal contract: the old core write of the old-admitted state, the old unrelated task write and the old sidecar's unrelated join save can no longer happen; the pinned task and sidecar readers fail closed with bytes unchanged.
test('real module ownership and pinned old evaluator/known local actions stay pure; the pinned store and sidecar refuse new provenance unchanged while current reopen preserves demonstrated conditional versions',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'contrast-compat-'));let core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Contrast owner'}),created=await createTextHelper(core,{taskId:task.id,requestId:'helper'}),artifact=created.task.artifacts.find(item=>item.id===created.artifactId)!,revision=artifact.revisions[0],module=parseModuleAnswer(JSON.parse(revision.content)).modules[0];if(module.data.kind!=='helper-studio')throw Error('Expected helper');const helperId=module.data.id,identity={taskId:task.id,artifactId:artifact.id,artifactRevision:1,moduleId:module.id};
  const read=async()=>pickingHelper.parseState(helperId,(await core.getTask(task.id)).session!.moduleStates[0].state);let count=0;const act=async(action:Record<string,unknown>)=>{await editModule(core,{...identity,action:{...action,expectedRevision:count++} as never});return read();};
  await act({kind:'begin-table-helper'});await act({kind:'picking-candidate',definition:pickingExampleDefinition(),reason:'Supported local profile.'});
  for(const [delivery,handling] of [['desk','Collect at green desk'],['parcel','Pack at blue bench']]){let state=await act({kind:'picking-context',table:pickingExampleInventory(),request:{...pickingExampleRequest,delivery}});await act({kind:'picking-record-start',contextId:state.currentContextId});await act({kind:'picking-select-row',rowId:'chosen'});for(const [source,field,output] of [['row','sku','itemKey'],['row','name','label'],['request','quantity','quantity']])await act({kind:'picking-copy',source,field,output});await act({kind:'picking-literal',output:'handling',value:handling});await act({kind:'picking-record-stop'});}
  let state=await act({kind:'picking-propose-contrast'});await act({kind:'picking-cases',cases:suggestedPickingCases(state.candidate!.definition,pickingExampleInventory(),{...pickingExampleRequest,delivery:'parcel'})});state=await act({kind:'picking-save',note:'From controlled contrasts.'});await act({kind:'picking-activate',version:1,digest:state.releases[0].digest,generation:0});state=await act({kind:'picking-context',table:{id:'fresh',rows:[{id:'freshRow',values:['N-82','Fresh fixture',12,false]}]},request:{key:'N-82',quantity:5,reviewed:true,delivery:'desk'}});
  const originals=JSON.stringify(state.observations),release=JSON.stringify(state.releases[0]);expect(oldPicking.parseState(helperId,state)).toEqual(state);expect(()=>oldPicking.parseAction({kind:'picking-propose-contrast',expectedRevision:state.revision})).toThrow();
  const prepared=oldAdmit(state.owner!,state,{kind:'picking-prepare',runId:'old-known-run',releaseDigest:state.activation.digest,generation:state.activation.generation,contextId:state.currentContextId,targetRevision:0,expectedRevision:state.revision});expect(prepared.attempts.at(-1)!.result).toMatchObject({status:'completed',output:{itemKey:'N-82',label:'Fresh fixture',quantity:5,handling:'Collect at green desk'}});const applied=oldAdmit(state.owner!,prepared,{kind:'picking-apply',runId:'old-known-run',expectedRevision:prepared.revision});expect(applied.contexts.at(-1)!.target.revision).toBe(1);
  const owner={...identity,artifactDigest:revision.digest,moduleVersion:module.version},slot='helper:table:candidate',policy=learningDraftJsonPolicy(owner,slot),raw={definitionText:JSON.stringify(state.candidate!.definition),changeReason:'  Keep the inferred steps for review  '},value={initial:serializeLearningDraftJson(raw,policy),value:serializeLearningDraftJson(raw,policy),basis:'contrast-raw-copy'},lookupTask=async(id:string)=>(await core.listTasks()).find(item=>item.id===id),drafts=new LearningDraftStore({directory,lookupTask});await drafts.save(owner,slot,'initial',0,value);const sidecar=join(directory,'learning-drafts.json'),beforeRaw=await readFile(sidecar),other=await core.createTask({title:'Unrelated old work'}),before=await core.getTask(task.id);await core.close();
  expect(Schema.decodeUnknownSync(OldStoredSchema,{onExcessProperty:'error'})(applied)).toEqual(applied);
  await expectPinnedReaderRefusal(directory,()=>Effect.runPromise(oldRead(directory)));expect(await readFile(sidecar)).toEqual(beforeRaw);
  const oldDrafts=new OldDraftStore({directory,lookupTask:oldTaskLookup(directory)});expect((await oldDrafts.read()).kind).toBe('unavailable');await expect(oldDrafts.save(owner,slot,'initial',1,value)).rejects.toThrow();expect(await readFile(sidecar)).toEqual(beforeRaw);
  core=await createCompanion({dataDir:directory});const current=await core.getTask(task.id);expect(current.artifacts).toEqual(before.artifacts);expect(current.requests).toEqual(before.requests);expect(current.session!.moduleStates).toEqual(before.session!.moduleStates);const reopened=await read();expect(reopened).toEqual(state);expect(JSON.stringify(reopened.observations)).toBe(originals);expect(JSON.stringify(reopened.releases[0])).toBe(release);
  const joined=await core.saveArtifact(other.id,{title:'Unrelated join',mimeType:MODULE_MIME,content:JSON.stringify({schemaVersion:1,markdown:'Join.',modules:[{id:'join',version:1,data:exampleLesson,provenance:[]}]})});const joinBytes=await readFile(sidecar);await expect(oldDrafts.save({taskId:other.id,artifactId:joined.artifactId,artifactRevision:1,artifactDigest:joined.revision.digest,moduleId:'join',moduleVersion:1},'prediction','initial',0,{initial:'""',value:'"2"',basis:'unrelated'})).rejects.toThrow();expect(await readFile(sidecar)).toEqual(joinBytes);const after=await new LearningDraftStore({directory,lookupTask}).read();expect(after.kind).toBe('available');if(after.kind!=='available')throw Error('Current raw must remain available');expect(after.records.find(item=>learningDraftKey(item.owner,item.slot)===learningDraftKey(owner,slot))?.value).toEqual(value);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
