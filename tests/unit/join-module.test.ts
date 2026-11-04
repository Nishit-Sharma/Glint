import { expect, test } from 'vitest';
import { parseModule, initialModuleState, updateModuleState, moduleText } from '../../src/core/interactive-modules';
import { exampleLesson } from '../../src/learning/example';
import { joinLab } from '../../src/learning/join-lab';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {editModule} from '../../src/core/module-state';

test('installed join module checks duplicates, preserves source and renders a readable result', () => {
  const data = parseModule(exampleLesson);
  let state = initialModuleState(data);
  state = updateModuleState(data, state, {kind:'edit-row', side:'left', rowId:'practice-b', values:['x','blue'], expectedRevision:0});
  state = updateModuleState(data, state, {kind:'predict', count:2, reasoning:'one row per member', expectedRevision:1});
  expect(joinLab.observe(data, state).observation?.rows.map(row=>row.id)).toEqual(['practice-a:practice-r1','practice-a:practice-r2','practice-b:practice-r1','practice-b:practice-r2']);
  expect(moduleText(data, state)).toContain('actual count is 4');
});

test('cosmetic edits do not unlock transfer and undo requires a new prediction', () => {
  let state = joinLab.update(exampleLesson, joinLab.initial(exampleLesson), {kind:'edit-row',side:'left',rowId:'practice-b',values:['y','green'],expectedRevision:0});
  state = joinLab.update(exampleLesson,state,{kind:'predict',count:2,reasoning:'',expectedRevision:1});
  expect(()=>joinLab.update(exampleLesson,state,{kind:'start-transfer',expectedRevision:2})).toThrow(/relationship/);
  state=joinLab.update(exampleLesson,state,{kind:'undo-practice',expectedRevision:2});
  expect(state.revision).toBe(3);
  expect(state.practice).toEqual(exampleLesson.practice);
  expect(joinLab.observe(exampleLesson,state).assessment).toBeNull();
});

test('the existing module.edit sequence persists computed feedback and distinct transfer across core recreation',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'teaching-join-'));
 let core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Owned SQL teaching'}),content=JSON.stringify({schemaVersion:1,markdown:'Predict, change a relationship, then try the separate case.',modules:[{id:'j',version:1,data:exampleLesson,provenance:[]}]}),saved=await core.saveArtifact(task.id,{title:exampleLesson.title,content,mimeType:'application/vnd.window-companion.modules+json'}),target={taskId:task.id,artifactId:saved.artifactId,artifactRevision:1,moduleId:'j'},original=(await core.getTask(task.id)).artifacts;
  await expect(editModule(core,{...target,action:{kind:'start-transfer',expectedRevision:0}})).rejects.toThrow();
  await editModule(core,{...target,action:{kind:'edit-row',side:'left',rowId:'practice-b',values:['x','blue'],expectedRevision:0}});
  const predicted=await editModule(core,{...target,action:{kind:'predict',count:2,reasoning:'One match for each member.',expectedRevision:1}});
  expect(joinLab.observe(exampleLesson,predicted.moduleStates[0].state).assessment).toMatchObject({actualCount:4,correct:false});
  expect(moduleText(exampleLesson,predicted.moduleStates[0].state)).toContain('actual count is 4');
  await core.close();core=await createCompanion({dataDir:directory});
  expect((await core.getTask(task.id)).session?.moduleStates).toEqual(predicted.moduleStates);
  await expect(editModule(core,{...target,action:{kind:'start-transfer',expectedRevision:1}})).rejects.toThrow(/changed|revision/i);
  const transfer=await editModule(core,{...target,action:{kind:'start-transfer',expectedRevision:2}});
  expect(joinLab.observe(exampleLesson,transfer.moduleStates[0].state).observation).toBeNull();
  const answered=await editModule(core,{...target,action:{kind:'predict',count:6,reasoning:'Four duplicate matches and two unmatched rows.',expectedRevision:3}});
  expect(joinLab.observe(exampleLesson,answered.moduleStates[0].state).assessment).toMatchObject({actualCount:6,correct:true});
  await core.close();core=await createCompanion({dataDir:directory});
  const reopened=await core.getTask(task.id);
  expect(reopened.session?.moduleStates).toEqual(answered.moduleStates);
  expect(reopened.artifacts).toEqual(original);
  expect(reopened.artifacts[0].revisions[0].content).toBe(content);
  expect(reopened.requests).toHaveLength(0);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
