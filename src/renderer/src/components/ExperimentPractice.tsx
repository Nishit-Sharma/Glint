import {evaluateExperiment} from '../../../core/experiments';
import {nextExperimentCase} from '../../../learning/experiment-teaching';
import {EXPERIMENT_PRACTICE_SLOT,EXPERIMENT_PRACTICE_INTENT_SLOT,emptyExperimentPractice,emptyExperimentPracticeIntent,readExperimentPracticeDraft,experimentPracticeDraftBasis,type ExperimentPracticeOwner} from '../../../shared/experiment-practice-draft';
import {LearningDraftScope,useLearningDraft,useLearningDraftSubmission} from '../learning-draft-context';
import {retainExperimentExamples} from '../experiment-comparison';
import {OPEN_REVIEW_EXAMPLES,type ExperimentExampleContext} from '../../../shared/experiment-examples';
import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import type {ArtifactRef,ExperimentSpec,SourceRef,Task} from '../../../core/types';
import {Button,Field,type Run} from '../ui';
import {useNavigationDraft} from '../draft-navigation';
import {ReadableText} from './ReadableText';
type Basis={taskId:string;basis:ArtifactRef;expectedSourceRefs:SourceRef[]};
type Result={kind:'not-started'}|{kind:'running';requestId:string}|{kind:'terminal';requestId:string;canRetry:boolean}|{kind:'completed';artifactId:string;revision:number;digest:string};
type Status={kind:'choose'}|{kind:'check'}|Result;
type Props={basis:Basis;spec:ExperimentSpec;defaults:Record<string,number>;demonstratedInputs?:Record<string,number>[];exampleContext?:ExperimentExampleContext;formula:string;outputUnit:string;busy:boolean;run:Run;isCurrent:()=>boolean;onBack:()=>void};
export function ExperimentPractice(props:Props){const owner:ExperimentPracticeOwner={kind:'experiment-practice',taskId:props.basis.taskId,artifactId:props.basis.basis.artifactId,artifactRevision:props.basis.basis.revision,artifactDigest:props.basis.basis.digest};return <LearningDraftScope owner={owner}><Practice key={JSON.stringify(owner)} {...props} owner={owner}/></LearningDraftScope>;}
function Practice({basis,spec,defaults,demonstratedInputs:shownInputs=[],exampleContext:shownContext,formula,outputUnit,busy,run,isCurrent,onBack,owner}:Props&{owner:ExperimentPracticeOwner}){
 const rangeId=useId();
 const [fallback,setFallback]=useState({...emptyExperimentPractice}),[fallbackIntent,setFallbackIntent]=useState('');
 const saved=useLearningDraft(emptyExperimentPractice,EXPERIMENT_PRACTICE_SLOT,experimentPracticeDraftBasis(owner));
 const intent=useLearningDraft(emptyExperimentPracticeIntent,EXPERIMENT_PRACTICE_INTENT_SLOT,experimentPracticeDraftBasis(owner,EXPERIMENT_PRACTICE_INTENT_SLOT));
 const submitTracked=useLearningDraftSubmission(),pendingText=intent?.form.value.pendingText??fallbackIntent;
 let raw=saved?.form.value??fallback,rawIssue='';
 // A retained submission selects its original raw inputs until the host is checked.
 // It is never an executable command or a receipt authorizing another submission.
 try{if(pendingText)raw=readExperimentPracticeDraft(JSON.parse(pendingText));}catch{rawIssue='The retained submission needs inspection in Unfinished practice.';}
 const setRaw=(next:typeof emptyExperimentPractice):boolean=>{if(saved)return saved.cache.tryEdit(owner,EXPERIMENT_PRACTICE_SLOT,emptyExperimentPractice,experimentPracticeDraftBasis(owner),()=>next).kind==='accepted';setFallback(next);return true;};
 const setIntent=(pendingText:string):boolean=>{if(intent)return intent.cache.tryEdit(owner,EXPERIMENT_PRACTICE_INTENT_SLOT,emptyExperimentPracticeIntent,experimentPracticeDraftBasis(owner,EXPERIMENT_PRACTICE_INTENT_SLOT),()=>({pendingText})).kind==='accepted';setFallbackIntent(pendingText);return true;};
 let inputs:Record<string,string>={},demonstratedInputs=shownInputs,exampleContext=shownContext;
 try{
  const parsed:unknown=JSON.parse(raw.inputsText);
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.entries(parsed).some(([key,value])=>!spec.variables.some(variable=>variable.name===key)||typeof value!=='string'))throw Error();
  inputs=parsed as Record<string,string>;
  if(raw.examplesText){const examples=JSON.parse(raw.examplesText);if(!examples||typeof examples!=='object'||Object.keys(examples).some(key=>!['inputs','exampleContext'].includes(key))||!Array.isArray(examples.inputs)||examples.inputs.length>14||examples.exampleContext!==null&&examples.exampleContext!==OPEN_REVIEW_EXAMPLES)throw Error();for(const example of examples.inputs){if(!example||typeof example!=='object'||Array.isArray(example))throw Error();evaluateExperiment(spec,example);}demonstratedInputs=examples.inputs;exampleContext=examples.exampleContext??undefined;}
  // New observations in this open review must also constrain a new prediction.
  if(!pendingText){const merged=retainExperimentExamples(demonstratedInputs,shownInputs,spec);if(merged.kind==='full')throw Error();demonstratedInputs=merged.examples;if(shownContext===OPEN_REVIEW_EXAMPLES)exampleContext=shownContext;}
 }catch{rawIssue='The retained input or example fields need inspection in Unfinished practice.';}
 const {prediction,reasoning}=raw,examplesText=JSON.stringify({inputs:demonstratedInputs,exampleContext:exampleContext??null});
 const setInputs=(value:Record<string,string>)=>setRaw({...raw,inputsText:JSON.stringify(value),examplesText}),setPrediction=(prediction:string)=>setRaw({...raw,prediction}),setReasoning=(reasoning:string)=>setRaw({...raw,reasoning});
 const [phase,setStatus]=useState<Status>({kind:'choose'}),[pending,setPending]=useState(false),[display,setDisplay]=useState(''),[notice,setNotice]=useState(''),lock=useRef(false),mounted=useRef(true);
 const focusAfter=useRef<''|'check'|'save'|'open'>(''),predictionRef=useRef<HTMLInputElement>(null),savedRef=useRef<HTMLParagraphElement>(null),verdictRef=useRef<HTMLDivElement>(null);
 const status:Status=pendingText&&!pending&&(phase.kind==='choose'||phase.kind==='not-started'||phase.kind==='terminal')?{kind:'check'}:phase;
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const active=()=>mounted.current&&isCurrent();
 const held=[saved,intent].some(form=>!!form&&(form.frozen||form.maintenance||form.form.status!=='ready'||!!form.form.error||!!form.rejection));
 const vals=Object.fromEntries(spec.variables.map(v=>[v.name,inputs[v.name]?.trim()?Number(inputs[v.name]):NaN])),valid=spec.variables.every(v=>Number.isFinite(vals[v.name])&&(!v.integer||Number.isSafeInteger(vals[v.name]))&&vals[v.name]>=v.min&&vals[v.name]<=v.max)&&spec.variables.some(v=>vals[v.name]!==defaults[v.name])&&demonstratedInputs.every(example=>spec.variables.some(v=>vals[v.name]!==example[v.name])),pred=prediction.trim()?Number(prediction):NaN,canPredict=Number.isFinite(pred)&&Math.abs(pred)<=1e15&&!!reasoning.trim()&&reasoning.length<=2000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(reasoning),disabled=busy||pending||held||!!rawIssue||!active();
 const nav=useNavigationDraft(!saved&&status.kind!=='completed'&&(Object.values(inputs).some(Boolean)||!!prediction||!!reasoning),()=>{setRaw({...emptyExperimentPractice});setStatus({kind:'choose'});});
 const request=()=>({...basis,inputs:vals,...(demonstratedInputs.length?{demonstratedInputs}:{}),...(exampleContext?{exampleContext}:{})});
 async function clearIntent(){if(!setIntent(''))return false;if(intent)await intent.cache.flushForm(owner,EXPERIMENT_PRACTICE_INTENT_SLOT);return true;}
 async function check(){
  if(disabled||!valid||lock.current)return;lock.current=true;focusAfter.current='check';setPending(true);setNotice('');
  try{
   const result=await run<Result>({type:'experiment.practice.inspect',...request()},undefined,{isCurrent:active});if(!active())return;
   if(!result){setStatus({kind:'check'});return;}
   if(pendingText&&(result.kind==='not-started'||result.kind==='terminal')){
    if(!setRaw(raw))return;if(saved)await saved.cache.flushForm(owner,EXPERIMENT_PRACTICE_SLOT);
    if(!active()||!await clearIntent()||!active())return;
   }
   if(result.kind==='completed')nav();setStatus(result);
  }catch{if(active())setStatus({kind:'check'});}finally{lock.current=false;if(mounted.current)setPending(false);}
 }
 async function submit(){
  if(disabled||!valid||!canPredict||lock.current||!(status.kind==='not-started'||status.kind==='terminal'&&status.canRetry))return;
  lock.current=true;focusAfter.current='save';setPending(true);setNotice('');
  try{
   const result=await submitTracked(async()=>{
    if(saved)await saved.cache.flushForm(owner,EXPERIMENT_PRACTICE_SLOT);if(!active())return;
    if(!setIntent(JSON.stringify({...raw,examplesText})))return;
    if(intent)await intent.cache.flushForm(owner,EXPERIMENT_PRACTICE_INTENT_SLOT);if(!active())return;
    return run<{artifactId:string;revision:number;digest:string}>({type:'experiment.practice',...request(),prediction:pred,reasoning,...(status.kind==='terminal'?{retryOf:status.requestId}:{})},undefined,{isCurrent:active});
   });
   if(!active())return;if(!result){setStatus({kind:'check'});return;}nav();setStatus({kind:'completed',...result});
  }catch{if(active())setStatus({kind:'check'});}finally{lock.current=false;if(mounted.current)setPending(false);}
 }
 async function open(){if(disabled||status.kind!=='completed'||lock.current)return;lock.current=true;focusAfter.current='open';setPending(true);setNotice('');try{const check=await run<Result>({type:'experiment.practice.inspect',...request()},undefined,{isCurrent:active});if(!active())return;if(!check||check.kind!=='completed'||check.artifactId!==status.artifactId||check.revision!==status.revision||check.digest!==status.digest){setDisplay('');setNotice('The saved practice or its source changed. Review it in Files and its version history.');return;}const task=await run<Task>({type:'tasks.get',taskId:basis.taskId},undefined,{isCurrent:active});if(!active())return;const parent=task?.artifacts.find(a=>a.id===basis.basis.artifactId)?.revisions.at(-1),saved=task?.artifacts.find(a=>a.id===status.artifactId)?.revisions.at(-1),refs=basis.expectedSourceRefs;if(!parent||parent.revision!==basis.basis.revision||parent.digest!==basis.basis.digest||JSON.stringify(parent.sourceRefs)!==JSON.stringify(refs)||!saved||saved.revision!==status.revision||saved.digest!==status.digest||saved.mimeType!=='text/plain'||task!.sources.filter(s=>refs.some(r=>r.sourceId===s.id&&s.freshness==='fresh'&&s.currentVersion===r.version&&s.versions.at(-1)?.digest===r.digest)).length!==refs.length){setDisplay('');setNotice('The saved practice or its source changed. Review it in Files and its version history.');return;}setDisplay(saved.content);}catch{if(active()){setDisplay('');setNotice('The saved practice could not be checked. Review it in Files and its version history.');}}finally{lock.current=false;if(mounted.current)setPending(false);}}
 async function chooseCase(next:typeof emptyExperimentPractice,message=''){
  if(disabled||lock.current)return;lock.current=true;setPending(true);
  try{
   if(!setRaw(next))return;if(saved)await saved.cache.flushForm(owner,EXPERIMENT_PRACTICE_SLOT);
   if(!active()||!await clearIntent()||!active())return;
   setStatus({kind:'choose'});setDisplay('');setNotice(message);
  }catch{if(active())setNotice('The next inputs could not be saved. Your previous answer remains available.');}finally{lock.current=false;if(mounted.current)setPending(false);}
 }
 function freshCase(){
  if(disabled||status.kind!=='completed'||!display)return;
  try{
   const retained=retainExperimentExamples(demonstratedInputs,[...shownInputs,vals],spec);
   if(retained.kind==='full'){setNotice('Fourteen revealed examples are already recorded. Continue exploring in the experiment; no fresh-case claim can be made here.');return;}
   const next=nextExperimentCase(spec,defaults,vals,retained.examples);
   if(!next){setNotice('No distinct output was found in twelve samples per input within the saved bounds. Choose other inputs manually; this is not proof that none exist.');return;}
   void chooseCase({...emptyExperimentPractice,inputsText:JSON.stringify(Object.fromEntries(Object.entries(next).map(([name,value])=>[name,String(value)]))),examplesText:JSON.stringify({inputs:retained.examples,exampleContext:OPEN_REVIEW_EXAMPLES})},'Separate hypothetical case ready. Predict before revealing the result. Recorded examples from this retained practice draft are excluded; other exposure is unknown.');
  }catch{setNotice('A separate case could not be computed within the saved model bounds. Your saved answer and raw fields are kept.');}
 }
 // Presentation only: the loop reads choose → predict → see the result; every exclusion, tolerance and provenance statement stays, the long ones inside "How this is checked".
 const step=status.kind==='completed'?3:status.kind==='choose'||status.kind==='check'&&!pendingText?1:2,current=exampleContext!==OPEN_REVIEW_EXAMPLES&&demonstratedInputs.length<=2,verdict=display?readVerdict(display,spec):undefined;
 // Move focus only after an action this learner started has settled; a missing target (failure paths) leaves focus where it was.
 useEffect(()=>{if(pending||!focusAfter.current)return;const intent=focusAfter.current;focusAfter.current='';(intent==='open'?verdictRef.current:intent==='check'?predictionRef.current??savedRef.current:savedRef.current)?.focus();},[pending,status,display]);
 const label=(name:string)=>spec.variables.filter(v=>humanLabel(v.name)===humanLabel(name)).length>1?name:humanLabel(name);
 const valueText=(values:Record<string,unknown>,whole=false)=>spec.variables.map(v=>`${label(v.name)}: ${values[v.name]}${v.unit==='1'?'':' '+v.unit}${whole&&v.integer?' · whole-number input':''}`).join(', ');
 const defaultsText=valueText(defaults),exampleTexts=[...new Set(demonstratedInputs.map(example=>valueText(example)))],extraExamples=exampleTexts.filter(text=>text!==defaultsText),defaultsRecorded=extraExamples.length<exampleTexts.length;
 const model=<div className="practice-model"><p className="practice-formula"><span>Formula: </span><code>{withoutOuterBrackets(formula)}</code></p>{spec.assumptions.length>0&&<><p className="practice-label">Saved assumptions:</p><ul className="practice-assumptions">{spec.assumptions.map((item,index)=><li key={index}>{item}</li>)}</ul></>}</div>;
 return <section className="experiment-practice" aria-label="Separate experiment practice" aria-busy={pending||undefined}>
  <header className="practice-header"><h3>Predict the result</h3><p className="practice-lede">Choose new inputs, predict what the formula gives, then compare with the calculation.</p><p className="structured-help">Earlier exposure is unknown. The model is suggested from linked material and may be inaccurate.</p></header>
  <ol className="practice-steps" aria-label="Practice progress">{PRACTICE_STEPS.map((label,index)=><li key={label} aria-current={step===index+1?'step':undefined} data-done={step>index+1||undefined}><span aria-hidden="true">{step>index+1?'✓':index+1}</span>{label}{step>index+1&&<span className="sr-only"> (done)</span>}</li>)}</ol>
  {saved?.feedback}{intent?.feedback}{rawIssue&&<p role="alert">{rawIssue}</p>}
  {display&&active()&&verdict&&<div className="practice-verdict" data-within={verdict.within||undefined} tabIndex={-1} ref={verdictRef} role="group" aria-labelledby={`${rangeId}-verdict`}><h4 id={`${rangeId}-verdict`}>{verdict.within?'Matches the formula (within tolerance)':'Doesn’t match the formula (outside tolerance)'}</h4><p>You predicted {verdict.predicted}; the formula gives {verdict.calculated}.</p>{verdict.worked.length>0&&<ol className="practice-worked" aria-label="Worked steps from the saved record">{verdict.worked.map((line,index)=><li key={index}>{line}</li>)}</ol>}</div>}
  {status.kind==='completed'?<>
   <div className="practice-primary"><p role="status" tabIndex={-1} ref={savedRef}>The first prediction is saved. You can also reopen it from Files.</p><Button kind={display?'':'primary'} disabled={disabled} onClick={()=>void open()}>See the result</Button></div>
   <p className="practice-summary"><span className="practice-label">Your inputs: </span>{valueText(inputs)}</p>{model}
  </>:<>
   {model}
   <div className="practice-avoid"><p className="practice-label">{demonstratedInputs.length===0?'Saved input defaults:':current?'Current comparison examples to avoid repeating:':'Recorded model examples to avoid repeating:'}</p><ul className="practice-chips"><li>{demonstratedInputs.length>0&&<span className="practice-chip-tag">{defaultsRecorded?'Saved defaults, also recorded':'Saved defaults'}</span>}{valueText(defaults,true)}</li>{extraExamples.map(text=><li key={text}>{text}</li>)}</ul></div>
   <div className="practice-inputs">{spec.variables.map(v=><div className="practice-input" key={v.name}><Field label={`${label(v.name)}${v.unit==='1'?'':` (${v.unit})`}`}><input type="text" inputMode="decimal" maxLength={80} aria-describedby={`${rangeId}-${v.name}`} value={inputs[v.name]??''} disabled={disabled||status.kind!=='choose'} onChange={event=>setInputs({...inputs,[v.name]:event.target.value})}/></Field><p className="structured-help" id={`${rangeId}-${v.name}`}>Range: {v.min} to {v.max}{v.integer?'; whole numbers':''}.</p></div>)}</div>
  </>}
  {Object.values(inputs).some(Boolean)&&!valid&&<p role="alert" className="practice-issue">Enter finite values within each range (whole numbers for integer inputs), changing at least one saved input{demonstratedInputs.length?' and avoiding each current comparison example':''}.</p>}
  {status.kind==='choose'&&<div className="practice-primary"><Button kind="primary" disabled={disabled||!valid} onClick={()=>void check()}>Continue to predict</Button></div>}
  {(status.kind==='not-started'||status.kind==='terminal')&&<div className="practice-predict"><Field label={`Your predicted result (${outputUnit==='1'?'dimensionless':outputUnit})`}><input ref={predictionRef} className="practice-prediction" type="text" inputMode="decimal" maxLength={80} value={prediction} disabled={disabled} onChange={e=>setPrediction(e.target.value)}/></Field><Field label="Your reasoning"><textarea rows={3} maxLength={2000} value={reasoning} disabled={disabled} onChange={e=>setReasoning(e.target.value)}/></Field><p className="structured-help">The first completed answer for these exact inputs is retained. A saved document can still be revised.</p><div className="practice-primary"><Button kind="primary" disabled={disabled||!canPredict||status.kind==='terminal'&&!status.canRetry} onClick={()=>void submit()}>Save prediction</Button></div></div>}
  {status.kind==='check'&&<p role="alert">The practice could not be confirmed. Check the inputs and saved record before trying again.</p>}{status.kind==='running'&&<p role="status">The earlier submission is still running.</p>}{status.kind==='terminal'&&<p role="status">The earlier attempt ended without a saved answer.{status.canRetry?' You may retry.':' The retry limit was reached.'}</p>}{(status.kind==='check'||status.kind==='running')&&<div className="practice-primary"><Button disabled={disabled} onClick={()=>void check()}>Check saved practice</Button></div>}
  {notice&&<p role="alert">{notice}</p>}
  {display&&active()&&<><section className="practice-answer" aria-label="Saved practice answer"><ReadableText text={display}/></section><div className="practice-primary"><Button kind="primary" disabled={disabled} onClick={freshCase}>Try a fresh case</Button></div></>}
  <div className="practice-actions">{(status.kind==='not-started'||status.kind==='terminal'||status.kind==='completed'||status.kind==='check'&&!pendingText)&&<Button disabled={disabled} onClick={()=>nav.guard(()=>{void chooseCase({...emptyExperimentPractice,examplesText});})}>{status.kind==='completed'?'Try other inputs':'Change practice inputs'}</Button>}<Button disabled={pending} onClick={()=>nav.guard(onBack)}>Back to experiment</Button></div>
  <details className="practice-checking"><summary>How this is checked</summary><p>Choose an input set different from each example and the saved defaults. {current?'Only these current examples are checked; other earlier exposure is unknown.':'Only these recorded examples in this open review are checked; prior sessions and other exposure are not tracked.'}</p><p>A prediction is checked within the larger of 0.000000001 output units and one-billionth of the calculated magnitude. Reasoning is saved but not graded.</p></details>
 </section>;
}
const PRACTICE_STEPS=['Choose inputs','Predict','See the result'] as const;
/**
 * Restates host-written lines of the confirmed saved record (layout: experiment-practice-host.ts). Learner reasoning sits inside a
 * backtick fence that is longer than any backtick run it contains, so only text before that fence and after its closing line is read.
 * Any deviation yields no summary (or no worked steps); the full record is always shown.
 */
