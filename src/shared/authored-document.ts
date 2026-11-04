import {Schema} from 'effect';
import type {Task} from '../core/types';
import {parseSavedDocumentDraft,SAVED_DOCUMENT_CONTENT_LIMIT} from './saved-document-draft';
import {invalidLearningDraft} from './learning-draft-validation';
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
const ref=Schema.Struct({sourceId:id,version:Schema.Int.pipe(Schema.positive()),digest});
const refs=Schema.mutable(Schema.Array(ref)).pipe(Schema.maxItems(1024),Schema.filter(values=>new Set(values.map(value=>value.sourceId)).size===values.length));
const fields={title:Schema.String.pipe(Schema.maxLength(200)),content:Schema.String.pipe(Schema.maxLength(SAVED_DOCUMENT_CONTENT_LIMIT)),sourceRefs:refs};
const input=Schema.Struct({taskId:id,intentId:id,...fields});
export type AuthoredDocumentInput=typeof input.Type;
/** An explicit new input, never an existing artifact or a provenance override. */
export function readAuthoredDocumentInput(value:unknown):AuthoredDocumentInput{
 const parsed=Schema.decodeUnknownSync(input,{onExcessProperty:'error'})(value);
 if(!parsed.title.trim()||!parsed.content.trim()||parsed.title.includes('\0')||parsed.content.includes('\0'))throw Error('Add a title and document text before saving.');
 return parsed;
}
export type AuthoredDocumentResult={task:Task;artifactId:string;revision:1;digest:string;intentHash:string;payloadDigest:string};
export const NEW_DOCUMENT_DRAFT_SLOT='new-document:input';
export const NewDocumentDraftOwnerSchema=Schema.Struct({kind:Schema.Literal('new-document-edit'),taskId:id});
export const newDocumentDraftOwner=(taskId:string)=>({kind:'new-document-edit' as const,taskId});
export const newDocumentDraftBasis=(taskId:string)=>JSON.stringify({format:'new-document-edit:v1',taskId});
const raw=Schema.Struct({present:Schema.Boolean,...fields,intentId:Schema.String,binding:Schema.String});
export type NewDocumentDraft=typeof raw.Type;
export const emptyNewDocumentDraft:NewDocumentDraft=Object.freeze({present:false,title:'',content:'',sourceRefs:[],intentId:'',binding:''});
export function parseNewDocumentDraft(value:unknown):NewDocumentDraft{
 try{
 const parsed=Schema.decodeUnknownSync(raw,{onExcessProperty:'error'})(value);
 parseSavedDocumentDraft({present:parsed.present,title:parsed.title,content:parsed.content,sourceRefs:parsed.sourceRefs});
 if(!((parsed.intentId===''&&parsed.binding==='')||parsed.present&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(parsed.intentId)&&/^[a-f0-9]{64}$/.test(parsed.binding)))throw Error('The earlier document save identity needs review.');
 return parsed;
 }catch{throw invalidLearningDraft('New document input exceeds its supported fields or text limits.','invalid-data');}
}
