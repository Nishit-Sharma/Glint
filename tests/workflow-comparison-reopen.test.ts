import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createCompanion} from '../src/core/companion';
import {prepareWorkflowReview,createContextualReviewedWorkflow} from '../src/core/workflow-review-host';
import {editModule,saveModuleDocument} from '../src/core/module-state';
import {parseModuleAnswer} from '../src/core/interactive-modules';
import {workflowLab} from '../src/learning/workflow-lab';
import {WorkflowLab} from '../src/renderer/src/components/WorkflowLab';
import type {WorkflowReview} from '../src/learning/workflow-review';

test('reviewed controller collision refuses, corrected practice saves its source-linked explanation and reopens without replacing artifact bytes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'workflow-comparison-'));let core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Owned finite controller'}),literal='Idle + Start -> Busy\nBusy + Ack -> Done\nBusy + Reset -> Idle',prose='When a Done controller receives Reset, it returns to Idle.';
  await core.putSource(task.id,{kind:'text',label:'Owned transitions',role:'fact',content:literal});const sourced=await core.putSource(task.id,{kind:'text',label:'Owned reset note',role:'fact',content:prose});const refs=sourced.sources.map(source=>{const v=source.versions.at(-1)!;return {sourceId:source.id,version:v.version,digest:v.digest};});
  const document=await core.saveArtifact(task.id,{title:'Owned controller source',content:'Finite sequential abstraction.',sourceRefs:refs}),basis={artifactId:document.artifactId,revision:document.revision.revision,digest:document.revision.digest},prepared=await prepareWorkflowReview(core,{taskId:task.id,basis});
  const review:WorkflowReview={rules:prepared.passages.map(p=>({...p.candidate??{from:'Done',event:'Reset',to:'Idle'},sourceId:p.sourceId,start:p.start,end:p.end,quote:p.quote,interpretation:p.candidate?'source-stated':'user-interpreted',reason:p.candidate?'Reviewed transition.':'Interpreted Reset as Idle from this note.'})),initialState:'Idle',eventSequence:['Start','Ack','Reset','Ack'],assumptions:['One event at a time.'],confirmed:true};
  const saved=await createContextualReviewedWorkflow(core,{taskId:task.id,requestId:'comparison-owned',basis,expectedSourceRefs:refs,review}),current=await core.getTask(task.id),artifact=current.artifacts.find(a=>a.id===saved.artifactId)!,original=artifact.revisions[0].content,data=parseModuleAnswer(JSON.parse(original)).modules[0].data;if(data.kind!=='workflow-lab')throw Error('Expected controller');
  const target={taskId:task.id,artifactId:artifact.id,artifactRevision:1,moduleId:data.id},id=(label:string)=>data.practice.states.find(s=>s.label===label)!.id,reset=data.practice.events.find(e=>e.label==='Reset')!.id,rule=data.practice.rules.find(r=>r.fromStateId===id('Done')&&r.eventId===reset)!.id;
  expect(data.transfer.initialStateId).toBe(id('Busy'));
  await editModule(core,{...target,action:{kind:'set-initial',initialStateId:id('Busy'),reason:'Explore alternate start.',expectedRevision:0}});
  await editModule(core,{...target,action:{kind:'predict',finalStateId:id('Idle'),blockedCount:2,reasoning:'Start blocked from Busy.',expectedRevision:1}});
  await expect(editModule(core,{...target,action:{kind:'start-transfer',expectedRevision:2}})).rejects.toThrow(/distinct held-out path/);
  let reopened=await core.getTask(task.id),state=workflowLab.parseState(data,reopened.session!.moduleStates[0].state);expect(state.revision).toBe(2);expect(workflowLab.observe(data,state).transferBlock).toBe('matching-path');expect(renderToStaticMarkup(createElement(WorkflowLab,{data,state,task:reopened,onAction:()=>{}}))).toContain('This practice path matches the separate challenge');
  await editModule(core,{...target,action:{kind:'set-initial',initialStateId:id('Idle'),reason:'Return to the source start.',expectedRevision:2}});
  await editModule(core,{...target,action:{kind:'set-rule',ruleId:rule,toStateId:id('Busy'),enabled:true,reason:'Try a hypothetical reset to Busy.',expectedRevision:3}});
  await editModule(core,{...target,action:{kind:'predict',finalStateId:id('Done'),blockedCount:0,reasoning:'Ack follows the changed reset.',expectedRevision:4}});
  await expect(editModule(core,{...target,action:{kind:'set-mode',mode:'deep',expectedRevision:4}})).rejects.toThrow(/changed/i);
  state=workflowLab.parseState(data,(await core.getTask(task.id)).session!.moduleStates[0].state);expect(state.mode).toBe('quick');
  await editModule(core,{...target,action:{kind:'set-mode',mode:'deep',expectedRevision:5}});await core.close();core=await createCompanion({dataDir:directory});reopened=await core.getTask(task.id);state=workflowLab.parseState(data,reopened.session!.moduleStates[0].state);
  expect(state.mode).toBe('deep');expect(workflowLab.observe(data,state).canStartTransfer).toBe(true);const html=renderToStaticMarkup(createElement(WorkflowLab,{data,state,task:reopened,onAction:()=>{}}));expect(html).toContain(prose);expect(html).toContain('preceding path now reaches Busy instead of Idle');expect(html).toContain('Earlier exposure is not tracked');expect(html).toContain('Try separate challenge');expect(html).not.toContain('Unseen synthetic transfer');
  const note=await saveModuleDocument(core,{taskId:task.id,artifactId:artifact.id,artifactRevision:1,sessionRevision:reopened.session!.revision}),after=await core.getTask(task.id),savedNote=after.artifacts.find(a=>a.id===note.artifactId)!.revisions.at(-1)!;expect(savedNote.sourceRefs).toEqual(refs);expect(savedNote.content).toContain(prose);expect(savedNote.content).toContain('Try a hypothetical reset to Busy.');expect(after.artifacts.find(a=>a.id===artifact.id)!.revisions[0].content).toBe(original);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
