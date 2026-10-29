import {evaluateExperiment} from '../../core/experiments';
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
