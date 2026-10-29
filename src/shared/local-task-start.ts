import {Schema} from 'effect';
import type {Task} from '../core/types';

export const LOCAL_TASK_CONTENT_LIMIT=100_000;
export type LocalTaskStartValue={kind:'text'|'draft';title:string;content:string};
export type LocalTaskStartInput={intentId:string;kind:'text'|'draft';title?:string;content:string};
export type LocalTaskStartResult={task:Task;kind:'text';sourceId:string}|{task:Task;kind:'draft';artifactId:string};
const bounded=(max:number)=>Schema.String.pipe(Schema.maxLength(max),Schema.filter(value=>!value.includes('\0')));
const id=bounded(200).pipe(Schema.minLength(1),Schema.filter(value=>value.trim().length>0));
const inputSchema=Schema.Struct({intentId:id,kind:Schema.Literal('text','draft'),title:Schema.optional(bounded(200)),content:bounded(LOCAL_TASK_CONTENT_LIMIT).pipe(Schema.filter(value=>value.trim().length>0))});
/** A finite local save, not a provider prompt or permission grant. */
export function readLocalTaskStart(input:unknown):LocalTaskStartValue&{intentId:string}{
 let value:typeof inputSchema.Type;
 try{value=Schema.decodeUnknownSync(inputSchema,{onExcessProperty:'error'})(input);}catch{throw Error('Add text to save locally. Keep the title within 200 characters and the text within 100,000 characters.');}
 const title=value.title?.trim()||value.content.trim().split(/\r?\n/)[0].slice(0,80).replace(/[\uD800-\uDBFF]$/u,'');
 return {intentId:value.intentId,kind:value.kind,title,content:value.content};
}
