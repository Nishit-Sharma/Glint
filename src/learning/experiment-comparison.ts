import {evaluateExperiment,evaluateExperimentWithTrace,type ExperimentTraceStep} from '../core/experiments';
import type {ArtifactRef,ExperimentResult,ExperimentSpec,SourceRef} from '../core/types';
import {experimentExampleLimits} from '../shared/experiment-examples';
export type ExperimentSnapshot={title:string;spec:ExperimentSpec;inputs:Record<string,number>;result:ExperimentResult;owner:{taskId:string;artifact:ArtifactRef;sourceRefs:SourceRef[]}};
export const sameExperimentOwner=(a:ExperimentSnapshot['owner'],b:ExperimentSnapshot['owner'])=>JSON.stringify(a)===JSON.stringify(b);
const method=(spec:ExperimentSpec)=>JSON.stringify({expression:spec.expression,variables:spec.variables,assumptions:spec.assumptions});
export function sameExperimentMethod(a:ExperimentSpec,b:ExperimentSpec){return method(a)===method(b);}
/** Results were requested explicitly; this does not infer causation or evaluate a new case. */
export function compareExperimentSnapshots(baseline:ExperimentSnapshot,current:ExperimentSnapshot){
 if(!sameExperimentOwner(baseline.owner,current.owner))return {kind:'incompatible' as const,reason:'The source experiment or its saved links changed. Choose a new baseline.'};
 if(!sameExperimentMethod(baseline.spec,current.spec))return {kind:'incompatible' as const,reason:'The formula, input definitions or assumptions changed. Choose a new baseline.'};
 if(!Number.isFinite(baseline.result.value)||!Number.isFinite(current.result.value)||!baseline.result.unit||baseline.result.unit!==current.result.unit||JSON.stringify(baseline.result.assumptions)!==JSON.stringify(baseline.spec.assumptions)||JSON.stringify(current.result.assumptions)!==JSON.stringify(current.spec.assumptions))return {kind:'incompatible' as const,reason:'The calculated results or units need review. Choose a new baseline.'};
 const variables=baseline.spec.variables;if(variables.some(v=>!Number.isFinite(baseline.inputs[v.name])||!Number.isFinite(current.inputs[v.name]))||Object.keys(baseline.inputs).length!==variables.length||Object.keys(current.inputs).length!==variables.length)return {kind:'incompatible' as const,reason:'A calculated input is unavailable. Choose a new baseline.'};
 try {
  for(const snapshot of [baseline,current]){const checked=evaluateExperiment(snapshot.spec,snapshot.inputs);if(checked.value!==snapshot.result.value||checked.unit!==snapshot.result.unit)return {kind:'incompatible' as const,reason:'The calculated results or units need review. Choose a new baseline.'};}
 } catch {return {kind:'incompatible' as const,reason:'The calculation uses unsupported inputs, units or arithmetic. Choose a new baseline.'};}
 const changed=variables.filter(v=>baseline.inputs[v.name]!==current.inputs[v.name]).map(v=>({name:v.name,unit:v.unit,before:baseline.inputs[v.name],after:current.inputs[v.name]})),delta=current.result.value-baseline.result.value;
 if(!Number.isFinite(delta))return {kind:'incompatible' as const,reason:'The calculated difference is outside supported numeric bounds.'};
 return {kind:'comparable' as const,changed,delta:Object.is(delta,-0)?0:delta,unit:current.result.unit};
}

const symbol={add:'+',subtract:'−',multiply:'×',divide:'÷'};
export const traceQuantity=(step:Pick<ExperimentTraceStep,'value'|'unit'>)=>String(step.value)+(step.unit==='1'?'':' '+step.unit);

/** Compare existing snapshots only, keeping combined input effects separate from real-world causation. */
export function explainExperimentComparison(baseline:ExperimentSnapshot,current:ExperimentSnapshot){
 const comparison=compareExperimentSnapshots(baseline,current);if(comparison.kind==='incompatible')return comparison;
 const before=evaluateExperimentWithTrace(baseline.spec,baseline.inputs).steps,after=evaluateExperimentWithTrace(current.spec,current.inputs).steps;
 const beforeById=new Map(before.map(step=>[step.id,step])),afterById=new Map(after.map(step=>[step.id,step]));
 const operations=after.filter(step=>step.inputs.length||step.id==='result'),numbers=new Map(operations.map((step,index)=>[step.id,index+1]));
 const operand=(step:ExperimentTraceStep)=>step.op==='variable'?step.name!:step.op==='constant'?traceQuantity(step):'Step '+numbers.get(step.id);
 const equation=(step:ExperimentTraceStep,byId:Map<string,ExperimentTraceStep>)=>{
  const inputs=step.inputs.map(id=>'('+traceQuantity(byId.get(id)!)+')');
  return step.op==='power'?inputs[0]+' ^ '+step.exponent+' = '+traceQuantity(step):step.inputs.length?inputs.join(' '+symbol[step.op as keyof typeof symbol]+' ')+' = '+traceQuantity(step):traceQuantity(step);
 };
 const steps=operations.map(step=>{
  const original=beforeById.get(step.id)!,inputs=step.inputs.map(id=>afterById.get(id)!);
  return {number:numbers.get(step.id)!,id:step.id,label:step.op==='power'?operand(inputs[0])+' ^ '+step.exponent:step.inputs.length?inputs.map(operand).join(' '+symbol[step.op as keyof typeof symbol]+' '):operand(step),before:equation(original,beforeById),after:equation(step,afterById),valueBefore:original.value,valueAfter:step.value,unit:step.unit,dependencies:step.inputs.map(id=>({label:operand(afterById.get(id)!),before:traceQuantity(beforeById.get(id)!),after:traceQuantity(afterById.get(id)!)}))};
 });
 return {kind:'explained' as const,comparison,steps};
}

