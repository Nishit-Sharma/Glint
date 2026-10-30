import {evaluateExperiment,evaluateExperimentWithTrace,type ExperimentTraceStep} from '../../core/experiments';
import type {ArtifactRef,ExperimentResult,ExperimentSpec,SourceRef} from '../../core/types';
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
