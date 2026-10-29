import {Schema} from 'effect';
import type {SourceRef,Task} from '../core/types';
import {parseSourceTextExpected,type SourceTextExpected,type SourceTextFields,SOURCE_TEXT_DRAFT_STRING_LIMIT} from './source-text-draft';

export const SOURCE_TEXT_SAVE_BINDING_PREFIX='source-text-edit:v1:';
const identity=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const bounded=(limit:number)=>Schema.String.pipe(Schema.maxLength(limit),Schema.filter(value=>!value.includes('\0')));
const fieldsSchema=Schema.Struct({label:bounded(200),content:bounded(SOURCE_TEXT_DRAFT_STRING_LIMIT).pipe(Schema.filter(value=>value.trim().length>0)),role:Schema.Literal('fact','style','inspiration')});
const sourceSchema=Schema.Struct({kind:Schema.Literal('text'),id:identity,...fieldsSchema.fields});
const intentSchema=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/));
const bindingSchema=Schema.String.pipe(Schema.pattern(/^source-text-edit:v1:[a-f0-9]{64}$/));
const saveSchema=Schema.Struct({taskId:identity,source:sourceSchema,expectedSource:Schema.Unknown,intentId:intentSchema,binding:bindingSchema});
const inspectionSchema=Schema.Struct({taskId:identity,sourceId:identity,expectedSource:Schema.Unknown,intentId:intentSchema,binding:bindingSchema});
const invalid=()=>Error('The source save needs valid text, an exact source version, and its original save identity.');

function closedData(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(value===null||typeof value!=='object'||Array.isArray(value)||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null))throw invalid();
 const names=Reflect.ownKeys(value),descriptors=Object.getOwnPropertyDescriptors(value);
 if(names.length!==keys.length||names.some(key=>typeof key!=='string'||!keys.includes(key)))throw invalid();
 const detached:Record<string,unknown>={};
 for(const key of keys){const descriptor=descriptors[key];if(!descriptor||!('value' in descriptor))throw invalid();detached[key]=descriptor.value;}
 return detached;
}
function expected(value:unknown):SourceTextExpected{return parseSourceTextExpected(closedData(value,['sourceId','version','digest','freshness']));}
export type SourceTextSavePayload={taskId:string;source:{kind:'text';id:string;label:string;content:string;role:SourceTextFields['role']};expectedSource:SourceTextExpected};
export type SourceTextSaveInput=SourceTextSavePayload&{intentId:string;binding:string};
export type SourceTextSaveInspectionInput={taskId:string;sourceId:string;expectedSource:SourceTextExpected;intentId:string;binding:string};
export type SourceTextSaveConfirmed={kind:'confirmed';task:Task;reference:SourceRef;intentId:string;binding:string};
export type SourceTextSaveInspection=SourceTextSaveConfirmed|{kind:'uncommitted';task:Task;expectedUnchanged:boolean;intentId:string;binding:string};

export function sourceTextSavePayload(taskId:string,expectedSource:SourceTextExpected,fields:SourceTextFields):SourceTextSavePayload{
 try{
  const id=Schema.decodeUnknownSync(identity)(taskId),basis=expected(expectedSource);
  const value=Schema.decodeUnknownSync(fieldsSchema,{onExcessProperty:'error'})(closedData(fields,['label','content','role']));
  const label=value.label.trim()||value.content.split(/\r?\n/).find(line=>line.trim().length>0)?.trim().slice(0,80).replace(/[\uD800-\uDBFF]$/u,'')||'Text source';
  return {taskId:id,source:{kind:'text',id:basis.sourceId,label,content:value.content,role:value.role},expectedSource:basis};
 }catch{throw invalid();}
}
export function sourceTextSaveBindingText(payload:SourceTextSavePayload):string{
 const {taskId,source,expectedSource}=payload;
 return JSON.stringify({operation:'source-text-edit:v1',taskId,expectedSource:{sourceId:expectedSource.sourceId,version:expectedSource.version,digest:expectedSource.digest,freshness:expectedSource.freshness},source:{kind:'text',id:source.id,label:source.label,content:source.content,role:source.role}});
}
export function readSourceTextSave(input:unknown):SourceTextSaveInput{
 try{
  const raw=closedData(input,['taskId','source','expectedSource','intentId','binding']);
  const value=Schema.decodeUnknownSync(saveSchema,{onExcessProperty:'error'})({...raw,source:closedData(raw.source,['kind','id','label','content','role'])});
  const basis=expected(value.expectedSource);
  if(value.source.id!==basis.sourceId)throw invalid();
  return {...sourceTextSavePayload(value.taskId,basis,{label:value.source.label,content:value.source.content,role:value.source.role}),intentId:value.intentId,binding:value.binding};
 }catch{throw invalid();}
}
export function readSourceTextSaveInspection(input:unknown):SourceTextSaveInspectionInput{
 try{
  const value=Schema.decodeUnknownSync(inspectionSchema,{onExcessProperty:'error'})(closedData(input,['taskId','sourceId','expectedSource','intentId','binding']));
  const basis=expected(value.expectedSource);if(value.sourceId!==basis.sourceId)throw invalid();
  return {taskId:value.taskId,sourceId:value.sourceId,expectedSource:basis,intentId:value.intentId,binding:value.binding};
 }catch{throw invalid();}
}
