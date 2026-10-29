import {Schema} from 'effect';
import type {ArtifactRef,Task} from './types';
import {GroundingArtifactRefSchema} from '../learning/grounded-join';
import {parseWindowWorkflowProposal,type WindowWorkflowSourceContext} from '../learning/window-workflow-proposal';
import {readScreenBrief} from './screen-brief';
import {sameWindowSourceRef} from '../shared/window-workflow-artifact';
import {createHash} from 'node:crypto';
import type {Companion} from './companion';
import {checkWindowWorkflowReview} from '../learning/window-workflow-review';
import {readWindowWorkflowCandidate,WINDOW_WORKFLOW_MIME} from '../shared/window-workflow-artifact';
import {workflowLab,type WorkflowData} from '../learning/workflow-lab';
import {workflowExample} from '../learning/workflow-example';
import {parseModuleAnswer} from './interactive-modules';
import {MODULE_MIME} from '../shared/module-contract';
import {serializeLearningDraftJson} from '../shared/learning-drafts';
const metadataSchema=Schema.Struct({captureId:Schema.String,imageSha256:Schema.String,capturedAt:Schema.String,transform:Schema.Unknown,freshness:Schema.Literal('frozen-explicit-capture')});
/** Exact saved WINDOW brief metadata only. Actual capture/privacy admission stays in the host shell. */
export function prepareWindowWorkflowSourceContext(task:Task,basisInput:ArtifactRef):WindowWorkflowSourceContext{
 const basis=Schema.decodeUnknownSync(GroundingArtifactRefSchema,{onExcessProperty:'error'})(basisInput),current=task.artifacts.find(a=>a.id===basis.artifactId)?.revisions.at(-1);
 if(!current||current.revision!==basis.revision||current.digest!==basis.digest||current.encoding==='base64'||current.mimeType!=='application/json'||!readScreenBrief(current.content,current.sourceRefs))throw Error('The exact saved window brief changed. Open its current revision.');
 if(current.sourceRefs.length!==1)throw Error('State transition review needs one exact window fact source.');
 const ref=current.sourceRefs[0],source=task.sources.find(s=>s.id===ref.sourceId),version=source?.versions.at(-1);
 if(!source||!version||version.content.length>8192||source.freshness!=='fresh'||source.currentVersion!==ref.version||!sameWindowSourceRef(ref,{sourceId:version.id,version:version.version,digest:version.digest})||version.kind!=='window'||version.role!=='fact')throw Error('The window source changed. Capture and read it again.');
 let metadata:typeof metadataSchema.Type;
 try{metadata=Schema.decodeUnknownSync(metadataSchema,{onExcessProperty:'error'})(JSON.parse(version.content));}catch{throw Error('The window capture metadata is invalid. Capture and read it again.');}
 const context={taskId:task.id,basis,source:{handle:'S1',kind:'window',role:'fact',ref,capture:{captureId:metadata.captureId,imageSha256:metadata.imageSha256,capturedAt:metadata.capturedAt,previewExpiresAt:new Date(Date.parse(metadata.capturedAt)+300000).toISOString()}}} satisfies WindowWorkflowSourceContext;
 // Reuse the sealed context decoder; this unsupported result carries no model or authority.
 return parseWindowWorkflowProposal('{"schemaVersion":1,"kind":"unsupported-source","code":"unreadable","reason":"Context validation only."}',context).provenance;
}