export function experimentComparisonWorkedText(baseline:ExperimentSnapshot,current:ExperimentSnapshot){
 const explanation=explainExperimentComparison(baseline,current);if(explanation.kind==='incompatible')throw Error(explanation.reason);
 return ['Worked comparison (same formula and assumptions):',...explanation.steps.flatMap(step=>[`${step.number}. ${step.label}`,`   Baseline: ${step.before}`,`   Changed: ${step.after}`,`   Output ${step.valueBefore===step.valueAfter?'unchanged':'changed'}.`]),'These are combined recalculations, not isolated effects of each input or evidence of real-world causation.'].join('\n');
}

export type IsolatedExperimentTrial={name:string;inputUnit:string;before:number;after:number;inputs:Record<string,number>} & ({kind:'calculated';result:ExperimentResult;delta:number}|{kind:'unavailable';reason:string});
export type IsolatedExperimentChanges={kind:'isolated';trials:IsolatedExperimentTrial[];combinedDelta:number;unit:string;sum?:number;remainder?:number}|{kind:'incompatible';reason:string};
/** Hypothetical calculations with every other input held at the same baseline, never causal attribution. */
export function isolateExperimentChanges(baseline:ExperimentSnapshot,current:ExperimentSnapshot):IsolatedExperimentChanges{
 const comparison=compareExperimentSnapshots(baseline,current);if(comparison.kind==='incompatible')return comparison;
 const trials:IsolatedExperimentTrial[]=comparison.changed.map(variable=>{
  const inputs={...baseline.inputs,[variable.name]:current.inputs[variable.name]},entry={name:variable.name,inputUnit:variable.unit,before:variable.before,after:variable.after,inputs};
  try{const result=evaluateExperiment(baseline.spec,inputs),delta=result.value-baseline.result.value;if(result.unit!==comparison.unit||!Number.isFinite(delta))throw Error('The trial difference or unit is unsupported.');return {...entry,kind:'calculated' as const,result,delta:Object.is(delta,-0)?0:delta};}
  catch(error){return {...entry,kind:'unavailable' as const,reason:error instanceof Error?error.message:'This one-input combination cannot be calculated.'};}
 });
 const complete=trials.every(trial=>trial.kind==='calculated'),sum=complete?trials.reduce((value,trial)=>value+(trial.kind==='calculated'?trial.delta:0),0):undefined,remainder=sum===undefined?undefined:comparison.delta-sum;
 return {kind:'isolated',trials,combinedDelta:comparison.delta,unit:comparison.unit,...(sum!==undefined&&Number.isFinite(sum)&&remainder!==undefined&&Number.isFinite(remainder)?{sum:Object.is(sum,-0)?0:sum,remainder:Object.is(remainder,-0)?0:remainder}:{})};
}
export function retainExperimentExamples(previous:readonly Record<string,number>[],candidates:readonly Record<string,number>[],spec:ExperimentSpec){
 const key=(inputs:Record<string,number>)=>JSON.stringify(spec.variables.map(variable=>inputs[variable.name])),examples=previous.map(inputs=>({...inputs})),keys=new Set(examples.map(key));
 for(const inputs of candidates)if(!keys.has(key(inputs))){keys.add(key(inputs));examples.push({...inputs});}
 return examples.length>experimentExampleLimits.examples?{kind:'full' as const}:{kind:'retained' as const,examples};
}
export function retainTrialExamples(previous:readonly Record<string,number>[],trials:IsolatedExperimentTrial[],spec:ExperimentSpec){return retainExperimentExamples(previous,trials.flatMap(trial=>trial.kind==='calculated'?[trial.inputs]:[]),spec);}
export function isolatedExperimentWorkedText(baseline:ExperimentSnapshot,current:ExperimentSnapshot){
 const isolated=isolateExperimentChanges(baseline,current);if(isolated.kind==='incompatible')throw Error(isolated.reason);
 return ['One-input model trials (all other inputs held at the same baseline):',...isolated.trials.flatMap(trial=>[`Only ${trial.name}: ${trial.before} → ${trial.after} ${trial.inputUnit}`,`Inputs: ${baseline.spec.variables.map(variable=>`${variable.name} = ${trial.inputs[variable.name]} ${variable.unit}`).join(', ')}`,trial.kind==='calculated'?`Calculated trial: ${traceQuantity(trial.result)}; difference from baseline: ${traceQuantity({value:trial.delta,unit:isolated.unit})}.`:`Unavailable: ${trial.reason}`]),isolated.sum===undefined?'The sum and remaining difference are unavailable because at least one trial or its arithmetic is unsupported.':`Sum of one-input differences: ${traceQuantity({value:isolated.sum,unit:isolated.unit})}. Combined difference: ${traceQuantity({value:isolated.combinedDelta,unit:isolated.unit})}. Remaining difference: ${traceQuantity({value:isolated.remainder!,unit:isolated.unit})}.`,'These are bounded floating-point model comparisons. The remaining difference can reflect combined formula effects or rounding; it is not a causal attribution. Source links do not verify the formula.'].join('\n');
}
