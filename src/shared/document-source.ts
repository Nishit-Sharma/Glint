import {Schema} from 'effect';
const digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
export const DocumentStampSchema=Schema.Struct({method:Schema.Literal('ax-document'),evidence:Schema.Literal('foreground-application-correlation'),digest});
export type DocumentStamp=typeof DocumentStampSchema.Type;
/** Verified host-session metadata only; never persisted or hydrated from source content. */
export type RuntimeDocumentStamp=DocumentStamp & {edited?:boolean};
export const DocumentChangeSchema=Schema.Struct({kind:Schema.Literal('changed','unavailable'),reason:Schema.String,observedAt:Schema.String,observedDigest:Schema.optional(digest)});
export type DocumentChange=typeof DocumentChangeSchema.Type;
export type DocumentObservation=
 | {kind:'document';stamp:RuntimeDocumentStamp}
 | {kind:'inactive';reason:'background'}
 | {kind:'frozen';reason:'unsupported'|'permission'|'ambiguous'|'closed'|'metadata-unavailable'|'excluded'};
export type DocumentBinding={taskId:string;ref:{sourceId:string;version:number;digest:string};windowId:string;processId:number};

export type DocumentReconciliation=DocumentObservation | {kind:'edited-transition';before:RuntimeDocumentStamp & {edited:boolean};after:RuntimeDocumentStamp & {edited:boolean}};
export type DocumentCapture={ref:DocumentBinding['ref'];stamp:RuntimeDocumentStamp};
export function persistedDocumentStamp(stamp:DocumentStamp):DocumentStamp{return {method:stamp.method,evidence:stamp.evidence,digest:stamp.digest};}

/** An unchanged address/hint cannot establish unchanged document content. */
export function documentStampChange(before:RuntimeDocumentStamp,after:RuntimeDocumentStamp):'changed'|'edited-state-changed'|undefined{
 if(before.digest!==after.digest)return 'changed';
 if(typeof before.edited==='boolean'&&typeof after.edited==='boolean'&&before.edited!==after.edited)return 'edited-state-changed';
 return undefined;
}