export type WindowWorkflowCaptureFence={check:()=>Promise<void>;assertCurrent:()=>void};
const publication=Schema.Struct({taskId:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200)),requestId:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200)),candidate:GroundingArtifactRefSchema,review:Schema.Unknown});
const hash=(value:unknown)=>createHash('sha256').update(serializeLearningDraftJson(value)).digest('hex');
export function windowWorkflowCandidateForReview(task:Task,ref:ArtifactRef){
 const current=task.artifacts.find(a=>a.id===ref.artifactId)?.revisions.at(-1);
 const candidate=current&&current.revision===ref.revision&&current.digest===ref.digest&&current.mimeType===WINDOW_WORKFLOW_MIME&&current.encoding!=='base64'?readWindowWorkflowCandidate(current.content,current.sourceRefs):undefined;
 if(!candidate||candidate.provenance.taskId!==task.id)throw Error('The exact saved image review candidate changed. Open its current version.');
 return candidate;
}
/** This is the only image→finite-module admission; its fence is owned by the native host, never IPC. */
export async function createWindowWorkflow(core:Companion,input:unknown,fence:WindowWorkflowCaptureFence){
 let value:typeof publication.Type;try{value=Schema.decodeUnknownSync(publication,{onExcessProperty:'error'})(input);}catch{throw Error('Choose the exact candidate and reviewed image interpretation.');}
 const task=await core.getTask(value.taskId),candidate=windowWorkflowCandidateForReview(task,value.candidate),checked=checkWindowWorkflowReview(candidate,value.review);
 if(checked.kind!=='valid')throw Error('Complete the image transcription and finite rule review. Diagnostic: '+checked.issues[0]?.code+'.');
 const review=checked.value,issueProjection=Schema.decodeUnknownSync(Schema.Struct({draft:Schema.Struct({issueResolutions:Schema.Array(Schema.Struct({issueId:Schema.String,kind:Schema.Literal('resolved','excluded'),reason:Schema.String}))})}))(JSON.parse(checked.value.reviewSnapshot)),issueReviews=candidate.proposal.issues.map(issue=>{const resolution=issueProjection.draft.issueResolutions.find(resolution=>resolution.issueId===issue.id);if(!resolution)throw Error('The reviewed issue disposition is missing.');return {id:issue.id,originalKind:issue.kind,originalReason:issue.reason,citationIds:issue.citationIds,disposition:resolution.kind,reason:resolution.reason};}),identity=hash({candidate:value.candidate,transferDigest:hash(workflowExample.transfer),reviewDigest:createHash('sha256').update(review.reviewSnapshot).digest('hex')}),id='window-'+identity.slice(0,40),basis=review.provenance.basis,refs=[review.provenance.source.ref];
 const data:WorkflowData=workflowLab.parse({kind:'workflow-lab',schemaVersion:1,id,version:1,title:review.practice.title,basis:{kind:'reviewed-window',contextDigest:identity,taskId:task.id,artifact:basis,candidate:value.candidate,sourceRefs:refs,capture:review.provenance.source.capture,names:review.nameInterpretations,issueReviews},practice:review.practice,transfer:workflowExample.transfer,assumptions:[...review.assumptions,'Reviewed image transcription is historical evidence, not verified OCR.','Events are sequential; missing/disabled rules block without changing state. No timing, concurrency, HDL simulation or external action is modeled.'],citations:review.evidence.map(e=>({id:e.citationId,sourceRef:e.sourceRef,location:e.reviewed,original:e.original,classification:e.classification,reason:e.reason})),ruleOrigins:review.ruleInterpretations.map(r=>({ruleId:r.ruleId,reason:r.reason,citationId:r.citationIds[0],imageCitationIds:r.citationIds,interpretation:r.classification}))});
 // Inspect the exact completed receipt before requesting any fresh capture. Never invent a new request ID after an uncertain reply.
 const previous=task.requests.find(request=>request.id===value.requestId);
 if(previous){
  if(previous.status!=='completed'||!previous.answer)throw Error('This publication is '+previous.status+'. Inspect its saved outcome before starting a separate deliberate attempt.');
  const saved=task.artifacts.find(a=>a.id===previous.answer!.artifactId)?.revisions.find(r=>r.revision===previous.answer!.revision&&r.digest===previous.answer!.digest);
  const module=saved?.mimeType===MODULE_MIME?parseModuleAnswer(JSON.parse(saved.content)).modules.find(module=>module.id===id):undefined;
  if(!module||module.data.kind!=='workflow-lab'||module.data.basis.kind!=='reviewed-window'||module.data.basis.contextDigest!==identity)throw Error('This request ID belongs to a different publication intent.');
  return previous;
 }
 const assertContext=(current:Task)=>{if(serializeLearningDraftJson(prepareWindowWorkflowSourceContext(current,basis))!==serializeLearningDraftJson(candidate.provenance))throw Error('The image review source or capture changed.');windowWorkflowCandidateForReview(current,value.candidate);};
 assertContext(task);await fence.check();fence.assertCurrent();
 return core.runRequest({taskId:task.id,requestId:value.requestId,kind:'experiment',prompt:'Admit this explicitly reviewed image transcription into a finite sequential learning model.',executionScope:'reviewed-window-workflow-v1:'+identity,sourceIds:refs.map(ref=>ref.sourceId),expectedSourceRefs:refs,expectedArtifacts:[basis,value.candidate]},async context=>{
  if(context.signal.aborted)throw Error('Image review publication stopped.');assertContext(context.task);fence.assertCurrent();
  const output={title:data.title,mimeType:MODULE_MIME,content:JSON.stringify({schemaVersion:1,markdown:'Reviewed frozen image transcription from a historical capture. Pixels are not stored or restored. Rules are explicit image interpretations; this finite sequential experiment is not HDL simulation.',modules:[{id:data.id,version:data.version,data,provenance:[]}]})};
  await fence.check();fence.assertCurrent();if(context.signal.aborted)throw Error('Image review publication stopped.');return output;
 },()=>{fence.assertCurrent();});
}
