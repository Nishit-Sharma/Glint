import {WorkflowSourceCitations} from './WorkflowSourceCitations';
import {workflowImageCitationText} from '../../../learning/workflow-image-citation';
import {useId,useState} from 'react';
import type {Task} from '../../../core/types';
import {workflowLab,workflowLimits,workflowTransferDisplayTitle,type WorkflowAction,type WorkflowCase,type WorkflowData,type WorkflowState} from '../../../learning/workflow-lab';
import {workflowStatus} from '../../../learning/workflow-grounding';
import {useGuardedAction,useNavigationForm,formSubmission,type FormSubmission} from '../draft-navigation';
import {workflowSourceDocument} from '../workflow-source-navigation';
import './workflow-lab.css';

type Props={data:WorkflowData;state:WorkflowState;pending?:boolean;onAction:(action:WorkflowAction)=>void|Promise<boolean>;task?:Task;onOpenSourceDocument?:()=>void};
type InputAction=(action:WorkflowAction)=>FormSubmission|undefined;
type Interaction={revision:number;committedState:WorkflowState;disabled:boolean;onAction:InputAction};
const labelFor=(entries:readonly {id:string;label:string}[],id:string)=>entries.find(entry=>entry.id===id)?.label??'Unavailable';
const originLabel={
 'local-sample':'Illustrative local sample',
 'reviewed-source':'Reviewed source interpretation',
 'synthetic-transfer':'Separate synthetic transfer',
} as const;

function RuleEditor({problem,rule,revision,committedState,disabled,onAction}:{problem:WorkflowCase;rule:WorkflowCase['rules'][number]}&Interaction){
 const {draft,setDraft,submit,feedback,held}=useNavigationForm({target:rule.toStateId,enabled:rule.enabled,reason:''},committedState,undefined,undefined,{slot:`workflow:rule:${problem.id}:${rule.id}`}),{target,enabled,reason}=draft;
 const from=labelFor(problem.states,rule.fromStateId),event=labelFor(problem.events,rule.eventId);
 const dirty=target!==rule.toStateId||enabled!==rule.enabled;
 return <details className="workflow-rule-editor"><summary>Change {event} from {from}</summary>
  <form onSubmit={event=>{event.preventDefault();if(dirty&&reason.trim())submit(()=>onAction({kind:'set-rule',ruleId:rule.id,toStateId:target,enabled,reason:reason.trim(),expectedRevision:revision}));}}>
   <label>Destination<select aria-label={`${event} from ${from} destination`} value={target} disabled={disabled||held} onChange={event=>setDraft(previous=>({...previous,target:event.target.value}))}>{problem.states.map(state=><option key={state.id} value={state.id}>{state.label}</option>)}</select></label>
   <label className="workflow-checkbox"><input type="checkbox" aria-label={`${event} from ${from} enabled`} checked={enabled} disabled={disabled||held} onChange={event=>setDraft(previous=>({...previous,enabled:event.target.checked}))}/>Rule enabled</label>
   <label>Reason for this change<input aria-label={`${event} from ${from} reason`} required maxLength={500} value={reason} disabled={disabled||held} onChange={event=>setDraft(previous=>({...previous,reason:event.target.value}))}/></label>
   {feedback}<button type="submit" disabled={disabled||held||!dirty||!reason.trim()}>Apply rule</button>
   {dirty&&<small>Unapplied change. Applying clears the practice prediction.</small>}
  </form>
 </details>;
}

function RuleTable({problem,editable,...interaction}:{problem:WorkflowCase;editable:boolean}&Interaction){
 return <section className="workflow-rules" aria-label="Current workflow rules"><h4>Rules</h4>
  <p className="workflow-note">A rule applies only when both the current state and event match. Without an enabled rule, the event is blocked and the state stays the same.</p>
  <div className="workflow-table"><table><caption className="workflow-sr-only">Current finite transition rules</caption><thead><tr><th scope="col">From</th><th scope="col">Event</th><th scope="col">To</th>{editable&&<th scope="col">Change</th>}</tr></thead><tbody>{problem.rules.map(rule=><tr key={rule.id} data-rule-enabled={rule.enabled}>
   <th scope="row">{labelFor(problem.states,rule.fromStateId)}</th><td>{labelFor(problem.events,rule.eventId)}</td><td>{rule.enabled?labelFor(problem.states,rule.toStateId):'Disabled (event blocked)'}</td>
   {editable&&<td><RuleEditor key={`${problem.id}:${rule.id}`} {...{problem,rule,...interaction}}/></td>}
  </tr>)}</tbody></table></div>
 </section>;
}

