import {evaluateExperiment,evaluateExperimentWithTrace} from '../core/experiments';
import type {ExperimentSpec} from '../core/types';
const quantity=(value:{value:number;unit:string})=>`${value.value}${value.unit==='1'?'':' '+value.unit}`;
const symbols={add:'+',subtract:'−',multiply:'×',divide:'÷'};

/** Computed arithmetic only; the user's reasoning is retained, never diagnosed by a model. */
export function experimentTeachingFeedback(spec:ExperimentSpec,inputs:Record<string,number>,prediction:number){
 if(!Number.isFinite(prediction)||Math.abs(prediction)>1e15)throw Error('Enter a finite prediction within supported bounds.');
 const {result,steps}=evaluateExperimentWithTrace(spec,inputs),byId=new Map(steps.map(step=>[step.id,step])),tolerance=Math.max(1e-9,Math.abs(result.value)*1e-9),difference=prediction-result.value,matches=Math.abs(difference)<=tolerance;
 const worked=steps.filter(step=>step.inputs.length||step.id==='result').map(step=>{const operands=step.inputs.map(id=>'('+quantity(byId.get(id)!)+')');return step.op==='power'?`${operands[0]} ^ ${step.exponent} = ${quantity(step)}`:step.inputs.length?`${operands.join(' '+symbols[step.op as keyof typeof symbols]+' ')} = ${quantity(step)}`:quantity(step);});
 const intermediate=steps.find(step=>step.id!=='result'&&step.inputs.length>0&&step.unit===result.unit&&Math.abs(step.value-prediction)<=Math.max(1e-9,Math.abs(step.value)*1e-9));
 const hint=!matches&&intermediate?` Your prediction matches an intermediate calculation (${quantity(intermediate)}). Check the remaining operations after that value; this numeric match alone does not identify your reasoning.`:'';
 const adaptation=matches?'Your numeric prediction agrees within tolerance. Apply the same steps to a different input set before revealing its result.':`Your prediction is ${difference<0?'below':'above'} the computed result by ${quantity({value:Math.abs(difference),unit:result.unit})}. Recalculate the steps in order, carrying each intermediate value and unit into the next operation, then try a different input set.${hint}`;
 return {result,matches,tolerance,worked,adaptation};
}

/** A bounded search, not a solver or a guarantee that a fresh case exists. */
export function nextExperimentCase(spec:ExperimentSpec,defaults:Record<string,number>,previous:Record<string,number>,examples:readonly Record<string,number>[]){
 const excluded=[defaults,previous,...examples],key=(input:Record<string,number>)=>JSON.stringify(spec.variables.map(variable=>input[variable.name])),keys=new Set(excluded.map(key));
 const outputs=excluded.map(input=>evaluateExperiment(spec,input).value);
 // shortcut: twelve samples per single input, upgrade to a domain-specific generator if coverage needs more combinations.
 for(const variable of spec.variables)for(let index=0;index<12;index++){
  const fraction=(index+1)/13,value=variable.min*(1-fraction)+variable.max*fraction,input={...previous,[variable.name]:variable.integer?Math.round(value):value};
  if(keys.has(key(input)))continue;
  try{const result=evaluateExperiment(spec,input);if(outputs.every(output=>Math.abs(output-result.value)>Math.max(1e-9,Math.abs(output)*1e-9,Math.abs(result.value)*1e-9)))return input;}catch{/* An invalid bounded sample grants no answer or new input case. */}
 }
 return undefined;
}
