import {SavedDocumentDraftOwnerSchema,SAVED_DOCUMENT_DRAFT_SLOT,SAVED_DOCUMENT_CONTENT_LIMIT,SAVED_DOCUMENT_DRAFT_JSON_BYTES,emptySavedDocumentDraft,parseSavedDocumentDraft,parseSavedDocumentDraftBasis} from './saved-document-draft';
import {pickingRawPolicy,isPickingRawPolicy,validatePickingRaw,PICKING_DEFINITION_DRAFT_JSON_BYTES,PICKING_CASE_DRAFT_JSON_BYTES,type PickingRawPolicy} from './picking-draft-form-policy';
import {Schema,ParseResult} from 'effect';
import {LOCAL_TASK_DRAFT_JSON_BYTES,LOCAL_TASK_DRAFT_STRING_LIMIT,LOCAL_TASK_DRAFT_SLOT,emptyLocalTaskDraft,localTaskDraftBasis,parseLocalTaskDraft} from './local-task-draft';
import {isWorkflowSourceReviewSlot} from './workflow-source-admission';
import {joinRowDraftSlot,windowReviewCandidateId,parseJoinRowRaw,parseWindowReviewRaw,windowReviewRawKeepsIdentity} from './learning-draft-form-policy';
import {SourceTextDraftOwnerSchema,SOURCE_TEXT_DRAFT_SLOT,SOURCE_TEXT_DRAFT_STRING_LIMIT,SOURCE_TEXT_DRAFT_JSON_BYTES,emptySourceTextDraft,parseSourceTextDraft,parseSourceTextDraftBasis} from './source-text-draft';

/** Raw form text only. These records confer no execution or source authority. */
export const LEARNING_DRAFT_LIMITS=Object.freeze({entries:256,fileBytes:8*1024*1024,jsonBytes:128*1024,stringLength:32*1024,basisLength:16*1024,depth:16,nodes:8192,arrayItems:1024,objectKeys:256});
/** Eighty complete editable rows, including six-byte JSON escape expansion,
 * need at most 527,380 bytes at the existing per-field limits. */
export const WORKFLOW_SOURCE_DRAFT_JSON_BYTES=544*1024;
/** Complete raw maxima are 588,162 and 786,551 UTF8 JSON bytes respectively.
 * The host separately verifies historical candidate/module and exact row identity. */
