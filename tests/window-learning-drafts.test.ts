import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
import {createCompanion} from '../src/core/companion';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {learningDraftKey,parseLearningDraftOwner,serializeLearningDraftJson} from '../src/shared/learning-drafts';

test('an exact saved brief owns raw review edits without a fabricated module, and old module keys remain stable',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'window-review-draft-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Owned synthetic image-learning review'});
  const saved=await core.saveArtifact(task.id,{title:'Saved brief',mimeType:'application/json',content:JSON.stringify({schemaVersion:1,kind:'screen-brief',insight:'An owned state diagram.',actions:[]})});
  const owner=parseLearningDraftOwner({kind:'window-workflow-review',taskId:task.id,artifactId:saved.artifactId,artifactRevision:1,artifactDigest:saved.revision.digest});
  if(!('kind' in owner)||owner.kind!=='window-workflow-review')throw Error('Expected window review owner.');
  expect(learningDraftKey(owner,'review')).toContain('window-workflow-review');
  const store=new LearningDraftStore({directory,lookupTask:id=>core.getTask(id).catch(()=>undefined)}),raw={initial:serializeLearningDraftJson({text:''}),value:serializeLearningDraftJson({text:'Corrected quote'}),basis:'exact candidate pending'};
  expect(await store.save(owner,'review','initial',0,raw)).toMatchObject({kind:'saved',record:{owner,value:raw}});
  const reopened=new LearningDraftStore({directory,lookupTask:id=>core.getTask(id).catch(()=>undefined)});
  expect(await reopened.read()).toMatchObject({kind:'available',records:[{owner,value:raw}]});
  await expect(store.save({...owner,artifactDigest:'forged'},'review','initial',0,raw)).rejects.toThrow('no longer available');
  const old={taskId:'t',artifactId:'a',artifactRevision:1,artifactDigest:'d',moduleId:'m',moduleVersion:1};
  expect(learningDraftKey(parseLearningDraftOwner(old),'s')).toBe('["t","a",1,"d","m",1,"s"]');
  expect(()=>parseLearningDraftOwner({...owner,moduleId:'fake',moduleVersion:1})).toThrow();
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {prepareWindowRequestIntent,startSeparateWindowAttempt} from '../src/renderer/src/window-request-intent';
test('an uncertain intent write is reconciled before dispatch and reuses one durable request identity after reopen',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'window-intent-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Synthetic intent owner'}),saved=await core.saveArtifact(task.id,{title:'Brief',mimeType:'application/json',content:JSON.stringify({schemaVersion:1,kind:'screen-brief',insight:'Owned state diagram.',actions:[]})}),owner=parseLearningDraftOwner({kind:'window-workflow-review',taskId:task.id,artifactId:saved.artifactId,artifactRevision:1,artifactDigest:saved.revision.digest});
  const store=new LearningDraftStore({directory,lookupTask:id=>core.getTask(id).catch(()=>undefined)});let loseReply=true,ids=0;
  const cache=createLearningDrafts({read:()=>store.read(),save:async(...args)=>{const result=await store.save(...args);if(loseReply){loseReply=false;throw Error('Synthetic lost sidecar reply');}return result;}});await cache.load();
  const input={cache,owner,slot:'publication',basis:'candidate-1',binding:'review-digest',newId:()=>`stable-${++ids}`,isCurrent:()=>true};
  await expect(prepareWindowRequestIntent(input)).rejects.toThrow();await cache.retry();expect(await prepareWindowRequestIntent(input)).toBe('stable-1');expect(ids).toBe(1);
  await expect(prepareWindowRequestIntent({...input,binding:'changed-review'})).rejects.toThrow('earlier input');
  await expect(startSeparateWindowAttempt({...input,readTask:()=>core.getTask(task.id)})).rejects.toThrow('unknown');
  const reopened=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await reopened.load();
  expect(await prepareWindowRequestIntent({...input,cache:reopened})).toBe('stable-1');expect(ids).toBe(1);
  reopened.setFrozen(true);await expect(prepareWindowRequestIntent({...input,cache:reopened})).rejects.toThrow();
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
