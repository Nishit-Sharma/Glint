import {Schema} from 'effect';
import {readLocalTaskStart,type LocalTaskStartInput} from './local-task-start';

export const LOCAL_TASK_DRAFT_SLOT='local-task:input';
export const LOCAL_TASK_DRAFT_JSON_BYTES=640*1024;
export const LOCAL_TASK_DRAFT_STRING_LIMIT=100_000;
export type LocalTaskDraft={title:string;content:string;intentId:string;binding:string};
export const emptyLocalTaskDraft:LocalTaskDraft=Object.freeze({title:'',content:'',intentId:'',binding:''});
export const localTaskDraftOwner=(form:'text'|'draft')=>({kind:'local-task-form' as const,form});
export const localTaskDraftBasis=(form:'text'|'draft')=>JSON.stringify({basis:'local-task-form:v1:'+form,variableArrays:[]});
const raw=Schema.Struct({title:Schema.String.pipe(Schema.maxLength(200)),content:Schema.String.pipe(Schema.maxLength(LOCAL_TASK_DRAFT_STRING_LIMIT)),intentId:Schema.String,binding:Schema.String});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function parseLocalTaskDraft(value:unknown):LocalTaskDraft{
 const parsed=Schema.decodeUnknownSync(raw,{onExcessProperty:'error'})(value);
 if(!((parsed.intentId===''&&parsed.binding==='')||(uuid.test(parsed.intentId)&&/^local-task-start-form:v1:[0-9a-f]{64}$/.test(parsed.binding))))throw Error('The earlier local save identity needs review.');
 return parsed;
}
/** Only explicit submission normalizes title or rejects invalid source text. */
export function localTaskDraftInput(form:'text'|'draft',value:LocalTaskDraft,intentId:string):LocalTaskStartInput{
 return readLocalTaskStart({kind:form,title:value.title,content:value.content,intentId});
}