export const WINDOW_REVIEW_DRAFT_JSON_BYTES=640*1024;
export const JOIN_ROW_DRAFT_JSON_BYTES=800*1024;
export type LearningDraftJsonPolicy='workflow-source-review'|'window-workflow-review'|'join-row'|'local-task-form'|'source-text-edit'|'saved-document-edit'|PickingRawPolicy;
export {LearningDraftValidationError,type LearningDraftValidationReason} from './learning-draft-validation';
import {invalidLearningDraft as invalid} from './learning-draft-validation';
const safeText=(maximum:number)=>Schema.String.pipe(Schema.minLength(1),Schema.maxLength(maximum),Schema.filter(value=>!value.includes('\0')));
const positive=Schema.Int.pipe(Schema.between(1,Number.MAX_SAFE_INTEGER));
const ModuleOwner=Schema.Struct({taskId:safeText(200),artifactId:safeText(200),artifactRevision:positive,artifactDigest:safeText(200),moduleId:safeText(80),moduleVersion:positive});
const ReviewOwner=Schema.Struct({kind:Schema.Literal('window-workflow-review'),taskId:safeText(200),artifactId:safeText(200),artifactRevision:positive,artifactDigest:safeText(200)});
const SourceReviewOwner=Schema.Struct({kind:Schema.Literal('workflow-source-review'),taskId:safeText(200),artifactId:safeText(200),artifactRevision:positive,artifactDigest:safeText(200)});
const LocalTaskOwner=Schema.Struct({kind:Schema.Literal('local-task-form'),form:Schema.Literal('text','draft')});
const Owner=Schema.Union(ModuleOwner,ReviewOwner,SourceReviewOwner,LocalTaskOwner,SourceTextDraftOwnerSchema,SavedDocumentDraftOwnerSchema);
const Value=Schema.Struct({initial:Schema.String,value:Schema.String,basis:safeText(LEARNING_DRAFT_LIMITS.basisLength)});
const RecordSchema=Schema.Struct({owner:Owner,slot:safeText(512),revision:positive,value:Schema.NullOr(Value)});
const Epoch=Schema.String.pipe(Schema.filter(value=>value==='initial'||/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)));
const RecoveryToken=Schema.String.pipe(Schema.pattern(/^[0-9a-f]{64}$/));
const FileSchema=Schema.Struct({schemaVersion:Schema.Literal(2),epoch:Epoch,records:Schema.Array(RecordSchema).pipe(Schema.maxItems(LEARNING_DRAFT_LIMITS.entries))});
export type LearningDraftOwner=typeof Owner.Type;
export type TaskLearningDraftOwner=Exclude<LearningDraftOwner,typeof LocalTaskOwner.Type>;
export const isTaskLearningDraftOwner=(owner:LearningDraftOwner):owner is TaskLearningDraftOwner=>!('kind' in owner&&owner.kind==='local-task-form');
export const learningDraftTaskId=(owner:LearningDraftOwner):string|undefined=>isTaskLearningDraftOwner(owner)?owner.taskId:undefined;
export type LearningDraftValue=typeof Value.Type;
export type LearningDraftRecord=typeof RecordSchema.Type;
export type LearningDraftFile=typeof FileSchema.Type;
export type LearningDraftReadResult={kind:'available';epoch:string;records:LearningDraftRecord[];cleanup?:'needed'}|{kind:'unavailable';message:string;recoveryToken?:string};
export type LearningDraftSaveResult={kind:'saved';epoch:string;record:LearningDraftRecord}|{kind:'conflict';epoch:string;current:LearningDraftRecord|null}|{kind:'stale-epoch';epoch:string};
export type LearningDraftRecoverResult={kind:'recovered';epoch:string;backupBasename:string};
export type LearningDraftCleanupResult={kind:'cleaned';epoch:string;removed:number};
export type LearningDraftJson=null|boolean|number|string|LearningDraftJson[]|{[key:string]:LearningDraftJson};
const unsafeKeys=new Set(['__proto__','prototype','constructor']);

