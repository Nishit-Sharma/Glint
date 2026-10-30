import {Schema} from 'effect';
import type {Task} from '../core/types';

const id=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/));
export const TaskArchiveSchema=Schema.Struct({id,archivedAt:Schema.String.pipe(Schema.filter(value=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value))});
export type TaskArchive=typeof TaskArchiveSchema.Type;
const change=Schema.Struct({taskId:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0'))),archived:Schema.Boolean,expectedArchiveId:Schema.NullOr(id)});
export type TaskArchiveChange=typeof change.Type;
export const readTaskArchiveChange=(value:unknown):TaskArchiveChange=>Schema.decodeUnknownSync(change,{onExcessProperty:'error'})(value);
/** Archive is local organization. It neither deletes data nor resumes a task. */
export const navigationTasks=<T extends {archive?:TaskArchive}>(tasks:readonly T[]):T[]=>tasks.filter(task=>!task.archive);
export function archivedTasks(tasks:readonly Task[],query=''):Task[]{
 const needle=query.trim().slice(0,200).toLocaleLowerCase();
 return tasks.filter(task=>task.archive&&task.title.toLocaleLowerCase().includes(needle)).sort((a,b)=>b.archive!.archivedAt.localeCompare(a.archive!.archivedAt)||a.id.localeCompare(b.id));
}
