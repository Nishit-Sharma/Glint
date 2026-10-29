import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Effect} from 'effect';
import {expect,test} from 'vitest';
import {createCompanion} from '../src/core/companion';
import {createTextHelper} from '../src/core/text-helper-host';
import {editModule,saveModuleDocument} from '../src/core/module-state';
import {parseModuleAnswer} from '../src/core/interactive-modules';
import {semanticHelper} from '../src/learning/semantic-helper';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {LearningDraftStore as OldDraftStore} from './fixtures/a91/src/host/learning-drafts';
import {readState as oldRead,writeState as oldWrite} from './fixtures/a91/src/core/store';
import {moduleHistoryText as oldModuleHistoryText} from './fixtures/a91/src/core/interactive-modules';
import {semanticHelper as oldSemantic} from './fixtures/recording-expectation-source958/src/learning/semantic-helper';
import {learningDraftKey,serializeLearningDraftJson} from '../src/shared/learning-drafts';
import {semanticHelperDraftBasis} from '../src/renderer/src/semantic-helper-draft-basis';
import {navigationFormBasis} from '../src/renderer/src/learning-draft-basis';
import {exampleLesson} from '../src/learning/example';
import {MODULE_MIME} from '../src/shared/module-contract';
import {batchInput,batchProcedure,batchEvidence} from './semantic-helper-batch.fixture';

test('owned batch commits and reopens while pinned task/module/sidecar readers preserve unrelated work',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'typed-batch-'));let core=await createCompanion({dataDir:directory});try{
  const task=await core.createTask({title:'Owned generic batch'}),created=await createTextHelper(core,{taskId:task.id,requestId:'batch-create'}),artifact=created.task.artifacts.find(item=>item.id===created.artifactId)!,revision=artifact.revisions[0],module=parseModuleAnswer(JSON.parse(revision.content)).modules[0];if(module.data.kind!=='helper-studio')throw Error('Expected helper');const helperId=module.data.id,identity={taskId:task.id,artifactId:artifact.id,artifactRevision:1,moduleId:module.id};
  const state=async()=>semanticHelper.parseState(helperId,(await core.getTask(task.id)).session!.moduleStates[0].state),act=async(action:Record<string,unknown>)=>{const saved=await core.getTask(task.id);return editModule(core,{...identity,action:{...action,expectedRevision:saved.session?.moduleStates[0]?.state.revision??0} as never});};
  await act({kind:'begin-semantic-helper'});await act({kind:'set-semantic-procedure',procedure:batchProcedure()});await act({kind:'record-semantic-input',input:batchInput('TRAIN',{days:12})});await act({kind:'set-semantic-evidence',...batchEvidence((await state()).recordings[0].recordingId)});await act({kind:'save-semantic-version',changeNote:'Checked generic batch.'});await act({kind:'activate-semantic-version',version:1});const before=await state();
  await expect(editModule(core,{...identity,moduleId:'foreign',action:{kind:'run-semantic-batch',inputs:[batchInput('FRESH')],expectedVersion:1,expectedRevision:before.revision} as never})).rejects.toThrow();expect(await state()).toEqual(before);
  await act({kind:'run-semantic-batch',inputs:[batchInput('FRESH-1'),batchInput('FRESH-2',{approved:false}),batchInput('FRESH-3',{days:2000000})],expectedVersion:1});const extended=await state();expect(extended.lastBatchRun!.rows.map(row=>row.result.status)).toEqual(['completed','abstained','invalid-input']);expect(()=>oldSemantic.parseState(helperId,extended)).toThrow();
  const saved=await core.getTask(task.id),notes=await saveModuleDocument(core,{...identity,sessionRevision:saved.session!.revision});expect((await core.getTask(task.id)).artifacts.find(item=>item.id===notes.artifactId)!.revisions[0].content).toContain('Latest batch — version 1');
  const owner={taskId:task.id,artifactId:artifact.id,artifactRevision:1,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version},slot='helper:semantic:typedbatch',initial={rows:[{values:{item:'',condition:'',days:'0',approved:'false',recalled:'false'}}]},raw={rows:Array.from({length:8},(_,i)=>({values:{item:'item'+i+' '.repeat(150),condition:'working',days:'25',approved:'true',recalled:'false'}}))},lookupTask=async(id:string)=>(await core.listTasks()).find(item=>item.id===id),drafts=new LearningDraftStore({directory,lookupTask}),value={initial:serializeLearningDraftJson(initial),value:serializeLearningDraftJson(raw),basis:navigationFormBasis(initial,{slot,basisMode:'explicit',basis:semanticHelperDraftBasis(extended,'typedbatch'),variableArrays:['rows']})};expect(await drafts.save(owner,slot,'initial',0,value)).toMatchObject({kind:'saved'});
  const other=await core.createTask({title:'Unrelated older-reader work'}),joined=await core.saveArtifact(other.id,{title:'Unrelated join',mimeType:MODULE_MIME,content:JSON.stringify({schemaVersion:1,markdown:'Unrelated join.',modules:[{id:'join',version:1,data:exampleLesson,provenance:[]}]})}),joinOwner={taskId:other.id,artifactId:joined.artifactId,artifactRevision:1,artifactDigest:joined.revision.digest,moduleId:'join',moduleVersion:1};expect(await drafts.save(joinOwner,'prediction','initial',0,{initial:'""',value:'"1"',basis:'join'})).toMatchObject({kind:'saved'});const sidecar=join(directory,'learning-drafts.json'),rawBytes=await readFile(sidecar),states=(await core.getTask(task.id)).session!.moduleStates;await core.close();
  const old=await Effect.runPromise(oldRead(directory)),oldOwner=old.tasks.find(item=>item.id===task.id)!;expect(oldOwner.session!.moduleStates).toEqual(states);expect(oldModuleHistoryText(artifact.revisions[0].content,()=>oldOwner.session!.moduleStates[0].state)).toContain('needs review');old.tasks.find(item=>item.id===other.id)!.goal='Unrelated old-reader task write.';await Effect.runPromise(oldWrite(directory,old));expect(await readFile(sidecar)).toEqual(rawBytes);
  core=await createCompanion({dataDir:directory});expect(await state()).toEqual(extended);expect((await core.getTask(other.id)).goal).toBe('Unrelated old-reader task write.');const older=new OldDraftStore({directory,lookupTask}),oldRaw=await older.read();expect(oldRaw.kind).toBe('available');if(oldRaw.kind!=='available')throw Error('Hold integration: older sidecar is unavailable.');expect(oldRaw.records.find(record=>learningDraftKey(record.owner,record.slot)===learningDraftKey(owner,slot))?.value).toEqual(value);expect(oldRaw.records.find(record=>record.slot==='prediction')?.value?.value).toBe('"1"');
  await expect(older.save(owner,slot,'initial',1,value)).rejects.toThrow(/no longer available/);expect(await readFile(sidecar)).toEqual(rawBytes);expect(await older.save(joinOwner,'prediction','initial',1,{initial:'""',value:'"2"',basis:'join'})).toMatchObject({kind:'saved'});const after=await new LearningDraftStore({directory,lookupTask}).read();expect(after.kind).toBe('available');if(after.kind!=='available')throw Error('Current sidecar unavailable');expect(after.records.find(record=>learningDraftKey(record.owner,record.slot)===learningDraftKey(owner,slot))?.value).toEqual(value);expect(after.records.find(record=>record.slot==='prediction')?.value?.value).toBe('"2"');expect(await state()).toEqual(extended);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
