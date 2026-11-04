import {Schema} from 'effect';
import {parseSourceFormula} from './source-formula';
import {copyTableData} from './semantic-table-procedure';
import {evaluateExperimentWithTrace} from '../core/experiments';
import type {ExperimentDraft} from '../core/model-drafts';
import type {ExperimentSpec} from '../core/types';
import {pickingDigest} from '../shared/picking-digest';
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200)),finite=Schema.Number.pipe(Schema.finite(),Schema.between(-1e9,1e9));
export const FormulaComparisonInputSchema=Schema.Struct({taskId:id,basis:Schema.Struct({artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest:id}),expectedSourceRefs:Schema.Array(Schema.Struct({sourceId:id,version:Schema.Int.pipe(Schema.positive()),digest:id})).pipe(Schema.minItems(1),Schema.maxItems(64)),formula:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(2000)),variable:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(32)),minimum:finite,maximum:finite,prediction:Schema.Literal('difference','none'),reasoning:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(1000))});
const submission=Schema.Struct({...FormulaComparisonInputSchema.fields,freshPrediction:Schema.NullOr(Schema.String.pipe(Schema.minLength(1),Schema.maxLength(80),Schema.filter(value=>!!value.trim()&&Number.isFinite(Number(value))&&Math.abs(Number(value))<=2e15))),shareWithTask:Schema.Literal(true)});
export type FormulaComparisonInput=typeof FormulaComparisonInputSchema.Type;
export type FormulaComparisonSubmission=typeof submission.Type;
const decode=<A,I>(schema:Schema.Schema<A,I>,value:unknown)=>Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(copyTableData(value,32000,3000));
export const readFormulaComparisonInput=(value:unknown)=>decode(FormulaComparisonInputSchema,value);
export const readFormulaComparisonSubmission=(value:unknown)=>decode(submission,value);
export const formulaComparisonIdentity=(value:FormulaComparisonInput|FormulaComparisonSubmission)=>pickingDigest(value);
export const FORMULA_COMPARISON_SHARING='Saving creates a regular local report containing your exact formulas, source quotation, assumptions, predictions and reasoning. This content can enter later AI or browser context under the existing sharing controls. Preview and raw edits stay local.';
type Calculation=ReturnType<typeof evaluateExperimentWithTrace>;
type Outcome={kind:'value';calculation:Calculation}|{kind:'unsupported';reason:string};
const calculate=(spec:ExperimentSpec,inputs:Record<string,number>):Outcome=>{try{return {kind:'value',calculation:evaluateExperimentWithTrace(spec,inputs)};}catch(error){return {kind:'unsupported',reason:error instanceof Error?error.message:'Unsupported calculation.'};}};
const tolerance=(a:number,b:number)=>Math.max(1e-9,Math.abs(a)*1e-9,Math.abs(b)*1e-9);
function compare(original:Outcome,alternative:Outcome){
 if(original.kind==='unsupported'&&alternative.kind==='unsupported')return 'both-unsupported' as const;
 if(original.kind!==alternative.kind)return 'domain-difference' as const;
 if(original.kind!=='value'||alternative.kind!=='value')throw Error('Unsupported comparison.');
 if(original.calculation.result.unit!==alternative.calculation.result.unit)return 'unit-difference' as const;
 return Math.abs(original.calculation.result.value-alternative.calculation.result.value)>tolerance(original.calculation.result.value,alternative.calculation.result.value)?'numeric-difference' as const:'agreement' as const;
}
/** One-dimensional samples only. Nothing here proves an identity or a real-world model. */
export function compareFormula(draft:ExperimentDraft,input:FormulaComparisonInput){
 // The saved input domain still applies when the alternative uses no variables.
 const variable=draft.spec.variables.find(item=>item.name===input.variable),parsed=parseSourceFormula(input.formula,true);
 if(draft.unknownInputs?.length||!variable||input.minimum>=input.maximum||input.minimum<variable.min||input.maximum>variable.max||variable.integer&&(!Number.isSafeInteger(input.minimum)||!Number.isSafeInteger(input.maximum)))throw Error('Choose a nonzero subrange within the saved input bounds and domain.');
 if(!input.reasoning.trim()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input.reasoning))throw Error('Enter reasoning without control characters.');
 if(parsed.variables.some(name=>!draft.spec.variables.some(item=>item.name===name)))throw Error('The alternative may use only the saved input names. Units and assumptions stay fixed.');
 const spec={...draft.spec,expression:parsed.expression},values=new Set<number>();
 for(let index=0;index<=16;index++){const value=input.minimum*(1-index/16)+input.maximum*(index/16);values.add(variable.integer?Math.round(value):value);}
 const rows=[...values].map(value=>{const inputs={...draft.inputs,[input.variable]:value},original=calculate(draft.spec,inputs),alternative=calculate(spec,inputs);return {inputs,original,alternative,kind:compare(original,alternative)};});
 const witness=rows.find(row=>row.kind!=='agreement'&&row.kind!=='both-unsupported');
 // shortcut: 31 interior samples for a separate valid case, upgrade only when another domain needs a generator.
 let fresh:Record<string,number>|null=null;
 for(let index=1;index<32;index++){const raw=input.minimum*(1-index/32)+input.maximum*(index/32),value=variable.integer?Math.round(raw):raw;if(values.has(value)||value===draft.inputs[input.variable])continue;const inputs={...draft.inputs,[input.variable]:value},a=calculate(draft.spec,inputs),b=calculate(spec,inputs);if(a.kind==='value'&&b.kind==='value'&&a.calculation.result.unit===b.calculation.result.unit){fresh=inputs;break;}}
 return {rows,witness,fresh,spec};
}
const outcomeText=(outcome:Outcome)=>outcome.kind==='unsupported'?`Unsupported: ${outcome.reason}`:`${outcome.calculation.result.value} ${outcome.calculation.result.unit}`;
function trace(outcome:Outcome){return outcome.kind==='unsupported'?outcomeText(outcome):outcome.calculation.steps.map(step=>`${step.id}: ${step.op}${step.inputs.length?' ['+step.inputs.join(', ')+']':''}${step.name?' '+step.name:''}${step.exponent!==undefined?' ^ '+step.exponent:''} → ${step.value} ${step.unit}`).join('\n');}
export function formulaComparisonPreview(draft:ExperimentDraft,input:FormulaComparisonInput){
 const result=compareFormula(draft,input),valid=result.rows.filter(row=>row.kind==='agreement').length,skipped=result.rows.filter(row=>row.kind==='both-unsupported').length;
 const content=`Bounded formula comparison\n\nYour prediction: ${input.prediction==='difference'?'A difference will appear.':'No difference will appear in these samples.'}\nYour reasoning (retained, not graded):\n${input.reasoning}\n\nOnly ${input.variable} varies from ${input.minimum} to ${input.maximum}; other saved inputs, units and assumptions stay fixed. Up to 17 evenly spaced samples including endpoints are rounded for integer inputs and deduplicated.\n\n${result.witness?`A ${result.witness.kind} was found at ${JSON.stringify(result.witness.inputs)}.\nSaved formula: ${outcomeText(result.witness.original)}\nAlternative: ${outcomeText(result.witness.alternative)}\n\nSaved formula trace:\n${trace(result.witness.original)}\n\nAlternative trace:\n${trace(result.witness.alternative)}\n\nYour prediction ${input.prediction==='difference'?'matches':'differs from'} this observed sample finding. Inspect the operations and units at this witness. A numeric match alone does not diagnose your reasoning; revise the alternative explicitly to check a proposed correction.`:`No counterexample found within these ${result.rows.length} samples; ${valid} comparable agreements, ${skipped} cases unsupported by both formulas. This is not a proof of equivalence or full domain coverage.`}\n\nAll checked samples:\n${result.rows.map(row=>`${input.variable}=${row.inputs[input.variable]}: ${row.kind}; saved ${outcomeText(row.original)}; alternative ${outcomeText(row.alternative)}`).join('\n')}\n\nFloating-point comparison uses max(1e-9, |saved|×1e-9, |alternative|×1e-9) output units. A domain difference means one evaluation was unsupported, not necessarily mathematically undefined. Unit mismatches are not numeric comparisons. Assumption text is declared, not machine-checked. No source code, symbolic solver or real-world experiment runs.`;
 return {content,fresh:result.fresh,freshUnit:result.fresh?evaluateExperimentWithTrace(draft.spec,result.fresh).result.unit:null};
}
export function formulaComparisonReport(draft:ExperimentDraft,input:FormulaComparisonSubmission){
 const preview=formulaComparisonPreview(draft,input),result=compareFormula(draft,input);
 if(!preview.fresh){if(input.freshPrediction!==null)throw Error('No supported separate case exists in the bounded generator.');return preview.content+'\n\nNo separate valid input was found in 31 interior samples outside the comparison set and saved defaults. Fresh application is unavailable in this bounded generator; no mastery claim follows.';}
 if(input.freshPrediction===null)throw Error('Predict the output difference at the separate input before saving.');
 const a=evaluateExperimentWithTrace(draft.spec,preview.fresh),b=evaluateExperimentWithTrace(result.spec,preview.fresh),difference=b.result.value-a.result.value,t=tolerance(a.result.value,b.result.value),matches=Math.abs(Number(input.freshPrediction)-difference)<=t;
 return preview.content+`\n\nSeparate application (outside the comparison samples and saved defaults; earlier exposure unknown):\nInputs: ${JSON.stringify(preview.fresh)}\nYour saved predicted alternative − saved output: ${input.freshPrediction} ${a.result.unit}\nComputed difference: ${difference} ${a.result.unit}\nPrediction ${matches?'agrees within':'differs beyond'} tolerance ${t}. Reasoning is not graded; this is not evidence of mastery.\n\nSaved formula application trace:\n${trace({kind:'value',calculation:a})}\n\nAlternative application trace:\n${trace({kind:'value',calculation:b})}`;
}
const responseBinding=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),freshInputs=Schema.NullOr(Schema.Record({key:Schema.String,value:Schema.Number.pipe(Schema.finite())}));
export const readFormulaComparisonPreview=(value:unknown)=>Schema.decodeUnknownSync(Schema.Struct({binding:responseBinding,content:Schema.String.pipe(Schema.maxLength(64000)),fresh:freshInputs,freshUnit:Schema.NullOr(Schema.String.pipe(Schema.maxLength(200)))}),{onExcessProperty:'error'})(value);
export const readFormulaComparisonInspection=(value:unknown)=>Schema.decodeUnknownSync(Schema.Union(Schema.Struct({kind:Schema.Literal('not-started','running'),binding:responseBinding}),Schema.Struct({kind:Schema.Literal('terminal'),binding:responseBinding,status:Schema.Literal('failed','cancelled','interrupted')}),Schema.Struct({kind:Schema.Literal('completed'),binding:responseBinding,artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest:id,content:Schema.String.pipe(Schema.maxLength(64000))})),{onExcessProperty:'error'})(value);
