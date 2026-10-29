import { useId, useState } from 'react';
import { joinLab,describeLastJoinChange,type LastJoinChange,type Cell, type JoinAction, type JoinLesson, type JoinState, type JoinCase, type Table } from '../../../learning/join-lab';
import {useGuardedAction,useNavigationForm,formSubmission,type FormSubmission} from '../draft-navigation';
import {ReadyArtifact} from './ReadyArtifact';
import {JoinRowTrace} from './JoinRowTrace';
import './learning-tools.css';

type Props = { data: JoinLesson; state: JoinState; pending?: boolean; onAction: (action: JoinAction) => void|Promise<boolean>; embedded?:boolean;humanLabels?:boolean;explanationMode?:'quick'|'deep'|'visual';dispatchFence?:number;motion?:{identity:string;arrivalIdentity:string} };
type InputAction=(action:JoinAction)=>FormSubmission|undefined;
function valueText(value: Cell) { return value === null ? 'NULL' : value === 'NULL' ? '"NULL"' : String(value); }
function rowName(table:Table,rowId:string){const index=table.rows.findIndex(row=>row.id===rowId);return `${table.title} row ${index<0?'from an earlier version':index+1}`;}
export function humanJoinAssessment(view:ReturnType<typeof joinLab.observe>){
 if(!view.observation||!view.assessment)return null;
 const {assessment,observation,problem}=view;
 const details=observation.contributions.map(value=>{
  const left=rowName(problem.left,value.leftRowId);
  if(value.reason==='matches')return `${left} matches ${value.matchingRightRowIds.map(id=>rowName(problem.right,id)).join(', ')} and contributes ${value.outputCount} row(s).`;
  const reason=value.reason==='null-key'?'has a NULL key; equality is unknown even against NULL':'has no equal non-NULL right key';
  return `${left} ${reason}, contributing ${value.outputCount}${problem.join.mode==='LEFT'?' null-extended row(s)':' rows under INNER'}.`;
 });
 return `${assessment.correct?'Correct.':`You predicted ${assessment.predictedCount}; the actual count is ${assessment.actualCount}.`} ${details.join(' ')} Each equal pair is kept; duplicate keys are not deduplicated. Right-side NULL keys never satisfy equality.`;
}
function cellDraft(value:Cell){return {text:value===null?'':String(value),isNull:value===null};}
function LastChangeComparison({problem,change,mode,priorPractice}:{problem:JoinCase;change:LastJoinChange;mode:'quick'|'deep'|'visual';priorPractice:boolean}){
 const description=describeLastJoinChange(problem,change);
 return <section aria-label="Last applied join change"><h4>{priorPractice?'Practice comparison saved before transfer':'Last applied practice change'}</h4><p>{description.summary}</p><p>These are hypothetical local practice edits. The original supplied practice data is unchanged.</p><ul aria-label="Changed join inputs">{description.edits.map((edit,index)=><li key={index}>{edit}</li>)}</ul><p>{description.effects}</p>
  {mode==='deep'&&<ul aria-label="Why the join rows changed">{description.rows.map(row=><li key={row.label}><strong>{row.label}</strong>: before {row.before}; after {row.after}.</li>)}</ul>}
  {mode==='visual'&&<div role="group" aria-label="Before and after row pairs">{description.rows.map(row=><section key={row.label} aria-label={row.label+' pair comparison'}><p><strong>{row.label}</strong></p><ol className="learning-pairs" aria-label={row.label+' before and after'}><li><span>Before</span><span aria-label="paired with">→</span><span>{row.beforePairs}</span></li><li><span>After</span><span aria-label="paired with">→</span><span>{row.afterPairs}</span></li></ol></section>)}</div>}
  {description.rows.length===0&&<p>No row contribution or displayed result value changed.</p>}
  {mode!=='quick'&&description.unchanged.length>0&&<p>Unchanged output contributions: {description.unchanged.join(', ')}.</p>}
  <details><summary>Changed result pairs</summary><ul>{description.added.map(pair=><li key={'added:'+pair}>Added: {pair}</li>)}{description.removed.map(pair=><li key={'removed:'+pair}>Removed: {pair}</li>)}{description.changed.map(pair=><li key={'values:'+pair}>Displayed values changed: {pair}</li>)}</ul>{!description.added.length&&!description.removed.length&&!description.changed.length&&<p>No result pair changed.</p>}</details>
 </section>;
}
function SavedPracticeReview({problem,review}:{problem:JoinCase;review:NonNullable<ReturnType<typeof joinLab.observe>['practiceReview']>}){
 const leftKey=problem.left.columns.find(c=>c.id===problem.join.leftColumnId)!,rightKey=problem.right.columns.find(c=>c.id===problem.join.rightColumnId)!;
 return <details className="learning-practice-review"><summary>Review saved practice</summary><section aria-label="Saved practice before challenge">
  <p>These are the applied practice inputs at challenge start, not the challenge answer. They do not change the reviewed practice inputs.</p>
  <p>{problem.join.mode} equality on {problem.left.title}.{leftKey.label} = {problem.right.title}.{rightKey.label}.</p>
  <div className="learning-inputs">{(['left','right'] as const).map(side=>{const table=problem[side];return <div className="learning-input-table" key={side}><h4>{table.title}</h4><div className="learning-table" role="region" tabIndex={0} aria-label={`Saved practice ${table.title} table`}><table><caption>Saved practice · {table.title}</caption><thead><tr><th scope="col">Row</th>{table.columns.map(column=><th scope="col" key={column.id}>{column.label}</th>)}</tr></thead><tbody>{table.rows.map((row,index)=><tr key={row.id}><th scope="row">{index+1}</th>{row.values.map((value,i)=><td key={i}>{typeof value==='string'?JSON.stringify(value):valueText(value)}</td>)}</tr>)}</tbody></table>{table.rows.length===0&&<p>No rows in this table.</p>}</div></div>})}</div>
  <p>Practice prediction: {review.assessment.predictedCount}. Checked practice result: {review.assessment.actualCount} {review.assessment.actualCount===1?'row':'rows'}.</p><p className="learning-practice-reason">Practice reasoning (not graded): {review.assessment.reasoning||'(none supplied)'}</p>
  <ul aria-label="Saved practice row contributions">{review.observation.contributions.map(row=><li key={row.leftRowId}>{rowName(problem.left,row.leftRowId)}: {row.reason==='matches'?`matches ${row.matchingRightRowIds.map(id=>rowName(problem.right,id)).join(', ')}`:row.reason==='null-key'?'NULL key does not satisfy equality':'no equal non-NULL right key'}; contributes {row.outputCount} {row.outputCount===1?'row':'rows'}.</li>)}</ul>
 </section></details>;
}
function RowEditor({table,row,rowLabel,rowHeading,side,state,pending,onAction,dispatchFence}:{table:Table;row:Table['rows'][number];rowLabel:string;rowHeading:string|number;side:'left'|'right';state:JoinState;pending:boolean;onAction:InputAction;dispatchFence?:number}) {
  const [error,setError]=useState('');
  const errorId=useId();
  const {draft,setDraft,dirty,submit,feedback,held}=useNavigationForm({cells:row.values.map(cellDraft)},state,()=>setError(''),undefined,{slot:`join:row:${side}:${row.id}`,dispatchFence}),cells=draft.cells;
  return <tr><th scope="row">{rowHeading}</th>{table.columns.map((column,index)=><td key={column.id}><input aria-label={`${rowLabel} ${column.label}`} aria-invalid={error?true:undefined} aria-describedby={error?errorId:undefined} value={cells[index].text} disabled={pending||held||cells[index].isNull} onChange={event=>setDraft(previous=>({cells:previous.cells.map((value,i)=>i===index?{...value,text:event.target.value}:value)}))}/><label className="learning-null"><input type="checkbox" aria-label={`${rowLabel} ${column.label} is NULL`} checked={cells[index].isNull} disabled={pending||held} onChange={event=>setDraft(previous=>({cells:previous.cells.map((value,i)=>i===index?{...value,isNull:event.target.checked}:value)}))}/>NULL</label></td>)}<td><button type="button" disabled={pending||held||!dirty} onClick={()=>{
    try {
      const parsed=cells.map((draft,index):Cell=>{
        if(draft.isNull) return null;
        const value=draft.text;
        const type=table.columns[index].type;
        if(type==='integer') {const n=Number(value);if(!/^-?\d+$/.test(value)||!Number.isSafeInteger(n))throw Error('Use a whole number or NULL.');return n;}
        if(type==='boolean') {if(value!=='true'&&value!=='false')throw Error('Use true, false or NULL.');return value==='true';}
        return value;
      });
      submit(()=>onAction({kind:'edit-row',side,rowId:row.id,values:parsed,expectedRevision:state.revision}));setError('');
    } catch(cause){setError(cause instanceof Error?cause.message:'Check this row.');}
  }}>Apply row</button>{feedback}{dirty&&<small>Unapplied changes</small>}{error&&<p id={errorId} role="alert">{error}</p>}</td></tr>;
}
function KeySelection({problem,state,pending,editable,onAction,dispatchFence}:{problem:JoinCase;state:JoinState;pending:boolean;editable:boolean;onAction:InputAction;dispatchFence?:number}){
 const {draft,setDraft,dirty,submit,feedback,held}=useNavigationForm({left:problem.join.leftColumnId,right:problem.join.rightColumnId},state,undefined,undefined,{slot:`join:keys:${problem.id}`,dispatchFence}),{left,right}=draft;
 const leftColumn=problem.left.columns.find(c=>c.id===left),rightColumn=problem.right.columns.find(c=>c.id===right);
 const compatible=leftColumn?.type===rightColumn?.type;
 return <form className="learning-controls" onSubmit={event=>{event.preventDefault();if(compatible&&dirty)submit(()=>onAction({kind:'set-keys',leftColumnId:left,rightColumnId:right,expectedRevision:state.revision}));}}><label>Left key<select aria-label="Left key" disabled={!editable||pending||held} value={left} onChange={event=>setDraft(previous=>({...previous,left:event.target.value}))}>{problem.left.columns.map(c=><option key={c.id} value={c.id}>{c.label} ({c.type})</option>)}</select></label><label>Right key<select aria-label="Right key" disabled={!editable||pending||held} value={right} onChange={event=>setDraft(previous=>({...previous,right:event.target.value}))}>{problem.right.columns.map(c=><option key={c.id} value={c.id}>{c.label} ({c.type})</option>)}</select></label>{feedback}<button disabled={!editable||pending||held||!compatible||!dirty}>Apply keys</button>{dirty&&<p>{compatible?'Unapplied key selection.':'Choose two keys with the same type, then apply them together.'}</p>}</form>;
}
function InputTable({table,side,state,editable,pending,onAction,humanLabels,dispatchFence}:Omit<Props,'onAction'>&{onAction:InputAction;table:Table;side:'left'|'right';editable:boolean;pending:boolean}) {
  return <div className="learning-input-table"><h4>{table.title}</h4><div className="learning-table" role="region" aria-label={`${table.title} table`} tabIndex={0}><table aria-label={table.title}><thead><tr><th scope="col">Row</th>{table.columns.map(c=><th key={c.id} scope="col">{c.label}</th>)}{editable&&<th scope="col">Change</th>}</tr></thead><tbody>{table.rows.map((row,index)=>editable?<RowEditor key={row.id} {...{table,row,side,state,pending,onAction,dispatchFence}} rowLabel={humanLabels?rowName(table,row.id):row.id} rowHeading={humanLabels?index+1:row.id}/>:<tr key={row.id}><th scope="row">{humanLabels?index+1:row.id}</th>{row.values.map((v,i)=><td key={i}>{valueText(v)}</td>)}</tr>)}</tbody></table>{table.rows.length===0&&<p>No rows in this table.</p>}</div></div>;
}

