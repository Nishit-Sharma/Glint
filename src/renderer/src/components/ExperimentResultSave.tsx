import {useLayoutEffect,useRef,useState} from 'react';
import type {Task} from '../../../core/types';
import {artifactContextUncertain} from '../../../core/request-context';
import {experimentRunCurrent,type ExperimentRunInput} from '../../../learning/experiment-runs';
import {readExperimentResultInput,experimentResultBinding,expressionLabel,type ExperimentResultInput,type ExperimentResultInspection} from '../../../learning/experiment-result-copy';
import {EXPERIMENT_RESULT_SLOT,experimentResultDraftIdentity,readExperimentResultDraft,type ExperimentResultOwner} from '../../../shared/experiment-result-draft';
import type {LearningDraftJson} from '../../../shared/learning-drafts';
import {LearningDraftScope} from '../learning-draft-context';
import {formSubmission,useNavigationForm} from '../draft-navigation';
import {Button,type Run} from '../ui';
type Props={task:Task;owner:ExperimentResultOwner;calculation?:ExperimentRunInput;includeTrials?:boolean;busy:boolean;run:Run;isCurrent?:()=>boolean;scope?:string;onSaved?:()=>void};
export function ExperimentResultSave(props:Props){return <LearningDraftScope owner={props.owner}><ResultSave key={JSON.stringify(props.owner)} {...props}/></LearningDraftScope>;}
function ResultSave({task,owner,calculation,includeTrials=false,busy,run,isCurrent=()=>true,scope='',onSaved}:Props){
 const raw=useNavigationForm({pending:null as LearningDraftJson},task,undefined,undefined,{slot:EXPERIMENT_RESULT_SLOT,basisMode:'explicit',basis:experimentResultDraftIdentity(owner)}),[working,setWorking]=useState(false),[notice,setNotice]=useState(''),[sharing,setSharing]=useState(false),[discard,setDiscard]=useState(false),[outcome,setOutcome]=useState<ExperimentResultInspection>();
 const mounted=useRef(true),lock=useRef(false),latest=useRef({scope,isCurrent,calculation,includeTrials,pending:raw.draft.pending});latest.current={scope,isCurrent,calculation,includeTrials,pending:raw.draft.pending};
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useLayoutEffect(()=>{setSharing(false);},[JSON.stringify(calculation),includeTrials]);
 const pending=readExperimentResultDraft(raw.draft).pending,identity=pending?experimentResultBinding(pending):'',basis=task.artifacts.find(item=>item.id===owner.artifactId)?.revisions.at(-1),known=!!basis&&!artifactContextUncertain(task,owner.artifactId,basis),disabled=busy||working||raw.held;
 const active=()=>mounted.current&&latest.current.scope===scope&&latest.current.isCurrent(),samePending=(input:ExperimentResultInput)=>{try{return experimentResultBinding(readExperimentResultInput(latest.current.pending))===experimentResultBinding(input);}catch{return false;}};
 async function dispatch(input:ExperimentResultInput,inspect=false,leave=false){
  if(lock.current||busy||raw.held||!active()||!samePending(input))return false;
  lock.current=true;setWorking(true);setNotice('');const submitted=JSON.stringify([calculation,includeTrials]);
  try{const result=await run<ExperimentResultInspection>({type:inspect?'experiment.result.inspect':'experiment.result.save',input},undefined,{isCurrent:()=>active()&&samePending(input)});
   if(!result||result.binding!==experimentResultBinding(input))throw Error('The result save was not confirmed.');
   if(active()&&samePending(input)){setOutcome(result);setNotice(result.kind==='saved'?'That original result is saved in Files.':'The original result has not been saved. You can retry this exact calculation.');if(leave&&result.kind==='saved'&&JSON.stringify([latest.current.calculation,latest.current.includeTrials])===submitted){onSaved?.();return true;}}
  }catch{if(active()&&samePending(input))setNotice('The result save was not confirmed. Keep this original save and check its outcome before another copy.');}
  finally{lock.current=false;if(mounted.current)setWorking(false);}return false;
 }
 function save(){
  if(!calculation||!sharing||pending||latest.current.pending||disabled||!known||!active())return;
  const input=readExperimentResultInput({intentId:crypto.randomUUID(),includeTrials,calculation}),submitted=JSON.stringify([calculation,includeTrials]);
  if(raw.setDraft({pending:input as unknown as LearningDraftJson}).kind!=='accepted')return;latest.current.pending=input as unknown as LearningDraftJson;setOutcome(undefined);setDiscard(false);
  raw.submit(()=>{if(!active()||JSON.stringify([latest.current.calculation,latest.current.includeTrials])!==submitted)return;return formSubmission(undefined,dispatch(input,false,true));});
 }
 return <section className="experiment-result-save" aria-label="Save calculation result">
  {calculation&&!pending&&<><p>Save this calculated text as regular task content. It can be included in future AI or browser context under the existing sharing controls.</p><label><input type="checkbox" aria-label="Share calculated text with task context" checked={sharing} disabled={disabled} onChange={event=>setSharing(event.target.checked)}/> I reviewed this sharing notice for this result.</label><Button kind="primary" disabled={disabled||!sharing||!known||!experimentRunCurrent(task,calculation)} onClick={save}>Save result to task</Button>{!known&&<p role="status">This experiment’s original context cannot be verified. You can inspect it locally; save a current original experiment before making a result copy.</p>}</>}
  {pending&&<><h3>Original result save</h3><p>The exact calculation is kept on this Mac until you confirm its outcome. Checking never creates a copy.</p><p>{pending.calculation.title}: {Object.entries(pending.calculation.inputs).map(([name,value])=>`${name} = ${value}`).join(', ')}</p><details><summary>Review original calculation</summary><p>Formula: <code>{expressionLabel(pending.calculation.spec.expression)}</code></p><p>Assumptions: {pending.calculation.spec.assumptions.join(' ')}</p>{pending.calculation.baseline&&<p>Comparison baseline: {Object.entries(pending.calculation.baseline).map(([name,value])=>`${name} = ${value}`).join(', ')}. {pending.includeTrials?'Includes one-input model trials.':''}</p>}<p>Result text is derived locally from these exact bounded inputs and the saved experiment revision. No AI or browser action runs.</p></details><Button disabled={disabled} onClick={()=>void dispatch(pending,true)}>Check original result save</Button>{outcome?.binding===identity&&outcome.kind==='not-saved'&&<Button disabled={disabled||!known||!experimentRunCurrent(task,pending.calculation)} onClick={()=>void dispatch(pending)}>Retry original result save</Button>}{outcome?.binding===identity&&outcome.kind==='saved'&&<p role="status">The saved result remains in Files. Its original version is preserved.</p>}<label><input type="checkbox" checked={discard} disabled={disabled} onChange={event=>setDiscard(event.target.checked)}/> An earlier copy may already be saved. I will check Files before starting another copy.</label><Button disabled={disabled||!discard} onClick={()=>{if(!active()||lock.current)return;raw.setDraft({pending:null});setOutcome(undefined);setSharing(false);setDiscard(false);setNotice('Original save intent cleared. Calculate and review the current result before starting another copy.');}}>Discard original result save intent</Button></>}
  {raw.feedback}{notice&&<p role="status">{notice}</p>}
 </section>;
}
