import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
import {createCompanion} from '../src/core/companion';
import {prepareWorkflowReview,createContextualReviewedWorkflow} from '../src/core/workflow-review-host';
import {editModule,saveModuleDocument} from '../src/core/module-state';
import {parseModuleAnswer} from '../src/core/interactive-modules';
import {workflowLab,type WorkflowAction} from '../src/learning/workflow-lab';
import type {WorkflowReview} from '../src/learning/workflow-review';

type InputAction={[Kind in WorkflowAction['kind']]:Omit<Extract<WorkflowAction,{kind:Kind}>,'expectedRevision'>}[WorkflowAction['kind']];

test('actual reviewed admission and notes save retain the first attempt after newer practice and core reopen while stale source still refuses save',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'owned-causal-notes-'));
 let core=await createCompanion({dataDir:directory});
 try{
  const created=await core.createTask({title:'Owned synthetic hardware notes'});
  const literal='Idle + Start -> Busy\nBusy + Ack -> Done\nBusy + Reset -> Idle',prose='When a Done controller receives Reset, it returns to Idle.';
  await core.putSource(created.id,{kind:'text',label:'Owned literal transitions',role:'fact',content:literal});
  const sourced=await core.putSource(created.id,{kind:'text',label:'Owned reset interpretation',role:'fact',content:prose});
  const refs=sourced.sources.map(source=>{const version=source.versions.at(-1)!;return {sourceId:source.id,version:version.version,digest:version.digest};});
  const document=await core.saveArtifact(created.id,{title:'Owned finite controller basis',content:'A user-defined finite sequential abstraction, not HDL simulation.',sourceRefs:refs});
  const basis={artifactId:document.artifactId,revision:document.revision.revision,digest:document.revision.digest};
  const prepared=await prepareWorkflowReview(core,{taskId:created.id,basis});
  const review:WorkflowReview={rules:prepared.passages.map(passage=>({...passage.candidate??{from:'Done',event:'Reset',to:'Idle'},sourceId:passage.sourceId,start:passage.start,end:passage.end,quote:passage.quote,interpretation:passage.candidate?'source-stated':'user-interpreted',reason:passage.candidate?'Reviewed literal transition.':'I corrected the reset destination to Idle after rereading this exact prose.'})),initialState:'Idle',eventSequence:['Start','Ack','Reset','Ack'],assumptions:['One event at a time. No clock timing or hardware behavior is inferred.'],confirmed:true};
  const saved=await createContextualReviewedWorkflow(core,{taskId:created.id,requestId:'owned-causal-notes-admission',basis,expectedSourceRefs:refs,review});
  let current=await core.getTask(created.id);
  const artifact=current.artifacts.find(artifact=>artifact.id===saved.artifactId)!,definitionBytes=artifact.revisions[0].content,data=parseModuleAnswer(JSON.parse(definitionBytes)).modules[0].data;
  if(data.kind!=='workflow-lab')throw Error('Expected actual contextual workflow admission');
  const stateId=(label:string)=>data.practice.states.find(value=>value.label===label)!.id,eventId=data.practice.events.find(value=>value.label==='Reset')!.id;
  const ruleId=data.practice.rules.find(rule=>rule.fromStateId===stateId('Done')&&rule.eventId===eventId)!.id;
  const target={taskId:created.id,artifactId:artifact.id,artifactRevision:1,moduleId:data.id};let revision=0;
  async function apply(action:InputAction){await editModule(core,{...target,action:{...action,expectedRevision:revision++}});}
  await apply({kind:'set-rule',ruleId,toStateId:stateId('Busy'),enabled:true,reason:'Try the downstream Ack after restarting Busy.'});
  await apply({kind:'predict',finalStateId:stateId('Done'),blockedCount:0,reasoning:'  Practice reasoning before transfer.  '});
  await apply({kind:'start-transfer'});
  await apply({kind:'predict',finalStateId:stateId('Done'),blockedCount:0,reasoning:'  First independent answer.\nPreserve these spaces.  '});
  await apply({kind:'return-practice'});
  await apply({kind:'set-rule',ruleId,toStateId:stateId('Idle'),enabled:true,reason:'Later current-practice edit.'});
  current=await core.getTask(created.id);const storedBefore=structuredClone(current.session!.moduleStates),first=workflowLab.parseState(data,storedBefore[0].state).transfer;
  expect(first.kind).toBe('reviewed');
  const notesResult=await saveModuleDocument(core,{taskId:created.id,artifactId:artifact.id,artifactRevision:1,sessionRevision:current.session!.revision});
  current=await core.getTask(created.id);const notes=current.artifacts.find(artifact=>artifact.id===notesResult.artifactId)!.revisions.at(-1)!;
  const retained=notes.content.split('Saved first transfer attempt')[1];
  expect(retained).toContain('First independent answer.\nPreserve these spaces.  ');
  expect(retained).toContain('Practice reasoning before transfer.  ');
  expect(retained).toContain('Done + Reset → Busy (enabled)');
  expect(retained).toContain('lesson version 1; source artifact revision 1');
  expect(retained).toContain('Text source 1, version 1; Text source 2, version 1');
  expect(retained).not.toContain('Later current-practice edit.');
  expect(notes.sourceRefs).toEqual(refs);expect(current.session!.moduleStates).toEqual(storedBefore);
  expect(current.artifacts.find(value=>value.id===artifact.id)!.revisions[0].content).toBe(definitionBytes);
  await core.close();core=await createCompanion({dataDir:directory});current=await core.getTask(created.id);
  expect(current.artifacts.find(value=>value.id===notesResult.artifactId)!.revisions.at(-1)!.content).toBe(notes.content);
  expect(current.session!.moduleStates).toEqual(storedBefore);expect(current.requests).toHaveLength(1);
  await core.putSource(created.id,{id:refs[0].sourceId,kind:'text',label:'Owned literal transitions',role:'fact',content:literal+'\nA later source revision.'});
  current=await core.getTask(created.id);const count=current.artifacts.length;
  await expect(saveModuleDocument(core,{taskId:created.id,artifactId:artifact.id,artifactRevision:1,sessionRevision:current.session!.revision})).rejects.toThrow(/source changed|source.*fresh/i);
  const final=await core.getTask(created.id);expect(final.artifacts).toHaveLength(count);expect(final.session!.moduleStates).toEqual(storedBefore);
  expect(final.artifacts.find(value=>value.id===notesResult.artifactId)!.revisions.at(-1)!.sourceRefs).toEqual(refs);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
