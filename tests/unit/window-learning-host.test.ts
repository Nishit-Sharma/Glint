import {currentAnswerOrigin} from '../support/current-answer-origin.fixture';
import {defaultWorkflowExperiment,validateWorkflowExperiment,checkWorkflowVariant,workflowModel} from '../../src/learning/workflow-engine';
import {readTaskArtifactText} from '../../src/core/task-dialogue';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,beforeEach,expect,test} from 'vitest';
import {createCompanion,type Companion} from '../../src/core/companion';
import {prepareBriefActionPlan} from '../../src/host/brief-action-plan';
import {createWindowWorkflow,prepareWindowWorkflowSourceContext} from '../../src/core/window-workflow-host';
import {WINDOW_WORKFLOW_PROMPT,WINDOW_WORKFLOW_MIME,readWindowWorkflowCandidate} from '../../src/shared/window-workflow-artifact';
import {parseWindowWorkflowProposal} from '../../src/learning/window-workflow-proposal';
import {windowWorkflowReviewSnapshot} from '../../src/learning/window-workflow-review';
import {syntheticCandidate,syntheticReviewDraft,syntheticOmissionDraft} from '../support/window-learning.fixture';
import {parseModuleAnswer} from '../../src/core/interactive-modules';
import {MODULE_MIME} from '../../src/shared/module-contract';
import {workflowLab} from '../../src/learning/workflow-lab';
import {workflowStatus} from '../../src/learning/workflow-grounding';
import {editModule,saveModuleDocument} from '../../src/core/module-state';
let directory:string,core:Companion;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'window-learning-'));core=await createCompanion({dataDir:directory});});
afterEach(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
async function fixture(){
 const task=await core.createTask({title:'Owned synthetic FSM window, no actual OCR'}),capture=syntheticCandidate().provenance.source.capture;
 const withSource=await core.putSource(task.id,{id:'window-source',kind:'window',role:'fact',label:'Owned synthetic diagram',windowId:'owned-window',documentToken:'owned-document',content:JSON.stringify({captureId:capture.captureId,imageSha256:capture.imageSha256,capturedAt:capture.capturedAt,transform:{pixelWidth:800,pixelHeight:600},freshness:'frozen-explicit-capture'})});
 const version=withSource.sources[0].versions[0],ref={sourceId:version.id,version:version.version,digest:version.digest};
 const saved=await currentAnswerOrigin(core,task.id,'fixture-window-origin:'+task.id,{title:'Saved window brief',mimeType:'application/json',content:JSON.stringify({schemaVersion:1,kind:'screen-brief',insight:'An owned synthetic state diagram.',actions:[]})},[ref]);
 const basis={artifactId:saved.artifactId,revision:1,digest:saved.revision.digest},command={type:'model.run' as const,taskId:task.id,requestId:'stable-proposal',kind:'experiment' as const,prompt:WINDOW_WORKFLOW_PROMPT,sourceIds:[ref.sourceId],expectedSourceRefs:[ref],briefAction:{kind:'review-state-transitions' as const,artifact:basis}};
 return {task:await core.getTask(task.id),ref,basis,command};
}
async function candidateFixture(){
 const f=await fixture(),plan=prepareBriefActionPlan(f.task,f.command)!;
 const result=await core.runRequest(plan.request,async context=>{const response=plan.bind(context);if(response.kind!=='window-workflow-proposal')throw Error('Expected window review policy');return response.finish(JSON.stringify(syntheticCandidate().proposal));});
 expect(result.status).toBe('completed');const task=await core.getTask(f.task.id),artifact=task.artifacts.find(a=>a.id===result.artifactId)!,revision=artifact.revisions[0],candidate=readWindowWorkflowCandidate(revision.content,revision.sourceRefs)!;
 return {...f,task,candidate,candidateRef:{artifactId:artifact.id,revision:revision.revision,digest:revision.digest}};
}
test('the existing saved-brief provider plan publishes only a review candidate with exact host provenance',async()=>{
 const f=await candidateFixture(),revision=f.task.artifacts.at(-1)!.revisions[0];
 expect(revision.mimeType).toBe(WINDOW_WORKFLOW_MIME);expect(revision.mimeType).not.toBe(MODULE_MIME);
 expect(f.candidate.provenance).toEqual(prepareWindowWorkflowSourceContext(f.task,f.basis));
 expect(JSON.stringify(f.candidate)).not.toMatch(/workflow-lab|dataUrl|base64|approved|permission/);
 const plan=prepareBriefActionPlan(f.task,f.command)!;
 expect(await core.runRequest(plan.request,async()=>{throw Error('A lost proposal reply must not cause another inference');})).toMatchObject({status:'completed',artifactId:f.candidateRef.artifactId});
});

test('review publication uses fresh host fences at preparation, finish and atomic commit, then reopens historical transcription with the same engine',async()=>{
 const f=await candidateFixture(),draft=syntheticReviewDraft(),confirmation={kind:'reviewed-window-transcription' as const,snapshot:windowWorkflowReviewSnapshot(f.candidate,draft)};
 let checks=0,asserts=0;const fence={checkCommit:async()=>{},check:async()=>{checks++;},assertCurrent:()=>{asserts++;}};
 const input={taskId:f.task.id,requestId:'stable-publication',candidate:f.candidateRef,review:{draft,confirmation}};
 const result=await createWindowWorkflow(core,input,fence);expect(result.status).toBe('completed');expect(checks).toBe(2);expect(asserts).toBeGreaterThanOrEqual(3);
 let task=await core.getTask(f.task.id),artifact=task.artifacts.find(a=>a.id===result.artifactId)!,data=parseModuleAnswer(JSON.parse(artifact.revisions[0].content)).modules[0].data;
 if(data.kind!=='workflow-lab')throw Error('Expected existing finite engine');
 expect(data.basis.kind).toBe('reviewed-window');expect(workflowStatus(data,task).reason).toContain('historical');
 expect(data.ruleOrigins.every(r=>r.interpretation==='reviewed-image-interpretation')).toBe(true);
 expect(workflowLab.text(data)).toContain('HDL');expect(workflowLab.text(data)).not.toContain('Text source');
 const target={taskId:f.task.id,artifactId:artifact.id,artifactRevision:1,moduleId:data.id};
 await editModule(core,{...target,action:{kind:'predict',expectedRevision:0,finalStateId:'idle',blockedCount:0,reasoning:'My first guess'}});
 await editModule(core,{...target,action:{kind:'set-rule',expectedRevision:1,ruleId:'t-start',toStateId:'idle',enabled:true,reason:'Test whether the first arrow is a self loop.'}});
 await editModule(core,{...target,action:{kind:'predict',expectedRevision:2,finalStateId:'idle',blockedCount:1,reasoning:'The finish event is blocked at Idle.'}});
 let state=workflowLab.parseState(data,(await core.getTask(f.task.id)).session!.moduleStates[0].state);
 expect(workflowLab.observe(data,state).change?.changedSteps.length).toBeGreaterThan(0);
 for(const [i,mode] of ['deep','visual','quick'].entries())await editModule(core,{...target,action:{kind:'set-mode',mode:mode==='quick'?'quick':mode==='deep'?'deep':'visual',expectedRevision:3+i}});
 await editModule(core,{...target,action:{kind:'start-transfer',expectedRevision:6}});
 state=workflowLab.parseState(data,(await core.getTask(f.task.id)).session!.moduleStates[0].state);expect(workflowLab.observe(data,state).result).toBeNull();
 await editModule(core,{...target,action:{kind:'predict',expectedRevision:7,finalStateId:'reserved',blockedCount:1,reasoning:'First distinct transfer answer'}});
 task=await core.getTask(f.task.id);const notes=await saveModuleDocument(core,{taskId:task.id,artifactId:artifact.id,artifactRevision:1,sessionRevision:task.session!.revision});
 expect(task.artifacts).toHaveLength(3);await core.close();core=await createCompanion({dataDir:directory});
 const reopened=await core.getTask(f.task.id),restored=workflowLab.parseState(data,reopened.session!.moduleStates[0].state);
 expect(restored.transfer).toMatchObject({kind:'reviewed',prediction:{reasoning:'First distinct transfer answer'}});
 expect(reopened.artifacts.find(a=>a.id===notes.artifactId)!.revisions[0].content).toContain('historical');
 expect(await createWindowWorkflow(core,input,{checkCommit:async()=>{},check:async()=>{throw Error('Replay must inspect saved result before capture');},assertCurrent:()=>{throw Error('No capture after restart');}})).toMatchObject({status:'completed',artifactId:artifact.id});
});

test.each(['finish','commit'])('a host capture/privacy/TTL retirement at %s prevents module publication',async stage=>{
 const f=await candidateFixture(),draft=syntheticReviewDraft(),review={draft,confirmation:{kind:'reviewed-window-transcription',snapshot:windowWorkflowReviewSnapshot(f.candidate,draft)}};
 let checks=0,assertions=0;
 const result=await createWindowWorkflow(core,{taskId:f.task.id,requestId:'retired-'+stage,candidate:f.candidateRef,review},{checkCommit:async()=>{},check:async()=>{if(++checks===2&&stage==='finish')throw Error('Synthetic preview expired or privacy retired');},assertCurrent:()=>{if(++assertions===4&&stage==='commit')throw Error('Synthetic capture binding retired inside atomic commit');}});
 expect(result.status).not.toBe('completed');expect((await core.getTask(f.task.id)).artifacts).toHaveLength(2);
});

test.each(['source','brief','candidate','pause','cancel'])('a %s race during final capture check holds review without publishing a stale module',async target=>{
 const f=await candidateFixture(),draft=syntheticReviewDraft(),review={draft,confirmation:{kind:'reviewed-window-transcription',snapshot:windowWorkflowReviewSnapshot(f.candidate,draft)}};
 let checks=0;const requestId='race-'+target;
 const result=await createWindowWorkflow(core,{taskId:f.task.id,requestId,candidate:f.candidateRef,review},{assertCurrent:()=>{},checkCommit:async()=>{},check:async()=>{if(++checks!==2)return;
  if(target==='source')await core.putSource(f.task.id,{id:f.ref.sourceId,kind:'text',role:'fact',label:'Changed',content:'Different evidence'});
  if(target==='brief'||target==='candidate'){const ref=target==='brief'?f.basis:f.candidateRef;await core.saveArtifact(f.task.id,{artifactId:ref.artifactId,expectedRevision:ref.revision,title:'Changed',content:'Different artifact'});}
  if(target==='pause')await core.pause(f.task.id);
  if(target==='cancel')await core.cancelRequest(f.task.id,requestId);
 }});
 expect(result.status).not.toBe('completed');expect((await core.getTask(f.task.id)).artifacts).toHaveLength(2);
});

test('persisted reviewed-image evidence refuses malformed regions, forged classifications and text authority',async()=>{
 const f=await candidateFixture(),draft=syntheticReviewDraft();const result=await createWindowWorkflow(core,{taskId:f.task.id,requestId:'persisted-check',candidate:f.candidateRef,review:{draft,confirmation:{kind:'reviewed-window-transcription',snapshot:windowWorkflowReviewSnapshot(f.candidate,draft)}}},{checkCommit:async()=>{},check:async()=>{},assertCurrent:()=>{}});
 const task=await core.getTask(f.task.id),data=parseModuleAnswer(JSON.parse(task.artifacts.find(a=>a.id===result.artifactId)!.revisions[0].content)).modules[0].data;if(data.kind!=='workflow-lab')throw Error('Expected finite workflow');
 for(const patch of [{x:1,width:Number.MIN_VALUE},{x:Number.MIN_VALUE,width:1},{y:1,height:Number.MIN_VALUE},{y:Number.MIN_VALUE,height:1},{width:0},{x:-0.01}]){
  const bad={...data,citations:data.citations.map((c,i)=>i?c:{...c,location:{...c.location,...patch}})};expect(()=>workflowLab.parse(bad)).toThrow();
 }
 expect(()=>workflowLab.parse({...data,ruleOrigins:data.ruleOrigins.map(o=>({...o,interpretation:'source-stated'}))})).toThrow();
 expect(()=>workflowLab.parse({...data,ruleOrigins:data.ruleOrigins.map(o=>{if('imageCitationIds' in o){const {imageCitationIds,...rest}=o;return {...rest,interpretation:'source-stated'};}return o;})})).toThrow('image interpretation');
 expect(()=>workflowLab.parse({...data,citations:data.citations.map((c,i)=>i?c:{...c,classification:'corrected-transcription'})})).toThrow('classification');
});

test('large valid review snapshots remain ephemeral while bounded raw fields and admitted evidence fit their actual contracts',async()=>{
 const f=await candidateFixture(),proposed={...f.candidate.proposal,citations:[...f.candidate.proposal.citations,...Array.from({length:42},(_,i)=>({id:'extra-'+i,source:'S1',location:{kind:'image-region',x:0,y:0,width:1,height:1,quote:'q'.repeat(500)}}))]};
 const parsed=parseWindowWorkflowProposal(JSON.stringify(proposed),f.candidate.provenance);if(parsed.kind!=='window-workflow-review-candidate')throw Error('Expected bounded candidate');
 const saved=await core.saveArtifact(f.task.id,{artifactId:f.candidateRef.artifactId,expectedRevision:1,title:'Large bounded image review',mimeType:WINDOW_WORKFLOW_MIME,sourceRefs:[f.ref],content:JSON.stringify(parsed)}),candidateRef={artifactId:saved.artifactId,revision:2,digest:saved.revision.digest};
 const draft={...syntheticReviewDraft(),evidence:parsed.proposal.citations.map(c=>({citationId:c.id,kind:'confirmed-transcription',reason:'r'.repeat(500)}))},snapshot=windowWorkflowReviewSnapshot(parsed,draft);expect(snapshot.length).toBeGreaterThan(32*1024);
 const result=await createWindowWorkflow(core,{taskId:f.task.id,requestId:'large-reviewed-input',candidate:candidateRef,review:{draft,confirmation:{kind:'reviewed-window-transcription',snapshot}}},{checkCommit:async()=>{},check:async()=>{},assertCurrent:()=>{}});
 expect(result.status).toBe('completed');const task=await core.getTask(f.task.id),content=task.artifacts.find(a=>a.id===result.artifactId)!.revisions[0].content;expect(content).not.toContain('reviewSnapshot');expect(content).not.toContain('confirmation');
});

test('admitted historical provenance retains the reported ambiguity and the explicit review disposition',async()=>{
 const f=await candidateFixture(),parsed=parseWindowWorkflowProposal(JSON.stringify({...f.candidate.proposal,issues:[{id:'arrow-ambiguity',kind:'ambiguity',citationIds:['c-go'],reason:'The proposed arrow head is unclear.'}]}),f.candidate.provenance);if(parsed.kind!=='window-workflow-review-candidate')throw Error('Expected held candidate');
 const saved=await core.saveArtifact(f.task.id,{artifactId:f.candidateRef.artifactId,expectedRevision:1,title:'Review ambiguous arrow',mimeType:WINDOW_WORKFLOW_MIME,sourceRefs:[f.ref],content:JSON.stringify(parsed)}),candidate={artifactId:saved.artifactId,revision:2,digest:saved.revision.digest};
 const draft={...syntheticReviewDraft(),issueResolutions:[{issueId:'arrow-ambiguity',kind:'resolved',reason:'I inspected the arrow head and chose the outward transition.'}]};
 const result=await createWindowWorkflow(core,{taskId:f.task.id,requestId:'resolved-ambiguity',candidate,review:{draft,confirmation:{kind:'reviewed-window-transcription',snapshot:windowWorkflowReviewSnapshot(parsed,draft)}}},{checkCommit:async()=>{},check:async()=>{},assertCurrent:()=>{}});
 const task=await core.getTask(f.task.id),data=parseModuleAnswer(JSON.parse(task.artifacts.find(a=>a.id===result.artifactId)!.revisions[0].content)).modules[0].data;if(data.kind!=='workflow-lab')throw Error('Expected finite workflow');
 expect(data.basis).toMatchObject({kind:'reviewed-window',issueReviews:[{id:'arrow-ambiguity',originalKind:'ambiguity',originalReason:'The proposed arrow head is unclear.',disposition:'resolved',reason:'I inspected the arrow head and chose the outward transition.'}]});
 expect(workflowLab.text(data)).toContain('I inspected the arrow head');
});

test('equivalent exact brief references preserve proposal identity across JSON field ordering',async()=>{
 const f=await fixture(),first=prepareBriefActionPlan(f.task,f.command)!,basis=f.command.briefAction.artifact;
 const second=prepareBriefActionPlan(f.task,{...f.command,briefAction:{...f.command.briefAction,artifact:{digest:basis.digest,revision:basis.revision,artifactId:basis.artifactId}}})!;
 expect(JSON.stringify(second.request)).toBe(JSON.stringify(first.request));
});

test('a saved region-only correction stays inspectable through source history and saved notes',async()=>{
 const f=await candidateFixture(),draft={...syntheticReviewDraft(),evidence:syntheticReviewDraft().evidence.map((e,i)=>i?e:{citationId:e.citationId,kind:'corrected-transcription',location:{...f.candidate.proposal.citations[0].location,x:0.5,y:0.25,width:0.25,height:0.25},reason:'Only the region changed; the quoted text is unchanged.'})};
 const result=await createWindowWorkflow(core,{taskId:f.task.id,requestId:'region-only-notes',candidate:f.candidateRef,review:{draft,confirmation:{kind:'reviewed-window-transcription',snapshot:windowWorkflowReviewSnapshot(f.candidate,draft)}}},{checkCommit:async()=>{},check:async()=>{},assertCurrent:()=>{}});expect(result.status).toBe('completed');
 const task=await core.getTask(f.task.id),artifact=task.artifacts.find(a=>a.id===result.artifactId)!;const readable=readTaskArtifactText(task,artifact.id,1);expect(readable.available).toBe(true);
 const notes=await saveModuleDocument(core,{taskId:task.id,artifactId:artifact.id,artifactRevision:1,sessionRevision:task.session?.revision??0}),saved=(await core.getTask(task.id)).artifacts.find(a=>a.id===notes.artifactId)!.revisions[0].content;
 for(const output of [readable.available?readable.text:'',saved])for(const literal of ['Original proposed normalized region: 0.1, 0.1, 0.2, 0.2','Reviewed normalized region: 0.5, 0.25, 0.25, 0.25','corrected-transcription','Only the region changed; the quoted text is unchanged.'])expect(output).toContain(literal);
});

test('reviewer-added omitted state event and rule publish into bounded computed checks and survive notes/core reopen',async()=>{
 const f=await candidateFixture(),draft=syntheticOmissionDraft(),before=f.task.artifacts.find(item=>item.id===f.candidateRef.artifactId)!.revisions[0].content;
 const result=await createWindowWorkflow(core,{taskId:f.task.id,requestId:'human-omission-publication',candidate:f.candidateRef,review:{draft,confirmation:{kind:'reviewed-window-transcription',snapshot:windowWorkflowReviewSnapshot(f.candidate,draft)}}},{checkCommit:async()=>{},check:async()=>{},assertCurrent:()=>{}});
 expect(result.status).toBe('completed');const task=await core.getTask(f.task.id),artifact=task.artifacts.find(item=>item.id===result.artifactId)!,data=parseModuleAnswer(JSON.parse(artifact.revisions[0].content)).modules[0].data;if(data.kind!=='workflow-lab')throw Error('Expected finite workflow');
 expect(data.basis).toMatchObject({kind:'reviewed-window',candidate:f.candidateRef,sourceRefs:[f.ref],names:expect.arrayContaining([expect.objectContaining({id:'reviewer-state-1',reviewerAdded:true,classification:'user-interpreted'})])});expect(data.ruleOrigins.at(-1)).toMatchObject({reviewerAdded:true});
 const target={taskId:f.task.id,artifactId:artifact.id,artifactRevision:1,moduleId:data.id};await editModule(core,{...target,action:{kind:'predict',expectedRevision:0,finalStateId:'reviewer-state-1',blockedCount:0,reasoning:'My explicitly added pause rule reaches Paused.'}});
 const experiment=validateWorkflowExperiment(data.practice,{...defaultWorkflowExperiment(data.practice),fixtures:[{id:'added-path',label:'My omitted path',initialStateId:'idle',eventIds:['start','reviewer-event-1'],expectedFinalStateId:'reviewer-state-1'}],properties:[{id:'reachable-addition',kind:'reachable',stateId:'reviewer-state-1'}]});
 await editModule(core,{...target,action:{kind:'set-experiment',experiment,expectedRevision:1}});let current=await core.getTask(f.task.id);const notes=await saveModuleDocument(core,{taskId:f.task.id,artifactId:artifact.id,artifactRevision:1,sessionRevision:current.session!.revision});await core.close();core=await createCompanion({dataDir:directory});current=await core.getTask(f.task.id);
 const restored=workflowLab.parseState(data,current.session!.moduleStates[0].state),computed=checkWorkflowVariant(workflowModel(restored.practice,restored.experiment!,'practice'));expect(computed.fixtures[0].passed).toBe(true);expect(computed.fixtures[0].trace.finalStateId).toBe('reviewer-state-1');expect(computed.properties[0].verdict).toBe('witness-found');
 const content=current.artifacts.find(item=>item.id===notes.artifactId)!.revisions[0].content;for(const phrase of ['Reviewer-added state','Reviewer-added event','Reviewer-added rule','Bounded workflow experiment','historical'])expect(content).toContain(phrase);expect(current.artifacts.find(item=>item.id===f.candidateRef.artifactId)!.revisions[0].content).toBe(before);
});