/** Validate before serialization: JSON.stringify would silently drop executable values. */
function canonicalJson(input:unknown,stringLimit:number=LEARNING_DRAFT_LIMITS.stringLength):LearningDraftJson{
 const ancestors=new WeakSet<object>();let nodes=0;
 function visit(value:unknown,depth:number):LearningDraftJson{
  if(++nodes>LEARNING_DRAFT_LIMITS.nodes||depth>LEARNING_DRAFT_LIMITS.depth)throw invalid('Draft JSON is too complex.');
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='number'){if(!Number.isFinite(value))throw invalid('Draft JSON numbers must be finite.');return value;}
  if(typeof value==='string'){if(value.length>stringLimit)throw invalid('Draft text is too long.','text-too-long');return value;}
  if(typeof value!=='object'||ancestors.has(value))throw invalid('Drafts require plain JSON data.');
  ancestors.add(value);
  try{
   if(Array.isArray(value)){
    if(Object.getPrototypeOf(value)!==Array.prototype||value.length>LEARNING_DRAFT_LIMITS.arrayItems||Object.keys(value).length!==value.length||Reflect.ownKeys(value).length!==value.length+1)throw invalid('Draft JSON array is invalid.');
    return Array.from({length:value.length},(_,index)=>{const descriptor=Object.getOwnPropertyDescriptor(value,String(index));if(!descriptor||!('value' in descriptor))throw invalid('Draft JSON accessors are invalid.');return visit(descriptor.value,depth+1);});
   }
   const prototype:unknown=Object.getPrototypeOf(value);
   if(prototype!==Object.prototype&&prototype!==null)throw invalid('Draft JSON objects must be plain.');
   const keys=Reflect.ownKeys(value);
   if(keys.length>LEARNING_DRAFT_LIMITS.objectKeys)throw invalid('Draft JSON has too many fields.');
   const entries:[string,LearningDraftJson][]=[];
   for(const key of keys){
    if(typeof key!=='string'||unsafeKeys.has(key)||key.includes('\0')||key.length>200)throw invalid('Draft JSON contains an unsafe field.');
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!descriptor||!descriptor.enumerable||!('value' in descriptor))throw invalid('Draft JSON accessors are invalid.');
    entries.push([key,visit(descriptor.value,depth+1)]);
   }
   return Object.fromEntries(entries.sort(([a],[b])=>a<b?-1:a>b?1:0));
  }finally{ancestors.delete(value);}
 }
 return visit(input,0);
}
const byteLength=(text:string)=>new TextEncoder().encode(text).byteLength;
function jsonLimit(policy?:LearningDraftJsonPolicy){
 if(policy===undefined)return LEARNING_DRAFT_LIMITS.jsonBytes;
 if(policy==='workflow-source-review')return WORKFLOW_SOURCE_DRAFT_JSON_BYTES;
 if(policy==='window-workflow-review')return WINDOW_REVIEW_DRAFT_JSON_BYTES;
 if(policy==='join-row')return JOIN_ROW_DRAFT_JSON_BYTES;
 if(policy==='local-task-form')return LOCAL_TASK_DRAFT_JSON_BYTES;
 if(isPickingRawPolicy(policy))return policy==='picking-helper-candidate'?PICKING_DEFINITION_DRAFT_JSON_BYTES:policy==='picking-helper-cases'?PICKING_CASE_DRAFT_JSON_BYTES:LEARNING_DRAFT_LIMITS.jsonBytes;
 if(policy==='source-text-edit')return SOURCE_TEXT_DRAFT_JSON_BYTES;
 if(policy==='saved-document-edit')return SAVED_DOCUMENT_DRAFT_JSON_BYTES;
 throw invalid('Draft JSON policy is invalid.');
}
export function learningDraftJsonPolicy(owner:LearningDraftOwner,slot:string):LearningDraftJsonPolicy|undefined{
 if('kind' in owner){
  if(owner.kind==='saved-document-edit'){parseLearningDraftOwner(owner);return slot===SAVED_DOCUMENT_DRAFT_SLOT?'saved-document-edit':undefined;}
  if(owner.kind==='source-text-edit'){parseLearningDraftOwner(owner);return slot===SOURCE_TEXT_DRAFT_SLOT?'source-text-edit':undefined;}
  if(owner.kind==='local-task-form'){parseLearningDraftOwner(owner);return slot===LOCAL_TASK_DRAFT_SLOT?'local-task-form':undefined;}
  if(owner.kind==='workflow-source-review'&&isWorkflowSourceReviewSlot(slot))return 'workflow-source-review';
  if(owner.kind==='window-workflow-review'&&windowReviewCandidateId(slot))return 'window-workflow-review';
 }else{if(joinRowDraftSlot(slot))return 'join-row';return pickingRawPolicy(slot);}
 return undefined;
}
export function serializeLearningDraftJson(value:unknown,policy?:LearningDraftJsonPolicy):string{
 const canonical=canonicalJson(value,policy==='saved-document-edit'?SAVED_DOCUMENT_CONTENT_LIMIT:policy==='source-text-edit'?SOURCE_TEXT_DRAFT_STRING_LIMIT:policy==='local-task-form'?LOCAL_TASK_DRAFT_STRING_LIMIT:policy==='picking-helper-candidate'?512*1024:LEARNING_DRAFT_LIMITS.stringLength);
 if(isPickingRawPolicy(policy))validatePickingRaw(canonical,policy);
 const text=JSON.stringify(canonical);
 if(byteLength(text)>jsonLimit(policy))throw invalid('Draft JSON is too large.','too-large');
 return text;
}
export function parseLearningDraftJson(text:string,policy?:LearningDraftJsonPolicy):LearningDraftJson{
 if(typeof text!=='string'||byteLength(text)>jsonLimit(policy))throw invalid('Draft JSON is too large.','too-large');
 let parsed:unknown;try{parsed=JSON.parse(text);}catch{throw invalid('Draft JSON is invalid.');}
 const value=canonicalJson(parsed,policy==='saved-document-edit'?SAVED_DOCUMENT_CONTENT_LIMIT:policy==='source-text-edit'?SOURCE_TEXT_DRAFT_STRING_LIMIT:policy==='local-task-form'?LOCAL_TASK_DRAFT_STRING_LIMIT:policy==='picking-helper-candidate'?512*1024:LEARNING_DRAFT_LIMITS.stringLength);
 if(isPickingRawPolicy(policy))validatePickingRaw(value,policy);
 if(JSON.stringify(value)!==text)throw invalid('Draft JSON must use canonical serialization.');
 return value;
}
const decode=<A,I>(schema:Schema.Schema<A,I>,value:unknown):A=>{try{return Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(value);}catch(error){if(ParseResult.isParseError(error))throw invalid('Draft fields are invalid.');throw error;}};
export function parseLearningDraftEpoch(value:unknown):string{return decode(Epoch,value);}
export function parseLearningDraftRecoveryToken(value:unknown):string{return decode(RecoveryToken,value);}
export function parseLearningDraftOwner(value:unknown):LearningDraftOwner{canonicalJson(value);return decode(Owner,value);}
export function parseLearningDraftTaskId(value:unknown):string{return decode(ModuleOwner.fields.taskId,value);}
export function parseLearningDraftSlot(value:unknown):string{return decode(safeText(512),value);}
/** Legacy generic-size envelopes remain inert/readable. Only the additional
 * allowance requires the named complete-form contract and host applicability. */
