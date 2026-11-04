import {Schema} from 'effect';
import {WindowImageRegionSchema,windowImageText} from '../shared/window-image-evidence';
import type {Task,SourceRef} from '../core/types';
import {GroundingSourceRefSchema,GroundingArtifactRefSchema} from './grounded-join';

const id=Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,80}$/));
const text=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(500));
const hostId=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const digest=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(128));
const capture=Schema.Struct({captureId:hostId,imageSha256:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),capturedAt:Schema.String,previewExpiresAt:Schema.String});
const nameInterpretation=Schema.Struct({category:Schema.Literal('states','events'),id,classification:Schema.Literal('reviewed-transcription','user-interpreted'),citationId:id,reason:windowImageText(500),reviewerAdded:Schema.optional(Schema.Literal(true))});
const imageIssueReview=Schema.Struct({id,originalKind:Schema.Literal('ambiguity','unreadable','missing-information'),originalReason:windowImageText(500),citationIds:Schema.Array(id).pipe(Schema.maxItems(4)),disposition:Schema.Literal('resolved','excluded'),reason:windowImageText(500)});
export const WorkflowBasisSchema=Schema.Union(
 Schema.Struct({kind:Schema.Literal('local-sample'),contextDigest:digest}),
 Schema.Struct({kind:Schema.Literal('reviewed-window'),contextDigest:digest,taskId:hostId,artifact:GroundingArtifactRefSchema,candidate:GroundingArtifactRefSchema,sourceRefs:Schema.Array(GroundingSourceRefSchema).pipe(Schema.itemsCount(1)),capture,names:Schema.Array(nameInterpretation).pipe(Schema.maxItems(16)),issueReviews:Schema.Array(imageIssueReview).pipe(Schema.maxItems(12))}),
 Schema.Struct({kind:Schema.Literal('reviewed-source'),contextDigest:digest,taskId:hostId,artifact:GroundingArtifactRefSchema,sourceRefs:Schema.Array(GroundingSourceRefSchema).pipe(Schema.minItems(1),Schema.maxItems(2))}),
);
export const WorkflowRuleOriginSchema=Schema.Union(Schema.Struct({ruleId:id,reason:text,citationId:Schema.NullOr(id),interpretation:Schema.optional(Schema.Literal('source-stated','user-interpreted'))}),Schema.Struct({ruleId:id,reason:windowImageText(500),citationId:id,interpretation:Schema.Literal('reviewed-image-interpretation'),reviewerAdded:Schema.optional(Schema.Literal(true)),imageCitationIds:Schema.Array(id).pipe(Schema.minItems(1),Schema.maxItems(4))}));
export const WorkflowCitationSchema=Schema.Union(Schema.Struct({id,sourceRef:GroundingSourceRefSchema,location:Schema.Struct({kind:Schema.Literal('text-range'),start:Schema.Int.pipe(Schema.nonNegative()),end:Schema.Int.pipe(Schema.positive()),quote:text})}),Schema.Struct({id,sourceRef:GroundingSourceRefSchema,location:WindowImageRegionSchema,original:WindowImageRegionSchema,classification:Schema.Literal('confirmed-transcription','corrected-transcription'),reason:windowImageText(500)}));
export type WorkflowBasis=typeof WorkflowBasisSchema.Type;
export type WorkflowCitation=typeof WorkflowCitationSchema.Type;
const sameRef=(a:SourceRef,b:SourceRef)=>a.sourceId===b.sourceId&&a.version===b.version&&a.digest===b.digest;

/** Source status is host task state, never an inference about an unseen window. */
export function workflowStatus(data:{readonly basis:WorkflowBasis},task?:Task):{kind:'current'|'unavailable'|'stale';reason:string}{
 if(data.basis.kind==='local-sample')return {kind:'current',reason:'Illustrative local sample. No real procedure or screen was observed.'};
 const basis=data.basis;
 if(!task)return {kind:'unavailable',reason:'The source task is unavailable. Review the current source before changing this saved workflow.'};
 if(task.id!==basis.taskId)return {kind:'stale',reason:'This workflow belongs to a different source task. Review its source before editing.'};
 if(basis.kind==='reviewed-window'){const candidate=task.artifacts.find(a=>a.id===basis.candidate.artifactId)?.revisions.at(-1);if(!candidate||candidate.revision!==basis.candidate.revision||candidate.digest!==basis.candidate.digest)return {kind:'stale',reason:'The reviewed image candidate changed. Prepare a new review.'};}
 const current=task.artifacts.find(a=>a.id===basis.artifact.artifactId)?.revisions.at(-1);
 if(!current||current.revision!==basis.artifact.revision||current.digest!==basis.artifact.digest)return {kind:'stale',reason:'The reviewed source artifact changed. Create a new reviewed workflow from its current revision.'};
 if(current.sourceRefs.length!==basis.sourceRefs.length||!current.sourceRefs.every(r=>basis.sourceRefs.some(b=>sameRef(r,b))))return {kind:'stale',reason:'The reviewed source references changed. Review the current source again.'};
 for(const ref of basis.sourceRefs){
  const source=task.sources.find(s=>s.id===ref.sourceId),version=source?.versions.at(-1);
  if(!source||!version||source.freshness!=='fresh'||source.currentVersion!==ref.version||version.id!==ref.sourceId||version.version!==ref.version||version.digest!==ref.digest||version.role!=='fact')return {kind:'stale',reason:'A reviewed source changed or needs a fresh capture. Saved work is kept; editing requires a new reviewed version.'};
 }
 if(basis.kind==='reviewed-window')return {kind:'current',reason:'Reviewed frozen image transcription from a historical capture. Pixels are not stored or restored. Later changes are hypothetical finite sequential models, not HDL simulation or current screen claims.'};
 return {kind:'current',reason:'Rules are an explicit reviewed interpretation of the cited frozen text. This does not observe or change a real workflow.'};
}
