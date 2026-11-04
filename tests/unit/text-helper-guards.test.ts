import {currentAnswerOrigin} from '../support/current-answer-origin.fixture';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {createCompanion,type Companion} from '../../src/core/companion';
import {editModule,saveModuleDocument} from '../../src/core/module-state';
import {helperExample} from '../../src/learning/helper-example';
import {helperStudio,type HelperAction} from '../../src/learning/reusable-helper';
import {localWorkflow} from '../../src/core/workflow-lab-host';
import {workflowExample} from '../../src/learning/workflow-example';
import {MODULE_MIME} from '../../src/shared/module-contract';

let root:string,core:Companion;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'text-helper-guards-'));core=await createCompanion({dataDir:root});});
afterEach(async()=>{vi.restoreAllMocks();await core.close();await rm(root,{recursive:true,force:true});});

async function fixture(){
 const task=await core.createTask({title:'Owned helper guard fixture'});
 const artifact=await currentAnswerOrigin(core,task.id,'helper-original',{title:'Text helper',mimeType:MODULE_MIME,content:JSON.stringify({schemaVersion:1,markdown:'Local pasted-text helper.',modules:[{id:'helper',version:1,data:helperExample,provenance:[]}]})},[]);
 const target={taskId:task.id,artifactId:artifact.artifactId,artifactRevision:1,moduleId:'helper'};
 async function act(action:HelperAction){return editModule(core,{...target,action});}
 async function notes(){const current=await core.getTask(task.id);return saveModuleDocument(core,{...target,sessionRevision:current.session?.revision??0});}
 return {taskId:task.id,artifact,target,act,notes};
}
async function savedVersion(f:Awaited<ReturnType<typeof fixture>>){
 await f.act({kind:'append-operation',operation:{kind:'trim'},expectedRevision:0});
 await f.act({kind:'add-test',test:{id:'ordinary',label:'Trim edges',role:'example',input:' Dock ',expected:{kind:'output',text:'Dock'}},expectedRevision:1});
 await f.act({kind:'add-test',test:{id:'empty',label:'Empty input stays empty',role:'counterexample',input:'',expected:{kind:'output',text:''}},expectedRevision:2});
 await f.act({kind:'save-version',changeNote:'Tested trim',expectedRevision:3});
}

test('helper edit rejects an artifact replaced between read and atomic state commit',async()=>{
 const f=await fixture(),replaceSession=core.replaceSession.bind(core);
 // This is the public core boundary; ordinary product raw-module revision remains blocked.
 vi.spyOn(core,'replaceSession').mockImplementationOnce(async(...args)=>{
  await core.saveArtifact(f.taskId,{artifactId:f.artifact.artifactId,expectedRevision:1,title:'Changed helper artifact',content:'New ordinary document',sourceRefs:[]});
  expect((await core.getTask(f.taskId)).session?.revision??0).toBe(0);
  return replaceSession(...args);
 });
 await expect(f.act({kind:'append-operation',operation:{kind:'trim'},expectedRevision:0})).rejects.toThrow(/artifact changed/i);
 const current=await core.getTask(f.taskId);
 expect(current.artifacts[0].revisions).toHaveLength(2);
 expect(current.session?.moduleStates??[]).toEqual([]);
});

test('helper notes with no prior state reject the first edit racing the atomic save',async()=>{
 const f=await fixture(),saveModuleNotes=core.saveModuleNotes.bind(core);
 vi.spyOn(core,'saveModuleNotes').mockImplementationOnce(async(...args)=>{
  await f.act({kind:'append-operation',operation:{kind:'trim'},expectedRevision:0});
  return saveModuleNotes(...args);
 });
 await expect(f.notes()).rejects.toThrow(/answer or choices changed/i);
 const current=await core.getTask(f.taskId);
 expect(current.artifacts).toHaveLength(1);
 expect(helperStudio.parseState(helperExample,current.session!.moduleStates[0].state).draft.operations).toEqual([{kind:'trim'}]);
});

test.each([
 {label:'draft correction',action:{kind:'append-operation',operation:{kind:'uppercase'},expectedRevision:4}},
 {label:'activation',action:{kind:'activate-version',version:1,expectedRevision:4}},
 {label:'new tested version',action:{kind:'save-version',changeNote:'Second tested snapshot',expectedRevision:4}},
] satisfies {label:string;action:HelperAction}[])('helper notes reject $label racing the atomic save',async({action})=>{
 const f=await fixture();await savedVersion(f);
 const saveModuleNotes=core.saveModuleNotes.bind(core);
 vi.spyOn(core,'saveModuleNotes').mockImplementationOnce(async(...args)=>{await f.act(action);return saveModuleNotes(...args);});
 await expect(f.notes()).rejects.toThrow(/answer or choices changed/i);
 const current=await core.getTask(f.taskId);
 expect(current.artifacts).toHaveLength(1);
 expect(helperStudio.parseState(helperExample,current.session!.moduleStates[0].state).revision).toBe(5);
});

