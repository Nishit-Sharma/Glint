import {Effect} from 'effect';
import {expect,test} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {privateRecordedHelpers} from './recorded-text-privacy.fixture';
import {helperStudio as baselineHelper} from './fixtures/recorded-text-baseline272/src/learning/reusable-helper';
import {readState as baselineRead,writeState as baselineWrite} from './fixtures/recorded-text-baseline272/src/core/store';
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

test('exact 272737c helper refuses new receipt editing while its opaque store preserves task/artifact bytes through unrelated writes; older sidecar preserves raw forms',async()=>{
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
  const old=await Effect.runPromise(baselineRead(directory)),originalTask=old.tasks.find(item=>item.id===f.taskId)!;expect(originalTask).toEqual(before);const ledger=[...old.usedRequestIds];old.tasks.find(item=>item.id===other.id)!.goal='Unrelated exact-baseline write';await Effect.runPromise(baselineWrite(directory,old));expect((await Effect.runPromise(baselineRead(directory))).usedRequestIds).toEqual(ledger);expect((await Effect.runPromise(baselineRead(directory))).tasks.find(item=>item.id===f.taskId)).toEqual(before);expect(await readFile(join(directory,'learning-drafts.json'))).toEqual(rawBefore);
  const older=new OlderSidecar({directory,lookupTask:oldTaskLookup(directory)}),oldRaw=await older.read();expect(oldRaw.kind).toBe('available');if(oldRaw.kind!=='available')throw Error();for(const [expectedOwner,expectedSlot,expectedValue] of [[f.owner,textSlot,textValue],[owner,slot,value]] as const)expect(oldRaw.records.find(item=>learningDraftKey(item.owner,item.slot)===learningDraftKey(expectedOwner,expectedSlot))?.value).toEqual(expectedValue);
  await expect(older.save(f.owner,textSlot,'initial',1,textValue)).rejects.toThrow(/no longer available/);await expect(older.save(owner,slot,'initial',1,value)).rejects.toThrow(/no longer available/);expect(await readFile(join(directory,'learning-drafts.json'))).toEqual(rawBefore);expect(await older.save(joinOwner,'prediction','initial',0,{initial:'""',value:'"2"',basis:'older unrelated form'})).toMatchObject({kind:'saved'});
  core=await createCompanion({dataDir:directory});expect(await core.getTask(f.taskId)).toEqual({...before,session:{...before.session!,revision:before.session!.revision+1}});expect((await core.getTask(other.id)).goal).toBe('Unrelated exact-baseline write');const reopened=await new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(item=>item.id===id)}).read();expect(reopened.kind).toBe('available');if(reopened.kind!=='available')throw Error();for(const [expectedOwner,expectedSlot,expectedValue] of [[f.owner,textSlot,textValue],[owner,slot,value]] as const)expect(reopened.records.find(item=>learningDraftKey(item.owner,item.slot)===learningDraftKey(expectedOwner,expectedSlot))?.value).toEqual(expectedValue);expect(reopened.records.some(item=>learningDraftKey(item.owner,item.slot)===learningDraftKey(joinOwner,'prediction'))).toBe(true);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
