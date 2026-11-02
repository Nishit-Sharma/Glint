import {Schema} from 'effect';
import type {Task} from '../core/types';
export const OUTPUT_ARCHIVE_LIMIT=50,OUTPUT_ARCHIVE_BYTES=50*1024*1024;
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200)),digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),integer=Schema.Int.pipe(Schema.nonNegative(),Schema.filter(Number.isSafeInteger));
const operationId=Schema.String.pipe(Schema.pattern(/^[a-f0-9-]{36}$/));
export const OutputArchiveReceiptSchema=Schema.Struct({operationId,taskId:id,basis:digest,archiveDigest:digest,path:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(4096)),byteLength:integer,count:integer.pipe(Schema.between(1,OUTPUT_ARCHIVE_LIMIT)),savedAt:Schema.String.pipe(Schema.maxLength(40))});
export type OutputArchiveReceipt=typeof OutputArchiveReceiptSchema.Type;
export const readOutputArchiveReceipt=Schema.decodeUnknownSync(OutputArchiveReceiptSchema,{onExcessProperty:'error'});
export const OutputArchivePendingSchema=Schema.Struct({receipt:OutputArchiveReceiptSchema,device:id,inode:id});
export type OutputArchivePending=typeof OutputArchivePendingSchema.Type;
export const readOutputArchivePending=Schema.decodeUnknownSync(OutputArchivePendingSchema,{onExcessProperty:'error'});
const command=Schema.Union(Schema.Struct({type:Schema.Literal('outputs.preview'),taskId:id,operationId:Schema.optional(operationId)}),Schema.Struct({type:Schema.Literal('outputs.save'),taskId:id,operationId,basis:digest,archiveDigest:digest}));
export type OutputArchiveCommand=typeof command.Type;
export const readOutputArchiveCommand=Schema.decodeUnknownSync(command,{onExcessProperty:'error'});
export type OutputArchiveEntry={kind:'artifact'|'procedure';id:string;revision:number;title:string;mimeType:string;encoding:'utf8'|'base64';name:string;byteLength:number;digest:string;sourceRefs:readonly {sourceId:string;version:number;digest:string}[]};
export type OutputArchivePreview={taskId:string;taskTitle:string;basis:string;archiveDigest:string;byteLength:number;outputBytes:number;entries:OutputArchiveEntry[];pending?:Pick<OutputArchiveReceipt,'operationId'|'basis'|'archiveDigest'>;recovery?:{kind:'saved'|'absent'|'unconfirmed';operationId:string;message:string;path?:string}};
export type OutputArchiveResult={kind:'cancelled'}|{kind:'saved';receipt:OutputArchiveReceipt;reused:boolean}|{kind:'unconfirmed';path:string;message:string};
const result=Schema.Union(Schema.Struct({kind:Schema.Literal('cancelled')}),Schema.Struct({kind:Schema.Literal('saved'),receipt:OutputArchiveReceiptSchema,reused:Schema.Boolean}),Schema.Struct({kind:Schema.Literal('unconfirmed'),path:Schema.String.pipe(Schema.maxLength(4096)),message:Schema.String.pipe(Schema.maxLength(2000))}));
export const readOutputArchiveResult=Schema.decodeUnknownSync(result,{onExcessProperty:'error'});
/** Exact current output basis only. Never includes input bodies, drafts or request history. */
export function outputArchiveBasisText(task:Task):string{
 return JSON.stringify({taskId:task.id,artifacts:task.artifacts.map(item=>({id:item.id,...item.revisions.at(-1)})),procedures:task.procedures.map(item=>({id:item.id,revision:item.revisions.at(-1)}))});
}
