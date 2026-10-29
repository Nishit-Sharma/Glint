import type {truthChangeTrace} from '../../../learning/truth-change-trace';
import './truth-change-trace.css';

type Trace=NonNullable<ReturnType<typeof truthChangeTrace>>;
export function TruthChangeTrace({trace,stale}:{trace:Trace|null;stale:boolean}){
 return <section className="truth-change-trace" aria-label="Input change explanation">
  <h3>What changed from 00?</h3>
  {stale&&<p className="warning">This trace uses the saved reviewed assignment; the source now needs review.</p>}
  {!trace?<p>Select an input pair above to see its change from 00.</p>:<>
   <p>Reviewed assignment: <code>{trace.quote}</code></p><div className="truth-change-steps"><div><strong>Before</strong><span>{trace.inputs[0].name} = {trace.before.left}, {trace.inputs[1].name} = {trace.before.right}</span><span>{trace.outputName} = {trace.before.output}</span></div><div><strong>Selected</strong><span>{trace.inputs[0].name} = {trace.after.left}, {trace.inputs[1].name} = {trace.after.right}</span><span>{trace.outputName} = {trace.after.output}</span></div></div>
   <p>{trace.inputs.map(input=>`${input.name} ${input.before===input.after?'stays at '+input.before:'changes from '+input.before+' to '+input.after}`).join('; ')}.</p>
   <p>Output {trace.outputChanged?`changes from ${trace.before.output} to ${trace.after.output}`:`stays ${trace.after.output}`}.</p><p>{trace.explanation}</p>
   <p className="tiny">Binary values for the reviewed assignment only; this is not VHDL simulation.</p>
  </>}
 </section>;
}
