import {experimentExampleLimits} from './experiment-examples';
import {Schema} from 'effect';
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
export const TargetDraftOwnerSchema=Schema.Struct({kind:Schema.Literal('experiment-target-practice'),taskId:id,artifactId:id,artifactRevision:Schema.Int.pipe(Schema.positive()),artifactDigest:id});
export type TargetDraftOwner=typeof TargetDraftOwnerSchema.Type;
export const TARGET_REVIEW_SLOT='experiment-target:review',TARGET_INTENT_SLOT='experiment-target:save';
export const emptyTargetReview={variable:'',examplesText:'[]',answer:'',reasoning:''},emptyTargetIntent={pendingText:''};
const review=Schema.Struct({variable:Schema.String.pipe(Schema.maxLength(32)),examplesText:Schema.String.pipe(Schema.maxLength(experimentExampleLimits.rawCharacters)),answer:Schema.String.pipe(Schema.maxLength(80)),reasoning:Schema.String.pipe(Schema.maxLength(2000))});
const intent=Schema.Struct({pendingText:Schema.String.pipe(Schema.maxLength(16000))});
export function readTargetDraft(slot:string,value:unknown){
 const schema=slot===TARGET_REVIEW_SLOT?review:slot===TARGET_INTENT_SLOT?intent:undefined;if(!schema)throw Error('Unsupported target-practice draft slot.');
 // These closed raw string forms have larger limits than executable table cells.
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Target-practice raw fields must be a plain record.');
 const keys=Reflect.ownKeys(value);if(keys.length>Object.keys(schema.fields).length)throw Error('Target-practice raw fields are unsupported.');const fields:Record<string,string>={};
 for(const key of keys){const entry=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!Object.hasOwn(schema.fields,key)||!entry?.enumerable||!('value' in entry)||typeof entry.value!=='string'||entry.value.length>experimentExampleLimits.rawCharacters)throw Error('Target-practice raw fields are unsupported.');fields[key]=entry.value;}
 if(slot===TARGET_REVIEW_SLOT)return Schema.decodeUnknownSync(review,{onExcessProperty:'error'})(fields);
 return Schema.decodeUnknownSync(intent,{onExcessProperty:'error'})(fields);
}
export const targetDraftIdentity=(owner:TargetDraftOwner,slot:string)=>JSON.stringify(['experiment-target-raw-v1',owner,slot]);
export const targetDraftBasis=(owner:TargetDraftOwner,slot:string)=>JSON.stringify({basis:targetDraftIdentity(owner,slot),variableArrays:[]});
