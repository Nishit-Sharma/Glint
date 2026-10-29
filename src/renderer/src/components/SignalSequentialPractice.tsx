import {useEffect,useRef,useState} from 'react';
import type {ArtifactRef,SourceRef} from '../../../core/types';
import {Button,Field,type Run} from '../ui';
import './signal-sequential-practice.css';

type SourceInput={taskId:string;basis:ArtifactRef;expectedSourceRefs:readonly SourceRef[];sourceId:string;start:number;end:number;quote:string;confirmed:true};
type Result={kind:'not-started'}|{kind:'running'}|{kind:'terminal';requestId:string;canRetry:boolean}|{kind:'completed';artifactId:string;revision:number};
type Status={kind:'checking'}|{kind:'uncertain'}|Result;
export function SignalSequentialPractice({input,busy,run,isCurrent,onOpen,onBack}:{input:SourceInput;busy:boolean;run:Run;isCurrent:()=>boolean;onOpen:(result:{artifactId:string;revision:number},guard:()=>boolean)=>Promise<boolean>;onBack:()=>void}){
 const mounted=useRef(false),current=useRef({isCurrent});current.current={isCurrent};const active=()=>mounted.current&&current.current.isCurrent();
 const [status,setStatus]=useState<Status>({kind:'checking'}),[answer,setAnswer]=useState<0|1|null>(null),[reasoning,setReasoning]=useState(''),[pending,setPending]=useState(false);const lock=useRef(false);
 async function check(){if(lock.current||!active())return;lock.current=true;setPending(true);try{const result=await run<Result>({type:'signal.practice.inspect',...input},undefined,{isCurrent:active});if(!active())return;if(!result){setStatus({kind:'uncertain'});return;}if(result.kind==='completed'){if(!await onOpen(result,active)&&active())setStatus({kind:'uncertain'});return;}setStatus(result);}catch{if(active())setStatus({kind:'uncertain'});}finally{lock.current=false;if(active())setPending(false);}}
 useEffect(()=>{mounted.current=true;void check();return()=>{mounted.current=false;};},[]);
 async function submit(){if(lock.current||busy||pending||answer===null||!active()||!(status.kind==='not-started'||status.kind==='terminal'&&status.canRetry))return;lock.current=true;setPending(true);try{const result=await run<{artifactId:string;revision:number}>({type:'signal.practice',...input,answer,reasoning,...(status.kind==='terminal'?{retryOf:status.requestId}:{})},undefined,{isCurrent:active});if(!active())return;if(!result){setStatus({kind:'uncertain'});return;}if(!await onOpen(result,active)&&active())setStatus({kind:'uncertain'});}catch{if(active())setStatus({kind:'uncertain'});}finally{lock.current=false;if(active())setPending(false);}}
 const editable=!busy&&!pending&&(status.kind==='not-started'||status.kind==='terminal'&&status.canRetry);
 return <section aria-label="Separate signal practice" aria-busy={pending||undefined}>
  <h3>Separate signal practice</h3><p>Based on the idea in the reviewed line <code>{input.quote}</code>. The following two lines and values are synthetic, not taken from your source. Earlier exposure is unknown.</p>
  <p>Assume compatible scalar binary signals and a nonpostponed sequential process that executes these two consecutive statements without suspending between them, then suspends. Each target has one direct effective driver, no value-transforming resolution or external force, and no later transaction replaces either assignment. At execution, lamp is 0 and sensor is 1.</p>
  <pre>{'lamp <= sensor;\naudit <= lamp;'}</pre><p>What value does the second statement schedule for the audit driver?</p>
  {status.kind==='checking'&&<p role="status">Checking for an earlier saved answer…</p>}
  {status.kind==='running'&&<p role="status">The earlier submission is still running. Check again before submitting.</p>}
  {status.kind==='terminal'&&<p role="status">The earlier attempt ended without a saved answer.{status.canRetry?' You can submit a new attempt.':' The supported retry limit was reached.'}</p>}
  {status.kind==='uncertain'&&<p role="alert">The answer could not be confirmed. Check the saved result before submitting again.</p>}
  {(status.kind==='not-started'||status.kind==='terminal'&&status.canRetry||status.kind==='uncertain')&&<><fieldset className="signal-practice-prediction" disabled={!editable}><legend>Your predicted value</legend><label><input type="radio" name="signal-practice-answer" checked={answer===0} onChange={()=>setAnswer(0)}/> 0</label><label><input type="radio" name="signal-practice-answer" checked={answer===1} onChange={()=>setAnswer(1)}/> 1</label></fieldset><Field label="Reasoning (optional, up to 500 characters)"><textarea value={reasoning} maxLength={500} disabled={!editable} onChange={event=>setReasoning(event.target.value)}/></Field><p>Submitting saves your first completed answer and reasoning for this reviewed line. Existing document versions can still be edited.</p><Button kind="primary" disabled={!editable||answer===null} onClick={()=>void submit()}>Save answer and reveal explanation</Button></>}
  {(status.kind==='running'||status.kind==='uncertain')&&<Button disabled={busy||pending} onClick={()=>void check()}>Check saved answer</Button>}
  <p>This is a conceptual illustration, not a VHDL simulation or evidence of mastery.</p><Button disabled={pending} onClick={onBack}>Back to source review</Button>
 </section>;
}
