import {expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';
import {prepareWindowRequestIntent} from '../../src/renderer/src/window-request-intent';
import {learningDraftKey,type LearningDraftRecord} from '../../src/shared/learning-drafts';
import {publishWindowWorkflowReview} from '../../src/renderer/src/window-review-publication';
import {reviewedWindowFixture} from '../support/window-review-repair.fixture';

test.each(['intent','lookup','publication'].flatMap(phase=>['edit','mirror-edit-undo','owner','confirmation'].map(kind=>({phase,kind}))))('a completed receipt held at $phase cannot replace a $kind update',async({phase,kind})=>{
 const directory=await mkdtemp(join(tmpdir(),'review-continuation-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Owned synthetic continuation race'}),brief=await core.saveArtifact(task.id,{title:'Saved synthetic brief',mimeType:'application/json',content:'{"schemaVersion":1,"kind":"screen-brief","insight":"Owned synthetic FSM.","actions":[]}'}),candidate=await core.saveArtifact(task.id,{title:'Synthetic candidate identity',content:'Owned synthetic candidate receipt'}),candidateRef={artifactId:candidate.artifactId,revision:1,digest:candidate.revision.digest},f=reviewedWindowFixture(task.id,candidateRef);
  await core.runRequest({taskId:task.id,requestId:'completed-publication',kind:'experiment',prompt:'Synthetic prior completed review',sourceIds:[]},async()=>({title:f.data.title,mimeType:'application/vnd.window-companion.modules+json',content:JSON.stringify({schemaVersion:1,markdown:'Owned synthetic historical model.',modules:[{id:f.data.id,version:1,data:f.data,provenance:[]}]})}));
  let records:LearningDraftRecord[]=[];const cache=createLearningDrafts({read:async()=>({kind:'available',epoch:'initial',records}),save:async(owner,slot,_epoch,revision,value)=>{const record={owner,slot,revision:revision+1,value};records=records.filter(r=>learningDraftKey(r.owner,r.slot)!==learningDraftKey(owner,slot));records.push(record);return {kind:'saved',epoch:'initial',record};}});await cache.load();
  const owner={kind:'window-workflow-review' as const,taskId:task.id,artifactId:brief.artifactId,artifactRevision:1,artifactDigest:brief.revision.digest},slot='window-workflow:review:'+candidate.artifactId,initial={text:''},basis='exact candidate';cache.edit(owner,slot,initial,basis,()=>({text:'submitted review'}));await cache.flush();const generation=cache.getSnapshot().entries[learningDraftKey(owner,slot)].generation;
  let scope='owner',confirmed=true,opened=0,published=0,reads=0;let release=()=>{},reached=()=>{};const gate=new Promise<void>(resolve=>release=resolve),ready=new Promise<void>(resolve=>reached=resolve);
  const pending=publishWindowWorkflowReview({candidate:candidateRef,prepareIntent:async()=>{const id=await prepareWindowRequestIntent({cache,owner,slot:'publication',basis,binding:'submitted review',newId:()=> 'completed-publication',isCurrent:()=>true});if(phase==='intent'){reached();await gate;}return id;},readTask:async()=>{reads++;if(phase==='publication'&&reads===1)return task;if(phase==='lookup'){reached();await gate;}return core.getTask(task.id);},publish:async()=>{published++;if(phase==='publication'){reached();await gate;}},isMounted:()=>true,isCurrent:()=>scope==='owner'&&confirmed&&cache.getSnapshot().entries[learningDraftKey(owner,slot)].generation===generation,onOpen:()=>{opened++;}});
  await ready;
  if(kind==='edit'||kind==='mirror-edit-undo'){cache.edit(owner,slot,initial,basis,()=>({text:'newer mirror edit'}));if(kind==='mirror-edit-undo')cache.edit(owner,slot,initial,basis,()=>({text:'submitted review'}));}
  if(kind==='owner')scope='another owner';if(kind==='confirmation')confirmed=false;release();
  await expect(pending).rejects.toThrow('review changed');expect(opened).toBe(0);expect(published).toBe(phase==='publication'?1:0);expect(cache.readForm(owner,slot,initial,basis).value.text).toBe(kind==='edit'?'newer mirror edit':'submitted review');await cache.flush();
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
