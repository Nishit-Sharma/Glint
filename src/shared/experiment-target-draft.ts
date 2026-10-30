import {Schema} from 'effect';
import {copyTableData} from '../learning/semantic-table-procedure';
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
export const TargetDraftOwnerSchema=Schema.Struct({kind:Schema.Literal('experiment-target-practice'),taskId:id,artifactId:id,artifactRevision:Schema.Int.pipe(Schema.positive()),artifactDigest:id});
export type TargetDraftOwner=typeof TargetDraftOwnerSchema.Type;
export const TARGET_REVIEW_SLOT='experiment-target:review',TARGET_INTENT_SLOT='experiment-target:save';
export const emptyTargetReview={variable:'',examplesText:'[]',answer:'',reasoning:''},emptyTargetIntent={pendingText:''};
const review=Schema.Struct({variable:Schema.String.pipe(Schema.maxLength(32)),examplesText:Schema.String.pipe(Schema.maxLength(4096)),answer:Schema.String.pipe(Schema.maxLength(80)),reasoning:Schema.String.pipe(Schema.maxLength(2000))});
const intent=Schema.Struct({pendingText:Schema.String.pipe(Schema.maxLength(16000))});
export function readTargetDraft(slot:string,value:unknown){const safe=copyTableData(value,32000,2000);if(slot===TARGET_REVIEW_SLOT)return Schema.decodeUnknownSync(review,{onExcessProperty:'error'})(safe);if(slot===TARGET_INTENT_SLOT)return Schema.decodeUnknownSync(intent,{onExcessProperty:'error'})(safe);throw Error('Unsupported target-practice draft slot.');}
export const targetDraftIdentity=(owner:TargetDraftOwner,slot:string)=>JSON.stringify(['experiment-target-raw-v1',owner,slot]);
export const targetDraftBasis=(owner:TargetDraftOwner,slot:string)=>JSON.stringify({basis:targetDraftIdentity(owner,slot),variableArrays:[]});
