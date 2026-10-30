import {expect,test} from 'vitest';
import {recognizeRangeSum,rangeSumIllustration,rangeSumVariables,RANGE_SUM_FORMULA,RANGE_SUM_ASSUMPTION} from '../src/learning/python-range-sum';
import {parseSourceFormula,buildSourceFormulaDraft,type SourceFormulaInput} from '../src/learning/source-formula';
import {parseModelDraft} from '../src/core/model-drafts';
import {evaluateExperiment} from '../src/core/experiments';
import {makeTargetProblem,checkTargetAnswer} from '../src/learning/experiment-target-practice';

export const rangeSource='total = 2\nfor item in range(5):\n    total += item';
const source=recognizeRangeSum(rangeSource)!;
const input:SourceFormulaInput={taskId:'task',sourceRef:{sourceId:'source',version:1,digest:'a'.repeat(64)},lineNumber:1,start:0,end:source.end,title:'Reviewed range sum',formula:RANGE_SUM_FORMULA,variables:rangeSumVariables(source),assumptions:[RANGE_SUM_ASSUMPTION],correctionReason:'Derived arithmetic from the reviewed idiom.',confirmed:'reviewed-source-transcription',derivation:'python-range-sum-v1'};
const draft=()=>buildSourceFormulaDraft(input,{sourceRef:input.sourceRef,lineNumber:1,start:0,end:source.end,quote:rangeSource,lineCount:3});
test('recognizes exactly three complete lines and source literals, preserving exact CRLF and final-line boundaries',()=>{
 expect(source).toMatchObject({accumulator:'total',index:'item',initial:2,count:5,quote:rangeSource});const text=rangeSource.replaceAll('\n','\r\n')+'\r\n',result=recognizeRangeSum(text)!;expect(result.quote).toBe(rangeSource.replaceAll('\n','\r\n'));expect(text.slice(0,result.end)).toBe(result.quote);
});
test.each([
 'total = 2\nfor item in range(-1):\n    total += item',rangeSource.replace('range(5)','range(2.5)'),rangeSource.replace('range(5)','range(33)'),rangeSource.replace('range(5)','range(0, 5)'),rangeSource.replace('range(5)','range(limit)'),rangeSource.replace('range(5)','range(05)'),rangeSource.replace('total = 2','total = 101'),rangeSource.replace('    total += item','    total += 1'),rangeSource.replace('    total += item','\ttotal += item'),rangeSource+'\nprint(total)', 'import os\n'+rangeSource,rangeSource.replaceAll('total','range'),rangeSource.replaceAll('item','for'),rangeSource.replaceAll('item','total'),rangeSource.replace('total = 2','total = 1.5'),rangeSource+'\n\n',
])('refuses unsupported source rather than reinterpreting it: %s',text=>expect(recognizeRangeSum(text)).toBeNull());
test('99 boundary and representative initial/count combinations agree with the derived bounded arithmetic model, including empty and one-term cases',()=>{
 const spec=draft().spec;
 for(const initial of [-100,0,100])for(let count=0;count<=32;count++){
  const illustration=rangeSumIllustration(initial,count);expect(illustration.rows).toHaveLength(count);expect(illustration.rows.map(row=>row.index)).toEqual(Array.from({length:count},(_,i)=>i));expect(evaluateExperiment(spec,{initial,count}).value).toBe(illustration.result);if(count)expect(illustration.rows.at(-1)!.after).toBe(illustration.result);else expect(illustration.result).toBe(initial);
 }
});
test('integer domains reject unsupported metadata, bounds and fractional values in shared parser/evaluator',()=>{
 const value=draft();for(const integer of [false,'integer',1,null]){const forged={...value,spec:{...value.spec,variables:value.spec.variables.map(v=>({...v,integer}))}};expect(()=>parseModelDraft(JSON.stringify(forged),'experiment')).toThrow();expect(()=>evaluateExperiment(forged.spec as any,value.inputs)).toThrow();}
 for(const count of [-1,.5,32.5,33,NaN,Infinity]){expect(()=>evaluateExperiment(value.spec,{initial:2,count})).toThrow();expect(()=>rangeSumIllustration(2,count)).toThrow();}
 expect(()=>evaluateExperiment({...value.spec,variables:value.spec.variables.map(v=>({...v,min:.1}))},value.inputs)).toThrow();
 const ordinary={...value,spec:{...value.spec,variables:value.spec.variables.map(({integer,...v})=>v)},inputs:{initial:2,count:2.5}};expect(parseModelDraft(JSON.stringify(ordinary),'experiment')).toMatchObject({inputs:ordinary.inputs});expect(evaluateExperiment(ordinary.spec,ordinary.inputs).value).toBe(3.875);
});
test('distinct target sampling stays integral and excludes saved/current example results; answer entry rechecks the integer spec',()=>{
 const value=draft(),shown={initial:2,count:8},problem=makeTargetProblem(value,'count',[shown]);expect(problem.challenge.integer).toBe(true);expect(Number.isInteger(problem.witness)).toBe(true);expect(problem.challenge.target).not.toBe(evaluateExperiment(value.spec,value.inputs).value);expect(problem.challenge.target).not.toBe(evaluateExperiment(value.spec,shown).value);expect(checkTargetAnswer(value,problem,problem.witness).matches).toBe(true);
 for(const count of [-1,.5,33])expect(()=>checkTargetAnswer(value,problem,count)).toThrow();expect(()=>checkTargetAnswer(value,{...problem,challenge:{...problem.challenge,integer:undefined}},.5)).toThrow();expect(()=>makeTargetProblem({...value,inputs:{initial:2,count:.5}},'count')).toThrow();expect(()=>makeTargetProblem(value,'count',[{initial:2,count:2.5}])).toThrow();
});
test('the source-to-model contract refuses formula/default/domain/bounds/assumption mismatches',()=>{
 const citation={sourceRef:input.sourceRef,lineNumber:1,start:0,end:source.end,quote:rangeSource,lineCount:3 as const};for(const change of [{formula:'initial + count'},{variables:input.variables.map(v=>v.name==='count'?{...v,value:6}:v)},{variables:input.variables.map(v=>({...v,integer:undefined}))},{variables:input.variables.map(v=>({...v,max:100}))},{assumptions:['Any loop.']}])expect(()=>buildSourceFormulaDraft({...input,...change},citation)).toThrow();expect(()=>buildSourceFormulaDraft(input,{...citation,lineCount:undefined})).toThrow();expect(parseSourceFormula(RANGE_SUM_FORMULA).variables).toEqual(['initial','count']);
});