test('helper notes reject an artifact replacement racing the atomic save',async()=>{
 const f=await fixture(),saveModuleNotes=core.saveModuleNotes.bind(core);
 vi.spyOn(core,'saveModuleNotes').mockImplementationOnce(async(...args)=>{
  await core.saveArtifact(f.taskId,{artifactId:f.artifact.artifactId,expectedRevision:1,title:'Changed output',content:'Replacement document',sourceRefs:[]});
  return saveModuleNotes(...args);
 });
 await expect(f.notes()).rejects.toThrow(/answer or choices changed/i);
 const current=await core.getTask(f.taskId);
 expect(current.artifacts).toHaveLength(1);expect(current.artifacts[0].revisions).toHaveLength(2);
});

test('unchanged helper notes save and reuse the exact snapshot',async()=>{
 const f=await fixture();await savedVersion(f);
 await f.act({kind:'activate-version',version:1,expectedRevision:4});
 await f.act({kind:'run-active',input:' Fresh Dock ',expectedRevision:5});
 const first=await f.notes(),second=await f.notes();
 expect(second.artifactId).toBe(first.artifactId);
 const current=await core.getTask(f.taskId),notes=current.artifacts.find(a=>a.id===first.artifactId)!.revisions[0];
 expect(second.revision).toBe(notes.revision);expect(notes.sourceRefs).toEqual([]);expect(notes.content).toContain('Fresh Dock');
 expect(current.artifacts).toHaveLength(2);
});

test('helper and workflow notes sharing an artifact keep their guards deduplicated',async()=>{
 const f=await fixture(),workflow=localWorkflow(workflowExample);
 const artifact=await currentAnswerOrigin(core,f.taskId,'two-tools-original',{title:'Two local tools',mimeType:MODULE_MIME,content:JSON.stringify({schemaVersion:1,markdown:'Explicit local tools.',modules:[{id:'helper',version:1,data:helperExample,provenance:[]},{id:workflow.id,version:workflow.version,data:workflow,provenance:[]}]})},[]);
 const notes=await saveModuleDocument(core,{taskId:f.taskId,artifactId:artifact.artifactId,artifactRevision:1,sessionRevision:0});
 const saved=(await core.getTask(f.taskId)).artifacts.find(a=>a.id===notes.artifactId)!.revisions[0];
 expect(saved.content).toContain(helperExample.title);expect(saved.content).toContain(workflow.title);
 expect(saved.sourceRefs).toEqual([]);
});

test('identical helper notes reuse only the same exact source references',async()=>{
 const f=await fixture();
 const one=await core.putSource(f.taskId,{kind:'text',role:'fact',label:'First supplied text',content:'First supplied text'});
 const firstSource=one.sources[0],firstVersion=firstSource.versions.at(-1)!;
 const firstRefs=[{sourceId:firstSource.id,version:firstVersion.version,digest:firstVersion.digest}];
 const two=await core.putSource(f.taskId,{kind:'text',role:'fact',label:'Second supplied text',content:'Second supplied text'});
 const secondSource=two.sources[1],secondVersion=secondSource.versions.at(-1)!;
 const secondRefs=[{sourceId:secondSource.id,version:secondVersion.version,digest:secondVersion.digest}];
 const create=(sourceRefs:typeof firstRefs)=>currentAnswerOrigin(core,f.taskId,'helper-original-'+sourceRefs[0].sourceId,{title:'Identical helper',content:f.artifact.revision.content,mimeType:MODULE_MIME},sourceRefs);
 const first=await create(firstRefs),second=await create(secondRefs);
 const save=async(artifactId:string)=>{const current=await core.getTask(f.taskId);return saveModuleDocument(core,{taskId:f.taskId,artifactId,artifactRevision:1,sessionRevision:current.session?.revision??0});};
 const firstNotes=await save(first.artifactId),secondNotes=await save(second.artifactId);
 expect(firstNotes.artifactId).not.toBe(secondNotes.artifactId);
 const current=await core.getTask(f.taskId),firstSaved=current.artifacts.find(a=>a.id===firstNotes.artifactId)!.revisions[0],secondSaved=current.artifacts.find(a=>a.id===secondNotes.artifactId)!.revisions[0];
 expect(firstSaved.content).toBe(secondSaved.content);expect(firstSaved.sourceRefs).toEqual(firstRefs);expect(secondSaved.sourceRefs).toEqual(secondRefs);
 expect(await save(second.artifactId)).toEqual({artifactId:secondNotes.artifactId,revision:secondSaved.revision});
});
