import {ResponseModeSchema} from './task-response-mode';
import {RequestInferenceSelectionSchema} from './request-inference';
import {InstructionSkillReferenceSchema} from './instruction-skill';
import {Schema} from 'effect';

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const revision=Schema.Int.pipe(Schema.between(1,Number.MAX_SAFE_INTEGER));
const prompt=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(16_000),Schema.filter(value=>value.trim().length>0));
const kind=Schema.Literal('explain','create');
const refs=Schema.Array(Schema.Struct({sourceId:id,version:revision,digest:id})).pipe(Schema.maxItems(64));
const fingerprint=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
export const QueuedFollowupSchema=Schema.Struct({
 responseMode:Schema.optional(ResponseModeSchema),
 instructionSkill:Schema.optional(InstructionSkillReferenceSchema),
 id,revision,prompt,kind,createdAt:id,sourceRefs:refs,inference:Schema.optional(RequestInferenceSelectionSchema),
 status:Schema.Literal('queued','held','cancelled','dispatched'),reason:Schema.optional(Schema.String.pipe(Schema.maxLength(2_000))),
 dispatchedRequestId:Schema.optional(id),basis:fingerprint,scope:fingerprint,precedingRequestIds:Schema.Array(id).pipe(Schema.maxItems(100)),
}).pipe(Schema.filter(value=>(value.status==='dispatched')===(value.dispatchedRequestId!==undefined)));
export type QueuedFollowup=typeof QueuedFollowupSchema.Type;
const value={taskId:id,id,prompt,kind,sourceIds:Schema.Array(id).pipe(Schema.maxItems(64)),expectedSourceRefs:refs};
const draft=Schema.Struct({text:Schema.String.pipe(Schema.maxLength(100_000)),kind:Schema.Literal('explain','create'),revision:Schema.Int.pipe(Schema.between(0,Number.MAX_SAFE_INTEGER))});
const command=Schema.Union(
 Schema.Struct({type:Schema.Literal('queue.submit'),...value,submittedDraft:Schema.optional(draft)}),
 Schema.Struct({type:Schema.Literal('queue.edit'),...value,expectedRevision:revision}),
 Schema.Struct({type:Schema.Literal('queue.cancel'),taskId:id,id,expectedRevision:revision}),
 Schema.Struct({type:Schema.Literal('queue.hold'),taskId:id}),
);
export type QueueCommand=typeof command.Type;
export const readQueueCommand=Schema.decodeUnknownSync(command,{onExcessProperty:'error'});
export const pendingFollowups=(items:readonly QueuedFollowup[]=[])=>items.filter(item=>item.status==='queued'||item.status==='held');
