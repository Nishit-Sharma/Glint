import {Schema} from 'effect';
import {copyTableData} from '../learning/semantic-table-procedure';
export const SOURCE_FORMULA_DRAFT_SLOT='source-formula:review';
export const SOURCE_FORMULA_INTENT_SLOT='source-formula:save';
export const sourceFormulaDraftOwner=(taskId:string)=>({kind:'source-formula-review' as const,taskId});
export const sourceFormulaDraftBasis=(slot:string)=>JSON.stringify({basis:'source-formula-local-v1:'+slot,variableArrays:[]});
export const emptySourceFormulaDraft:SourceFormulaDraft=Object.freeze({sourceChoice:'',lineChoice:'',title:'',formula:'',variablesText:'{}',assumptions:'',correctionReason:''});
export const emptySourceFormulaIntent:{pendingText:string}=Object.freeze({pendingText:''});
const text=Schema.String.pipe(Schema.maxLength(32000));
const form=Schema.Struct({sourceChoice:text,lineChoice:text,title:text,formula:text,variablesText:text,assumptions:text,correctionReason:text});
const intent=Schema.Struct({pendingText:text});
export type SourceFormulaDraft=typeof form.Type;
export function readSourceFormulaDraft(slot:string,value:unknown){if(![SOURCE_FORMULA_DRAFT_SLOT,SOURCE_FORMULA_INTENT_SLOT].includes(slot))throw Error('Unsupported formula draft slot.');if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Formula drafts require plain raw fields.');const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(value);if(keys.length>7||keys.some(key=>typeof key!=='string'||['__proto__','prototype','constructor'].includes(key)))throw Error('Unsupported formula draft fields.');const raw:Record<string,string>={};for(const key of keys){const descriptor=descriptors[key as string];if(!descriptor||!('value' in descriptor)||!descriptor.enumerable||typeof descriptor.value!=='string')throw Error('Formula drafts require inert raw text.');raw[key as string]=descriptor.value;}return slot===SOURCE_FORMULA_DRAFT_SLOT?Schema.decodeUnknownSync(form,{onExcessProperty:'error'})(raw):Schema.decodeUnknownSync(intent,{onExcessProperty:'error'})(raw);}
const id=Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,80}$/)),digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),positive=Schema.Int.pipe(Schema.positive()),base={taskId:id,binding:digest};
const inspection=Schema.Union(Schema.Struct({...base,kind:Schema.Literal('saved'),artifactId:id,revision:positive,digest,alreadySaved:Schema.optional(Schema.Boolean)}),Schema.Struct({...base,kind:Schema.Literal('not-saved')}),Schema.Struct({...base,kind:Schema.Literal('running'),requestId:Schema.String.pipe(Schema.maxLength(100))}),Schema.Struct({...base,kind:Schema.Literal('terminal'),requestId:Schema.String.pipe(Schema.maxLength(100)),status:Schema.Literal('failed','cancelled','interrupted'),canRetry:Schema.Boolean}));
export const readSourceFormulaInspection=(value:unknown)=>Schema.decodeUnknownSync(inspection,{onExcessProperty:'error'})(copyTableData(value,4000,100));