export function learningDraftUsesExtendedCapacity(value:LearningDraftValue):boolean{return byteLength(value.initial)>LEARNING_DRAFT_LIMITS.jsonBytes||byteLength(value.value)>LEARNING_DRAFT_LIMITS.jsonBytes;}
export function parseLearningDraftValue(value:unknown,owner?:LearningDraftOwner,slot?:string):LearningDraftValue|null{
 if(value===null)return null;
 const policy=owner&&slot!==undefined?learningDraftJsonPolicy(parseLearningDraftOwner(owner),parseLearningDraftSlot(slot)):undefined;
 canonicalJson(value,jsonLimit(policy));const parsed=decode(Value,value);
 const initial=parseLearningDraftJson(parsed.initial,policy),current=parseLearningDraftJson(parsed.value,policy);
 if(owner&&'kind' in owner&&owner.kind==='saved-document-edit'){
  try{const basis=parseSavedDocumentDraftBasis(parsed.basis);if(slot!==SAVED_DOCUMENT_DRAFT_SLOT||basis.taskId!==owner.taskId||basis.artifactId!==owner.artifactId||parsed.initial!==serializeLearningDraftJson(emptySavedDocumentDraft,'saved-document-edit'))throw Error();parseSavedDocumentDraft(initial);parseSavedDocumentDraft(current);}
  catch{throw invalid('Document edits need review.');}
 }
 if(owner&&'kind' in owner&&owner.kind==='source-text-edit'){
  try{
   if(slot!==SOURCE_TEXT_DRAFT_SLOT||parsed.initial!==serializeLearningDraftJson(emptySourceTextDraft,'source-text-edit')||parseSourceTextDraftBasis(parsed.basis).sourceId!==owner.sourceId)throw Error();
   parseSourceTextDraft(initial);parseSourceTextDraft(current);
  }catch{throw invalid('Source edits need review.');}
 }
 if(owner&&!isTaskLearningDraftOwner(owner)){
  try{
   if(slot!==LOCAL_TASK_DRAFT_SLOT||parsed.basis!==localTaskDraftBasis(owner.form)||parsed.initial!==serializeLearningDraftJson(emptyLocalTaskDraft,'local-task-form'))throw Error();
   parseLocalTaskDraft(initial);parseLocalTaskDraft(current);
  }catch{throw invalid('Local task draft fields need review.');}
 }
 if(learningDraftUsesExtendedCapacity(parsed)){
  if(policy==='join-row'){parseJoinRowRaw(initial);parseJoinRowRaw(current);}
  if(policy==='window-workflow-review'&&!windowReviewRawKeepsIdentity(parseWindowReviewRaw(initial),parseWindowReviewRaw(current)))throw invalid('Draft form identity changed.');
 }
 return parsed;
}
/** Closed envelopes admit long strings only after exact owner+slot resolution.
 * Reading a file never grants the owner applicability needed by host save. */
