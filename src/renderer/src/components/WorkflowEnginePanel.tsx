import {useEffect,useMemo,useRef,useState} from 'react';
import {defaultWorkflowExperiment,validateWorkflowExperiment,practiceVariantRules,workflowVariants,checkWorkflowVariant,compareWorkflowVariants,readWorkflowRepairProposal,describeProperty,workflowEngineLimits,workflowRepairGoals,findWorkflowRepair,type WorkflowRepairSearch,type WorkflowExperiment,type WorkflowProperty,type WorkflowTrace,type VariantCheck} from '../../../learning/workflow-engine';
import type {WorkflowAction,WorkflowCase,WorkflowState} from '../../../learning/workflow-lab';
import {useNavigationForm,useGuardedAction,type FormSubmission} from '../draft-navigation';

type Props={state:WorkflowState;disabled:boolean;onAction:(action:WorkflowAction)=>FormSubmission|undefined};
type FormProps=Props&{experiment:WorkflowExperiment;save:(experiment:WorkflowExperiment)=>FormSubmission|undefined};
const name=(rows:readonly {id:string;label:string}[],id:string)=>rows.find(row=>row.id===id)?.label??id;
const nextId=(prefix:string,rows:readonly {id:string}[])=>{let n=1;while(rows.some(row=>row.id===prefix+n))n++;return prefix+n;};
const message=(error:unknown)=>error instanceof Error?error.message:'Review these experiment inputs and try again.';
function Trace({trace,problem}:{trace:WorkflowTrace;problem:WorkflowCase}){
 return <details><summary>Event trace · final {trace.finalStateLabel}{trace.haltedAtStep?` · stopped at step ${trace.haltedAtStep}`:''}</summary>
  <p>Start: {name(problem.states,trace.initialStateId)}. {trace.steps.length} events inspected.</p>
  <ol>{trace.steps.map(step=><li key={step.index}><p>{step.index}. {step.eventLabel}: {step.beforeStateLabel} → {step.afterStateLabel}. {step.explanation}{step.outsideAssumptions?' This event is outside the saved possible-event assumptions.':''}</p>
   {step.candidates.length>0&&<details><summary>Rules and conditions for step {step.index}</summary><ul>{step.candidates.map(c=><li key={c.ruleId}>{c.ruleId}: {c.enabled?'enabled':'disabled'}; {c.matched?'matched':'did not match'}; destination {c.toStateLabel}. {c.guard.map(g=>`${g.flagLabel}: expected ${g.expected?'yes':'no'}, actual ${g.actual?'yes':'no'} (${g.passed?'matched':'failed'})`).join('; ')||'No guard conditions.'}</li>)}</ul><p>Flags before: {JSON.stringify(step.beforeFlags)}. After: {JSON.stringify(step.afterFlags)}.</p></details>}
  </li>)}</ol>{trace.unrunEventIds.length>0&&<p>Not run after ambiguity: {trace.unrunEventIds.map(id=>name(problem.events,id)).join(' → ')}.</p>}
 </details>;
}
function Assumptions({state,experiment,disabled,save}:FormProps){
 const p=state.practice,a=experiment.assumptions;
 const pairs=p.states.flatMap(s=>p.events.map(e=>({stateId:s.id,eventId:e.id})));
 // Fixed masks preserve empty selections without requiring a variable-array element template.
 const initial={starts:p.states.map(s=>a.initialStateIds.includes(s.id)),depth:String(a.maxDepth),budget:String(a.budget),allowed:pairs.map(pair=>!a.allowedEvents.some(row=>row.stateId===pair.stateId&&!row.eventIds.includes(pair.eventId))),ignored:pairs.map(pair=>a.ignored.some(row=>row.stateId===pair.stateId&&row.eventId===pair.eventId)),flags:JSON.stringify(experiment.flags,null,2)};
 const {draft,setDraft,submit,feedback,held}=useNavigationForm(initial,state,undefined,undefined,{slot:`workflow:engine:assumptions:${p.id}`}),[error,setError]=useState('');
 const toggle=(field:'starts'|'allowed'|'ignored',index:number)=>setDraft(old=>({...old,[field]:old[field].map((value,i)=>i===index?!value:value)}));
 return <form onSubmit={event=>{event.preventDefault();setError('');try{const candidate=validateWorkflowExperiment(p,{...experiment,flags:JSON.parse(draft.flags),assumptions:{initialStateIds:p.states.filter((_,i)=>draft.starts[i]).map(s=>s.id),maxDepth:Number(draft.depth),budget:Number(draft.budget),allowedEvents:p.states.map((s,si)=>({stateId:s.id,eventIds:p.events.filter((_,ei)=>draft.allowed[si*p.events.length+ei]).map(e=>e.id)})),ignored:pairs.filter((_,i)=>draft.ignored[i])}});submit(()=>save(candidate));}catch(cause){setError(message(cause));}}}>
  <fieldset disabled={disabled||held}><legend>Possible starting states</legend>{p.states.map((s,i)=><label className="workflow-checkbox" key={s.id}><input type="checkbox" checked={draft.starts[i]} onChange={()=>toggle('starts',i)}/>{s.label}</label>)}</fieldset>
  <div className="workflow-engine-fields"><label>Maximum event depth<input type="number" min={1} max={12} step={1} required value={draft.depth} disabled={disabled||held} onChange={e=>setDraft(old=>({...old,depth:e.target.value}))}/></label><label>Event-step budget<input type="number" min={100} max={50000} step={1} required value={draft.budget} disabled={disabled||held} onChange={e=>setDraft(old=>({...old,budget:e.target.value}))}/></label></div>
  <details><summary>Possible and explicitly ignored events</summary><p>Possible events bound the search. An ignored event stays in place only when no enabled rule matches.</p>{p.states.map((s,si)=><fieldset key={s.id} disabled={disabled||held}><legend>{s.label}</legend>{p.events.map((e,ei)=>{const index=si*p.events.length+ei;return <div className="workflow-engine-fields" key={e.id}><label className="workflow-checkbox"><input type="checkbox" checked={draft.allowed[index]} onChange={()=>toggle('allowed',index)}/>{e.label} possible in {s.label}</label><label className="workflow-checkbox"><input type="checkbox" checked={draft.ignored[index]} onChange={()=>toggle('ignored',index)}/>{e.label} ignored in {s.label}</label></div>;})}</fieldset>)}</details>
  <details><summary>Optional Boolean flags</summary><p>Up to three named flags, each with id, label and initial true/false. Alternative rule guards and sets may use these ids.</p><label>Flag definitions (JSON)<textarea rows={6} maxLength={2000} spellCheck={false} value={draft.flags} disabled={disabled||held} onChange={e=>setDraft(old=>({...old,flags:e.target.value}))}/></label></details>
  {feedback}{error&&<p role="alert">{error}</p>}<button type="submit" disabled={disabled||held}>Save assumptions</button>
 </form>;
}
function PropertyForm({state,experiment,disabled,save}:FormProps){
 const p=state.practice,{draft,setDraft,submit,feedback,held}=useNavigationForm({kind:'never',target:p.states.at(-1)!.id,after:p.states[0].id,unless:'',terminals:[p.states.at(-1)!.id]},state,undefined,undefined,{slot:`workflow:engine:property:${p.id}`,variableArrays:['terminals']}),[error,setError]=useState('');
 return <form onSubmit={event=>{event.preventDefault();setError('');try{const id=nextId('property-',experiment.properties),kind=draft.kind as WorkflowProperty['kind'];let property:WorkflowProperty;
  if(kind==='reachable'||kind==='never')property={id,kind,stateId:draft.target};else if(kind==='never-follows')property={id,kind,stateId:draft.target,afterStateId:draft.after,unlessStateId:draft.unless||null};else if(kind==='no-dead-end'||kind==='terminates')property={id,kind,terminalStateIds:draft.terminals};else property={id,kind};
  const candidate=validateWorkflowExperiment(p,{...experiment,properties:[...experiment.properties,property]});submit(()=>save(candidate));}catch(cause){setError(message(cause));}}}>
  <label>Property to check<select value={draft.kind} disabled={disabled||held} onChange={e=>setDraft(old=>({...old,kind:e.target.value}))}><option value="never">Never reach a state</option><option value="reachable">Reach a state</option><option value="never-follows">Never follow a state without a reset</option><option value="deterministic">No ambiguous rules</option><option value="complete">Handle every possible event</option><option value="no-dead-end">No dead ends outside terminal states</option><option value="terminates">Reach a terminal state within the depth</option></select></label>
  {['never','reachable','never-follows'].includes(draft.kind)&&<label>Target state<select value={draft.target} disabled={disabled||held} onChange={e=>setDraft(old=>({...old,target:e.target.value}))}>{p.states.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>}
  {draft.kind==='never-follows'&&<><label>After state<select value={draft.after} disabled={disabled||held} onChange={e=>setDraft(old=>({...old,after:e.target.value}))}>{p.states.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label><label>Unless visited in between<select value={draft.unless} disabled={disabled||held} onChange={e=>setDraft(old=>({...old,unless:e.target.value}))}><option value="">No reset exception</option>{p.states.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label></>}
  {['no-dead-end','terminates'].includes(draft.kind)&&<fieldset disabled={disabled||held}><legend>Terminal states</legend>{p.states.map(s=><label className="workflow-checkbox" key={s.id}><input type="checkbox" checked={draft.terminals.includes(s.id)} onChange={()=>setDraft(old=>({...old,terminals:old.terminals.includes(s.id)?old.terminals.filter(id=>id!==s.id):[...old.terminals,s.id]}))}/>{s.label}</label>)}</fieldset>}
  {feedback}{error&&<p role="alert">{error}</p>}<button type="submit" disabled={disabled||held||experiment.properties.length>=workflowEngineLimits.properties}>Add bounded property</button>
 </form>;
}
function FixtureForm({state,experiment,disabled,save}:FormProps){
 const p=state.practice,{draft,setDraft,submit,feedback,held}=useNavigationForm({label:'Sequence test',initial:p.initialStateId,events:[...p.eventIds],expected:''},state,undefined,undefined,{slot:`workflow:engine:fixture:${p.id}`,variableArrays:['events']}),[error,setError]=useState('');
 return <form onSubmit={event=>{event.preventDefault();setError('');try{const candidate=validateWorkflowExperiment(p,{...experiment,fixtures:[...experiment.fixtures,{id:nextId('test-',experiment.fixtures),label:draft.label,initialStateId:draft.initial,eventIds:draft.events,expectedFinalStateId:draft.expected||null}]});submit(()=>save(candidate));}catch(cause){setError(message(cause));}}}>
  <label>Test name<input value={draft.label} required maxLength={160} disabled={disabled||held} onChange={e=>setDraft(old=>({...old,label:e.target.value}))}/></label>
  <label>Test starting state<select value={draft.initial} disabled={disabled||held} onChange={e=>setDraft(old=>({...old,initial:e.target.value}))}>{p.states.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
  <ol className="workflow-event-fields">{draft.events.map((id,index)=><li key={index}><label>Test event {index+1}<select value={id} disabled={disabled||held} onChange={e=>setDraft(old=>({...old,events:old.events.map((v,i)=>i===index?e.target.value:v)}))}>{p.events.map(e=><option key={e.id} value={e.id}>{e.label}</option>)}</select></label><button type="button" aria-label={`Remove test event ${index+1}`} disabled={disabled||held||draft.events.length===1} onClick={()=>setDraft(old=>({...old,events:old.events.filter((_,i)=>i!==index)}))}>Remove</button></li>)}</ol>
  <button type="button" disabled={disabled||held||draft.events.length>=12} onClick={()=>setDraft(old=>({...old,events:[...old.events,p.events[0].id]}))}>Add test event</button>
  <label>Expected final state<select value={draft.expected} disabled={disabled||held} onChange={e=>setDraft(old=>({...old,expected:e.target.value}))}><option value="">Trace only, no expected result</option>{p.states.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
  {feedback}{error&&<p role="alert">{error}</p>}<button type="submit" disabled={disabled||held||experiment.fixtures.length>=8}>Save sequence test</button>
 </form>;
}
function AlternativeForm({state,experiment,disabled,save}:FormProps){
 const p=state.practice,{draft,setDraft,submit,feedback,held}=useNavigationForm({origin:'user',proposal:JSON.stringify({label:'Proposed alternative',note:'Hypothetical local rule choices.',rules:practiceVariantRules(p)},null,2)},state,undefined,undefined,{slot:`workflow:engine:alternative:${p.id}`}),[error,setError]=useState('');
 return <form onSubmit={event=>{event.preventDefault();setError('');try{const variant=readWorkflowRepairProposal(p,experiment,nextId('alternative-',experiment.variants),draft.origin==='muse-proposed'?'muse-proposed':'user',draft.proposal),candidate={...experiment,variants:[...experiment.variants,variant]};submit(()=>save(candidate));}catch(cause){setError(message(cause));}}}>
  <p>Edit a copy or paste proposed rules. Each rule has an id, fromStateId, eventId, toStateId, enabled, guard (flagId/equals) and sets (flagId/value). All identities must belong to this practice model. No proposal changes the original rules.</p>
  <p>States: {p.states.map(s=>`${s.label} (${s.id})`).join(', ')}. Events: {p.events.map(e=>`${e.label} (${e.id})`).join(', ')}.</p>
  <label>Proposal origin<select value={draft.origin} disabled={disabled||held} onChange={e=>setDraft(old=>({...old,origin:e.target.value}))}><option value="user">Your alternative</option><option value="muse-proposed">Pasted Muse proposal (unverified)</option></select></label>
  <label>Alternative rules (JSON)<textarea rows={14} maxLength={32000} spellCheck={false} value={draft.proposal} disabled={disabled||held} onChange={e=>setDraft(old=>({...old,proposal:e.target.value}))}/></label>
  {feedback}{error&&<p role="alert">{error}</p>}<button type="submit" disabled={disabled||held||experiment.variants.length>=3}>Save and check alternative</button>
  <small>Checks use only the saved sequence tests, properties and bounds. A proposed repair is never a guarantee.</small>
 </form>;
}
function GoalForm({state,experiment,disabled,save}:FormProps){
 const problem=state.practice,goals=workflowRepairGoals(problem,experiment),{draft,setDraft,submit,feedback,held}=useNavigationForm({goal:''},state,undefined,undefined,{slot:`workflow:engine:goal:${problem.id}`});
 const [preview,setPreview]=useState<{key:string;value:WorkflowRepairSearch}>(),[error,setError]=useState(''),alive=useRef(true);
 const key=JSON.stringify([state.revision,problem,experiment,draft.goal]),shown=preview?.key===key?preview.value:undefined,live=useRef({key,disabled,held,shown});live.current={key,disabled,held,shown};
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 function find(event:React.FormEvent){event.preventDefault();if(disabled||held)return;setError('');try{setPreview({key,value:findWorkflowRepair(problem,experiment,draft.goal,nextId('goal-',experiment.variants))});}catch(cause){setPreview(undefined);setError(message(cause));}}
 function keep(){
  const selected=shown;if(!selected?.variant||disabled||held)return;
  submit(()=>{if(!alive.current||live.current.key!==key||live.current.disabled||live.current.held||live.current.shown!==selected)return;return save(validateWorkflowExperiment(problem,{...experiment,variants:[...experiment.variants,selected.variant!],comparison:{leftId:'practice',rightId:selected.variant!.id}}));});
 }
 return <form onSubmit={find}>
  <p>Choose a saved check as your goal. Search changes one current practice rule’s destination or enabled setting. It keeps every original rule, assumption, flag, prediction and separate challenge unchanged.</p>
  {!goals.length&&<p>First add a property, or save a sequence test with an expected final state. Trace-only tests cannot be goals.</p>}
  <label>Repair goal<select required value={draft.goal} disabled={disabled||held} onChange={event=>{setDraft({goal:event.target.value});setPreview(undefined);setError('');}}><option value="">Choose a saved check</option>{goals.map(goal=><option key={goal.id} value={goal.id}>{goal.label}</option>)}</select></label>
  {feedback}{error&&<p role="alert">{error}</p>}
  <button type="submit" disabled={disabled||held||!goals.length||experiment.variants.length>=workflowEngineLimits.variants}>Find a local candidate</button>
  {experiment.variants.length>=workflowEngineLimits.variants&&<p>Remove a saved alternative before searching for another.</p>}
  <p className="workflow-note">At most {workflowEngineLimits.repairCandidates} candidates and {workflowEngineLimits.repairEventSteps.toLocaleString()} total event steps, including property searches, witness replays and sequence tests. Every saved expected result and property must pass its bounded check; incomplete or ambiguous checks cannot qualify. This is not an arbitrary-code or natural-language repair service.</p>
  {shown&&<section aria-label="Local repair preview"><h5>{shown.goal}</h5>
   <p role="status">{shown.status==='found'?'A candidate passed all saved checks within their bounds. Review it before saving.':shown.status==='already-satisfied'?'The current rules already meet this goal and every saved check within their bounds. No new alternative is needed.':shown.status==='exhausted'?'No qualifying single-rule candidate was found in the enumerated choices.':shown.status==='candidate-limit'?'Candidate limit reached. No qualifying candidate was found before the search stopped.':'Event-work limit reached. The next full check would exceed the remaining allowance; saved budgets were not reduced.'}</p>
   <p>{shown.candidatesChecked} of {shown.candidatesAvailable} single-rule candidates checked; {shown.eventSteps} total event steps. {shown.inconclusiveCandidates} checked candidate(s) had incomplete or ambiguous checks.{shown.baselineInconclusive?' The original checks were also incomplete or ambiguous.':''} No result proves a repair exists or is impossible outside this search and its saved depth.</p>
   {shown.change&&<p><strong>Proposed rule {shown.change.before.id}:</strong> {name(problem.states,shown.change.before.fromStateId)} + {name(problem.events,shown.change.before.eventId)}: destination {name(problem.states,shown.change.before.toStateId)} → {name(problem.states,shown.change.after.toStateId)}; {shown.change.before.enabled?'enabled':'disabled'} → {shown.change.after.enabled?'enabled':'disabled'}. All other rule fields stay unchanged.</p>}
   {shown.baseline&&<Results check={shown.baseline} problem={problem}/>}{shown.check&&<Results check={shown.check} problem={problem}/>}
   {shown.variant&&<button type="button" disabled={disabled||held} onClick={keep}>Save reviewed local candidate</button>}
  </section>}
 </form>;
}
function Results({check,problem}:{check:VariantCheck;problem:WorkflowCase}){
 return <section aria-label={`Bounded results for ${check.variantLabel}`}><h5>{check.variantLabel}</h5><p>{check.label}</p>
  {check.fixtures.map(f=><div key={f.fixtureId}><p><strong>{f.label}</strong> · {f.passed===null?'Trace only':f.passed?'Expected final state reached':'Expected final state not reached'}{f.expectedFinalStateId?` (${name(problem.states,f.expectedFinalStateId)})`:''}</p><Trace trace={f.trace} problem={problem}/></div>)}
  {check.properties.map(r=><div key={r.propertyId}><p><strong>{r.description}</strong></p><p>{r.summary}</p><p className="workflow-note">Depth limit {r.bounds.maxDepth}; completed exploration depth {r.bounds.completedDepth}. {r.bounds.stepsExplored} / {r.bounds.budget} event probes; {r.bounds.configurationsVisited} configurations. {r.bounds.budgetExhausted?'Budget exhausted; search is incomplete.':''} {r.bounds.ambiguousStops?`${r.bounds.ambiguousStops} ambiguous branches were not extended.`:''}</p>{r.counterexample&&<Trace trace={r.counterexample.trace} problem={problem}/>}</div>)}
 </section>;
}
export function WorkflowEnginePanel({state,disabled,onAction}:Props){
 const experiment=state.experiment??defaultWorkflowExperiment(state.practice),guard=useGuardedAction();
 const checks=useMemo(()=>workflowVariants(state.practice,experiment).map(checkWorkflowVariant),[state.practice,state.experiment]);
 const comparison=useMemo(()=>experiment.comparison?compareWorkflowVariants(state.practice,experiment,experiment.comparison.leftId,experiment.comparison.rightId):null,[state.practice,state.experiment]);
 const save=(candidate:WorkflowExperiment)=>onAction({kind:'set-experiment',experiment:candidate,expectedRevision:state.revision});
 const form={state,experiment,disabled,onAction,save};
 return <details className="workflow-engine"><summary>Bounded checks and alternatives</summary><section aria-label="Bounded workflow checks">
  <p>Hypothetical practice inputs at saved revision {state.revision}. Search within explicit bounds can find a counterexample; none found within bounds is not proof. Missing rules stay in place; ambiguous events stop that branch. No real procedure executes.</p>
  <p className="workflow-note">{state.experiment?'These experiment inputs are saved with this lesson.':'Default bounds are shown; save inputs or add a test to keep an experiment.'} Each explicit sequence test starts with the flag defaults and runs its full listed events, even outside search assumptions; such steps are marked.</p>
  <details><summary>Edit search assumptions and inputs</summary><Assumptions {...form}/></details>
  <details><summary>Add a property</summary><PropertyForm {...form}/></details>
  <details><summary>Add a sequence test</summary><FixtureForm {...form}/></details>
  <details><summary>Find a repair for a goal</summary><GoalForm {...form}/></details>
  <details><summary>Propose an alternative or repair</summary><AlternativeForm {...form}/></details>
  {experiment.properties.length>0&&<ul aria-label="Saved properties">{experiment.properties.map(p=><li key={p.id}>{describeProperty(state.practice,p)} <button type="button" disabled={disabled} onClick={()=>guard(()=>save({...experiment,properties:experiment.properties.filter(v=>v.id!==p.id)}))}>Remove property {p.id}</button></li>)}</ul>}
  {experiment.fixtures.length>0&&<ul aria-label="Saved sequence tests">{experiment.fixtures.map(f=><li key={f.id}>{f.label} <button type="button" disabled={disabled} onClick={()=>guard(()=>save({...experiment,fixtures:experiment.fixtures.filter(v=>v.id!==f.id)}))}>Remove test {f.label}</button></li>)}</ul>}
  {experiment.variants.length>0&&<section aria-label="Saved alternatives"><h5>Compare proposed alternatives</h5><p>Original practice rules are retained. Proposed origin describes who supplied rules; computed checks describe only this saved model.</p>{experiment.variants.map(v=><p key={v.id}>{v.label} · {v.origin==='muse-proposed'?'Muse-proposed, unverified':'User-proposed'}. {v.note} <button type="button" disabled={disabled} onClick={()=>guard(()=>save({...experiment,comparison:{leftId:'practice',rightId:v.id}}))}>Compare {v.label} with practice</button> <button type="button" disabled={disabled} onClick={()=>guard(()=>save({...experiment,variants:experiment.variants.filter(row=>row.id!==v.id),comparison:null}))}>Remove alternative {v.label}</button></p>)}</section>}
  {comparison&&<section aria-label="Computed alternative comparison"><h5>{comparison.left.variantLabel} versus {comparison.right.variantLabel}</h5>{comparison.fixtures.map(f=><p key={f.fixtureId}>{f.label}: {f.left.trace.finalStateLabel} → {f.right.trace.finalStateLabel}. {f.divergesAtStep===null?'No event outcome differs.':`First differing event: ${f.divergesAtStep}.`}</p>)}{comparison.properties.map(p=><p key={p.propertyId}>{p.description}: {p.left.verdict} → {p.right.verdict}. {p.changed?'Verdict changed.':'Same bounded verdict.'}</p>)}{!comparison.fixtures.length&&!comparison.properties.length&&<p>Add a sequence test or property to compare outcomes.</p>}</section>}
  {checks.map(check=><Results key={check.variantId} check={check} problem={state.practice}/>)}
 </section></details>;
}
