import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
import {createCompanion} from '../../src/core/companion';
import {editModule,saveModuleDocument} from '../../src/core/module-state';
import {exampleLesson} from '../../src/learning/example';
import {helperExample} from '../../src/learning/helper-example';
import {joinLab} from '../../src/learning/join-lab';
import {helperStudio,type HelperAction} from '../../src/learning/reusable-helper';

test('installed lessons and executable helper versions persist in the same atomic task store and survive restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'companion-learning-'));
 let core=await createCompanion({dataDir:root});
 try{
  const task=await core.createTask({title:'Synthetic learning journey'});
  const artifact=await core.saveArtifact(task.id,{title:'Learning examples',mimeType:'application/vnd.window-companion.modules+json',content:JSON.stringify({schemaVersion:1,markdown:'Explicit synthetic practice and local text helper.',modules:[{id:'join',version:1,data:exampleLesson,provenance:[]},{id:'helper',version:1,data:helperExample,provenance:[]}]})});
  const target={taskId:task.id,artifactId:artifact.artifactId,artifactRevision:1};
  await editModule(core,{...target,moduleId:'join',action:{kind:'edit-row',side:'left',rowId:'practice-b',values:['x','blue'],expectedRevision:0}});
  await editModule(core,{...target,moduleId:'join',action:{kind:'predict',count:2,reasoning:'One row per member',expectedRevision:1}});
  let revision=0;
  const act=async(action:HelperAction)=>{await editModule(core,{...target,moduleId:'helper',action});revision++;};
  await act({kind:'start-demonstration',input:' Dock ',expectedRevision:revision});
  await act({kind:'demonstrate-step',operation:{kind:'trim'},expectedRevision:revision});
  await act({kind:'finish-demonstration',expectedRevision:revision});
  await act({kind:'add-test',test:{id:'empty',label:'Empty input',role:'counterexample',input:'',expected:{kind:'output',text:''}},expectedRevision:revision});
  await act({kind:'save-version',changeNote:'Tested trim demonstration',expectedRevision:revision});
  await act({kind:'activate-version',version:1,expectedRevision:revision});
  await act({kind:'run-active',input:' New dock ',expectedRevision:revision});
  const before=await core.getTask(task.id);
  await core.close();core=await createCompanion({dataDir:root});
  const restored=await core.getTask(task.id),states=restored.session?.moduleStates??[];
  expect(restored.artifacts).toEqual(before.artifacts);
  const joinState=joinLab.parseState(exampleLesson,states.find(s=>s.moduleId==='join')?.state);
  expect(joinLab.observe(exampleLesson,joinState).assessment).toMatchObject({actualCount:4,correct:false});
  const helper=helperStudio.parseState(helperExample,states.find(s=>s.moduleId==='helper')?.state);
  expect(helper).toMatchObject({activeVersion:1,lastRun:{version:1,input:' New dock ',result:{kind:'output',text:'New dock'}}});
  expect(restored.actions).toEqual([]);
  await editModule(core,{...target,moduleId:'join',action:{kind:'undo-practice',expectedRevision:2}});
  const afterUndo=await core.getTask(task.id);
  expect(joinLab.parseState(exampleLesson,afterUndo.session?.moduleStates.find(s=>s.moduleId==='join')?.state).practice).toEqual(exampleLesson.practice);
  await expect(editModule(core,{...target,moduleId:'helper',action:{kind:'run-active',input:'late',expectedRevision:0}})).rejects.toThrow(/changed/);
  const notes=await saveModuleDocument(core,{...target,sessionRevision:afterUndo.session!.revision});
  const saved=(await core.getTask(task.id)).artifacts.find(a=>a.id===notes.artifactId)?.revisions.at(-1)?.content;
  expect(saved).toContain('Predict the result count');expect(saved).toContain('Active version: 1');
 } finally{await core.close();await rm(root,{recursive:true,force:true});}
});
