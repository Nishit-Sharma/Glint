import {Effect} from 'effect';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
import {createCompanion} from '../src/core/companion';
import {createTextHelper} from '../src/core/text-helper-host';
import {editModule} from '../src/core/module-state';
import {parseModuleAnswer} from '../src/core/interactive-modules';
import {semanticHelper} from '../src/learning/semantic-helper';
import {semanticHelper as oldSemantic} from './fixtures/recording-expectation-source958/src/learning/semantic-helper';
import {readState as oldRead,writeState as oldWrite} from './fixtures/a91/src/core/store';
import {LearningDraftStore as OldDraftStore} from './fixtures/a91/src/host/learning-drafts';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {recordProcedure} from '../src/renderer/src/components/SemanticHelperStudio';
import {semanticHelperDraftBasis} from '../src/renderer/src/semantic-helper-draft-basis';
import {navigationFormBasis} from '../src/renderer/src/learning-draft-basis';
import {serializeLearningDraftJson,learningDraftKey} from '../src/shared/learning-drafts';
import {exampleLesson} from '../src/learning/example';
import {MODULE_MIME} from '../src/shared/module-contract';

test('pinned old readers preserve corrected task and small raw bytes, refuse helper editing, and retain unrelated store and sidecar writes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'recording-expectation-compat-'));let core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Corrected helper owner'}),created=await createTextHelper(core,{taskId:task.id,requestId:'create'}),artifact=created.task.artifacts.find(item=>item.id===created.artifactId)!,revision=artifact.revisions[0],module=parseModuleAnswer(JSON.parse(revision.content)).modules[0];if(module.data.kind!=='helper-studio')throw Error('Expected helper');const helperId=module.data.id;
  const identity={taskId:task.id,artifactId:artifact.id,artifactRevision:1,moduleId:module.id};let rev=0;const act=async(action:Record<string,unknown>)=>{await editModule(core,{...identity,action:{...action,expectedRevision:rev++} as never});};const state=async()=>semanticHelper.parseState(helperId,(await core.getTask(task.id)).session!.moduleStates[0].state);
  const plan=(threshold:string)=>recordProcedure({inputName:'request',numberField:'amount',approvalField:'approved',sensitiveField:'sensitive',outputField:'route',threshold,comparison:'gte',whenTrue:'review',whenFalse:'standard'}),input={amount:1500,approved:true,sensitive:false};
  await act({kind:'begin-semantic-helper'});await act({kind:'set-semantic-procedure',procedure:plan('1000')});await act({kind:'record-semantic-input',input});const recording=(await state()).recordings[0];
  const evidence={rationales:[{id:'route',kind:'inferred-rationale',stepId:'threshold',basis:[{recordingId:recording.recordingId,traceStepId:'threshold'}],reason:'The threshold chooses the route.'}],corrections:[],examples:[{id:'different',role:'held-out',input:{amount:3000,approved:true,sensitive:false},expected:{status:'completed',output:{route:'review'}}},{id:'no',role:'counterexample',input:{amount:10,approved:false,sensitive:false},expected:{status:'abstained',code:'precondition',haltedStepId:'approval'}},{id:'private',role:'exception',input:{amount:10,approved:true,sensitive:true},expected:{status:'abstained',code:'explicit-stop',haltedStepId:'sensitive-stop'}}]};
  await act({kind:'set-semantic-evidence',...evidence});await act({kind:'save-semantic-version',changeNote:'Original'});const unextended=await state();expect(oldSemantic.parseState(helperId,unextended)).toEqual(unextended);
  await act({kind:'activate-semantic-version',version:1});await act({kind:'replace-semantic-procedure',procedure:plan('2000'),rationales:[],corrections:[],examples:[]});await act({kind:'correct-semantic-recording-expectation',recordingId:recording.recordingId,expected:{status:'completed',output:{route:'standard'}},reason:'Use the higher threshold.'});await act({kind:'set-semantic-evidence',...evidence});await act({kind:'save-semantic-version',changeNote:'Corrected expected route'});await act({kind:'activate-semantic-version',version:2});
  const extended=await state();expect(()=>oldSemantic.parseState(helperId,extended)).toThrow();expect(()=>oldSemantic.update(helperId,extended,{kind:'activate-semantic-version',version:1,expectedRevision:extended.revision})).toThrow();expect(extended.recordings[0]).toEqual(recording);expect(extended.versions[0]).toEqual(unextended.versions[0]);
  const owner={taskId:task.id,artifactId:artifact.id,artifactRevision:1,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version},slot='helper:semantic:typedexpectation',initial={recordingId:recording.recordingId,outcome:'completed',output:{route:'standard'},stopId:'approval',reason:''},raw={...initial,output:{route:'  keep unsent result  '},reason:'  Keep exact correction reasoning.  '},lookupTask=async(id:string)=>(await core.listTasks()).find(item=>item.id===id),drafts=new LearningDraftStore({directory,lookupTask}),value={initial:serializeLearningDraftJson(initial),value:serializeLearningDraftJson(raw),basis:navigationFormBasis(initial,{slot,basisMode:'explicit',basis:semanticHelperDraftBasis(extended,'typedexpectation')})};
  expect(await drafts.save(owner,slot,'initial',0,value)).toMatchObject({kind:'saved'});const sidecar=join(directory,'learning-drafts.json'),rawBefore=await readFile(sidecar);const other=await core.createTask({title:'Unrelated older-reader work'});await core.close();
  const old=await Effect.runPromise(oldRead(directory)),preserved=old.tasks.find(item=>item.id===task.id)!.session!.moduleStates[0].state;expect(preserved).toEqual(extended);old.tasks.find(item=>item.id===other.id)!.goal='Unrelated old-reader task update.';await Effect.runPromise(oldWrite(directory,old));expect(await readFile(sidecar)).toEqual(rawBefore);
  core=await createCompanion({dataDir:directory});expect((await state())).toEqual(extended);expect((await core.getTask(other.id)).goal).toBe('Unrelated old-reader task update.');
  const olderDrafts=new OldDraftStore({directory,lookupTask});const oldRaw=await olderDrafts.read();expect(oldRaw.kind).toBe('available');if(oldRaw.kind!=='available')throw Error('Small generic raw must remain readable');expect(oldRaw.records.find(item=>learningDraftKey(item.owner,item.slot)===learningDraftKey(owner,slot))?.value).toEqual(value);
  await expect(olderDrafts.save(owner,slot,'initial',1,value)).rejects.toThrow(/no longer available/);expect(await readFile(sidecar)).toEqual(rawBefore);
  const joined=await core.saveArtifact(other.id,{title:'Unrelated join practice',mimeType:MODULE_MIME,content:JSON.stringify({schemaVersion:1,markdown:'Unrelated join.',modules:[{id:'join',version:1,data:exampleLesson,provenance:[]}]})}),joinOwner={taskId:other.id,artifactId:joined.artifactId,artifactRevision:1,artifactDigest:joined.revision.digest,moduleId:'join',moduleVersion:1};expect(await olderDrafts.save(joinOwner,'prediction','initial',0,{initial:'""',value:'"2"',basis:'older-join'})).toMatchObject({kind:'saved'});
  const after=await new LearningDraftStore({directory,lookupTask}).read();expect(after.kind).toBe('available');if(after.kind!=='available')throw Error('Current raw sidecar must remain readable');expect(after.records.find(item=>learningDraftKey(item.owner,item.slot)===learningDraftKey(owner,slot))?.value).toEqual(value);expect(after.records.some(item=>'taskId' in item.owner&&item.owner.taskId===other.id&&item.slot==='prediction')).toBe(true);expect(await state()).toEqual(extended);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