export function JoinLab({data,state,pending=false,onAction,embedded=false,humanLabels=false,explanationMode,dispatchFence,motion}:Props) {
  const view=joinLab.observe(data,state);
  const [localMode,setMode]=useState<'quick'|'deep'|'visual'>('quick');
  const mode=explanationMode??localMode;
  const {draft,setDraft,submit,feedback,held}=useNavigationForm({prediction:'',reasoning:''},state,undefined,'prediction',{slot:`join:prediction:${view.problem.id}`,basis:JSON.stringify([view.phase.startsWith('practice')?'practice':'transfer',view.phase.startsWith('practice')?state.practiceEdits:0]),dispatchFence}),{prediction,reasoning}=draft;
  const guard=useGuardedAction();
  const send:InputAction=action=>{if(pending)return;let expected:JoinState|undefined;try{expected=joinLab.update(data,state,action);}catch{/* The existing action boundary reports refused mutations. */}return formSubmission(expected,onAction(action));};
  const predictionId=useId();
  const editable=state.phase.kind==='practice-predict'||state.phase.kind==='practice-reviewed';
  const reviewed=view.assessment!==null;
  const problem=view.problem;
  const lastChange=view.lastChange??view.practiceReview?.lastChange;
  const leftKey=problem.left.columns.findIndex(c=>c.id===problem.join.leftColumnId);
  const first=problem.left.rows.find(row=>row.values[leftKey]!==null);
  const next=problem.left.rows.find(row=>first&&row.values[leftKey]!==first.values[leftKey]);
  return <div className="learning-tool join-lab" data-ui>
    {!embedded&&<><ReadyArtifact identity={`${motion?.identity}:heading`} arrivalIdentity={motion?.arrivalIdentity} enabled={!!motion&&!embedded&&state.revision===0}>
    <header><h3>{data.title}</h3><p>{editable?'Change the tables, then predict the result.':`Separate challenge: ${problem.title}`}</p></header>
    <p className="learning-origin">{editable?'Local worked example':'Synthetic transfer'} · Supplied lesson tables, not a reading of your screen.</p>
    </ReadyArtifact>
    <div className="learning-modes" role="group" aria-label="Explanation style">{(['quick','deep','visual'] as const).map(value=><button key={value} type="button" aria-pressed={mode===value} onClick={()=>setMode(value)}>{value[0].toUpperCase()+value.slice(1)}</button>)}</div>
    {mode==='quick'&&<p>Each equal, non-NULL key pair produces one row. {problem.join.mode==='LEFT'?'LEFT also keeps each unmatched left row, with NULLs on the right.':'INNER leaves unmatched rows out.'} Duplicate keys can produce several rows per input row.</p>}
    {mode==='deep'&&<div><p>Compare every left key to every right key using exact typed equality. A left row with two matches contributes two result rows; two left rows sharing that key contribute four. NULL does not match NULL. Text is case sensitive here; database collations can differ.</p><p>This example supports INNER and LEFT equality. Results come from the applied tables, without database filters or type conversion.</p><a href="https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-JOIN" target="_blank" rel="noreferrer">SQL join reference</a><p className="learning-note">Lesson source: {data.source.sourceId}, version {data.source.version}. Applied revision: {state.revision}.</p></div>}
    {mode==='visual'&&<p>Read the pair map after a prediction. Every line is one output row. A blank right side represents a preserved unmatched left row. Before submission, use the table keys to make your own prediction.</p>}
    </>}
    <ReadyArtifact identity={`${motion?.identity}:join-controls`} arrivalIdentity={motion?.arrivalIdentity} enabled={!!motion&&!embedded&&state.revision===0}>
    {editable||!embedded?<><div className="learning-controls"><label>Join type<select aria-label="Join type" disabled={!editable||pending} value={problem.join.mode} onChange={event=>send({kind:'set-mode',mode:event.target.value==='LEFT'?'LEFT':'INNER',expectedRevision:state.revision})}><option>INNER</option><option>LEFT</option></select></label></div>
    <KeySelection {...{problem,state,pending,editable,dispatchFence}} onAction={send}/>
    </>:<p>{problem.join.mode} join: {problem.left.title}.{problem.left.columns.find(c=>c.id===problem.join.leftColumnId)?.label} = {problem.right.title}.{problem.right.columns.find(c=>c.id===problem.join.rightColumnId)?.label}.</p>}
    </ReadyArtifact>
    <p className="learning-note">Use the NULL checkbox for a missing value. Typed “NULL” stays text. Apply edits before predicting; each applied edit clears the previous prediction.</p>
    <div className="learning-inputs">{(['left','right'] as const).map(side=><InputTable key={side} {...{data,state,pending,editable,side,humanLabels,dispatchFence}} onAction={send} table={problem[side]}/>)}</div>
    {editable&&<div className="learning-actions"><button type="button" disabled={pending||!first||!next} onClick={()=>{if(first&&next)onAction({kind:'edit-row',side:'left',rowId:next.id,values:next.values.map((v,i)=>i===leftKey?first.values[leftKey]:v),expectedRevision:state.revision});}}>Try duplicate key</button><button type="button" disabled={pending||!state.undoPractice} onClick={()=>onAction({kind:'undo-practice',expectedRevision:state.revision})}>Undo last change</button></div>}
    {!editable&&<p className="learning-note">Earlier exposure is not tracked; this separate challenge may have been seen before.</p>}
    {!reviewed&&<form className="learning-prediction" onSubmit={event=>{event.preventDefault();submit(()=>send({kind:'predict',count:Number(prediction),reasoning,expectedRevision:state.revision}));}}><label htmlFor={predictionId}>Predict the output row count</label><input id={predictionId} type="number" min="0" max="144" required value={prediction} disabled={pending||held} onChange={event=>setDraft(previous=>({...previous,prediction:event.target.value}))}/><label>Why? (recorded, not graded)<textarea maxLength={800} value={reasoning} disabled={pending||held} onChange={event=>setDraft(previous=>({...previous,reasoning:event.target.value}))}/></label>{feedback}<button className="learning-primary" disabled={pending||held} type="submit">Check prediction</button></form>}
    {view.practiceReview&&<SavedPracticeReview problem={state.practice} review={view.practiceReview}/>}
    {lastChange&&<LastChangeComparison problem={state.practice} change={lastChange} mode={mode} priorPractice={!!view.practiceReview}/>}
    {view.observation&&view.assessment&&<section aria-label="Computed result"><h4>{view.observation.rowCount} output rows</h4><p role="status">{humanLabels?humanJoinAssessment(view):view.assessment.correction}</p>{!editable&&<><p>First submitted prediction: {view.assessment.predictedCount} rows.</p><p className="learning-note">Your first reasoning (ungraded): {view.assessment.reasoning||'(none supplied)'}</p><p>Transfer score: {view.assessment.correct?'1 / 1':'0 / 1'} for the first row-count prediction. Reasoning is ungraded. This is an observed attempt, not a claim of lasting learning.</p></>}
      <JoinRowTrace key={`${data.id}:${data.version}:${state.revision}`} data={data} state={state}/>
      {(view.change)&&<p>Change: {view.change.originalCount} → {view.change.currentCount} rows. Added {view.change.addedPairIds.length}, removed {view.change.removedPairIds.length}, changed values in {view.change.changedPairIds.length} pairs.</p>}
      {mode==='visual'&&<ol className="learning-pairs" aria-label="Pair map">{view.observation.rows.map(row=><li key={row.id}><span>{humanLabels?rowName(problem.left,row.provenance.leftRowId):row.provenance.leftRowId}</span><span aria-label="paired with">→</span><span>{row.provenance.rightRowId?(humanLabels?rowName(problem.right,row.provenance.rightRowId):row.provenance.rightRowId):'No right row (NULL)'}</span></li>)}</ol>}
      <div className="learning-table" role="region" aria-label="Exact result and provenance" tabIndex={0}><table><caption>Exact result and provenance</caption><thead><tr><th scope="col">Left row</th><th scope="col">Right row</th><th scope="col">Left values</th><th scope="col">Right values</th><th scope="col">Pair</th><th scope="col">Change</th></tr></thead><tbody>{view.observation.rows.map(row=><tr key={row.id}><td>{humanLabels?rowName(problem.left,row.provenance.leftRowId):row.provenance.leftRowId}</td><td>{row.provenance.rightRowId?(humanLabels?rowName(problem.right,row.provenance.rightRowId):row.provenance.rightRowId):'Unmatched'}</td><td>{row.leftValues.map(valueText).join(', ')}</td><td>{row.rightValues.map(valueText).join(', ')}</td><td>{row.kind==='matched'?'Matched':'Left unmatched'}</td><td>{view.change?.addedPairIds.includes(row.id)?'Added':view.change?.changedPairIds.includes(row.id)?'Values changed':'Kept'}</td></tr>)}</tbody></table></div>
      {view.change&&view.change.removedPairIds.length>0&&<p>Removed pairs: {humanLabels?view.change.removedPairIds.map(id=>{const [left,right]=id.split(':');return `${rowName(data.practice.left,left)} → ${right==='@unmatched'?'No right row (NULL)':rowName(data.practice.right,right)}`;}).join('; '):view.change.removedPairIds.join(', ')}.</p>}
      {editable&&<button type="button" disabled={pending||state.practiceEdits===0} onClick={()=>guard(()=>send({kind:'start-transfer',expectedRevision:state.revision}))}>Try separate challenge</button>}
    </section>}
  </div>;
}
