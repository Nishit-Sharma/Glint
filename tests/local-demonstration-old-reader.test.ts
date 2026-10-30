import {expect,test} from 'vitest';
import {Effect} from 'effect';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {localDemonstrationFixture,demoStart,demoSteps} from './local-demonstration.fixture';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {LearningDraftStore as OlderSidecar} from './fixtures/a91/src/host/learning-drafts';
import {readState as oldRead,writeState as oldWrite} from './fixtures/a91/src/core/store';
import {oldTaskLookup} from './pinned-old-task-lookup';
import {navigationFormBasis} from '../src/renderer/src/learning-draft-basis';
import {semanticHelperDraftBasis} from '../src/renderer/src/semantic-helper-draft-basis';
import {serializeLearningDraftJson} from '../src/shared/learning-drafts';
import {exampleLesson} from '../src/learning/example';
import {MODULE_MIME} from '../src/shared/module-contract';
import {createCompanion} from '../src/core/companion';
test('pinned old task and sidecar readers preserve workspace and unapplied action bytes during unrelated writes, and refuse action-draft editing',async()=>{
 const f=await localDemonstrationFixture();
 try{
  await f.act(demoStart);const state=await f.act({kind:'perform-semantic-demonstration-step',stage:demoSteps[0]}),{helperId:_helperId,...owner}=f.owner;
  const store=new LearningDraftStore({directory:f.directory,lookupTask:async id=>(await f.core.listTasks()).find(task=>task.id===id)}),slot='helper:semantic:demonstrationstep',initial={stageText:JSON.stringify(demoSteps[1])},raw={stageText:JSON.stringify({...demoSteps[1],label:'  PRIVATE UNSENT ACTION  '})},value={initial:serializeLearningDraftJson(initial),value:serializeLearningDraftJson(raw),basis:navigationFormBasis(initial,{slot,basisMode:'explicit',basis:semanticHelperDraftBasis(state,'demonstrationstep')})};expect(await store.save(owner,slot,'initial',0,value)).toMatchObject({kind:'saved'});
  const other=await f.core.createTask({title:'Unrelated old-reader task'}),artifact=await f.core.saveArtifact(other.id,{title:'Unrelated join',mimeType:MODULE_MIME,content:JSON.stringify({schemaVersion:1,markdown:'Unrelated join.',modules:[{id:'join',version:1,data:exampleLesson,provenance:[]}]})}),joinOwner={taskId:other.id,artifactId:artifact.artifactId,artifactRevision:1,artifactDigest:artifact.revision.digest,moduleId:'join',moduleVersion:1};const before=await f.core.getTask(owner.taskId),sidecarBefore=await readFile(join(f.directory,'learning-drafts.json'));await f.core.close();
  const old=await Effect.runPromise(oldRead(f.directory));expect(old.tasks.find(task=>task.id===owner.taskId)).toEqual(before);old.tasks.find(task=>task.id===other.id)!.goal='An unrelated old-reader edit.';await Effect.runPromise(oldWrite(f.directory,old));expect((await Effect.runPromise(oldRead(f.directory))).tasks.find(task=>task.id===owner.taskId)).toEqual(before);expect(await readFile(join(f.directory,'learning-drafts.json'))).toEqual(sidecarBefore);
  const older=new OlderSidecar({directory:f.directory,lookupTask:oldTaskLookup(f.directory)}),loaded=await older.read();if(loaded.kind!=='available')throw Error('Old sidecar must preserve unknown forms.');expect(loaded.records.find(item=>item.slot===slot)?.value).toEqual(value);await expect(older.save(owner,slot,'initial',1,value)).rejects.toThrow(/no longer available/);expect(await readFile(join(f.directory,'learning-drafts.json'))).toEqual(sidecarBefore);expect(await older.save(joinOwner,'prediction','initial',0,{initial:'""',value:'"2"',basis:'old unrelated prediction'})).toMatchObject({kind:'saved'});
  const reopened=await createCompanion({dataDir:f.directory});try{expect((await reopened.getTask(owner.taskId)).session!.moduleStates[0].state).toEqual(state);expect((await reopened.getTask(other.id)).goal).toBe('An unrelated old-reader edit.');const drafts=await new LearningDraftStore({directory:f.directory,lookupTask:async id=>(await reopened.listTasks()).find(task=>task.id===id)}).read();if(drafts.kind!=='available')throw Error();expect(drafts.records.find(item=>item.slot===slot)?.value).toEqual(value);}finally{await reopened.close();}
 }finally{await f.close();}
});
