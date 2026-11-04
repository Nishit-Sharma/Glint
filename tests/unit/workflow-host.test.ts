import {currentAnswerOrigin} from '../support/current-answer-origin.fixture';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,beforeEach,expect,test} from 'vitest';
import {createCompanion,type Companion,type ArtifactRef} from '../../src/core/companion';
import {admitReviewedWorkflow,localWorkflow,createWorkflowArtifact,workflowCommitGuard,workflowExplanationContext,explainWorkflow} from '../../src/core/workflow-lab-host';
import {workflowLab,type WorkflowData} from '../../src/learning/workflow-lab';
import {workflowStatus} from '../../src/learning/workflow-grounding';
import {workflowExample} from '../../src/learning/workflow-example';
import {workflowRuleCitations,workflowSourceText,reviewedWorkflowDefinition} from '../support/workflow-source-fixture';
import {parseModule,parseModelModule,parseModuleAnswer,moduleHistoryText} from '../../src/core/interactive-modules';
import {editModule,saveModuleDocument} from '../../src/core/module-state';
import {emptyTaskSession} from '../../src/core/task-session';
import {readTaskArtifactText} from '../../src/core/task-dialogue';
let root:string,core:Companion;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'finite-workflow-'));core=await createCompanion({dataDir:root});});
afterEach(async()=>{await core.close();await rm(root,{recursive:true,force:true});});
async function fixture(){
 const task=await core.createTask({title:'Owned synthetic finite workflow'});
 const t=await core.putSource(task.id,{kind:'text',role:'fact',label:'Synthetic review rules, no real procedure',content:workflowSourceText});
 const source=t.sources[0],version=source.versions.at(-1)!,refs=[{sourceId:source.id,version:version.version,digest:version.digest}];
 const basis=await currentAnswerOrigin(core,task.id,'workflow-basis-original-'+task.id,{title:'Reviewed text basis',content:'Explicit synthetic rule interpretations.'},refs);
 const ref:ArtifactRef={artifactId:basis.artifactId,revision:basis.revision.revision,digest:basis.revision.digest};
 const input={definition:reviewedWorkflowDefinition,review:{basis:ref,acknowledgement:'reviewed-rules' as const,ruleCitations:workflowRuleCitations(t.sources[0].id)}};
 return {task:await core.getTask(task.id),taskId:task.id,sourceId:t.sources[0].id,basis:ref,input};
}
async function installed(source=false){
 const f=await fixture(),request=await createWorkflowArtifact(core,{taskId:f.taskId,requestId:'workflow-'+f.taskId,...(source?f.input:{definition:workflowExample})});
 expect(request.status).toBe('completed');
 const task=await core.getTask(f.taskId),artifact=task.artifacts.find(a=>a.id===request.artifactId)!,revision=artifact.revisions.at(-1)!;
 const data=parseModuleAnswer(JSON.parse(revision.content)).modules[0].data as WorkflowData;
 return {...f,task,artifact,data,target:{taskId:f.taskId,artifactId:artifact.id,artifactRevision:1,moduleId:data.id}};
}
test('host storage admits the workflow but model-facing plans cannot supply it',()=>{
 const data=localWorkflow(workflowExample);
 expect(parseModule(data).kind).toBe('workflow-lab');
 expect(()=>parseModelModule(data)).toThrow(/comparison or plan/);
 expect(workflowStatus(data).kind).toBe('current');
 expect(()=>localWorkflow({...data,basis:{kind:'reviewed-source'}})).toThrow();
});
test('review admission binds exact source revisions and rule citations while preserving modeling assumptions',async()=>{
 const f=await fixture(),data=admitReviewedWorkflow(f.task,f.input),view=workflowLab.observe(data,workflowLab.initial(data));
 expect(data.basis.kind).toBe('reviewed-source');
 expect(data.citations[2].location.quote).toBe('Ready + Edit -> Draft');
 expect(view.ruleOrigins[2].reason).toContain('owned synthetic');
 expect(view.assumptions.join(' ')).toContain('modeling choices');
 expect(workflowStatus(data).kind).toBe('unavailable');
 expect(workflowStatus(data,f.task).kind).toBe('current');
 const bad=f.input.review.ruleCitations.map((r,i)=>i===2?{...r,quote:'Ready + Edit -> In review'}:r);
 expect(()=>admitReviewedWorkflow(f.task,{...f.input,review:{...f.input.review,ruleCitations:bad}})).toThrow(/exact selected source/);
 expect(()=>admitReviewedWorkflow(f.task,{...f.input,review:{...f.input.review,ruleCitations:f.input.review.ruleCitations.slice(1)}})).toThrow(/Every finite practice rule/);
 expect(()=>admitReviewedWorkflow(f.task,{...f.input,review:{...f.input.review,ruleCitations:f.input.review.ruleCitations.map((r,i)=>i? r:{...r,sourceId:'not-selected'})}})).toThrow(/exact selected source/);
});
test('real module edits recompute and persist corrected answers, preserve first transfer attempt, and restart deterministically',async()=>{
 const f=await installed();
 await editModule(core,{...f.target,action:{kind:'predict',finalStateId:'ready',blockedCount:0,reasoning:'A deliberate wrong prediction',expectedRevision:0}});
 await editModule(core,{...f.target,action:{kind:'set-rule',ruleId:'ready-edit',toStateId:'review',enabled:true,reason:'Test the effect of returning edited work directly to review.',expectedRevision:1}});
 await editModule(core,{...f.target,action:{kind:'predict',finalStateId:'ready',blockedCount:0,reasoning:'Approval can now follow the edit.',expectedRevision:2}});
 await editModule(core,{...f.target,action:{kind:'start-transfer',expectedRevision:3}});
 const active=await core.getTask(f.taskId),state=active.session!.moduleStates[0].state;
 expect(workflowLab.observe(f.data,state).result).toBeNull();
 const transferNotes=workflowLab.text(f.data,state);
 expect(transferNotes).not.toContain('Final state: Available');
 expect(transferNotes).toContain('Practice before transfer: Final state: Ready');
 expect(transferNotes).toContain('Recorded practice reasoning (ungraded): Approval can now follow the edit.');
 await editModule(core,{...f.target,action:{kind:'predict',finalStateId:'reserved',blockedCount:1,reasoning:'A wrong first transfer guess',expectedRevision:4}});
 const first=workflowLab.parseState(f.data,(await core.getTask(f.taskId)).session!.moduleStates[0].state).transfer;
 await editModule(core,{...f.target,action:{kind:'return-practice',expectedRevision:5}});
 await editModule(core,{...f.target,action:{kind:'set-rule',ruleId:'ready-edit',toStateId:'draft',enabled:true,reason:'Restore the original sample.',expectedRevision:6}});
 await core.close();core=await createCompanion({dataDir:root});
 const restored=workflowLab.parseState(f.data,(await core.getTask(f.taskId)).session!.moduleStates[0].state);
 expect(restored.transfer).toEqual(first);
 expect(restored.practicePrediction).toBeNull();
 expect(workflowLab.observe(f.data,restored).result).toBeNull();
 await expect(editModule(core,{...f.target,action:{kind:'set-mode',mode:'deep',expectedRevision:0}})).rejects.toThrow(/changed/);
});
test('notes, history and explanation project only the active stage, never unstarted held-out definitions',async()=>{
 const f=await installed(true),ref={artifactId:f.artifact.id,artifactRevision:1,moduleId:f.data.id,stateRevision:0};
 const context=workflowExplanationContext(await core.getTask(f.taskId),ref);
 for(const value of [JSON.stringify(context),moduleHistoryText(f.artifact.revisions[0].content)]){
  expect(value).not.toContain('equipment-checkout');expect(value).not.toContain('Available');expect(value).not.toContain('out-return');
 }
 const task=await core.getTask(f.taskId),notes=await saveModuleDocument(core,{taskId:f.taskId,artifactId:f.artifact.id,artifactRevision:1,sessionRevision:task.session?.revision??0});
 const saved=(await core.getTask(f.taskId)).artifacts.find(a=>a.id===notes.artifactId)!.revisions.at(-1)!.content;
 expect(saved).toContain('Ready + Edit -> Draft');expect(saved).not.toContain('equipment-checkout');
 expect(saved).not.toContain('Available');
 const readable=readTaskArtifactText(task,f.artifact.id,1);expect(readable.available).toBe(true);
 for(const text of [saved,moduleHistoryText(f.artifact.revisions[0].content),readable.available?readable.text:'']){
  expect(text).toContain('Text source 1, version 1');expect(text).toContain('Original rule Ready + Edit → Draft');
  expect(text).not.toContain(f.sourceId);expect(text).not.toContain(f.basis.digest);expect(text).not.toContain(f.data.basis.contextDigest);expect(text).not.toContain('rule-citation-');
 }
});
test('identical readable notes retain each exact reviewed source binding and reuse only matching notes',async()=>{
 const first=await installed(true);
 const sourceTask=await core.putSource(first.taskId,{id:'second-owned-rules',kind:'text',role:'fact',label:'Second synthetic source',content:workflowSourceText});
 const source=sourceTask.sources.find(source=>source.id==='second-owned-rules')!,version=source.versions.at(-1)!;
 const refs=[{sourceId:source.id,version:version.version,digest:version.digest}];
 const basis=await currentAnswerOrigin(core,first.taskId,'second-workflow-basis-original',{title:'Second reviewed basis',content:'Explicit synthetic rule interpretations.'},refs);
 const second=await createWorkflowArtifact(core,{taskId:first.taskId,requestId:'second-reviewed-workflow',definition:reviewedWorkflowDefinition,review:{basis:{artifactId:basis.artifactId,revision:basis.revision.revision,digest:basis.revision.digest},acknowledgement:'reviewed-rules',ruleCitations:workflowRuleCitations(source.id)}});
 expect(second.status).toBe('completed');
 const save=async(artifactId:string)=>{const task=await core.getTask(first.taskId);return saveModuleDocument(core,{taskId:first.taskId,artifactId,artifactRevision:1,sessionRevision:task.session?.revision??0});};
 const firstNotes=await save(first.artifact.id),secondNotes=await save(second.artifactId!);
 expect(secondNotes.artifactId).not.toBe(firstNotes.artifactId);
 const task=await core.getTask(first.taskId),one=task.artifacts.find(item=>item.id===firstNotes.artifactId)!.revisions.at(-1)!,two=task.artifacts.find(item=>item.id===secondNotes.artifactId)!.revisions.at(-1)!;
 expect(two.content).toBe(one.content);expect(two.sourceRefs).toEqual(refs);expect(one.sourceRefs).toEqual(first.artifact.revisions[0].sourceRefs);
 expect(await save(second.artifactId!)).toEqual({artifactId:secondNotes.artifactId,revision:two.revision});
});
test('source and basis changes invalidate edits and notes while a sample remains a sample',async()=>{
 const f=await installed(true);
 await core.putSource(f.taskId,{id:f.sourceId,kind:'text',role:'fact',label:'Changed synthetic rules',content:workflowSourceText+'\nChanged revision'});
 const task=await core.getTask(f.taskId);
 expect(workflowStatus(f.data,task).kind).toBe('stale');
 await expect(editModule(core,{...f.target,action:{kind:'set-mode',mode:'visual',expectedRevision:0}})).rejects.toThrow(/source changed|source.*fresh/i);
 await expect(saveModuleDocument(core,{taskId:f.taskId,artifactId:f.artifact.id,artifactRevision:1,sessionRevision:task.session?.revision??0})).rejects.toThrow(/source changed|source.*fresh/i);
 const g=await installed(true);
 await core.saveArtifact(g.taskId,{artifactId:g.basis.artifactId,expectedRevision:1,title:'New basis',content:'Rules need review.'});
 expect(workflowStatus(g.data,await core.getTask(g.taskId)).kind).toBe('stale');
 await expect(editModule(core,{...g.target,action:{kind:'set-mode',mode:'deep',expectedRevision:0}})).rejects.toThrow(/artifact changed/);
});
test('prepared guards stop source races and sample output revisions are guarded too',async()=>{
 const f=await installed(true),v=f.artifact.revisions[0],task=await core.getTask(f.taskId);
 const guard=workflowCommitGuard(task,f.data,{artifactId:f.artifact.id,revision:1,digest:v.digest});
 await core.putSource(f.taskId,{id:f.sourceId,kind:'text',role:'fact',label:'Changed',content:'New rules'});
 const session=(await core.getTask(f.taskId)).session??emptyTaskSession();
 await expect(core.replaceSession(f.taskId,session.revision,session,guard)).rejects.toThrow(/Source changed/);
 const g=await installed(),t=await core.getTask(g.taskId),gref={artifactId:g.artifact.id,revision:1,digest:g.artifact.revisions[0].digest};
 const localGuard=workflowCommitGuard(t,g.data,gref);
 await core.saveArtifact(g.taskId,{artifactId:g.artifact.id,expectedRevision:1,title:'Updated model',content:'A new answer'});
 const s=(await core.getTask(g.taskId)).session??emptyTaskSession();
 await expect(core.replaceSession(g.taskId,s.revision,s,localGuard)).rejects.toThrow(/artifact changed/);
});
test('asynchronous explanations reject an observation changed before final commit',async()=>{
 const f=await installed(),ref={artifactId:f.artifact.id,artifactRevision:1,moduleId:f.data.id,stateRevision:0};
 let release!:()=>void,started!:()=>void;const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>started=r);
 const pending=explainWorkflow(core,{taskId:f.taskId,requestId:'explain-workflow',observation:ref},async context=>{expect(context.observation.result).toBeNull();started();await gate;return {title:'Old explanation',content:'This stale explanation must not commit.'};});
 await ready;await editModule(core,{...f.target,action:{kind:'set-mode',mode:'deep',expectedRevision:0}});release();
 expect(await pending).toMatchObject({status:'failed'});
 expect((await core.getTask(f.taskId)).artifacts).toHaveLength(2);
});
test('admission replay is idempotent and changed definitions cannot reuse request identity',async()=>{
 const f=await fixture(),input={taskId:f.taskId,requestId:'reviewed-workflow-replay',...f.input};
 const first=await createWorkflowArtifact(core,input),second=await createWorkflowArtifact(core,input);
 expect(first.artifactId).toBe(second.artifactId);
 await expect(createWorkflowArtifact(core,{...input,definition:{...reviewedWorkflowDefinition,title:'Changed meaning'}})).rejects.toThrow(/different payload/);
 const data=admitReviewedWorkflow(f.task,f.input),foreign={...data,citations:data.citations.map((c,i)=>i?c:{...c,sourceRef:{...c.sourceRef,digest:'forged'}})};
 expect(()=>workflowLab.parse(foreign)).toThrow(/source/);
 const roleChanged=await core.putSource(f.taskId,{id:f.sourceId,kind:'text',role:'style',label:'Synthetic style reference',content:workflowSourceText});
 expect(()=>admitReviewedWorkflow(roleChanged,f.input)).toThrow(/changed|fact-source|fact source/);
});
