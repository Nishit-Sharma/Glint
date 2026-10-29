import {useState,type ReactNode} from 'react';
import type {SourceRef,Task} from '../../../core/types';
import {groundedJoin,type GroundedJoinData,type GroundedJoinState,type GroundedJoinAction,type GroundingStatus} from '../../../learning/grounded-join';
import type {Cell} from '../../../learning/join-lab';
import {JoinLab,humanJoinAssessment} from './JoinLab';
import {ReadyArtifact} from './ReadyArtifact';
import {useGuardedAction,useNavigationForm,formSubmission,type FormSubmission} from '../draft-navigation';
import './learning-tools.css';

type Props={data:GroundedJoinData;state:GroundedJoinState;status:GroundingStatus;pending?:boolean;onAction:(action:GroundedJoinAction)=>void|Promise<boolean>;task?:Task;motion?:{identity:string;arrivalIdentity:string}};
type InputAction=(action:GroundedJoinAction)=>FormSubmission|undefined;
type Side='left'|'right';
type Keys=NonNullable<GroundedJoinState['keyCorrection']>['keys'];
function InitialPart({motion,id,enabled,children}:{motion:Props['motion'];id:string;enabled:boolean;children:ReactNode}){
 return motion?<ReadyArtifact identity={`${motion.identity}:${id}`} arrivalIdentity={motion.arrivalIdentity} enabled={enabled}>{children}</ReadyArtifact>:children;
}
function columnName(data:GroundedJoinData,side:Side,columnId:string){
 const table=data.extraction[side];return `${table.title}.${table.columns.find(column=>column.id===columnId)?.label??'Unknown column'}`;
}
function rowName(data:GroundedJoinData,side:Side,rowId:string){
 const table=data.extraction[side],index=table.rows.findIndex(row=>row.id===rowId);return `${table.title} row ${index<0?'from an earlier version':index+1}`;
}
function keysName(data:GroundedJoinData,keys:Keys){return `${keys.mode}: ${columnName(data,'left',keys.leftColumnId)} = ${columnName(data,'right',keys.rightColumnId)}`;}
function readableIssue(data:GroundedJoinData,message:string){
 for(const side of ['left','right'] as const){
  const table=data.extraction[side];
  for(const column of table.columns){
   const typePrefix=`${side}/${column.id}: `;
   if(message.startsWith(typePrefix))return `${columnName(data,side,column.id)}: ${message.slice(typePrefix.length)}`;
   for(const row of table.rows){
    const cellPrefix=`${side}/${row.id}/${column.id}: `,errorPrefix=`Cell ${row.id}/${column.id} must be `;
    if(message.startsWith(cellPrefix))return `${rowName(data,side,row.id)}, ${column.label}: ${message.slice(cellPrefix.length)}`;
    if(message.startsWith(errorPrefix))return `${rowName(data,side,row.id)}, ${column.label} must be ${message.slice(errorPrefix.length)}`;
   }
  }
 }
 return message;
}
function CellCorrection({label,type,value,committedState,onCorrect,disabled,slot}:{label:string;type:string;value:Cell|undefined;committedState:GroundedJoinState;onCorrect:(value:Cell,reason:string)=>FormSubmission|undefined;disabled:boolean;slot:string}){
 const [error,setError]=useState('');
 const {draft,setDraft,submit,feedback,held}=useNavigationForm({input:value===null||value===undefined?'':String(value),isNull:value===null,reason:''},committedState,()=>setError(''),undefined,{slot,basis:type}),{input,isNull,reason}=draft;
 return <form className="helper-fields" onSubmit={event=>{event.preventDefault();try{
  let corrected:Cell=input;
  if(isNull)corrected=null;
  else if(type==='integer'){if(!/^-?\d+$/.test(input)||!Number.isSafeInteger(Number(input)))throw Error('Enter a whole number.');corrected=Number(input);}
  else if(type==='boolean'){if(input!=='true'&&input!=='false')throw Error('Enter true or false.');corrected=input==='true';}
  if(type==='unknown')throw Error('Choose the column type first.');
  submit(()=>onCorrect(corrected,reason));setError('');
 }catch(cause){setError(cause instanceof Error?cause.message:'Check this value.');}}}><label>Corrected value<input aria-label={`${label} corrected value`} maxLength={160} value={input} disabled={disabled||held||isNull} onChange={event=>setDraft(previous=>({...previous,input:event.target.value}))}/></label><label className="learning-null"><input type="checkbox" aria-label={`${label} is NULL`} checked={isNull} disabled={disabled||held} onChange={event=>setDraft(previous=>({...previous,isNull:event.target.checked}))}/>Missing value (NULL)</label><label>Why this correction?<input aria-label={`${label} correction reason`} maxLength={500} required value={reason} disabled={disabled||held} onChange={event=>setDraft(previous=>({...previous,reason:event.target.value}))}/></label>{feedback}<button disabled={disabled||held||type==='unknown'}>Apply correction</button>{error&&<p role="alert">{error}</p>}</form>;
}
function ColumnType({column,label,side,state,pending,onAction}:{column:GroundedJoinData['extraction']['left']['columns'][number];label:string;side:Side;state:GroundedJoinState;pending:boolean;onAction:InputAction}){
 const current=state.typeCorrections.find(c=>c.side===side&&c.columnId===column.id)?.type??column.type;
 const {draft,setDraft,submit,feedback,held}=useNavigationForm<{type:'string'|'integer'|'boolean'|'';reason:string}>({type:current==='unknown'?'':current,reason:''},state,undefined,undefined,{slot:`grounded:type:${side}:${column.id}`}),{type,reason}=draft;
 return <details open={current==='unknown'}><summary>{column.sourceLabel} → {column.label} ({current})</summary><form className="helper-fields" onSubmit={event=>{event.preventDefault();if(type)submit(()=>onAction({kind:'correct-type',side,columnId:column.id,type,reason,expectedRevision:state.revision}));}}><label>Column type<select aria-label={`${label} column type`} required value={type} disabled={pending||held} onChange={event=>{const type=event.target.value;if(type==='string'||type==='integer'||type==='boolean')setDraft(previous=>({...previous,type}));}}><option value="" disabled>Choose a type</option><option value="string">Text</option><option value="integer">Whole number</option><option value="boolean">True or false</option></select></label><label>Why this type?<input aria-label={`${label} type reason`} required maxLength={500} value={reason} disabled={pending||held} onChange={event=>setDraft(previous=>({...previous,reason:event.target.value}))}/></label>{feedback}<button disabled={pending||held||!type}>Confirm type</button></form></details>;
}
function KeyCorrection({data,state,pending,onAction}:Pick<Props,'data'|'state'>&{pending:boolean;onAction:InputAction}){
 const original=state.keyCorrection?.keys??(data.extraction.join.kind==='mapped'?data.extraction.join.keys:null);
 const {draft,setDraft,submit,feedback,held}=useNavigationForm<{left:string;right:string;mode:'INNER'|'LEFT'|'';reason:string}>({left:original?.leftColumnId??'',right:original?.rightColumnId??'',mode:original?.mode??'',reason:''},state,undefined,undefined,{slot:'grounded:keys'}),{left,right,mode,reason}=draft;
 return <details open={!original}><summary>{original?`${state.keyCorrection?'Your reviewed join condition':'Proposed join condition'} · ${keysName(data,original)}`:'Join condition is ambiguous; choose it explicitly'}</summary><form className="helper-fields" onSubmit={event=>{event.preventDefault();if(mode&&left&&right)submit(()=>onAction({kind:'correct-keys',keys:{mode,leftColumnId:left,rightColumnId:right},reason,expectedRevision:state.revision}));}}><label>Reviewed join type<select required value={mode} disabled={pending||held} onChange={event=>{const mode=event.target.value;if(mode==='INNER'||mode==='LEFT')setDraft(previous=>({...previous,mode}));}}><option value="" disabled>Choose a join type</option><option>INNER</option><option>LEFT</option></select></label><label>Reviewed left key<select required value={left} disabled={pending||held} onChange={event=>setDraft(previous=>({...previous,left:event.target.value}))}><option value="" disabled>Choose a left key</option>{data.extraction.left.columns.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label><label>Reviewed right key<select required value={right} disabled={pending||held} onChange={event=>setDraft(previous=>({...previous,right:event.target.value}))}><option value="" disabled>Choose a right key</option>{data.extraction.right.columns.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label><label>Why these keys?<input required maxLength={500} value={reason} disabled={pending||held} onChange={event=>setDraft(previous=>({...previous,reason:event.target.value}))}/></label>{feedback}<button disabled={pending||held||!mode||!left||!right}>Confirm join condition</button></form></details>;
}
export function GroundedJoin({data,state,status,pending=false,onAction,task,motion}:Props){
 const view=groundedJoin.observe(data,state),held=status.kind!=='current',disabled=pending||held;
 const guard=useGuardedAction();
 const send:InputAction=action=>{if(disabled)return;let expected:GroundedJoinState|undefined;try{expected=groundedJoin.update(data,state,action);}catch{/* The existing action boundary reports refused mutations. */}return formSubmission(expected,onAction(action));};
 const initial=state.revision===0,local=data.basis.kind==='local-demo';
 const label=view.origin==='local-demo'?'Local worked example':view.origin==='user-corrected'?'User-corrected source data':'Observed source data: transcription for review';
 const sourceName=(ref:SourceRef)=>task?.sources.find(source=>source.id===ref.sourceId)?.versions.find(version=>version.version===ref.version&&version.digest===ref.digest)?.label||`Captured source ${Math.max(0,view.sourceRefs.findIndex(source=>source.sourceId===ref.sourceId))+1}`;
 const change=view.lab?.change??view.lab?.practiceReview?.change;
 return <section className="learning-tool" data-ui aria-label={local?'Local join example':'Source-grounded join'}>
  <InitialPart {...{motion,enabled:initial}} id="grounded-heading"><header><h3>{data.title}</h3><p>{label}</p></header></InitialPart>
  {held&&<p role="alert">{status.reason} You can inspect this saved result; current-source editing is unavailable.</p>}
  {data.basis.kind==='observed-source'&&<p className="learning-origin">Based on {data.basis.sourceRefs.map(ref=>`${sourceName(ref)}, version ${ref.version}`).join('; ')} and the cited artifact at revision {data.basis.artifact.revision}. A citation binds a transcription to that snapshot; image cells still require your review. Local edits never change the source window.</p>}
  <p className="learning-origin">{local?'This simulates only the supplied example rows.':'This simulates only reviewed rows.'} It does not query your database or infer hidden rows.</p>
  <section aria-label="Original join mapping">
   <InitialPart {...{motion,enabled:initial}} id="grounded-mapping"><p><strong>Original join condition</strong> · {view.joinMapping.origin==='proposed-assumption'?'Proposed assumption (no source citation)':view.joinMapping.origin==='source-cited'?'Source-cited mapping':view.joinMapping.origin==='local-demo'?'Local example':'Unresolved mapping'}{view.joinMapping.kind==='mapped'&&<> · {keysName(data,view.joinMapping.keys)}</>}</p></InitialPart>
   <p>{view.joinMapping.reason}</p>
   {view.joinMapping.kind==='mapped'&&view.joinMapping.citation&&<p>Citation from {sourceName(view.joinMapping.citation.sourceRef)}, version {view.joinMapping.citation.sourceRef.version}: <q>{view.joinMapping.citation.location.quote}</q>.</p>}
  </section>
  {view.userJoinCorrection&&<p aria-label="User join correction">User join correction · {keysName(data,view.userJoinCorrection.keys)}: {view.userJoinCorrection.reason}</p>}
  <div role="group" aria-label={local?'Practice explanation style':'Grounded explanation style'} className="learning-modes">{(['quick','deep','visual'] as const).map(mode=><button key={mode} disabled={disabled} aria-pressed={state.mode===mode} onClick={()=>{if(state.mode!==mode)onAction({kind:'explanation-mode',mode,expectedRevision:state.revision});}}>{mode[0].toUpperCase()+mode.slice(1)}</button>)}</div>
  <p>{state.mode==='deep'?(view.lab?humanJoinAssessment(view.lab)??view.deep:view.deep):view.quick}</p>
  {change&&<p aria-label="Computed change summary">{view.stage==='Unseen synthetic transfer'?'Practice review before transfer: ':''}Compared with reviewed practice: {change.originalCount} → {change.currentCount} rows; added: {change.addedPairIds.length} pairs; removed: {change.removedPairIds.length} pairs; changed values: {change.changedPairIds.length} pairs.</p>}
  {view.currentProblemOrigin==='local-experiment'&&<p>{local?'These are hypothetical local experiment edits. The original supplied practice data is unchanged.':'These are hypothetical local experiment edits. The cited source and reviewed transcription are unchanged.'}</p>}
  <section aria-label="Review assumptions"><h4>Assumptions for this experiment</h4>{view.assumptions.length?<ul>{view.assumptions.map((assumption,index)=><li key={index}>{assumption}</li>)}</ul>:<p>No additional assumptions supplied.</p>}<p>Model: ordinary INNER/LEFT equality; NULL does not match NULL, duplicates produce separate pairs, strings are exact and no coercion or hidden rows are inferred.</p></section>
  <details><summary>{local?'Assumptions and corrections':'Source citations, assumptions and corrections'}</summary><ul>{view.citations.map(c=><li key={c.id}><strong>{sourceName(c.sourceRef)}, version {c.sourceRef.version}</strong> · {c.location.kind==='text-range'?`characters ${c.location.start}–${c.location.end}`:`image region ${c.location.x}, ${c.location.y}, ${c.location.width}, ${c.location.height}`} · <q>{c.location.quote}</q></li>)}</ul><ul>{state.cellCorrections.map(c=><li key={`${c.side}:${c.rowId}:${c.columnId}`}>{rowName(data,c.side,c.rowId)}, {data.extraction[c.side].columns.find(column=>column.id===c.columnId)?.label}: {JSON.stringify(c.value)} · {c.reason}</li>)}{state.typeCorrections.map(c=><li key={`${c.side}:${c.columnId}`}>{columnName(data,c.side,c.columnId)}: {c.type} · {c.reason}</li>)}{state.keyCorrection&&<li>Join condition: {keysName(data,state.keyCorrection.keys)} · {state.keyCorrection.reason}</li>}</ul></details>
  {!state.lab?<>
   <InitialPart {...{motion,enabled:initial}} id="grounded-review"><h4>{local?'Review supplied practice tables':'Review table transcription'}</h4><p>{local?'Confirm the supplied values, types and join condition, then accept this local example. Accepting fixes these reviewed values for this experiment.':'Unreadable values have no guessed value. Resolve them, confirm types and keys, then accept this extraction. Later source corrections create a new version and preserve this attempt.'}</p></InitialPart>
   <div className="learning-inputs">{(['left','right'] as const).map(side=>{const table=data.extraction[side];return <section className="grounded-review-table" key={side}><h4>{table.title}</h4>{table.columns.map(column=><ColumnType key={column.id} label={columnName(data,side,column.id)} {...{column,side,state,pending:disabled}} onAction={send}/>)}<div className="learning-table"><table><caption>{local?'Supplied':'Extracted'} {table.title}</caption><thead><tr><th>Row</th>{table.columns.map(c=><th key={c.id}>{c.label}</th>)}</tr></thead><tbody>{table.rows.map((row,rowIndex)=><tr key={row.id}><th scope="row">{rowIndex+1}</th>{row.cells.map((cell,index)=>{
    const column=table.columns[index],correction=state.cellCorrections.find(c=>c.side===side&&c.rowId===row.id&&c.columnId===column.id),value=correction?correction.value:cell.kind==='needs-correction'?undefined:cell.value,type=state.typeCorrections.find(c=>c.side===side&&c.columnId===column.id)?.type??column.type;
    return <td key={column.id}><details open={cell.kind==='needs-correction'&&!correction}><summary>{correction?'Corrected: ':''}{value===undefined?'Unreadable':JSON.stringify(value)}</summary>{cell.kind==='needs-correction'&&!correction&&<p>{cell.reason}</p>}<CellCorrection slot={`grounded:cell:${side}:${row.id}:${column.id}`} key={`${row.id}:${column.id}`} label={`${rowName(data,side,row.id)}, ${column.label}`} {...{value,type,disabled}} committedState={state} onCorrect={(value,reason)=>send({kind:'correct-cell',side,rowId:row.id,columnId:column.id,value,reason,expectedRevision:state.revision})}/></details></td>;
   })}</tr>)}</tbody></table></div></section>;})}</div>
   <KeyCorrection {...{data,state,pending:disabled}} onAction={send}/>{view.missing.length>0&&<p role="status">Needs review: {view.missing.map(message=>readableIssue(data,message)).join('; ')}</p>}{view.problemError&&<p role="alert">{readableIssue(data,view.problemError)}</p>}<p>Accepting confirms the reviewed values, column types, join condition and the assumptions listed above for this local experiment.</p><button disabled={disabled||!view.ready} onClick={()=>guard(()=>send({kind:'accept-extraction',expectedRevision:state.revision}))}>{local?'Accept supplied tables and experiment':'Accept reviewed extraction and experiment'}</button>
  </>:view.lesson&&<><h4>{view.stage}</h4>{view.stage==='Unseen synthetic transfer'&&<p>{local?'This is a separate synthetic problem from the supplied practice example.':'This is a separate synthetic problem, not a transcription of the cited source.'} The first count attempt is checked; reasoning remains ungraded.</p>}<JoinLab data={view.lesson} state={state.lab} pending={disabled} embedded humanLabels explanationMode={state.mode} dispatchFence={state.revision} onAction={action=>onAction({kind:'lab',action,expectedRevision:state.revision})}/></>}
 </section>;
}
