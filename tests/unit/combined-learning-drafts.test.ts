import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
import {createCompanion} from '../../src/core/companion';
import {createTextHelper} from '../../src/core/text-helper-host';
import {parseModuleAnswer} from '../../src/core/interactive-modules';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';
import {learningDraftKey,type LearningDraftOwner} from '../../src/shared/learning-drafts';
import {MODULE_MIME} from '../../src/shared/module-contract';
import {exampleLesson} from '../../src/learning/example';

test('mixed review, helper and SQL drafts retain their owners through deleted-task cleanup and a later save',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'mixed-learning-drafts-')),core=await createCompanion({dataDir:directory});
 try{
  const helperTask=await core.createTask({title:'Disposable helper owner'}),created=await createTextHelper(core,{taskId:helperTask.id,requestId:'owned-helper-create'});
  const helper=created.task.artifacts.find(item=>item.id===created.artifactId)!,helperRevision=helper.revisions[0],helperModule=parseModuleAnswer(JSON.parse(helperRevision.content)).modules[0];
  const helperOwner:LearningDraftOwner={taskId:helperTask.id,artifactId:helper.id,artifactRevision:1,artifactDigest:helperRevision.digest,moduleId:helperModule.id,moduleVersion:helperModule.version};
  const lessonTask=await core.createTask({title:'Disposable review and SQL owner'});
  const brief=await core.saveArtifact(lessonTask.id,{title:'Owned saved brief',mimeType:'application/json',content:JSON.stringify({schemaVersion:1,kind:'screen-brief',insight:'Synthetic review ownership fixture.',actions:[]})});
  const reviewOwner:LearningDraftOwner={kind:'window-workflow-review',taskId:lessonTask.id,artifactId:brief.artifactId,artifactRevision:1,artifactDigest:brief.revision.digest};
  const joinArtifact=await core.saveArtifact(lessonTask.id,{title:'Owned join',mimeType:MODULE_MIME,sourceRefs:[],content:JSON.stringify({schemaVersion:1,markdown:'Synthetic join fixture.',modules:[{id:'owned-join',version:1,data:exampleLesson,provenance:[]}]})});
  const sqlOwner:LearningDraftOwner={taskId:lessonTask.id,artifactId:joinArtifact.artifactId,artifactRevision:1,artifactDigest:joinArtifact.revision.digest,moduleId:'owned-join',moduleVersion:1};
  const store=new LearningDraftStore({directory,lookupTask:id=>core.getTask(id).catch(()=>undefined)});
  const cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args),cleanup:()=>store.cleanup()});await cache.load();
  const initial={text:''},helperSlot='helper:text:run',reviewSlot='window-workflow:review:owned',sqlSlot='join:prediction:practice';
  expect(cache.edit(helperOwner,helperSlot,initial,'helper-basis',()=>({text:'  Helper raw input.  '}))).toBe(true);
  expect(cache.edit(reviewOwner,reviewSlot,initial,'review-basis',()=>({text:'Idle  + Start\n-> Busy'}))).toBe(true);
  expect(cache.edit(sqlOwner,sqlSlot,initial,'sql-basis',()=>({text:'0'}))).toBe(true);
  await cache.flush();const read=await store.read();expect(read.kind).toBe('available');if(read.kind!=='available')throw Error('Expected mixed draft storage.');
  expect(new Set(read.records.map(item=>learningDraftKey(item.owner,item.slot))).size).toBe(3);
  expect(read.records.find(item=>('taskId' in item.owner)&&item.owner.taskId===helperTask.id)?.owner).toEqual(helperOwner);
  const lateHelperAcknowledgement=cache.capture(helperOwner,helperSlot)!;
  await core.deleteTask(helperTask.id);cache.forgetTask(helperTask.id);await cache.cleanupDeleted();
  expect(cache.acknowledge(lateHelperAcknowledgement)).toBe(false);
  expect(cache.edit(reviewOwner,reviewSlot,initial,'review-basis',()=>({text:'  Newer reviewed quote.  '}))).toBe(true);
  expect(cache.edit(sqlOwner,sqlSlot,initial,'sql-basis',()=>({text:''}))).toBe(true);
  await cache.flush();expect(cache.getSnapshot().error).toBeUndefined();
  const reopened=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await reopened.load();
  expect(reopened.readForm(reviewOwner,reviewSlot,initial,'review-basis')).toMatchObject({status:'ready',value:{text:'  Newer reviewed quote.  '}});
  expect(reopened.readForm(sqlOwner,sqlSlot,initial,'sql-basis')).toMatchObject({status:'ready',value:{text:''}});
  const after=await store.read();expect(after.kind).toBe('available');if(after.kind!=='available')throw Error('Expected reopened mixed storage.');
  expect(after.records).toHaveLength(2);expect(after.records.every(item=>('taskId' in item.owner)&&item.owner.taskId===lessonTask.id)).toBe(true);
  expect(after.records.some(item=>('taskId' in item.owner)&&item.owner.taskId===helperTask.id)).toBe(false);
  await expect(store.save(sqlOwner,'helper:text:run',after.epoch,0,{initial:'""',value:'"foreign helper"',basis:'wrong-family'})).rejects.toThrow(/no longer available/);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
