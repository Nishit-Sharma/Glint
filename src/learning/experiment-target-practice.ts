import {evaluateExperiment} from '../core/experiments';
import type {ExperimentDraft} from '../core/model-drafts';
import type {ExperimentResult} from '../core/types';
import {Schema} from 'effect';
import {copyTableData} from './semantic-table-procedure';
import {pickingDigest} from '../shared/picking-digest';

export const TARGET_SHARING='Saving creates a regular local document with your first answer, exact reasoning and source citation. This saved content can be included in future AI or browser context under the existing request and source-sharing controls. Raw fields and local previews stay local; saving here makes no AI request.';

export const targetPracticeLimits=Object.freeze({samples:12,examples:2,reasonCharacters:2000,attempts:8});
export type TargetChallenge={variable:string;knownInputs:Record<string,number>;minimum:number;maximum:number;inputUnit:string;target:number;outputUnit:string;tolerance:number};
export type TargetProblem={challenge:TargetChallenge;witness:number;witnessResult:ExperimentResult};
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const ref=Schema.Struct({sourceId:id,version:Schema.Int.pipe(Schema.positive()),digest:id});
const basis=Schema.Struct({artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest:id});
const numericRecord=Schema.Record({key:Schema.String,value:Schema.Number});
const input=Schema.Struct({taskId:id,basis,expectedSourceRefs:Schema.Array(ref).pipe(Schema.minItems(1),Schema.maxItems(64)),variable:Schema.String.pipe(Schema.pattern(/^[A-Za-z][A-Za-z0-9_]{0,31}$/)),demonstratedInputs:Schema.Array(numericRecord).pipe(Schema.maxItems(2))});
const submission=Schema.Struct({...input.fields,answer:Schema.Number,reasoning:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(2000)),shareWithTask:Schema.Literal(true),retryOf:Schema.optional(id)});
export type TargetPracticeInput=typeof input.Type;
export type TargetPracticeSubmission=typeof submission.Type;
const read=<A,I>(schema:Schema.Schema<A,I>,raw:unknown):A=>Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(copyTableData(raw,32000,2000));
export const readTargetPracticeInput=(raw:unknown)=>read(input,raw);
export const readTargetPracticeSubmission=(raw:unknown)=>read(submission,raw);
const challengeSchema=Schema.Struct({variable:id,knownInputs:numericRecord,minimum:Schema.Number,maximum:Schema.Number,inputUnit:id,target:Schema.Number,outputUnit:id,tolerance:Schema.Number});
const replyOwner={taskId:id,binding:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))};
const inspectionSchema=Schema.Union(Schema.Struct({...replyOwner,kind:Schema.Literal('not-started'),challenge:challengeSchema,title:id}),Schema.Struct({...replyOwner,kind:Schema.Literal('running'),requestId:id}),Schema.Struct({...replyOwner,kind:Schema.Literal('terminal'),requestId:id,canRetry:Schema.Boolean}),Schema.Struct({...replyOwner,kind:Schema.Literal('completed','receipt-mismatch'),artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest:id,content:Schema.String.pipe(Schema.maxLength(32000)),submissionDigest:Schema.optional(Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)))}));
export const readTargetPracticeInspection=(raw:unknown)=>read(inspectionSchema,raw);
export const targetPracticeIdentity=(value:TargetPracticeInput,challenge:TargetChallenge)=>pickingDigest({taskId:value.taskId,basis:value.basis,sourceRefs:value.expectedSourceRefs,challenge});
/** Retry envelopes identify an attempt; the receipt binds all reviewed data,
 * including exact answer/reasoning, independently of challenge deduplication. */
export const targetSubmissionIdentity=(value:TargetPracticeSubmission)=>{const {retryOf,...submitted}=value;return pickingDigest({format:'experiment-target-submission-v1',...submitted});};
const fractions=[.25,.75,.5,.125,.875,.375,.625,0,1,.0625,.9375,.3125] as const;
export const targetTolerance=(value:number)=>Math.max(1e-9,Math.abs(value)*1e-9);

/** A finite target generator, not an inverse solver. A witness establishes only
 * that one sampled value works in this AST; alternative answers may also work. */
export function makeTargetProblem(draft:ExperimentDraft,variable:string,demonstratedInputs:readonly Record<string,number>[]=[]):TargetProblem{
 if(draft.unknownInputs?.length)throw Error('Confirm the saved input defaults before target practice.');
 if(demonstratedInputs.length>targetPracticeLimits.examples)throw Error('At most two current comparison examples are supported.');
 const selected=draft.spec.variables.find(item=>item.name===variable);
 if(!selected||selected.min===selected.max)throw Error('Choose a variable with a nonzero supported range.');
 const shown=[draft.inputs,...demonstratedInputs].map(inputs=>evaluateExperiment(draft.spec,inputs));
 const knownInputs=Object.fromEntries(draft.spec.variables.filter(item=>item.name!==variable).map(item=>[item.name,draft.inputs[item.name]]));
 const tried=new Set<number>();
 for(const fraction of fractions){
  const raw=selected.min+(selected.max-selected.min)*fraction,witness=Math.max(selected.min,Math.min(selected.max,Number(raw.toPrecision(12))));
  if(tried.has(witness)||witness===draft.inputs[variable])continue;tried.add(witness);
  let result:ExperimentResult;try{result=evaluateExperiment(draft.spec,{...knownInputs,[variable]:witness});}catch{continue;}
  if(shown.some(item=>item.unit===result.unit&&Math.abs(item.value-result.value)<=Math.max(targetTolerance(item.value),targetTolerance(result.value))))continue;
  return {challenge:{variable,knownInputs,minimum:selected.min,maximum:selected.max,inputUnit:selected.unit,target:result.value,outputUnit:result.unit,tolerance:targetTolerance(result.value)},witness,witnessResult:result};
 }
 throw Error('No distinct valid target was found in the twelve supported samples. Choose another variable or use separate forward practice. This does not establish that no solution exists.');
}

/** The proposal is graded by its calculated output, never by equality with the
 * generator's witness. This admits other valid solutions to nonlinear formulas. */
export function checkTargetAnswer(draft:ExperimentDraft,problem:TargetProblem,answer:number){
 if(!Number.isFinite(answer)||answer<problem.challenge.minimum||answer>problem.challenge.maximum)throw Error('Enter a finite value within the chosen variable range.');
 const inputs={...problem.challenge.knownInputs,[problem.challenge.variable]:answer},result=evaluateExperiment(draft.spec,inputs);
 return {inputs,result,matches:Math.abs(result.value-problem.challenge.target)<=problem.challenge.tolerance};
}
