import {Schema} from 'effect';
import type {Task} from '../core/types';

export const TaskAttentionFilterSchema=Schema.Literal('all','unread','needs-attention','needs-review');
export type TaskAttentionFilter=typeof TaskAttentionFilterSchema.Type;
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.pattern(/^[^\0]+$/));
const basis=Schema.String.pipe(Schema.maxLength(1_000_000));
export const TaskAttentionSavedSchema=Schema.Struct({schemaVersion:Schema.Literal(1),revision:Schema.Int.pipe(Schema.between(0,Number.MAX_SAFE_INTEGER)),filter:TaskAttentionFilterSchema,entries:Schema.Array(Schema.Struct({taskId:id,basis:Schema.NullOr(basis)})).pipe(Schema.maxItems(10_000))});
export type TaskAttentionSaved=typeof TaskAttentionSavedSchema.Type;
export type TaskAttentionState=({kind:'available'}&Omit<TaskAttentionSaved,'schemaVersion'>)|{kind:'unavailable';message:string};
const change=Schema.Union(Schema.Struct({kind:Schema.Literal('filter'),filter:TaskAttentionFilterSchema}),Schema.Struct({kind:Schema.Literal('unread'),taskId:id}),Schema.Struct({kind:Schema.Literal('read'),taskId:id,basis}));
export type TaskAttentionChange=typeof change.Type;
export const readTaskAttentionChange=Schema.decodeUnknownSync(change,{onExcessProperty:'error'});
const command=Schema.Union(Schema.Struct({type:Schema.Literal('task-attention.get')}),Schema.Struct({type:Schema.Literal('task-attention.change'),change}));
export type TaskAttentionCommand=typeof command.Type;
export const readTaskAttentionCommand=Schema.decodeUnknownSync(command,{onExcessProperty:'error'});

/** A read cursor contains saved activity identity, never prompts, source text or edited artifact content. */
export function taskActivityBasis(task:Task):string{
 return JSON.stringify([task.status,task.requests.map(request=>[request.id,request.digest,request.status,request.answer?[request.answer.artifactId,request.answer.revision,request.answer.digest]:null]),(task.session?.queuedFollowups??[]).map(item=>[item.id,item.revision,item.status,item.dispatchedRequestId??null])]);
}
export function isTaskUnread(task:Task,state?:TaskAttentionState):boolean{
 if(state?.kind!=='available')return false;
 const entry=state.entries.find(entry=>entry.taskId===task.id);
 return entry?entry.basis!==taskActivityBasis(task):task.requests.length>0||!!task.session?.queuedFollowups?.length;
}
