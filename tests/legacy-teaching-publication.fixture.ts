// Seed pre-existing runner-era journals only. New local publication tests call the concrete methods.
import {formulaComparisonPublication} from '../src/core/formula-comparison-host';
import {readFormulaComparisonSubmission} from '../src/learning/formula-comparison';
import type {Companion} from '../src/core/companion';
import {sourceFormulaPublication} from '../src/core/source-formula-host';
import {experimentPracticePublication,readExperimentPracticeSubmission} from '../src/core/experiment-practice-host';
import {targetPracticePublication} from '../src/core/experiment-target-practice-host';
import {readSourceFormulaCommand} from '../src/learning/source-formula';
import {readTargetPracticeSubmission} from '../src/learning/experiment-target-practice';
type Method='saveSourceFormula'|'saveExperimentPractice'|'saveTargetPractice'|'saveFormulaComparison';
export function legacyTeachingBoundary(core:Companion,method:Method,run:Companion['runRequest']):Companion{
 return new Proxy(core,{get(target,key){if(key===method)return async(raw:unknown,guard?:()=>void)=>{
  const value=method==='saveSourceFormula'?readSourceFormulaCommand(raw):method==='saveExperimentPractice'?readExperimentPracticeSubmission(raw):method==='saveFormulaComparison'?readFormulaComparisonSubmission(raw):readTargetPracticeSubmission(raw),taskId='input' in value?value.input.taskId:value.taskId,task=await target.getTask(taskId);
  const publication=method==='saveSourceFormula'?sourceFormulaPublication(task,value as ReturnType<typeof readSourceFormulaCommand>):method==='saveExperimentPractice'?experimentPracticePublication(task,value as ReturnType<typeof readExperimentPracticeSubmission>):method==='saveFormulaComparison'?formulaComparisonPublication(task,value as ReturnType<typeof readFormulaComparisonSubmission>):targetPracticePublication(task,value as ReturnType<typeof readTargetPracticeSubmission>);
  if(publication.kind==='existing')return publication.result;
  const record=await run(publication.request,async()=>publication.artifact,guard);if(record.status!=='completed')throw Error('The original local publication was not confirmed. Inspect its outcome. '+(record.error??''));
  return target[method](raw,guard);
 };const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
}
