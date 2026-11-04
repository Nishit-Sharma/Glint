import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {createCompanion,type Companion} from '../../src/core/companion';
import {createTextHelper,readTextHelperCreate} from '../../src/core/text-helper-host';
import {parseModuleAnswer} from '../../src/core/interactive-modules';
import {helperStudio} from '../../src/learning/reusable-helper';
import {MODULE_MIME} from '../../src/shared/module-contract';
import {editModule} from '../../src/core/module-state';

let directory:string,core:Companion;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'text-helper-host-'));core=await createCompanion({dataDir:directory});});
afterEach(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});

test('deliberate local creation produces a blank helper without borrowing task sources, and exact replay preserves it',async()=>{
 const owner=await core.createTask({title:'Local helper owner'});
 await core.putSource(owner.id,{kind:'text',label:'Unrelated private notes',role:'fact',content:'Do not turn these notes into a helper.'});
 const input={taskId:owner.id,requestId:'create-helper-once'};
 const first=await createTextHelper(core,input),again=await createTextHelper(core,input);
 expect(again.artifactId).toBe(first.artifactId);expect(again.revision).toBe(1);
 expect(again.task.artifacts).toHaveLength(1);expect(again.task.requests).toHaveLength(1);
 const artifact=again.task.artifacts[0],revision=artifact.revisions[0];
 expect(revision.mimeType).toBe(MODULE_MIME);expect(revision.sourceRefs).toEqual([]);
 expect(again.task.requests[0]).toMatchObject({status:'completed',sourceRefs:[],artifactId:artifact.id});
 expect(again.task.actions).toEqual([]);expect(again.task.procedures).toEqual([]);
 const answer=parseModuleAnswer(JSON.parse(revision.content)),module=answer.modules[0];
 expect(answer.modules).toHaveLength(1);expect(module.data.kind).toBe('helper-studio');
 expect(module.provenance).toEqual([]);
 expect(helperStudio.initial(module.data)).toMatchObject({draft:{operations:[],exceptions:[],tests:[]},versions:[],activeVersion:null,recording:null});
 expect(revision.content).not.toContain('Do not turn these notes into a helper.');
});

test('creation accepts only bounded owner and intent identities',async()=>{
 const owner=await core.createTask({title:'Strict entry'}),input={taskId:owner.id,requestId:'strict-create'};
 expect(readTextHelperCreate(input)).toEqual(input);
 for(const value of [null,[],{...input,definition:{}},{...input,sourceIds:[]},{...input,activeVersion:1},{...input,taskId:''},{...input,requestId:'x'.repeat(201)}]){
  expect(()=>readTextHelperCreate(value)).toThrow();
  await expect(createTextHelper(core,value)).rejects.toThrow();
 }
 expect((await core.getTask(owner.id)).requests).toEqual([]);
 expect((await core.getTask(owner.id)).artifacts).toEqual([]);
});

test('replay after helper edits and normal restart preserves the original identity and teaching state',async()=>{
 const owner=await core.createTask({title:'Restarted local helper'}),input={taskId:owner.id,requestId:'saved-intent'};
 const first=await createTextHelper(core,input),module=parseModuleAnswer(JSON.parse(first.task.artifacts[0].revisions[0].content)).modules[0];
 await editModule(core,{taskId:owner.id,artifactId:first.artifactId,artifactRevision:1,moduleId:module.id,action:{kind:'start-demonstration',input:' A ',expectedRevision:0}});
 await editModule(core,{taskId:owner.id,artifactId:first.artifactId,artifactRevision:1,moduleId:module.id,action:{kind:'demonstrate-step',operation:{kind:'trim'},expectedRevision:1}});
 const before=await core.getTask(owner.id);
 await core.close();core=await createCompanion({dataDir:directory});
 const replay=await createTextHelper(core,input);
 expect(replay.artifactId).toBe(first.artifactId);
 expect(replay.task.requests).toEqual(before.requests);expect(replay.task.artifacts).toEqual(before.artifacts);
 expect(replay.task.session?.moduleStates).toEqual(before.session?.moduleStates);
});

test('a deliberate new intent creates a separate blank helper with host-owned identities',async()=>{
 const owner=await core.createTask({title:'Two helpers'});
 const first=await createTextHelper(core,{taskId:owner.id,requestId:'first'}),second=await createTextHelper(core,{taskId:owner.id,requestId:'second'});
 const a=parseModuleAnswer(JSON.parse(first.task.artifacts[0].revisions[0].content)).modules[0],b=parseModuleAnswer(JSON.parse(second.task.artifacts[1].revisions[0].content)).modules[0];
 expect(first.artifactId).not.toBe(second.artifactId);expect(a.id).not.toBe(b.id);
 if(a.data.kind!=='helper-studio'||b.data.kind!=='helper-studio')throw Error('Expected host-owned helpers');
 expect(a.data.id).not.toBe(b.data.id);
});