function envelopeFields(value:unknown,fields:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw invalid('Draft envelope is invalid.');
 const prototype=Object.getPrototypeOf(value);if(prototype!==Object.prototype&&prototype!==null)throw invalid('Draft envelope must be plain.');
 const keys=Reflect.ownKeys(value);if(keys.length!==fields.length||keys.some(k=>typeof k!=='string'||!fields.includes(k)))throw invalid('Unknown draft envelope fields.');
 const descriptors=Object.getOwnPropertyDescriptors(value),copy:Record<string,unknown>={};
 for(const field of fields){const descriptor=descriptors[field];if(!descriptor||!descriptor.enumerable||!('value' in descriptor))throw invalid('Draft envelope accessors are invalid.');copy[field]=descriptor.value;}
 return copy;
}
export function parseLearningDraftRecord(value:unknown):LearningDraftRecord{
 const fields=envelopeFields(value,['owner','slot','revision','value']);
 const owner=parseLearningDraftOwner(fields.owner),slot=parseLearningDraftSlot(fields.slot);
 if(!isTaskLearningDraftOwner(owner)&&slot!==LOCAL_TASK_DRAFT_SLOT)throw invalid('Local task draft slot is invalid.');
 if('kind' in owner&&owner.kind==='saved-document-edit'&&slot!==SAVED_DOCUMENT_DRAFT_SLOT)throw invalid('Document edit slot is invalid.');
 if('kind' in owner&&owner.kind==='source-text-edit'&&slot!==SOURCE_TEXT_DRAFT_SLOT)throw invalid('Source edit slot is invalid.');
 const parsedValue=parseLearningDraftValue(fields.value,owner,slot);
 return decode(RecordSchema,{owner,slot,revision:canonicalJson(fields.revision),value:parsedValue});
}
export function learningDraftKey(owner:LearningDraftOwner,slot:string):string{
 if(!isTaskLearningDraftOwner(owner))return JSON.stringify([owner.kind,owner.form,slot]);
 if('kind' in owner&&owner.kind==='saved-document-edit')return JSON.stringify([owner.kind,owner.taskId,owner.artifactId,slot]);
 if('kind' in owner&&owner.kind==='source-text-edit')return JSON.stringify([owner.kind,owner.taskId,owner.sourceId,slot]);
 return 'kind' in owner?JSON.stringify([owner.kind,owner.taskId,owner.artifactId,owner.artifactRevision,owner.artifactDigest,slot]):JSON.stringify([owner.taskId,owner.artifactId,owner.artifactRevision,owner.artifactDigest,owner.moduleId,owner.moduleVersion,slot]);
}
export function parseLearningDraftFile(value:unknown):LearningDraftFile{
 const fields=envelopeFields(value,['schemaVersion','epoch','records']),input=fields.records;
 if(!Array.isArray(input)||Object.getPrototypeOf(input)!==Array.prototype||input.length>LEARNING_DRAFT_LIMITS.entries||Reflect.ownKeys(input).length!==input.length+1)throw invalid('Draft record list is invalid.');
 const descriptors=Object.getOwnPropertyDescriptors(input),records:LearningDraftRecord[]=[];
 for(let index=0;index<input.length;index++){const descriptor=descriptors[String(index)];if(!descriptor||!descriptor.enumerable||!('value' in descriptor))throw invalid('Draft record list accessors are invalid.');records.push(parseLearningDraftRecord(descriptor.value));}
 const plain={schemaVersion:canonicalJson(fields.schemaVersion),epoch:canonicalJson(fields.epoch),records};
 if(byteLength(JSON.stringify(plain))>LEARNING_DRAFT_LIMITS.fileBytes)throw invalid('Draft file is too large.');
 const parsed=decode(FileSchema,plain),keys=new Set<string>();
 for(const record of parsed.records){const key=learningDraftKey(record.owner,record.slot);if(keys.has(key))throw Error('Duplicate draft identity.');keys.add(key);}
 return parsed;
}
