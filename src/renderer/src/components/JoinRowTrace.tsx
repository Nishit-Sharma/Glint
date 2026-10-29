import {useId,useState} from 'react';
import {joinLab,type Cell,type JoinLesson,type JoinState} from '../../../learning/join-lab';
import './join-row-trace.css';

function exactValue(value:Cell){return typeof value==='string'?JSON.stringify(value):value===null?'NULL':String(value);}
function rows(count:number){return `${count} output ${count===1?'row':'rows'}`;}

/** Read-only projection of the current checked observation; never a join executor. */
export function JoinRowTrace({data,state}:{data:JoinLesson;state:JoinState}){
 const {problem,observation,assessment}=joinLab.observe(data,state);
 const initial=observation?.contributions.reduce<(NonNullable<typeof observation>['contributions'][number])|undefined>((best,row)=>!best||row.outputCount>best.outputCount?row:best,undefined);
 const [selectedId,setSelectedId]=useState(initial?.leftRowId??''),[expanded,setExpanded]=useState(assessment?!assessment.correct:false);
 const selectId=useId(),summaryId=useId();
 // observe() deliberately withholds results for practice and transfer predictions.
 if(!observation||!assessment)return null;
 const contribution=observation.contributions.find(row=>row.leftRowId===selectedId)??initial;
 const rowIndex=problem.left.rows.findIndex(row=>row.id===contribution?.leftRowId);
 const rowName=`${problem.left.title} row ${rowIndex+1}`;
 const leftKey=problem.left.columns.find(column=>column.id===problem.join.leftColumnId);
 const rightKeyIndex=problem.right.columns.findIndex(column=>column.id===problem.join.rightColumnId);
 const rightKey=problem.right.columns[rightKeyIndex];
 return <details className="join-row-trace" open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}>
  <summary>Trace one input row</summary>
  {!contribution?<p>There are no left input rows, so this join produces no output rows.</p>:<>
   <p className="learning-note">{assessment.correct?'Inspect the keys behind the checked result.':'Follow one row to see where the checked count comes from.'} These comparisons use the applied tables.</p>
   <label htmlFor={selectId}>Choose a left input row</label>
   <select id={selectId} value={contribution.leftRowId} onChange={event=>setSelectedId(event.target.value)}>
    {observation.contributions.map((row,index)=><option key={row.leftRowId} value={row.leftRowId}>{problem.left.title} row {index+1} · {leftKey?.label}: {exactValue(row.key)}</option>)}
   </select>
   <div className="join-row-trace-result" aria-live="polite" aria-atomic="true">
    <p id={summaryId}><strong>{rowName} contributes {contribution.outputCount} of the {rows(observation.rowCount)}.</strong></p>
    {contribution.reason==='matches'?<p>{contribution.matchingRightRowIds.length===1?'One right row has the same non-NULL key.':'Each matching right row keeps a separate pair.'} Equal keys are compared exactly; duplicates stay separate.</p>:<p>{contribution.reason==='null-key'?'This left key is NULL. Equality is unknown, including when the right key is also NULL.':'No right row has an equal non-NULL key.'} {problem.join.mode==='LEFT'?'LEFT keeps this left row once, with NULL values for the right columns.':'INNER leaves this left row out.'}</p>}
   </div>
   <p className="join-row-trace-key"><span>{problem.left.title} · {leftKey?.label}</span><code>{exactValue(contribution.key)}</code></p>
   {problem.right.rows.length===0?<p>No right rows to compare.</p>:<ul className="join-row-comparisons" aria-label={`Key comparisons for ${rowName}`} aria-describedby={summaryId}>
    {problem.right.rows.map((right,index)=>{
     const value=right.values[rightKeyIndex],matches=contribution.matchingRightRowIds.includes(right.id),unknown=contribution.key===null||value===null;
     return <li key={right.id} data-match={matches?'yes':'no'}><span><strong>{problem.right.title} row {index+1}</strong><span className="join-row-trace-key-label">{rightKey?.label}: <code>{exactValue(value)}</code></span></span><span className="join-row-comparison-result">{matches?'Match · 1 pair':unknown?'Unknown (NULL)':'Different key'}</span></li>;
    })}
   </ul>}
   <p className="learning-note">The contributions of all {problem.left.rows.length} left input {problem.left.rows.length===1?'row':'rows'} add up to {rows(observation.rowCount)}.</p>
  </>}
 </details>;
}