test('existing ordinary requests and other tasks cannot reuse a helper intent',async()=>{
 const owner=await core.createTask({title:'First owner'}),other=await core.createTask({title:'Other owner'});
 await core.runRequest({taskId:owner.id,requestId:'ordinary',kind:'create',prompt:'An ordinary text request',sourceIds:[]},async()=>({title:'Ordinary output',content:'Plain text'}));
 await expect(createTextHelper(core,{taskId:owner.id,requestId:'ordinary'})).rejects.toThrow(/different payload/);
 await createTextHelper(core,{taskId:owner.id,requestId:'helper-intent'});
 await expect(createTextHelper(core,{taskId:other.id,requestId:'helper-intent'})).rejects.toThrow(/already used/);
 await expect(core.runRequest({taskId:owner.id,requestId:'helper-intent',kind:'create',prompt:'A changed operation',sourceIds:[]},async()=>({title:'Wrong',content:'Wrong'}))).rejects.toThrow(/different payload/);
 expect((await core.getTask(owner.id)).artifacts).toHaveLength(2);expect((await core.getTask(other.id)).artifacts).toEqual([]);
});

test('paused owners cannot create and a deleted owner is never resurrected by replay',async()=>{
 const owner=await core.createTask({title:'Lifecycle owner'}),input={taskId:owner.id,requestId:'original'};
 await createTextHelper(core,input);await core.pause(owner.id);
 await expect(createTextHelper(core,{...input,requestId:'while-paused'})).rejects.toThrow(/Resume/);
 expect((await core.getTask(owner.id)).requests).toHaveLength(1);
 await core.deleteTask(owner.id);
 await expect(createTextHelper(core,input)).rejects.toThrow(/not found/i);
 expect(await core.listTasks()).toEqual([]);
});

test('a current-work failure before admission leaves no request or helper',async()=>{
 const owner=await core.createTask({title:'Before admission'}),before=await core.getTask(owner.id),runRequest=core.runRequest.bind(core);let active=true,runnerInvoked=false;
 const spy=vi.spyOn(core,'runRequest').mockImplementation((input,runner,assertCurrent)=>{active=false;return runRequest(input,async context=>{runnerInvoked=true;return runner(context);},assertCurrent);});
 try{
  await expect(createTextHelper(core,{taskId:owner.id,requestId:'not-admitted'},()=>{if(!active)throw Error('Owned test work retired.');})).rejects.toThrow('Owned test work retired.');
  expect(runnerInvoked).toBe(false);expect(await core.getTask(owner.id)).toEqual(before);
 }finally{spy.mockRestore();}
});

test('a current-work failure at publication retains failure evidence without publishing a helper',async()=>{
 const owner=await core.createTask({title:'Publication boundary'}),runRequest=core.runRequest.bind(core);let active=true,runnerReturned=false;
 const spy=vi.spyOn(core,'runRequest').mockImplementation((input,runner,assertCurrent)=>runRequest(input,async context=>{
  const output=await runner(context);expect(output.mimeType).toBe(MODULE_MIME);
  expect((await core.getTask(owner.id)).requests.find(request=>request.id==='retired')?.status).toBe('running');runnerReturned=true;active=false;return output;
 },assertCurrent));
 try{
  await expect(createTextHelper(core,{taskId:owner.id,requestId:'retired'},()=>{if(!active)throw Error('Owned test work retired.');})).rejects.toThrow('Owned test work retired.');
  expect(runnerReturned).toBe(true);const task=await core.getTask(owner.id);
  expect(task.artifacts).toEqual([]);expect(task.requests).toHaveLength(1);expect(task.requests[0].status).toBe('cancelled');
  await expect(createTextHelper(core,{taskId:owner.id,requestId:'retired'})).rejects.toThrow('Owned test work retired.');
  expect((await core.getTask(owner.id)).requests).toEqual(task.requests);
 }finally{spy.mockRestore();}
});

test('replay rejects a changed artifact instead of silently opening another revision',async()=>{
 const owner=await core.createTask({title:'Changed artifact'}),input={taskId:owner.id,requestId:'exact-artifact'};
 const created=await createTextHelper(core,input);
 await core.saveArtifact(owner.id,{artifactId:created.artifactId,expectedRevision:1,title:'Changed through the core seam',content:'Ordinary text',sourceRefs:[]});
 await expect(createTextHelper(core,input)).rejects.toThrow(/saved text helper changed/);
 expect((await core.getTask(owner.id)).artifacts).toHaveLength(1);
});