export function readVerdict(text:string,spec:ExperimentSpec){
 const marker='\nYour reasoning (not graded):\n',at=text.indexOf(marker);if(at<0)return;
 const predicted=/\nYour first prediction: ([^\n]+)\n$/.exec(text.slice(0,at))?.[1],open=at+marker.length,openEnd=text.indexOf('\n',open),fence=openEnd<0?'':text.slice(open,openEnd);
 if(!predicted||!/^`{3,}$/.test(fence))return;
 const close=text.indexOf('\n'+fence+'\n',openEnd);if(close<0)return;
 const after=text.slice(close+fence.length+2),result=/^\nCalculated result: ([^\n]+)\nPrediction (is within|is outside) the tolerance [^\n]*\n\n/.exec(after);if(!result)return;
 const assumptions=`Assumptions:\n${spec.assumptions.map(item=>'- '+item).join('\n')}\n\nComputed worked steps:\n`,rest=after.slice(result[0].length),end=rest.indexOf('\n\nNext step:\n');
 const lines=rest.startsWith(assumptions)&&end>assumptions.length?rest.slice(assumptions.length,end).split('\n'):[],worked=lines.every((line,index)=>line.startsWith(`${index+1}. `))?lines.map((line,index)=>line.slice(`${index+1}. `.length)):[];
 return {predicted,calculated:result[1],within:result[2]==='is within',worked};
}
/** Drops one pair of brackets only when they enclose the whole formula. */
function withoutOuterBrackets(formula:string){if(!formula.startsWith('(')||!formula.endsWith(')'))return formula;let depth=0;for(let index=0;index<formula.length;index++){depth+=formula[index]==='('?1:formula[index]===')'?-1:0;if(depth===0&&index<formula.length-1)return formula;}return formula.slice(1,-1);}
export const humanLabel=(name:string)=>name.replace(/[_-]+/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase());