function StartingStateEditor({problem,revision,committedState,disabled,onAction}:{problem:WorkflowCase}&Interaction){
 const {draft,setDraft,submit,feedback,held}=useNavigationForm({initial:problem.initialStateId,reason:''},committedState,undefined,undefined,{slot:`workflow:initial:${problem.id}`}),{initial,reason}=draft;
 return <form onSubmit={event=>{event.preventDefault();if(initial!==problem.initialStateId&&reason.trim())submit(()=>onAction({kind:'set-initial',initialStateId:initial,reason:reason.trim(),expectedRevision:revision}));}}>
  <label>Starting state<select aria-label="Edited starting state" value={initial} disabled={disabled||held} onChange={event=>setDraft(previous=>({...previous,initial:event.target.value}))}>{problem.states.map(state=><option key={state.id} value={state.id}>{state.label}</option>)}</select></label>
  <label>Reason for starting-state change<input aria-label="Starting-state change reason" maxLength={500} required value={reason} disabled={disabled||held} onChange={event=>setDraft(previous=>({...previous,reason:event.target.value}))}/></label>
  {feedback}<button type="submit" disabled={disabled||held||initial===problem.initialStateId||!reason.trim()}>Apply starting state</button>
 </form>;
}

function SequenceEditor({problem,revision,committedState,disabled,onAction}:{problem:WorkflowCase}&Interaction){
 const {draft,setDraft,submit,feedback,held}=useNavigationForm({events:[...problem.eventIds],reason:''},committedState,undefined,undefined,{slot:`workflow:sequence:${problem.id}`,variableArrays:['events']}),{events,reason}=draft;
 const dirty=events.join('|')!==problem.eventIds.join('|');
 return <form onSubmit={event=>{event.preventDefault();if(dirty&&reason.trim())submit(()=>onAction({kind:'set-sequence',eventIds:events,reason:reason.trim(),expectedRevision:revision}));}}>
  <ol className="workflow-event-fields">{events.map((eventId,index)=><li key={index}><label>Event {index+1}<select aria-label={`Edited event ${index+1}`} value={eventId} disabled={disabled||held} onChange={event=>setDraft(previous=>({...previous,events:previous.events.map((value,i)=>i===index?event.target.value:value)}))}>{problem.events.map(value=><option key={value.id} value={value.id}>{value.label}</option>)}</select></label><button type="button" aria-label={`Remove event ${index+1}`} disabled={disabled||held||events.length===1} onClick={()=>setDraft(previous=>({...previous,events:previous.events.filter((_,i)=>i!==index)}))}>Remove</button></li>)}</ol>
  <button type="button" disabled={disabled||held||events.length>=workflowLimits.steps} onClick={()=>setDraft(previous=>({...previous,events:[...previous.events,problem.events[0].id]}))}>Add event</button>
  <label>Reason for sequence change<input aria-label="Sequence change reason" maxLength={500} required value={reason} disabled={disabled||held} onChange={event=>setDraft(previous=>({...previous,reason:event.target.value}))}/></label>
  {feedback}<button type="submit" disabled={disabled||held||!dirty||!reason.trim()}>Apply event sequence</button>
  {dirty&&<small>Unapplied sequence. Only applied events feed the result.</small>}
 </form>;
}

