import {Schema} from 'effect';
import type {Source,SourceRef} from '../core/types';
import {invalidLearningDraft} from './learning-draft-validation';

export const SOURCE_TEXT_DRAFT_SLOT='source-text:edit';
export const SOURCE_TEXT_DRAFT_STRING_LIMIT=1_000_000;
export const SOURCE_TEXT_DRAFT_JSON_BYTES=12*1024*1024;
const identity=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
export const SourceTextDraftOwnerSchema=Schema.Struct({kind:Schema.Literal('source-text-edit'),taskId:identity,sourceId:identity});
export type SourceTextDraftOwner=typeof SourceTextDraftOwnerSchema.Type;
export const sourceTextDraftOwner=(taskId:string,sourceId:string):SourceTextDraftOwner=>({kind:'source-text-edit',taskId,sourceId});
const fields=Schema.Struct({label:Schema.String.pipe(Schema.maxLength(200)),content:Schema.String.pipe(Schema.maxLength(SOURCE_TEXT_DRAFT_STRING_LIMIT)),role:Schema.Literal('fact','style','inspiration')});
export type SourceTextFields=typeof fields.Type;
export const parseSourceTextFields=(value:unknown):SourceTextFields=>Schema.decodeUnknownSync(fields,{onExcessProperty:'error'})(value);
const revision=Schema.Int.pipe(Schema.between(0,Number.MAX_SAFE_INTEGER));
const draft=Schema.Struct({present:Schema.Boolean,...fields.fields,editVersion:revision,intentId:Schema.String,binding:Schema.String,submittedEditVersion:revision,submittedLabel:fields.fields.label,submittedContent:fields.fields.content,submittedRole:fields.fields.role,submittedFrozen:Schema.Boolean});
export type SourceTextDraft=typeof draft.Type;
export const emptySourceTextDraft:SourceTextDraft=Object.freeze({present:false,label:'',content:'',role:'fact',editVersion:0,intentId:'',binding:'',submittedEditVersion:0,submittedLabel:'',submittedContent:'',submittedRole:'fact',submittedFrozen:false});
export const sourceTextFields=(value:SourceTextFields):SourceTextFields=>({label:value.label,content:value.content,role:value.role});
export const sameSourceTextFields=(left:SourceTextFields,right:SourceTextFields)=>left.label===right.label&&left.content===right.content&&left.role===right.role;
export const sourceTextSubmittedFields=(value:SourceTextDraft):SourceTextFields=>value.submittedFrozen?{label:value.submittedLabel,content:value.submittedContent,role:value.submittedRole}:sourceTextFields(value);
export function parseSourceTextDraft(value:unknown):SourceTextDraft{
 const parsed=Schema.decodeUnknownSync(draft,{onExcessProperty:'error'})(value);
 const emptySnapshot=parsed.submittedLabel===''&&parsed.submittedContent===''&&parsed.submittedRole==='fact';
 if(!parsed.present&&(parsed.label!==''||parsed.content!==''||parsed.role!=='fact'||parsed.intentId!==''||parsed.editVersion!==0))throw Error('Absent source draft fields are invalid.');
 if(parsed.intentId===''){if(parsed.binding!==''||parsed.submittedFrozen||!emptySnapshot||parsed.submittedEditVersion!==0)throw Error('Absent source save identity is invalid.');}
 else{
  if(!parsed.present||parsed.submittedEditVersion>parsed.editVersion||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(parsed.intentId)||!/^source-text-edit:v1:[a-f0-9]{64}$/.test(parsed.binding)||!parsed.submittedFrozen&&!emptySnapshot)throw Error('Source save identity needs review.');
  const submitted=sourceTextSubmittedFields(parsed);if(!submitted.content.trim()||submitted.content.includes('\0')||submitted.label.includes('\0'))throw Error('Submitted source text needs review.');
 }
 return parsed;
}
export function clearSourceTextAttempt(value:SourceTextDraft):SourceTextDraft{return {...emptySourceTextDraft,present:value.present,editVersion:value.editVersion,...sourceTextFields(value)};}
export function sourceTextDraftWithIntent(value:SourceTextDraft,submitted:SourceTextFields,intentId:string,binding:string,submittedEditVersion=value.editVersion):SourceTextDraft{
 if(value.intentId&&(value.intentId!==intentId||value.binding!==binding))throw Error('A different source save is already pending.');
 const frozen=!sameSourceTextFields(value,submitted);
 return parseSourceTextDraft({...value,present:true,intentId,binding,submittedEditVersion,submittedFrozen:frozen,submittedLabel:frozen?submitted.label:'',submittedContent:frozen?submitted.content:'',submittedRole:frozen?submitted.role:'fact'});
}
export function changeSourceTextDraft(value:SourceTextDraft,applied:SourceTextFields,change:Partial<SourceTextFields>):SourceTextDraft{
 try{
  const next=parseSourceTextFields({...sourceTextFields(value.present?value:applied),...change});
  if(value.editVersion===Number.MAX_SAFE_INTEGER)throw Error('Source edit version exhausted.');
  if(value.intentId)return sourceTextDraftWithIntent({...value,...next,editVersion:value.editVersion+1},sourceTextSubmittedFields(value),value.intentId,value.binding,value.submittedEditVersion);
  return sameSourceTextFields(next,applied)?emptySourceTextDraft:{...emptySourceTextDraft,present:true,editVersion:value.editVersion+1,...next};
 }catch{throw invalidLearningDraft('The source change exceeds its supported fields or text limits.','invalid-data');}
}
const expectedSchema=Schema.Struct({sourceId:identity,version:Schema.Int.pipe(Schema.between(1,Number.MAX_SAFE_INTEGER)),digest:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),freshness:Schema.Literal('fresh','refresh-required')});
export type SourceTextExpected=typeof expectedSchema.Type;
export function parseSourceTextExpected(value:unknown):SourceTextExpected{const parsed=Schema.decodeUnknownSync(expectedSchema,{onExcessProperty:'error'})(value);return {sourceId:parsed.sourceId,version:parsed.version,digest:parsed.digest,freshness:parsed.freshness};}
const basisSchema=Schema.Struct({format:Schema.Literal('source-text-edit:v1'),...expectedSchema.fields});
export function sourceTextDraftBasis(reference:SourceRef,freshness:Source['freshness']):string{return JSON.stringify({format:'source-text-edit:v1',sourceId:reference.sourceId,version:reference.version,digest:reference.digest,freshness});}
export function parseSourceTextDraftBasis(text:string):typeof basisSchema.Type{
 const value=Schema.decodeUnknownSync(basisSchema,{onExcessProperty:'error'})(JSON.parse(text));
 if(sourceTextDraftBasis(value,value.freshness)!==text)throw Error('Source edit basis needs review.');
 return value;
}
