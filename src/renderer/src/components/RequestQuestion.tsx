import {useId,useLayoutEffect,useRef,useState} from 'react';
import type {Task,RequestRecord} from '../../../core/types';
import {REQUEST_QUESTION_SLOT,initialRequestQuestionDraft,requestQuestionDraftIdentity,readRequestQuestionCommand,readRequestQuestionReply,requestQuestionDecision,sameRequestQuestionDecision,type RequestQuestionRecord,type RequestQuestionBinding,type RequestQuestionCommand,type RequestQuestionReply,type RequestQuestionDraftOwner} from '../../../shared/request-question';
import {LearningDraftScope} from '../learning-draft-context';
import {useNavigationForm,formSubmission} from '../draft-navigation';
import './request-question.css';

type Props={task:Task;request:RequestRecord;question:RequestQuestionRecord;active:boolean;authorityKey:string;isCurrent:(binding:RequestQuestionBinding)=>boolean};
export function RequestQuestion(props:Props){
 const owner:RequestQuestionDraftOwner={kind:'request-question',taskId:props.task.id,requestId:props.request.id,requestDigest:props.request.digest,questionId:props.question.id,questionDigest:props.question.digest};
 return <LearningDraftScope owner={owner}><QuestionForm key={requestQuestionDraftIdentity(owner)} {...props} owner={owner}/></LearningDraftScope>;
}
function QuestionForm({task,request,question,active,authorityKey,isCurrent,owner}:Props&{owner:RequestQuestionDraftOwner}){
 const raw=useNavigationForm(initialRequestQuestionDraft(question),[request.id,request.digest,question.id,question.digest,question.revision],undefined,undefined,{slot:REQUEST_QUESTION_SLOT,basisMode:'explicit',basis:requestQuestionDraftIdentity(owner)});
 const [notice,setNotice]=useState(''),[working,setWorking]=useState(false),[inspection,setInspection]=useState<RequestQuestionReply>();
 const alive=useRef(true),sending=useRef(false),epoch=useRef(0),latest=useRef({active,authorityKey,isCurrent,owner});latest.current={active,authorityKey,isCurrent,owner};
 const heading=useId(),group=useId(),key=requestQuestionDraftIdentity(owner),binding:RequestQuestionBinding={taskId:task.id,requestId:request.id,requestDigest:request.digest,questionId:question.id,questionDigest:question.digest};
 useLayoutEffect(()=>{alive.current=true;return()=>{alive.current=false;epoch.current++;};},[]);
 useLayoutEffect(()=>{epoch.current++;setInspection(undefined);setNotice('');setWorking(false);},[key,authorityKey]);
 const current=(captured=authorityKey)=>alive.current&&latest.current.active&&latest.current.authorityKey===captured&&requestQuestionDraftIdentity(latest.current.owner)===key&&latest.current.isCurrent(binding);
 const shown=inspection&&inspection.question.revision>=question.revision?inspection.question:question;
 const latestShown=useRef(shown);latestShown.current=shown;
 const waiting=shown.status==='waiting'&&request.status==='running'&&task.status==='active'&&!task.archive;
 const disabled=!active||!waiting||working||raw.held||!!raw.draft.pendingText;
 let pending:Exclude<RequestQuestionCommand,{type:'request.question.inspect'}>|undefined;
 try{if(raw.draft.pendingText){const parsed=readRequestQuestionCommand(JSON.parse(raw.draft.pendingText));if(parsed.type!=='request.question.inspect'&&Object.entries(binding).every(([name,value])=>parsed[name as keyof typeof binding]===value))pending=parsed;}}catch{}
 function receiptMatches(record:RequestQuestionRecord,command:Exclude<RequestQuestionCommand,{type:'request.question.inspect'}>){try{return record.revision===command.expectedRevision+1&&(record.status==='answered'||record.status==='skipped')&&sameRequestQuestionDecision(record.decision,requestQuestionDecision(question.definition,command.type==='request.question.skip'?{kind:'skip'}:command.decision));}catch{return false;}}
 const confirmed=!!pending&&receiptMatches(shown,pending);
 const receiptNotice=(skip:boolean)=>skip?'Skipped. The request continues using the available information.':'Answer recorded. This same request is continuing.';
 useLayoutEffect(()=>{if(confirmed&&current()){setNotice(receiptNotice(shown.status==='skipped'));raw.setDraft(value=>value.pendingText===raw.draft.pendingText?{...value,pendingText:''}:value);}},[confirmed,raw.draft.pendingText,active,authorityKey]);
 function verify(reply:unknown){const value=readRequestQuestionReply(reply);if(Object.entries(binding).some(([name,expected])=>value[name as keyof RequestQuestionBinding]!==expected))throw Error('A reply belongs to another question.');return value;}
 async function dispatch(command:Exclude<RequestQuestionCommand,{type:'request.question.inspect'}>,captured:string):Promise<boolean>{
  if(!current(captured)||sending.current)return false;
  const attempt=++epoch.current;sending.current=true;setWorking(true);setNotice('');
  try{
   const result=verify(await window.companion.invoke(command)),decision=requestQuestionDecision(question.definition,command.type==='request.question.skip'?{kind:'skip'}:command.decision);
   if(!sameRequestQuestionDecision(result.question.decision,decision)||result.question.status!==(decision.kind==='skip'?'skipped':'answered'))throw Error('This response was not confirmed.');
   if(current(captured)&&epoch.current===attempt){setInspection(result);setNotice(receiptNotice(decision.kind==='skip'));}
  }catch{if(current(captured)&&epoch.current===attempt)setNotice(receiptMatches(latestShown.current,command)?receiptNotice(command.type==='request.question.skip'):(latestShown.current.status==='answered'||latestShown.current.status==='skipped')?'A different response is already recorded. Your original input is kept; no response was resent.':'The response was not confirmed. Your exact input is kept. Inspect this question before retrying.');}
  finally{sending.current=false;if(current(captured)&&epoch.current===attempt)setWorking(false);}
  // Preserve raw fields; only an exact authoritative receipt settles pendingText.
  return false;
 }
 function admit(command:Exclude<RequestQuestionCommand,{type:'request.question.inspect'}>){
  if(!current()||!waiting||working||raw.held)return;
  const captured=authorityKey,text=JSON.stringify(command);if(raw.setDraft({...raw.draft,pendingText:text}).kind!=='accepted')return;
  raw.submit(()=>{if(!current(captured))return;return formSubmission(undefined,dispatch(command,captured));});
 }
 function submit(){
  if(disabled||!current())return;
  try{const decision=requestQuestionDecision(question.definition,raw.draft.useAlternative?{kind:'alternative',text:raw.draft.alternative}:{kind:'choices',ids:question.definition.mode==='ranking'?raw.draft.ranking:question.definition.options.filter((_option,index)=>raw.draft.selected[index]).map(option=>option.id)});if(decision.kind==='skip')return;admit({type:'request.question.answer',...binding,expectedRevision:question.revision,decision});}catch{setNotice(question.definition.mode==='ranking'?'Rank every option once, or type your own answer.':'Choose an answer or type your own answer before submitting.');}
 }
 async function inspect(){
  if(!current()||sending.current)return;const captured=authorityKey,attempt=++epoch.current;sending.current=true;setWorking(true);setNotice('');
  try{const result=verify(await window.companion.invoke({type:'request.question.inspect',...binding}));if(current(captured)&&epoch.current===attempt){setInspection(result);setNotice(result.question.status==='waiting'&&result.active?'This question is still waiting. You can retry only the original saved response.':result.question.status==='closed'?'This question is closed. Its saved draft cannot restart the request.':'The recorded response is shown below. No continuation was resent.');}}
  catch{if(current(captured)&&epoch.current===attempt)setNotice('This question could not be inspected. Your saved response is kept; no response was resent.');}
  finally{sending.current=false;if(current(captured)&&epoch.current===attempt)setWorking(false);}
 }
 const selected=(id:string)=>raw.draft.selected[question.definition.options.findIndex(option=>option.id===id)]===true;
 function choose(id:string){if(disabled)return;raw.setDraft(value=>({...value,selected:question.definition.options.map((option,index)=>question.definition.mode==='single'?option.id===id:option.id===id?!value.selected[index]:value.selected[index])}));}
 function move(index:number,direction:number){if(disabled||raw.draft.useAlternative)return;raw.setDraft(value=>{const ranking=[...value.ranking],target=index+direction;if(target<0||target>=ranking.length)return value;[ranking[index],ranking[target]]=[ranking[target],ranking[index]];return {...value,ranking};});}
 const recorded=shown.decision?.kind==='alternative'?shown.decision.text:shown.decision?.kind==='choices'?shown.decision.ids.map(id=>question.definition.options.find(option=>option.id===id)?.label??id).join(question.definition.mode==='ranking'?' → ':', '):shown.decision?.kind==='skip'?'Skipped; no answer supplied.':undefined;
 return <section className="request-question-card" aria-labelledby={heading}>
  <h4 id={heading}>{question.definition.question}</h4>
  <p className="request-question-state" role="status">{shown.status==='waiting'?'Waiting for your answer':shown.status==='closed'?shown.reason??'This question is closed.':shown.status==='skipped'?'Skipped · continued with available information':'Answer recorded'}</p>
  {recorded&&<p className="request-question-recorded"><strong>Recorded response: </strong>{recorded}</p>}
  <form onSubmit={event=>{event.preventDefault();submit();}}>
   <fieldset disabled={disabled}><legend>{question.definition.mode==='ranking'?'Rank the options':question.definition.mode==='multiple'?'Choose all that apply':'Choose one answer'}</legend>
    {question.definition.mode==='ranking'?<ol>{raw.draft.ranking.map((id,index)=>{const option=question.definition.options.find(item=>item.id===id);return <li key={id}><span>{option?.label??id}</span><button type="button" aria-label={`Move ${option?.label??id} up`} disabled={index===0||raw.draft.useAlternative} onClick={()=>move(index,-1)}>Move up</button><button type="button" aria-label={`Move ${option?.label??id} down`} disabled={index===raw.draft.ranking.length-1||raw.draft.useAlternative} onClick={()=>move(index,1)}>Move down</button></li>;})}</ol>:question.definition.options.map(option=><label key={option.id}><input type={question.definition.mode==='single'?'radio':'checkbox'} name={group} checked={!raw.draft.useAlternative&&selected(option.id)} disabled={raw.draft.useAlternative} onChange={()=>choose(option.id)}/><span className="request-question-choice-text">{option.label}</span></label>)}
    <label><input type="checkbox" checked={raw.draft.useAlternative} onChange={event=>{const checked=event.currentTarget.checked;raw.setDraft(value=>({...value,useAlternative:checked}));}}/>Use my own answer</label>
    <label>Your answer<textarea maxLength={4000} rows={3} value={raw.draft.alternative} disabled={!raw.draft.useAlternative} onChange={event=>{const text=event.currentTarget.value;raw.setDraft(value=>({...value,alternative:text}));}}/></label>
   </fieldset>
   {waiting&&<><p className="request-question-sharing">Submit continues this request with your answer and its original selected context. Skip continues with the information already available. Ordinary chat text does not answer this card.</p><div className="row"><button type="submit" disabled={disabled}>Submit answer</button><button type="button" disabled={disabled} onClick={()=>admit({type:'request.question.skip',...binding,expectedRevision:question.revision})}>Skip</button></div></>}
  </form>
  {raw.draft.pendingText&&!confirmed&&<div className="request-question-recovery"><p>Your original response input is kept separately until its saved state is checked.</p><button type="button" disabled={!active||working} onClick={()=>void inspect()}>Inspect question</button>{pending&&inspection?.active&&shown.status==='waiting'&&<button type="button" disabled={!active||working||raw.held} onClick={()=>admit(pending!)}>Retry original response</button>}{!pending&&<p role="alert">The retained response needs inspection and cannot be sent from this card.</p>}</div>}
  {notice&&<p role="status">{notice}</p>}{raw.feedback}
 </section>;
}
