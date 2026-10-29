import {useId} from 'react';
import {observeTruthPrediction,type BinaryAssignment} from '../../../learning/truth-table';
import {comparisonModule,type ModuleAction} from '../../../core/interactive-modules';

type Data=ReturnType<typeof comparisonModule.parse>;
type State=ReturnType<typeof comparisonModule.parseState>;
export function TruthPrediction({data,state,rule,pending,onAction}:{data:Data;state:State;rule:BinaryAssignment;pending:boolean;onAction:(action:ModuleAction)=>void|Promise<boolean>}){
 const group=useId(),result=observeTruthPrediction(rule,state.selectedRowId);
 return <section aria-label="Binary output prediction">
  <h3>{data.title}</h3><p>Reviewed source:</p><blockquote>{rule.quote}</blockquote><p>{data.question}</p>
  <p>Earlier exposure is not tracked. This binary Boolean model is not VHDL simulation and does not model timing or unknown values.</p>
  <fieldset><legend>Choose a predicted output</legend>{data.rows.map(row=><label key={row.id}><input type="radio" name={group} checked={state.selectedRowId===row.id} disabled={pending||!!result} onChange={()=>{if(!pending&&!result)void onAction({kind:'select',rowId:row.id,expectedRevision:state.revision});}}/> {row.label}</label>)}</fieldset>
  {result&&<div role="status"><p>Your saved prediction: {result.prediction}</p><p>Computed output: {result.output}. {result.correct?'Matches':'Does not match'} your prediction.</p><p>{result.explanation}</p></div>}
 </section>;
}
