import {Schema} from 'effect';
import type {ArtifactRevision,SourceRef,Task} from '../core/types';
import {invalidLearningDraft} from './learning-draft-validation';
export const SAVED_DOCUMENT_DRAFT_SLOT='saved-document:edit';
export const SAVED_DOCUMENT_CONTENT_LIMIT=12_000_000;
export const SAVED_DOCUMENT_DRAFT_JSON_BYTES=73_000_000;
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/),Schema.maxLength(64));
const positive=Schema.Int.pipe(Schema.between(1,Number.MAX_SAFE_INTEGER));
const ref=Schema.Struct({sourceId:id,version:positive,digest});
const refs=Schema.mutable(Schema.Array(ref)).pipe(Schema.maxItems(1024),Schema.filter(values=>new Set(values.map(value=>value.sourceId)).size===values.length));
export const SavedDocumentDraftOwnerSchema=Schema.Struct({kind:Schema.Literal('saved-document-edit'),taskId:id,artifactId:id});
export type SavedDocumentDraftOwner=typeof SavedDocumentDraftOwnerSchema.Type;
export const savedDocumentDraftOwner=(taskId:string,artifactId:string):SavedDocumentDraftOwner=>({kind:'saved-document-edit',taskId,artifactId});
const draftSchema=Schema.Struct({present:Schema.Boolean,title:Schema.String.pipe(Schema.maxLength(500)),content:Schema.String.pipe(Schema.maxLength(SAVED_DOCUMENT_CONTENT_LIMIT)),sourceRefs:refs});
export type SavedDocumentDraft=typeof draftSchema.Type;
export const emptySavedDocumentDraft:SavedDocumentDraft=Object.freeze({present:false,title:'',content:'',sourceRefs:[]});
export function parseSavedDocumentDraft(value:unknown):SavedDocumentDraft{
 try{const parsed=Schema.decodeUnknownSync(draftSchema,{onExcessProperty:'error'})(value);if(!parsed.present&&(parsed.title!==''||parsed.content!==''||parsed.sourceRefs.length))throw Error();return parsed;}
 catch{throw invalidLearningDraft('Document edits exceed their supported fields or text limits.','invalid-data');}
}
const observation=Schema.Union(Schema.Struct({kind:Schema.Literal('missing'),sourceId:id}),Schema.Struct({kind:Schema.Literal('available'),...ref.fields,freshness:Schema.Literal('fresh','refresh-required')}));
const basisSchema=Schema.Struct({format:Schema.Literal('saved-document-edit:v1'),taskId:id,artifactId:id,revision:positive,digest,sourceRefs:refs,sources:Schema.Array(observation).pipe(Schema.maxItems(1024))});
export const ordinaryTextDocument=(revision:ArtifactRevision)=>revision.mimeType.startsWith('text/')&&revision.encoding!=='base64';
export const orderedDocumentRefs=(values:readonly SourceRef[]):SourceRef[]=>values.map(value=>({...value})).sort((a,b)=>a.sourceId<b.sourceId?-1:a.sourceId>b.sourceId?1:0);
export const sameDocumentRefs=(a:readonly SourceRef[],b:readonly SourceRef[])=>JSON.stringify(orderedDocumentRefs(a))===JSON.stringify(orderedDocumentRefs(b));
export function savedDocumentDraftBasis(task:Task,artifactId:string,revision:ArtifactRevision):string{
 const sourceRefs=orderedDocumentRefs(revision.sourceRefs),sources=sourceRefs.map(reference=>{const source=task.sources.find(item=>item.id===reference.sourceId),version=source?.versions.at(-1);return source&&version?{kind:'available' as const,sourceId:source.id,version:version.version,digest:version.digest,freshness:source.freshness}:{kind:'missing' as const,sourceId:reference.sourceId};});
 return JSON.stringify({format:'saved-document-edit:v1',taskId:task.id,artifactId,revision:revision.revision,digest:revision.digest,sourceRefs,sources});
}
export function parseSavedDocumentDraftBasis(text:string):typeof basisSchema.Type{
 const value=Schema.decodeUnknownSync(basisSchema,{onExcessProperty:'error'})(JSON.parse(text));
 if(JSON.stringify(value)!==text||JSON.stringify(value.sourceRefs)!==JSON.stringify(orderedDocumentRefs(value.sourceRefs))||value.sources.length!==value.sourceRefs.length||value.sources.some((source,index)=>source.sourceId!==value.sourceRefs[index].sourceId))throw Error('Document edit basis needs review.');
 return value;
}
