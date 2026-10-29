import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
import {createCompanion} from '../src/core/companion';
import {createTextHelper} from '../src/core/text-helper-host';
import {editModule} from '../src/core/module-state';
import {parseModuleAnswer} from '../src/core/interactive-modules';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {serializeLearningDraftJson,type LearningDraftOwner} from '../src/shared/learning-drafts';
import {exampleLesson} from '../src/learning/example';
import {MODULE_MIME} from '../src/shared/module-contract';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {LearningDraftStore as OldDraftStore} from './fixtures/a91/src/host/learning-drafts';

test('helper raw slots require an exact helper owner and remain inspectable across modes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'helper-draft-owner-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Owned local helper'}),created=await createTextHelper(core,{taskId:task.id,requestId:'create-helper'}),artifact=created.task.artifacts.find(item=>item.id===created.artifactId)!;
  const revision=artifact.revisions[0],module=parseModuleAnswer(JSON.parse(revision.content)).modules[0];
  const owner:LearningDraftOwner={taskId:task.id,artifactId:artifact.id,artifactRevision:revision.revision,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version};
  const store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(item=>item.id===id)});
  const value={initial:serializeLearningDraftJson({editingTest:null,input:''}),value:serializeLearningDraftJson({editingTest:'test-1',input:'  raw  '}),basis:'legacy-check'};
  expect(await store.save(owner,'helper:text:check','initial',0,value)).toMatchObject({kind:'saved'});
  expect(await store.save(owner,'helper:semantic:steps','initial',0,value)).toMatchObject({kind:'saved'});
  await expect(store.save(owner,'helper:text:unknown','initial',0,value)).rejects.toThrow(/no longer available/);
  for(const changed of [{taskId:'other'},{artifactId:'other'},{artifactDigest:'other'},{moduleId:'other'},{moduleVersion:2}])await expect(store.save({...owner,...changed},'helper:text:check','initial',0,value)).rejects.toThrow(/no longer available/);
  await editModule(core,{taskId:task.id,artifactId:artifact.id,artifactRevision:revision.revision,moduleId:module.id,action:{kind:'begin-semantic-helper',expectedRevision:0}});
  expect(await store.save(owner,'helper:text:check','initial',1,value)).toMatchObject({kind:'saved'});
  const read=await store.read();if(read.kind!=='available')throw Error('Expected readable helper drafts.');
  expect(read.records.find(record=>record.slot==='helper:text:check')).toMatchObject({value});expect(read.records.find(record=>record.slot==='helper:semantic:steps')).toMatchObject({value});
  expect(await store.save(owner,'helper:text:check','initial',2,null)).toMatchObject({kind:'saved',record:{value:null}});
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('a first in-flight old-mode write and its newer generation survive a mode change',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'helper-draft-mode-race-')),core=await createCompanion({dataDir:directory});
 let release:()=>void=()=>{},entered:()=>void=()=>{};const held=new Promise<void>(done=>{release=done;}),atRecheck=new Promise<void>(done=>{entered=done;});
 try{
  const task=await core.createTask({title:'Owned helper'}),created=await createTextHelper(core,{taskId:task.id,requestId:'create'}),artifact=created.task.artifacts.find(item=>item.id===created.artifactId)!;
  const revision=artifact.revisions[0],module=parseModuleAnswer(JSON.parse(revision.content)).modules[0],owner:LearningDraftOwner={taskId:task.id,artifactId:artifact.id,artifactRevision:1,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version};
  let lookups=0;const store=new LearningDraftStore({directory,lookupTask:async id=>{if(++lookups===2){entered();await held;}return (await core.listTasks()).find(item=>item.id===id);}});
  const cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await cache.load();
  const initial={name:''};expect(cache.edit(owner,'helper:text:details',initial,'text-details',()=>({name:'first generation'}))).toBe(true);
  await atRecheck;expect(cache.edit(owner,'helper:text:details',initial,'text-details',()=>({name:'  newer unsent  '}))).toBe(true);
  await editModule(core,{taskId:task.id,artifactId:artifact.id,artifactRevision:1,moduleId:module.id,action:{kind:'begin-semantic-helper',expectedRevision:0}});release();
  await cache.flush();const reopened=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await reopened.load();
  expect(reopened.readForm(owner,'helper:text:details',initial,'text-details')).toMatchObject({status:'ready',value:{name:'  newer unsent  '}});
  expect(reopened.readForm(owner,'helper:semantic:steps',initial,'semantic-steps')).toMatchObject({status:'ready',value:initial});
  expect(reopened.getSnapshot().error).toBeUndefined();
 }finally{release();await core.close();await rm(directory,{recursive:true,force:true});}
});

