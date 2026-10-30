import {useState} from 'react';
import {explainExperimentComparison,traceQuantity,type ExperimentSnapshot} from '../experiment-comparison';

export function ExperimentChangeExplanation({baseline,current}:{baseline:ExperimentSnapshot;current:ExperimentSnapshot}){
 const [mode,setMode]=useState<'quick'|'deep'|'visual'>('quick');
 const explanation=explainExperimentComparison(baseline,current);
 if(explanation.kind==='incompatible')return <p role="alert">{explanation.reason}</p>;
 const {comparison,steps}=explanation;
 return <section className="experiment-change-explanation" aria-label="Understand this calculation change">
  <div role="group" className="learning-modes" aria-label="Calculation explanation style">{(['quick','deep','visual'] as const).map(value=><button key={value} type="button" aria-pressed={mode===value} onClick={()=>setMode(value)}>{value[0].toUpperCase()+value.slice(1)}</button>)}</div>
  {mode==='quick'?<div aria-label="Quick calculation explanation">
   <p>{comparison.changed.length===0?'The input values are identical.':comparison.changed.length===1?'One input changed.':'Several inputs changed together.'} Recalculating the same formula gives {traceQuantity(baseline.result)} → {traceQuantity(current.result)}; difference {traceQuantity({value:comparison.delta,unit:comparison.unit})}.</p>
   {comparison.changed.length>0&&comparison.delta===0&&<p>The changed inputs give the same final value. Deep and Visual show where intermediate values changed or stayed equal.</p>}
   <p className="structured-help">Deep shows each arithmetic step; Visual connects its inputs to its output.</p>
  </div>:mode==='deep'?<ol className="experiment-worked-steps" aria-label="Worked calculation steps">{steps.map(step=><li key={step.id}><strong>{step.label}</strong><p>Baseline: <code>{step.before}</code></p><p>Changed: <code>{step.after}</code></p><p className="structured-help">Output {step.valueBefore===step.valueAfter?'unchanged':'changed'}.</p></li>)}</ol>:<ol className="experiment-calculation-flow" aria-label="Calculation dependency flow">{steps.map(step=><li key={step.id}>
   <span className="experiment-flow-step">Step {step.number} · {step.label}</span>
   <ul aria-label={`Step ${step.number} inputs`}>{step.dependencies.length?step.dependencies.map((dependency,index)=><li key={index}><strong>{dependency.label}</strong><span>{dependency.before} → {dependency.after}</span></li>):<li>{step.before} → {step.after}</li>}</ul>
   <span className="experiment-flow-arrow" aria-hidden="true">↓</span>
   <p className="experiment-flow-output">Output: {traceQuantity({value:step.valueBefore,unit:step.unit})} → {traceQuantity({value:step.valueAfter,unit:step.unit})}<span>{step.valueBefore===step.valueAfter?'Unchanged':'Changed'}</span></p>
  </li>)}</ol>}
  <p className="structured-help">These are combined recalculations using floating-point arithmetic. They do not isolate each input’s effect or establish real-world causation. Source links do not verify the formula.</p>
 </section>;
}