function Prediction({problem,revision,committedState,disabled,onAction}:{problem:WorkflowCase}&Interaction){
 const {draft,setDraft,submit,feedback,held}=useNavigationForm({finalState:'',blocked:'',reasoning:''},committedState,undefined,'prediction',{slot:`workflow:prediction:${problem.id}`,basis:JSON.stringify([committedState.active,committedState.active==='practice'?committedState.practiceEdits:0])}),{finalState,blocked,reasoning}=draft;
 const id=useId();
 return <form className="workflow-prediction" onSubmit={event=>{event.preventDefault();if(finalState&&blocked!=='')submit(()=>onAction({kind:'predict',finalStateId:finalState,blockedCount:Number(blocked),reasoning,expectedRevision:revision}));}}>
  <h4>Predict this sequence</h4>
  <div className="workflow-prediction-fields"><label htmlFor={`${id}-state`}>Final state<select id={`${id}-state`} required value={finalState} disabled={disabled||held} onChange={event=>setDraft(previous=>({...previous,finalState:event.target.value}))}><option value="">Choose a state</option>{problem.states.map(state=><option key={state.id} value={state.id}>{state.label}</option>)}</select></label>
   <label htmlFor={`${id}-blocked`}>Blocked events<input id={`${id}-blocked`} type="number" min={0} max={problem.eventIds.length} step={1} required value={blocked} disabled={disabled||held} onChange={event=>setDraft(previous=>({...previous,blocked:event.target.value}))}/></label></div>
  <label>Why? (recorded, not graded)<textarea aria-label="Prediction reasoning" maxLength={800} value={reasoning} disabled={disabled||held} onChange={event=>setDraft(previous=>({...previous,reasoning:event.target.value}))}/></label>
  {feedback}<button type="submit" className="workflow-primary" disabled={disabled||held||!finalState||blocked===''}>Check prediction</button>
 </form>;
}

function CausalExplanation({value,sourceName}:{value:NonNullable<ReturnType<typeof workflowLab.observe>['causal']>;sourceName:(ref:WorkflowData['citations'][number]['sourceRef'])=>string}){
 return <section className="workflow-causal" aria-label="Computed workflow explanation">
  <h4>Why these events lead here</h4><p className="workflow-note">Computed from the displayed finite model after your prediction. Quotes describe the original reviewed rules; local changes remain hypothetical.</p>
  {value.scope==='practice'&&<>
   {value.ruleChanges.length>0&&<><h5>Local hypothetical rule changes</h5><ul>{value.ruleChanges.map(change=><li key={change.ruleId}>Original: {change.original}. Current: {change.current}.</li>)}</ul></>}
   {value.unchanged&&<p className="workflow-note">Starting state {value.unchanged.startingState?'unchanged':'changed'}; event sequence {value.unchanged.eventSequence?'unchanged':'changed'}. {value.unchanged.ruleCount} rule definitions unchanged. Unchanged trace steps: {value.unchanged.stepIndices.join(', ')||'none'}.</p>}
   {value.unpairedOriginalSteps.length>0&&<ul aria-label="Original sequence positions without a current position">{value.unpairedOriginalSteps.map(step=><li key={step.index}>{step.comparison}</li>)}</ul>}
  </>}
  <ol className="workflow-causal-steps">{value.steps.map(step=><li key={step.after.index}>
   <h5>Step {step.after.index}: {step.after.eventLabel}</h5><p>{step.explanation}</p><p className="workflow-note">{step.sourceNote}</p>
   {step.evidence.map((item,index)=><blockquote key={item.citation.id+':'+index}><p><strong>{item.classification}</strong> · Original rule: {item.originalRule}.</p>{item.citation.location.kind==='text-range'?<q>{item.citation.location.quote}</q>:'original' in item.citation?<span className="workflow-image-citation">{workflowImageCitationText(item.citation)}</span>:null}<p>Recorded interpretation reason: {item.reason}</p><p className="workflow-note">Citation {item.citationNumber} · {sourceName(item.citation.sourceRef)}, version {item.citation.sourceRef.version}.</p></blockquote>)}
  </li>)}</ol>
  {value.edits.length>0&&<details><summary>User-recorded change reasons</summary><ol>{value.edits.map(edit=><li key={edit.revision}>Revision {edit.revision}: {edit.detail} <span className="workflow-first-reason">Your reason: {edit.reason}</span></li>)}</ol></details>}
  <p className="workflow-note">{value.limit}</p>
 </section>;
}

