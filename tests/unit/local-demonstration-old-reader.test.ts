import {expect,test} from 'vitest';
import {Effect} from 'effect';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {localDemonstrationFixture,demoStart,demoSteps} from '../support/local-demonstration.fixture';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {LearningDraftStore as OlderSidecar} from '../fixtures/a91/src/host/learning-drafts';
import {readState as oldRead} from '../fixtures/a91/src/core/store';
import {expectPinnedReaderRefusal} from '../support/pinned-reader-refusal.fixture';
import {oldTaskLookup} from '../support/pinned-old-task-lookup';
import {navigationFormBasis} from '../../src/renderer/src/learning-draft-basis';
import {semanticHelperDraftBasis} from '../../src/renderer/src/semantic-helper-draft-basis';
import {serializeLearningDraftJson} from '../../src/shared/learning-drafts';
import {exampleLesson} from '../../src/learning/example';
import {MODULE_MIME} from '../../src/shared/module-contract';
import {createCompanion} from '../../src/core/companion';
// Refusal contract: the old unrelated task write and the old sidecar's unrelated join-form save can no longer happen; both pinned readers fail closed with every byte unchanged.
test('pinned old task and sidecar readers refuse the provenance-bearing store with workspace and unapplied action bytes unchanged, and refuse action-draft editing',async()=>{
 const f=await localDemonstrationFixture();
 try{
  await f.act(demoStart);const state=await f.act({kind:'perform-semantic-demonstration-step',stage:demoSteps[0]}),{helperId:_helperId,...owner}=f.owner;
  const store=new LearningDraftStore({directory:f.directory,lookupTask:async id=>(await f.core.listTasks()).find(task=>task.id===id)}),slot='helper:semantic:demonstrationstep',initial={stageText:JSON.stringify(demoSteps[1])},raw={stageText:JSON.stringify({...demoSteps[1],label:'  PRIVATE UNSENT ACTION  '})},value={initial:serializeLearningDraftJson(initial),value:serializeLearningDraftJson(raw),basis:navigationFormBasis(initial,{slot,basisMode:'explicit',basis:semanticHelperDraftBasis(state,'demonstrationstep')})};expect(await store.save(owner,slot,'initial',0,value)).toMatchObject({kind:'saved'});
  const other=await f.core.createTask({title:'Unrelated old-reader task'}),artifact=await f.core.saveArtifact(other.id,{title:'Unrelated join',mimeType:MODULE_MIME,content:JSON.stringify({schemaVersion:1,markdown:'Unrelated join.',modules:[{id:'join',version:1,data:exampleLesson,provenance:[]}]})}),joinOwner={taskId:other.id,artifactId:artifact.artifactId,artifactRevision:1,artifactDigest:artifact.revision.digest,moduleId:'join',moduleVersion:1};const before=await f.core.getTask(owner.taskId),sidecarBefore=await readFile(join(f.directory,'learning-drafts.json'));await f.core.close();
  await expectPinnedReaderRefusal(f.directory,()=>Effect.runPromise(oldRead(f.directory)));expect(await readFile(join(f.directory,'learning-drafts.json'))).toEqual(sidecarBefore);
  const older=new OlderSidecar({directory:f.directory,lookupTask:oldTaskLookup(f.directory)});expect((await older.read()).kind).toBe('unavailable');await expect(older.save(owner,slot,'initial',1,value)).rejects.toThrow();await expect(older.save(joinOwner,'prediction','initial',0,{initial:'""',value:'"2"',basis:'old unrelated prediction'})).rejects.toThrow();expect(await readFile(join(f.directory,'learning-drafts.json'))).toEqual(sidecarBefore);
  const reopened=await createCompanion({dataDir:f.directory});try{const task=await reopened.getTask(owner.taskId);expect(task.artifacts).toEqual(before.artifacts);expect(task.requests).toEqual(before.requests);expect(task.session!.moduleStates).toEqual(before.session!.moduleStates);expect(task.session!.moduleStates[0].state).toEqual(state);expect((await reopened.getTask(other.id)).artifacts.map(item=>item.id)).toEqual([artifact.artifactId]);const drafts=await new LearningDraftStore({directory:f.directory,lookupTask:async id=>(await reopened.listTasks()).find(task=>task.id===id)}).read();if(drafts.kind!=='available')throw Error();expect(drafts.records.find(item=>item.slot===slot)?.value).toEqual(value);expect(drafts.records.some(item=>'taskId' in item.owner&&item.owner.taskId===other.id)).toBe(false);}finally{await reopened.close();}
 }finally{await f.close();}
});
