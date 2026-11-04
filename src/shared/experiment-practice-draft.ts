import {Schema} from 'effect';
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
export const ExperimentPracticeOwnerSchema=Schema.Struct({kind:Schema.Literal('experiment-practice'),taskId:id,artifactId:id,artifactRevision:Schema.Int.pipe(Schema.positive()),artifactDigest:id});
export type ExperimentPracticeOwner=typeof ExperimentPracticeOwnerSchema.Type;
export const EXPERIMENT_PRACTICE_SLOT='experiment:prediction';
export const EXPERIMENT_PRACTICE_INTENT_SLOT='experiment:prediction-save';
export const emptyExperimentPractice={inputsText:'{}',prediction:'',reasoning:'',examplesText:''};
export const emptyExperimentPracticeIntent={pendingText:''};
const raw=Schema.Struct({inputsText:Schema.String.pipe(Schema.maxLength(4096)),prediction:Schema.String.pipe(Schema.maxLength(80)),reasoning:Schema.String.pipe(Schema.maxLength(2000)),examplesText:Schema.String.pipe(Schema.maxLength(16384))});
const intent=Schema.Struct({pendingText:Schema.String.pipe(Schema.maxLength(32768))});
function fields(value:unknown,keys:readonly string[]){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Experiment practice requires plain raw fields.');
 const result:Record<string,string>={};
 for(const key of Reflect.ownKeys(value)){const entry=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!keys.includes(key)||!entry?.enumerable||!('value' in entry)||typeof entry.value!=='string')throw Error('Unsupported experiment practice field.');result[key]=entry.value;}
 return result;
}
export function readExperimentPracticeDraft(value:unknown){return Schema.decodeUnknownSync(raw,{onExcessProperty:'error'})(fields(value,Object.keys(raw.fields)));}
export function readExperimentPracticeIntent(value:unknown){return Schema.decodeUnknownSync(intent,{onExcessProperty:'error'})(fields(value,Object.keys(intent.fields)));}
export const experimentPracticeDraftIdentity=(owner:ExperimentPracticeOwner)=>JSON.stringify(['experiment-practice-raw-v1',owner]);
export const experimentPracticeDraftBasis=(owner:ExperimentPracticeOwner,slot=EXPERIMENT_PRACTICE_SLOT)=>JSON.stringify({basis:slot===EXPERIMENT_PRACTICE_SLOT?experimentPracticeDraftIdentity(owner):JSON.stringify(['experiment-practice-intent-v1',owner,slot]),variableArrays:[]});
