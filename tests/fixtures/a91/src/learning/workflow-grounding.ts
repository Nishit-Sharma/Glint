import {Schema} from 'effect';
import type {Task,SourceRef} from '../core/types';
import {GroundingSourceRefSchema,GroundingArtifactRefSchema} from './grounded-join';

const id=Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,80}$/));
const text=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(500));
const hostId=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const digest=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(128));
export const WorkflowBasisSchema=Schema.Union(
 Schema.Struct({kind:Schema.Literal('local-sample'),contextDigest:digest}),
 Schema.Struct({kind:Schema.Literal('reviewed-source'),contextDigest:digest,taskId:hostId,artifact:GroundingArtifactRefSchema,sourceRefs:Schema.Array(GroundingSourceRefSchema).pipe(Schema.minItems(1),Schema.maxItems(2))}),
);
export const WorkflowRuleOriginSchema=Schema.Struct({ruleId:id,reason:text,citationId:Schema.NullOr(id),interpretation:Schema.optional(Schema.Literal('source-stated','user-interpreted'))});
export const WorkflowCitationSchema=Schema.Struct({id,sourceRef:GroundingSourceRefSchema,location:Schema.Struct({kind:Schema.Literal('text-range'),start:Schema.Int.pipe(Schema.nonNegative()),end:Schema.Int.pipe(Schema.positive()),quote:text})});
export type WorkflowBasis=typeof WorkflowBasisSchema.Type;
export type WorkflowCitation=typeof WorkflowCitationSchema.Type;
const sameRef=(a:SourceRef,b:SourceRef)=>a.sourceId===b.sourceId&&a.version===b.version&&a.digest===b.digest;

/** Source status is host task state, never an inference about an unseen window. */
export function workflowStatus(data:{readonly basis:WorkflowBasis},task?:Task):{kind:'current'|'unavailable'|'stale';reason:string}{
 if(data.basis.kind==='local-sample')return {kind:'current',reason:'Illustrative local sample. No real procedure or screen was observed.'};
 const basis=data.basis;
 if(!task)return {kind:'unavailable',reason:'The source task is unavailable. Review the current source before changing this saved workflow.'};
 if(task.id!==basis.taskId)return {kind:'stale',reason:'This workflow belongs to a different source task. Review its source before editing.'};
 const current=task.artifacts.find(a=>a.id===basis.artifact.artifactId)?.revisions.at(-1);
 if(!current||current.revision!==basis.artifact.revision||current.digest!==basis.artifact.digest)return {kind:'stale',reason:'The reviewed source artifact changed. Create a new reviewed workflow from its current revision.'};
 if(current.sourceRefs.length!==basis.sourceRefs.length||!current.sourceRefs.every(r=>basis.sourceRefs.some(b=>sameRef(r,b))))return {kind:'stale',reason:'The reviewed source references changed. Review the current source again.'};
 for(const ref of basis.sourceRefs){
  const source=task.sources.find(s=>s.id===ref.sourceId),version=source?.versions.at(-1);
  if(!source||!version||source.freshness!=='fresh'||source.currentVersion!==ref.version||version.id!==ref.sourceId||version.version!==ref.version||version.digest!==ref.digest||version.role!=='fact')return {kind:'stale',reason:'A reviewed source changed or needs a fresh capture. Saved work is kept; editing requires a new reviewed version.'};
 }
 return {kind:'current',reason:'Rules are an explicit reviewed interpretation of the cited frozen text. This does not observe or change a real workflow.'};
}
