import {useEffect,useRef,useState} from 'react';
import type {ArtifactRef,SourceRef} from '../../../core/types';
import {SIGNAL_OVERWRITE_ASSUMPTIONS,SIGNAL_OVERWRITE_LIMIT,signalOverwriteAnswers,signalOverwriteTrace,type SignalOverwrite,type SignalOverwriteAnswer} from '../../../learning/signal-overwrite';
import {Button,type Run} from '../ui';
import './signal-sequential-practice.css';

type SourceInput={taskId:string;basis:ArtifactRef;expectedSourceRefs:readonly SourceRef[];sourceId:string;start:number;end:number;quote:string;confirmed:true};
type Result={kind:'not-started'}|{kind:'running'}|{kind:'terminal';requestId:string;canRetry:boolean}|{kind:'completed';artifactId:string;revision:number};
type Status={kind:'checking'}|{kind:'uncertain'}|Result;
export function SignalOverwriteReview({pair,input,sourceLabel,busy,run,isCurrent,onOpen,onBack}:{pair:SignalOverwrite;input:SourceInput;sourceLabel:string;busy:boolean;run:Run;isCurrent:()=>boolean;onOpen:(result:{artifactId:string;revision:number},guard:()=>boolean)=>Promise<boolean>;onBack:()=>void}){
 const mounted=useRef(false),latest=useRef(isCurrent);latest.current=isCurrent;const active=()=>mounted.current&&latest.current();
 const [mode,setMode]=useState<'lesson'|'practice'>('lesson'),[secondEnabled,setSecondEnabled]=useState(true),[confirmed,setConfirmed]=useState(false),[answer,setAnswer]=useState<SignalOverwriteAnswer|null>(null),[status,setStatus]=useState<Status>({kind:'not-started'}),[pending,setPending]=useState(false),lock=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const selection=()=>({...input,...(mode==='lesson'?{mode,secondEnabled}:{mode})});
 async function inspect(){if(lock.current||!active()||busy)return;lock.current=true;setPending(true);try{const result=await run<Result>({type:'signal.overwrite.inspect',...selection()},undefined,{isCurrent:active});if(!active())return;if(!result){setStatus({kind:'uncertain'});return;}if(result.kind==='completed'){if(!await onOpen(result,active)&&active())setStatus({kind:'uncertain'});return;}setStatus(result);}catch{if(active())setStatus({kind:'uncertain'});}finally{lock.current=false;if(active())setPending(false);}}
 useEffect(()=>{if(mode==='practice')void inspect();},[mode]);
 async function submit(){if(lock.current||busy||pending||!confirmed||!active()||mode==='practice'&&answer===null||!(status.kind==='not-started'||status.kind==='terminal'&&status.canRetry))return;lock.current=true;setPending(true);try{const result=await run<{artifactId:string;revision:number}>({type:'signal.overwrite',...input,...(mode==='lesson'?{mode,secondEnabled}:{mode,answer:answer!}),...(status.kind==='terminal'?{retryOf:status.requestId}:{})},undefined,{isCurrent:active});if(!active())return;if(!result){setStatus({kind:'uncertain'});return;}if(!await onOpen(result,active)&&active())setStatus({kind:'uncertain'});}catch{if(active())setStatus({kind:'uncertain'});}finally{lock.current=false;if(active())setPending(false);}}
 const editable=!busy&&!pending&&(status.kind==='not-started'||status.kind==='terminal'&&status.canRetry),trace=signalOverwriteTrace(secondEnabled),sourceVersion=input.expectedSourceRefs.find(r=>r.sourceId===pair.sourceId)?.version;
 return <section className="workflow-source-review" aria-label="Two assignments to one signal" aria-busy={pending||undefined}>
  <header className="workflow-review-heading"><Button disabled={pending} onClick={onBack}>Back to source review</Button><h2>Two assignments to one signal</h2><p>Read a pending transaction, then change which statement executes.</p></header>
  <h3>Reviewed source pair</h3><p>Saved source: {sourceLabel} · version {sourceVersion}. Both adjacent complete lines are used.</p><pre>{pair.quote}</pre><p>To correct either source line, return to the document, edit the linked source, save and review its new version.</p>
  <details><summary>Required process and driver assumptions</summary><p>{SIGNAL_OVERWRITE_ASSUMPTIONS}</p></details><p>{SIGNAL_OVERWRITE_LIMIT}</p>
  <label><input type="checkbox" checked={confirmed} disabled={!editable} onChange={e=>setConfirmed(e.target.checked)}/> I reviewed both exact source lines and the same-process, same-driver assumptions.</label>
  {mode==='lesson'?<>
   <h3>Quick</h3><p>If both statements execute in this same process, the second replaces the first pending transaction for {pair.first.target}. The signal does not update between these statements.</p>
   <details><summary>Deep — why the first value is replaced</summary><p>No explicit delay means both transactions have the same simulation time. The second assignment removes the first pending transaction for this driver and adds its own. After the process suspends, the driver updates in a later delta cycle. This reasoning does not apply to separate concurrent drivers.</p></details>
   <h3>Visual — chosen hypothetical values</h3><p>Start with {pair.first.target} = 0, {pair.first.value} = 1 and {pair.second.value} = 0. These values are chosen for teaching, not read from your source.</p>
   <ol><li>First line: schedule 1; {pair.first.target} still reads 0.</li><li>Second line: replace that transaction with 0; {pair.first.target} still reads 0.</li><li>After suspension and a later delta update: {pair.first.target} reads 0.</li></ol>
   <h3>Change the hypothetical execution</h3><label><input type="checkbox" checked={secondEnabled} disabled={!editable} onChange={e=>setSecondEnabled(e.target.checked)}/> Execute the second statement in the changed example</label>
   <p role="status">Original: final scheduled value 0. Changed: final scheduled value {trace.after}. {secondEnabled?'The second transaction replaces the first.':'Skipping the second leaves the first transaction, so the final value changes from 0 to 1.'}</p><p>Skipping is your experimental choice; no condition or source edit is inferred. The current signal value stays 0 during either process execution.</p>
  </>:<>
   <h3>Separate replacement practice</h3><p>The three statements and values below are synthetic. Earlier exposure is unknown. Assume the same process and direct-driver restrictions for lamp and audit. Start with lamp = 1, primary = 0 and backup = 0.</p><pre>{'lamp <= primary;\naudit <= lamp;\nlamp <= backup;'}</pre><p>After these statements execute without a wait and the process suspends, predict (lamp, audit) after the later delta update.</p>
   <fieldset className="signal-practice-prediction" disabled={!editable}><legend>Your predicted pair (lamp, audit)</legend>{signalOverwriteAnswers.map(value=><label key={value}><input type="radio" name="signal-overwrite-answer" checked={answer===value} onChange={()=>setAnswer(value)}/> ({value[0]}, {value[1]})</label>)}</fieldset><p>Your first completed answer is saved before the explanation is revealed. One answer does not establish mastery.</p>
  </>}
  {status.kind==='checking'&&<p role="status">Checking for an earlier saved answer…</p>}{status.kind==='running'&&<p role="status">The earlier publication is still running. Check it before another submission.</p>}{status.kind==='terminal'&&<p role="status">The previous attempt ended without a saved result.{status.canRetry?' You can explicitly submit a new attempt.':' The retry limit was reached.'}</p>}{status.kind==='uncertain'&&<p role="alert">The publication could not be confirmed. Check the saved result before submitting again.</p>}
  {editable&&<Button kind="primary" disabled={!confirmed||mode==='practice'&&answer===null} onClick={()=>void submit()}>{mode==='lesson'?'Save source-linked explanation and change':'Save first answer and reveal explanation'}</Button>}
  {(status.kind==='uncertain'||status.kind==='running')&&<Button disabled={busy||pending} onClick={()=>void inspect()}>Check saved result</Button>}
  {mode==='lesson'&&status.kind==='not-started'&&<p><Button disabled={!confirmed||!editable} onClick={()=>{setStatus({kind:'checking'});setMode('practice');}}>Try separate replacement practice</Button></p>}
  <p className="tiny">Language basis: <a href="https://faculty-web.msoe.edu/johnsontimoj/Common/FILES/VHDL_2008.pdf">IEEE Std 1076-2008</a>, 10.5.2.2 and 14.7.5.</p>
 </section>;
}