export function WorkflowLab({data,state,pending=false,onAction,task,onOpenSourceDocument}:Props){
 const view=workflowLab.observe(data,state),firstTransfer=workflowLab.firstTransfer(data,state),status=workflowStatus(data,task),disabled=pending||status.kind!=='current';
 const editable=view.phase==='practice-predict'||view.phase==='practice-reviewed';
 const citationNumber=(id:string)=>data.citations.findIndex(citation=>citation.id===id)+1;
 const sourceName=(ref:WorkflowData['citations'][number]['sourceRef'])=>task?.sources.find(source=>source.id===ref.sourceId)?.versions.find(version=>version.version===ref.version&&version.digest===ref.digest)?.label??`${data.basis.kind==='reviewed-window'?'Window source':'Text source'} ${data.basis.kind!=='local-sample'?data.basis.sourceRefs.findIndex(source=>source.sourceId===ref.sourceId)+1:1}`;
 const historical=status.kind!=='current',modeOwner=JSON.stringify([task?.id??null,data.id,data.version,data.basis,state.revision,state.active,status.kind]),[historicalMode,setHistoricalMode]=useState<{owner:string;mode:WorkflowState['mode']}>();
 const problem=view.problem,mode=historical&&historicalMode?.owner===modeOwner?historicalMode.mode:state.mode;
 function chooseMode(next:WorkflowState['mode']){if(pending||next===mode)return;if(historical){setHistoricalMode({owner:modeOwner,mode:next});return;}void onAction({kind:'set-mode',mode:next,expectedRevision:state.revision});}
 const guard=useGuardedAction();
 const send:InputAction=action=>{if(disabled)return;let expected:WorkflowState|undefined;try{expected=workflowLab.update(data,state,action);}catch{/* The existing action boundary reports refused mutations. */}return formSubmission(expected,onAction(action));};
 const interaction={revision:state.revision,committedState:state,disabled,onAction:send};
 const edited=view.editNotes.length>0;
 return <section className="workflow-lab" data-ui aria-label="Workflow experiment" aria-busy={pending||undefined}>
  <header><h3>{data.title}</h3><p className="workflow-origin">{originLabel[view.origin]} · {view.origin==='synthetic-transfer'?workflowTransferDisplayTitle(data):problem.title}</p></header>
  {status.kind!=='current'&&<p role="alert" className="workflow-source-status">{status.reason} You can inspect this saved work; editing is unavailable.</p>}
  {status.kind==='stale'&&data.basis.kind==='reviewed-source'&&<section aria-label="Review the source document"><p className="workflow-note">{workflowSourceDocument(task,data.basis)?'Open the latest saved source document to review its links and create a separate lesson. This does not update this saved lesson or its first answer. Current live content remains unknown.':'The source document is unavailable for this lesson. Your saved work is kept.'}</p>{workflowSourceDocument(task,data.basis)&&onOpenSourceDocument&&<button type="button" disabled={pending} onClick={onOpenSourceDocument}>Open source document</button>}</section>}
  {firstTransfer&&<details className="workflow-first-attempt"><summary>Inspect first transfer answer</summary><section aria-label="Saved first transfer attempt">
   <h4>{firstTransfer.title}</h4><p className="workflow-note">Synthetic transfer · Read-only first attempt. Earlier exposure is not tracked. {status.kind!=='current'?'Historical source. The original source changed or is unavailable.':data.basis.kind==='reviewed-window'?'Historical frozen image source.':'Kept with this saved lesson version.'} Opening this view does not change your current practice or apply edits.</p>
   <p>Your first answer: {firstTransfer.predictedStateLabel}; {firstTransfer.prediction.blockedCount} blocked events.</p><p className="workflow-first-reason">Your reasoning (ungraded): {firstTransfer.prediction.reasoning||'(none supplied)'}</p>
   <p>Computed final state: {firstTransfer.result.finalStateLabel}; {firstTransfer.result.blockedCount} blocked events. First prediction score: {firstTransfer.assessment.score} / {firstTransfer.assessment.maxScore}.</p>
   <ol aria-label="Saved first transfer trace">{firstTransfer.result.steps.map(step=><li key={step.index}>{step.eventLabel}: {step.fromStateLabel} → {step.toStateLabel} ({step.status}).</li>)}</ol>
   <p className="workflow-note">Practice before transfer: {firstTransfer.practiceAtStart.title}; computed final state {firstTransfer.practiceAtStart.result.finalStateLabel}; {firstTransfer.practiceAtStart.result.blockedCount} blocked events.</p><p className="workflow-first-reason">Earlier practice reasoning (ungraded): {firstTransfer.practiceAtStart.prediction.reasoning||'(none supplied)'}</p>
   <p className="workflow-note">This preserves one submitted attempt. It does not establish lasting learning.</p>
  </section></details>}
  {editable?<p className="workflow-note">{data.basis.kind==='local-sample'?'These rules are supplied sample data. No real procedure or screen was observed.':data.basis.kind==='reviewed-window'?'These rules are reviewed image interpretations from historical frozen transcription. Pixels are not stored or restored; this is not HDL simulation.':'Rules are an explicit interpretation of the cited frozen text, not automatic screen inference.'} Changes here are hypothetical and never operate a real workflow.</p>:<p className="workflow-note">This is a separate synthetic workflow. Earlier exposure is not tracked. Its first prediction is kept for checking; reasoning is ungraded.</p>}
  {historical&&<p className="workflow-note">Historical saved-source explanation. Changing the view is local and does not change this saved lesson or its source.</p>}
  <div className="workflow-modes" role="group" aria-label="Workflow explanation style">{(['quick','deep','visual'] as const).map(value=><button key={value} type="button" aria-pressed={mode===value} disabled={pending} onClick={()=>chooseMode(value)}>{value[0].toUpperCase()+value.slice(1)}</button>)}</div>
  {mode==='quick'&&<p className="workflow-explanation">Start in {labelFor(problem.states,problem.initialStateId)}. Read events in order, applying at most one enabled rule per event. A blocked event does not change the state.</p>}
  {mode==='deep'&&<div className="workflow-explanation"><p>For each event, match its name and the current state to one rule. Take that rule’s destination, then use the new state for the next event. Disabled or missing rules count as blocked; they keep the previous state.</p><p>This finite model has no hidden conditions, timing, parallel events or real approvals. The trace, change explanation and score come from the applied rules and events at this saved revision.</p>{view.causal&&<CausalExplanation value={view.causal} sourceName={sourceName}/>}</div>}
  {mode==='visual'&&<p className="workflow-explanation">Follow each state-and-event pair in the rule table. After your prediction, the path below shows each computed transition; blocked steps keep the same state.</p>}
  <section className="workflow-sequence" aria-label="Applied event sequence"><h4>Start and events</h4><p>Start: <strong>{labelFor(problem.states,problem.initialStateId)}</strong></p><ol>{problem.eventIds.map((eventId,index)=><li key={index}><span className="workflow-event-number">{index+1}.</span> {labelFor(problem.events,eventId)}</li>)}</ol></section>
  <RuleTable problem={problem} editable={editable} {...interaction}/>
  {editable&&<>
   <p className="workflow-guide">{data.basis.kind==='local-sample'&&data.id==='review-workflow-lesson'?'Try changing Edit from Ready to In review. Apply the rule, then predict again and compare the changed steps.':'Change one rule destination, then predict again to see how later events depend on that choice.'}</p>
   <details className="workflow-advanced"><summary>Change the starting state or event sequence</summary><div className="workflow-edit-grid"><StartingStateEditor key={problem.id} problem={problem} {...interaction}/><SequenceEditor key={problem.id} problem={problem} {...interaction}/></div></details>
   {edited&&<p className="workflow-note" aria-label="Latest applied workflow change">Applied local changes: {view.editNotes.length}. Latest reason: {view.editNotes.at(-1)?.reason}</p>}
   <details className="workflow-provenance"><summary>Original rule interpretations, source and changes</summary>
    <p>{data.basis.kind==='local-sample'?'Original rules belong to the illustrative sample.':'Original rules are reviewed interpretations; the quotes preserve their source context.'} Local changes are recorded separately below.</p>
    <h4>Original interpretations</h4><ul>{view.ruleOrigins.map(origin=>{const rule=data.practice.rules.find(rule=>rule.id===origin.ruleId);return <li key={origin.ruleId}>{rule&&<strong>{labelFor(data.practice.states,rule.fromStateId)} + {labelFor(data.practice.events,rule.eventId)} → {labelFor(data.practice.states,rule.toStateId)}. </strong>}{origin.interpretation==='source-stated'?'Source-stated rule. ':origin.interpretation==='user-interpreted'?'Your interpretation. ':origin.interpretation==='reviewed-image-interpretation'?'Reviewed image interpretation. ':''}{origin.reason}{origin.citationId===null?' No source citation.':` Citation ${citationNumber(origin.citationId)}.`}</li>;})}</ul>
    <h4>Assumptions</h4>{view.assumptions.length?<ul>{view.assumptions.map((assumption,index)=><li key={index}>{assumption}</li>)}</ul>:<p>No additional assumptions supplied.</p>}
    {data.basis.kind==='reviewed-window'&&data.basis.issueReviews.length>0&&<><h4>Reviewed ambiguities</h4><ul>{data.basis.issueReviews.map(issue=><li key={issue.id}>Original {issue.originalKind}: {issue.originalReason} · {issue.disposition}: {issue.reason}</li>)}</ul></>}
    <WorkflowSourceCitations citations={view.citations} sourceName={sourceName}/>
    <h4>Applied local changes</h4>{edited?<ol>{view.editNotes.map((note,index)=><li key={index}>{note.detail} Reason: {note.reason}</li>)}</ol>:<p>No local changes applied.</p>}
   </details>
  </>}
  {!view.result&&<Prediction key={problem.id} problem={problem} {...interaction}/>}
  {view.result&&view.assessment&&<section className="workflow-result" aria-label="Computed workflow result">
   <h4>Final state: {view.result.finalStateLabel}</h4><p className="workflow-result-count">{view.result.blockedCount} blocked {view.result.blockedCount===1?'event':'events'}</p>
   <p role="status">{view.assessment.correction}</p>
   <p className="workflow-note">{editable?'Prediction':'First transfer prediction'} score: {view.assessment.score} / {view.assessment.maxScore}. Final state and blocked-event count are checked separately. This records one attempt and does not establish lasting learning.</p>
   {view.change&&<div className="workflow-change" aria-label="Computed workflow change"><h4>What changed?</h4><p>{view.change.summary}</p>{view.change.changedSteps.length>0&&<ol>{view.change.changedSteps.map(change=><li key={change.index}>Step {change.index}: {change.before?`${change.before.eventLabel}, ${change.before.fromStateLabel} → ${change.before.toStateLabel} (${change.before.status})`:'No original position'} → {change.after?`${change.after.eventLabel}, ${change.after.fromStateLabel} → ${change.after.toStateLabel} (${change.after.status})`:'No current position'}.</li>)}</ol>}<p className="workflow-note">Compared with the original practice rules and sequence by event position. This does not track where an event moved.</p>{edited&&mode!=='deep'&&<button type="button" disabled={pending} onClick={()=>chooseMode('deep')}>Explain this comparison</button>}</div>}
   {mode==='visual'&&<ol className="workflow-path" aria-label="Computed state path">{view.result.steps.map(step=><li key={step.index} data-blocked={step.status==='blocked'}><span>{step.fromStateLabel}</span><span className="workflow-path-event">{step.eventLabel}{step.status==='blocked'?' · blocked':' →'}</span><span>{step.toStateLabel}</span></li>)}</ol>}
   <div className="workflow-table"><table><caption>Computed event trace</caption><thead><tr><th scope="col" className="workflow-number">Step</th><th scope="col">Event</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Outcome</th></tr></thead><tbody>{view.result.steps.map(step=><tr key={step.index} data-changed={view.change?.changedSteps.some(change=>change.index===step.index)||undefined}><td className="workflow-number">{step.index}</td><th scope="row">{step.eventLabel}</th><td>{step.fromStateLabel}</td><td>{step.toStateLabel}</td><td>{step.status==='blocked'?'Blocked':'Applied'}{view.change?.changedSteps.some(change=>change.index===step.index)&&<span className="workflow-changed-label"> · changed</span>}</td></tr>)}</tbody></table></div>
   {editable&&<>{view.canStartTransfer?<button type="button" className="workflow-primary" disabled={disabled} onClick={()=>guard(()=>send({kind:'start-transfer',expectedRevision:state.revision}))}>{view.transferStarted?'Open saved transfer':'Try separate challenge'}</button>:<p className="workflow-note">{view.transferBlock==='matching-path'?'This practice path matches the separate challenge under this model’s path comparison. Change the starting state, events, or rules and check another prediction to try a different practice path.': 'Apply a change that alters the trace, then check a prediction to unlock the separate challenge.'}</p>}<p className="workflow-note">Earlier exposure is not tracked for this lesson; the separate challenge may have been seen before.</p></>}
  </section>}
  {!editable&&<button className="workflow-return" type="button" disabled={disabled} onClick={()=>guard(()=>send({kind:'return-practice',expectedRevision:state.revision}))}>Return to practice</button>}
 </section>;
}
