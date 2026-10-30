import {useState} from 'react';
import {rangeSumIllustration,recognizeRangeSum,RANGE_SUM_LIMIT} from '../../../learning/python-range-sum';
import type {SourceFormulaPacket} from '../../../learning/source-formula';

export function RangeSumExplanation({packet,inputs}:{packet:Pick<SourceFormulaPacket,'input'|'citation'>;inputs:Record<string,number>}){
 const [mode,setMode]=useState<'quick'|'deep'|'visual'>('quick');
 if(packet.input.derivation!=='python-range-sum-v1')return null;
 const source=recognizeRangeSum(packet.citation.quote);if(!source)return null;
 let model;try{model=rangeSumIllustration(inputs.initial,inputs.count);}catch{return <p role="alert">The loop illustration requires whole-number initial and count values within its supported bounds.</p>;}
 return <section className="learning-tool" aria-label="Understand the derived range sum">
  <h3>Understand the derived range sum</h3><p>This is an arithmetic illustration of the reviewed idiom, not an executed Python trace. The current calculation uses initial = {model.initial}, count = {model.count}; source defaults remain initial = {source.initial}, count = {source.count}.</p>
  <div role="group" className="learning-modes" aria-label="Range-sum explanation style">{(['quick','deep','visual'] as const).map(value=><button key={value} type="button" aria-pressed={mode===value} onClick={()=>setMode(value)}>{value[0].toUpperCase()+value.slice(1)}</button>)}</div>
  {mode==='quick'?<p>{model.count===0?'The range is empty, so no value is added.':`The ${model.count} illustrative iterations add integers 0 through ${model.count-1}; the stop ${model.count} is excluded.`} Starting at {model.initial} gives {model.result}. Changing count changes which terms are included; it does not change the saved source.</p>:mode==='deep'?<div><p>For a whole-number count n, pair the terms 0 through n - 1 with the same list reversed. Each of the n pairs adds to n - 1. The two copies therefore total n × (n - 1), so one copy totals n × (n - 1) ÷ 2. When n is 0, the sum is empty and equals 0.</p><p>Then add the initial accumulator: {model.initial} + {model.count} × ({model.count} - 1) ÷ 2 = {model.result}. This identity applies to this exact +1, zero-start accumulation idiom; it does not model other loop bodies or arbitrary code.</p></div>:<div><p>Before any illustrative iteration: {source.accumulator} = {model.initial}.</p>{model.rows.length?<ol aria-label="Illustrative accumulator states">{model.rows.map(row=><li key={row.index}>{source.index} = {row.index}: {source.accumulator} {row.before} + {row.index} → {row.after}.</li>)}</ol>:<p>No illustrative body steps: count is 0.</p>}<p>After the illustrated accumulation: {source.accumulator} = {model.result}. The excluded stop {model.count} contributes nothing.</p></div>}
  <p>{RANGE_SUM_LIMIT}</p><p><a href="https://docs.python.org/3/library/stdtypes.html#typesseq-range">Python range reference</a> · <a href="https://docs.python.org/3/reference/compound_stmts.html#the-for-statement">for statement</a>. The arithmetic identity above is the model’s derivation.</p>
 </section>;
}
