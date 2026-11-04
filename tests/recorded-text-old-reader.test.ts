import {Effect} from 'effect';
import {expect,test} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {privateRecordedHelpers} from './recorded-text-privacy.fixture';
import {helperStudio as baselineHelper} from './fixtures/recorded-text-baseline272/src/learning/reusable-helper';
import {readState as baselineRead} from './fixtures/recorded-text-baseline272/src/core/store';
import {expectPinnedReaderRefusal} from './pinned-reader-refusal.fixture';
import {LearningDraftStore as OlderSidecar} from './fixtures/a91/src/host/learning-drafts';
import {oldTaskLookup} from './pinned-old-task-lookup';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {initialModuleState} from '../src/core/interactive-modules';
import {editModule} from '../src/core/module-state';
import {stagedDraftFromProcedure} from '../src/renderer/src/staged-semantic-procedure';
import {semanticHelper} from '../src/learning/semantic-helper';
import {legacyHelperDraftBasis} from '../src/renderer/src/legacy-helper-draft-basis';
import {semanticHelperDraftBasis} from '../src/renderer/src/semantic-helper-draft-basis';
import {navigationFormBasis} from '../src/renderer/src/learning-draft-basis';
import {serializeLearningDraftJson,learningDraftKey} from '../src/shared/learning-drafts';
import {exampleLesson} from '../src/learning/example';
import {MODULE_MIME} from '../src/shared/module-contract';

test('exact 272737c helper refuses new receipt editing; its store and the older sidecar refuse the provenance-bearing store with bytes unchanged, and current reopen keeps task, artifacts and raw forms',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'recorded-text-old-reader-'));let core=await createCompanion({dataDir:directory});
 try{
  const f=await privateRecordedHelpers(core),original=f.originalState,derivedInitial=semanticHelper.parseState(f.derivedData.id,initialModuleState(f.derivedData));
  expect(baselineHelper.initial(f.data)).toMatchObject({revision:0,recording:null});
  expect(()=>baselineHelper.parseState(f.data,original)).toThrow();expect(()=>baselineHelper.update(f.data,original,{kind:'append-operation',operation:{kind:'trim'},expectedRevision:original.revision})).toThrow();
  expect(()=>baselineHelper.initial(f.derivedData)).toThrow();expect(()=>baselineHelper.parseState(f.derivedData,derivedInitial)).toThrow();expect(()=>baselineHelper.update(f.derivedData,derivedInitial,{kind:'clear-operations',expectedRevision:derivedInitial.revision})).toThrow();
  await editModule(core,{taskId:f.taskId,artifactId:f.derived.artifactId,artifactRevision:1,moduleId:f.derivedModuleId,action:{kind:'set-semantic-evidence',rationales:[],corrections:[],examples:[],expectedRevision:0}});
  const before=await core.getTask(f.taskId),derived=semanticHelper.parseState(f.derivedData.id,before.session!.moduleStates.find(item=>item.artifactId===f.derived.artifactId)!.state),revision=before.artifacts.find(item=>item.id===f.derived.artifactId)!.revisions[0],owner={taskId:f.taskId,artifactId:f.derived.artifactId,artifactRevision:1,artifactDigest:revision.digest,moduleId:f.derivedModuleId,moduleVersion:1};
  const drafts=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(item=>item.id===id)}),textInitial={op:'trim',find:'',replacement:''},textRaw={op:'replace-literal',find:'  ORIGINAL_UNSENT_FIND  ',replacement:'  ORIGINAL_UNSENT_REPLACEMENT  '},textSlot='helper:text:operation',textValue={initial:serializeLearningDraftJson(textInitial),value:serializeLearningDraftJson(textRaw),basis:navigationFormBasis(textInitial,{slot:textSlot,basisMode:'explicit',basis:legacyHelperDraftBasis(original,'operation')})};
  const stagedInitial={definitionText:JSON.stringify(stagedDraftFromProcedure(derived.definitions[0].procedure))},stagedRaw={definitionText:stagedInitial.definitionText.replace('Apply recorded replace-literal.','  DERIVED_UNSENT_STAGE_INTENT  ')},slot='helper:semantic:stagedsteps',value={initial:serializeLearningDraftJson(stagedInitial),value:serializeLearningDraftJson(stagedRaw),basis:navigationFormBasis(stagedInitial,{slot,basisMode:'explicit',basis:semanticHelperDraftBasis(derived,'stagedsteps')})};
  expect(await drafts.save(f.owner,textSlot,'initial',0,textValue)).toMatchObject({kind:'saved'});expect(await drafts.save(owner,slot,'initial',0,value)).toMatchObject({kind:'saved'});const rawBefore=await readFile(join(directory,'learning-drafts.json'));
  const other=await core.createTask({title:'Unrelated task'}),joined=await core.saveArtifact(other.id,{title:'Unrelated join',mimeType:MODULE_MIME,content:JSON.stringify({schemaVersion:1,markdown:'Ordinary join',modules:[{id:'join',version:1,data:exampleLesson,provenance:[]}]})}),joinOwner={taskId:other.id,artifactId:joined.artifactId,artifactRevision:1,artifactDigest:joined.revision.digest,moduleId:'join',moduleVersion:1};await core.close();
  // Refusal contract: replaces the unrelated exact-baseline (272) task-store write and the older sidecar's raw-form read, edit refusal and unrelated join save; each now fails closed without changing tasks.json or learning-drafts.json.
  await expectPinnedReaderRefusal(directory,()=>Effect.runPromise(baselineRead(directory)));
  const older=new OlderSidecar({directory,lookupTask:oldTaskLookup(directory)});expect((await older.read()).kind).toBe('unavailable');
  for(const [olderOwner,olderSlot,olderValue] of [[f.owner,textSlot,textValue],[owner,slot,value],[joinOwner,'prediction',{initial:'""',value:'"2"',basis:'older unrelated form'}]] as const)await expect(older.save(olderOwner,olderSlot,'initial',0,olderValue)).rejects.toThrow(/unreadable or incompatible/);
  expect(await readFile(join(directory,'learning-drafts.json'))).toEqual(rawBefore);
  core=await createCompanion({dataDir:directory});expect(await core.getTask(f.taskId)).toEqual({...before,session:{...before.session!,revision:before.session!.revision+1}});expect((await core.getTask(other.id)).title).toBe('Unrelated task');const reopened=await new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(item=>item.id===id)}).read();expect(reopened.kind).toBe('available');if(reopened.kind!=='available')throw Error();for(const [expectedOwner,expectedSlot,expectedValue] of [[f.owner,textSlot,textValue],[owner,slot,value]] as const)expect(reopened.records.find(item=>learningDraftKey(item.owner,item.slot)===learningDraftKey(expectedOwner,expectedSlot))?.value).toEqual(expectedValue);expect(reopened.records.some(item=>learningDraftKey(item.owner,item.slot)===learningDraftKey(joinOwner,'prediction'))).toBe(false);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
