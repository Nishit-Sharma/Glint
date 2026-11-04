import {useState} from 'react';
import {joinLab,joinRewriteBounds,type JoinLesson,type JoinState,type Cell} from '../../../learning/join-lab';

const valueText=(value:Cell)=>value===null?'NULL':typeof value==='string'?JSON.stringify(value):String(value);
export function JoinRewriteCheck({data,state,pending=false}:{data:JoinLesson;state:JoinState;pending?:boolean}){
 const view=joinLab.observe(data,state),problem=view.problem;
 const [proposed,setProposed]=useState({...problem.join,mode:problem.join.mode==='INNER'?'LEFT' as const:'INNER' as const});
 const [result,setResult]=useState<ReturnType<typeof joinLab.compareRewrite>|null>(null),[error,setError]=useState('');
 if(!view.assessment)return null;
 const compatible=problem.left.columns.find(c=>c.id===proposed.leftColumnId)?.type===problem.right.columns.find(c=>c.id===proposed.rightColumnId)?.type;
 const change=(next:typeof proposed)=>{setProposed(next);setResult(null);setError('');};
 const witness=result?.witness;
 const description=witness?.change;
 const joinText=(keys:typeof proposed)=>`${keys.mode}: ${problem.left.title}.${problem.left.columns.find(c=>c.id===keys.leftColumnId)!.label} = ${problem.right.title}.${problem.right.columns.find(c=>c.id===keys.rightColumnId)!.label}`;
 return <details className="learning-practice-review"><summary>Check a join rewrite</summary><section aria-label="Bounded join rewrite check">
  <p>Would another join condition preserve the same output values and duplicate rows? Compare it with the applied condition: {joinText(problem.join)}.</p>
  <p>{joinRewriteBounds} Tables stay within 12 rows and 4 columns each.</p>
  <div className="learning-controls"><label>Proposed join type<select aria-label="Proposed join type" disabled={pending} value={proposed.mode} onChange={event=>change({...proposed,mode:event.target.value==='LEFT'?'LEFT':'INNER'})}><option>INNER</option><option>LEFT</option></select></label>
   {(['left','right'] as const).map(side=><label key={side}>Proposed {side} key<select aria-label={`Proposed ${side} key`} disabled={pending} value={side==='left'?proposed.leftColumnId:proposed.rightColumnId} onChange={event=>change({...proposed,[side==='left'?'leftColumnId':'rightColumnId']:event.target.value})}>{problem[side].columns.map(column=><option key={column.id} value={column.id}>{column.label} ({column.type})</option>)}</select></label>)}
  </div>
  {!compatible&&<p role="status">Choose keys with the same declared type. No coercion is performed.</p>}
  <button type="button" disabled={pending||!compatible} onClick={()=>{try{setResult(joinLab.compareRewrite(data,state,proposed));setError('');}catch(cause){setResult(null);setError(cause instanceof Error?cause.message:'Review the proposed keys.');}}}>Search bounded cases</button>
  <p className="learning-note">This inspection is unsaved. It changes no practice inputs, saved tables, prediction or database. After changing your practice, predict again before checking a rewrite.</p>
  {error&&<p role="alert">{error}</p>}
  {result&&<div aria-label="Join rewrite result"><p role="status">{witness?`Counterexample found after ${result.checkedCases} checked case(s).`:`No counterexample found within ${result.checkedCases} checked cases and the stated bounds. This is not proof of equivalence.`}</p><p>Applied revision {result.revision}. Proposed condition: {joinText(result.proposed)}.</p>
   {witness&&<><p>{description?.kind==='current'?'The applied tables already distinguish these conditions.':description?.kind==='empty'?`Synthetic counterexample: the ${description.side} table is empty.`:description?.kind==='cell'?`Synthetic counterexample: ${problem[description.side].title} row ${problem[description.side].rows.findIndex(row=>row.id===description.rowId)+1}, ${problem[description.side].columns.find(column=>column.id===description.columnId)!.label}: ${valueText(description.before)} → ${valueText(description.after)}. All other cells stay unchanged.`:''}</p><p>Applied condition: {witness.original.rowCount} output rows. Proposed rewrite: {witness.rewritten.rowCount} output rows. Comparison checks full output values with duplicates, ignoring row order.</p>
    <details><summary>Inspect exact counterexample tables and results</summary>
     {(['left','right'] as const).map(side=>{const table=witness.problem[side];return <div key={side} className="learning-table" role="region" tabIndex={0} aria-label={`Counterexample ${side} input`}><table><caption>Counterexample input · {table.title}</caption><thead><tr><th scope="col">Row</th>{table.columns.map(column=><th key={column.id} scope="col">{column.label}</th>)}</tr></thead><tbody>{table.rows.map((row,index)=><tr key={row.id}><th scope="row">{index+1}</th>{row.values.map((value,i)=><td key={i}>{valueText(value)}</td>)}</tr>)}</tbody></table>{!table.rows.length&&<p>No input rows.</p>}</div>;})}
     {([['Applied condition result',witness.original],['Proposed rewrite result',witness.rewritten]] as const).map(([label,observation])=><div key={label} className="learning-table" role="region" tabIndex={0} aria-label={label}><table><caption>{label}</caption><thead><tr><th scope="col">Left row</th><th scope="col">Right row</th><th scope="col">Left values</th><th scope="col">Right values</th></tr></thead><tbody>{observation.rows.map(row=><tr key={row.id}><td>{problem.left.rows.findIndex(input=>input.id===row.provenance.leftRowId)+1}</td><td>{row.provenance.rightRowId?problem.right.rows.findIndex(input=>input.id===row.provenance.rightRowId)+1:'Unmatched (NULL)'}</td><td>{row.leftValues.map(valueText).join(' | ')}</td><td>{row.rightValues.map(valueText).join(' | ')}</td></tr>)}</tbody></table>{!observation.rows.length&&<p>No output rows.</p>}</div>)}
    </details></>}
  </div>}
 </section></details>;
}