test('a non-helper owner cannot write a helper slot',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'foreign-helper-draft-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Join owner'}),artifact=await core.saveArtifact(task.id,{title:'Join',mimeType:MODULE_MIME,sourceRefs:[],content:JSON.stringify({schemaVersion:1,markdown:'Join.',modules:[{id:'join',version:1,data:exampleLesson,provenance:[]}]})});
  const owner:LearningDraftOwner={taskId:task.id,artifactId:artifact.artifactId,artifactRevision:artifact.revision.revision,artifactDigest:artifact.revision.digest,moduleId:'join',moduleVersion:1};
  const store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(item=>item.id===id)});
  await expect(store.save(owner,'helper:text:details','initial',0,{initial:'""',value:'"raw"',basis:'v1'})).rejects.toThrow(/no longer available/);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('artifact replacement and task deletion fence helper writes while preserving reviewable bytes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'helper-draft-removal-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Helper owner'}),created=await createTextHelper(core,{taskId:task.id,requestId:'create'}),artifact=created.task.artifacts.find(item=>item.id===created.artifactId)!,revision=artifact.revisions[0],module=parseModuleAnswer(JSON.parse(revision.content)).modules[0];
  const owner:LearningDraftOwner={taskId:task.id,artifactId:artifact.id,artifactRevision:1,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version};
  const store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(item=>item.id===id)}),value={initial:'""',value:'"  retained  "',basis:'text'};
  await store.save(owner,'helper:text:run','initial',0,value);
  await core.saveArtifact(task.id,{artifactId:artifact.id,expectedRevision:1,title:'Replacement',content:'Replaced document.',sourceRefs:[]});
  await expect(store.save(owner,'helper:text:run','initial',1,value)).rejects.toThrow(/no longer available/);
  expect(await store.read()).toMatchObject({kind:'available',records:[{owner,value}]});
  await core.deleteTask(task.id);await expect(store.save(owner,'helper:text:run','initial',1,value)).rejects.toThrow(/no longer available/);
  expect(await store.read()).toMatchObject({kind:'available',records:[],cleanup:'needed'});
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('pinned old sidecar reads helper raw fields and preserves them through an unrelated old write',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'helper-draft-old-reader-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Helper owner'}),created=await createTextHelper(core,{taskId:task.id,requestId:'create'}),helper=created.task.artifacts.find(item=>item.id===created.artifactId)!,revision=helper.revisions[0],module=parseModuleAnswer(JSON.parse(revision.content)).modules[0];
  const owner:LearningDraftOwner={taskId:task.id,artifactId:helper.id,artifactRevision:1,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version},lookupTask=async(id:string)=>(await core.listTasks()).find(item=>item.id===id);
  const current=new LearningDraftStore({directory,lookupTask}),value={initial:'""',value:'"  old reader keeps this  "',basis:'text'};
  await current.save(owner,'helper:text:run','initial',0,value);
  const joinTask=await core.createTask({title:'Join owner'}),joined=await core.saveArtifact(joinTask.id,{title:'Join',mimeType:MODULE_MIME,sourceRefs:[],content:JSON.stringify({schemaVersion:1,markdown:'Join.',modules:[{id:'join',version:1,data:exampleLesson,provenance:[]}]})});
  const joinOwner:LearningDraftOwner={taskId:joinTask.id,artifactId:joined.artifactId,artifactRevision:joined.revision.revision,artifactDigest:joined.revision.digest,moduleId:'join',moduleVersion:1};
  const old=new OldDraftStore({directory,lookupTask});const prior=await old.read();expect(prior.kind==='available'&&prior.records.some(record=>record.slot==='helper:text:run'&&record.value?.value===value.value)).toBe(true);
  await old.save(joinOwner,'prediction','initial',0,{initial:'""',value:'"0"',basis:'join'});
  const reopened=await current.read();expect(reopened.kind==='available'&&reopened.records.some(record=>record.slot==='helper:text:run'&&record.value?.value===value.value)).toBe(true);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
