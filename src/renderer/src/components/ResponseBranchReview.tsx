import {useEffect,useId,useRef,useState} from 'react';
import type {Task} from '../../../core/types';
import {responseBranchTitle,type responseBranchSnapshot} from '../../../core/response-branch';
import type {LocalTaskStartInput,LocalTaskStartResult} from '../../../shared/local-task-start';
import {createLocalTaskIntent,type LocalTaskIntentState} from '../local-task-intent';
import './response-branch-review.css';

/** A frozen preview. Creating it grants no provider, browser or original-source authority. */
export function ResponseBranchReview({task,snapshot,isCurrent,onCreate,onCreated,onClose,error}:{task:Task;snapshot:ReturnType<typeof responseBranchSnapshot>;isCurrent:()=>boolean;onCreate:(input:Readonly<LocalTaskStartInput>)=>Promise<LocalTaskStartResult|undefined>;onCreated:(result:LocalTaskStartResult)=>void;onClose:()=>void;error?:string}){
 const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null),active=useRef(true),props=useRef({isCurrent,onCreate,onCreated});props.current={isCurrent,onCreate,onCreated};
 const [title,setTitle]=useState(responseBranchTitle(task)),[state,setState]=useState<LocalTaskIntentState>({kind:'idle'}),id=useId();
 const [intent]=useState(()=>createLocalTaskIntent({createId:()=>crypto.randomUUID(),isActive:()=>active.current&&props.current.isCurrent(),send:value=>props.current.onCreate(value),onCreated:result=>props.current.onCreated(result),onState:setState}));
 useEffect(()=>{active.current=true;const opener=document.activeElement;dialog.current?.showModal();input.current?.focus();return()=>{active.current=false;dialog.current?.close();if(opener instanceof HTMLElement&&opener.isConnected)opener.focus();};},[intent]);
 const saving=state.kind==='saving',locked=state.kind!=='idle';
 return <dialog ref={dialog} className="response-branch-review" aria-labelledby={id+'-heading'} onCancel={event=>{event.preventDefault();if(!saving)onClose();}}><form onSubmit={event=>{event.preventDefault();void intent.submit({kind:'text',title:title.trim(),content:snapshot.content});}}>
  <header><h2 id={id+'-heading'}>Start a new task from this answer</h2><p>The new task saves the text below as one historical context source. Your original task and its unsent message stay in place. Nothing is sent to an AI service.</p></header>
  <label htmlFor={id+'-name'}>New task name</label><input ref={input} id={id+'-name'} value={title} onChange={event=>setTitle(event.target.value)} required maxLength={200} disabled={locked}/>
  <section aria-label="Copy boundaries"><h3>What is not copied</h3><ul>{snapshot.omissions.map((omission,index)=><li key={index}>{omission}</li>)}</ul><p>The same name and reviewed snapshot reopen the same saved task. Use a different name to create another. Deleting either task leaves the other in place.</p></section>
  <label htmlFor={id+'-snapshot'}>Conversation text to copy ({snapshot.turns} {snapshot.turns===1?'turn':'turns'})</label><textarea id={id+'-snapshot'} readOnly value={snapshot.content} rows={9} spellCheck={false}/>
  {state.kind==='uncertain'&&<div role="alert"><p>The save could not be confirmed. Check this same task before creating another. Closing keeps any task already saved; you can find it in your task list.</p>{error&&<p>{error}</p>}<p>If the original changed, close this review and open it again.</p></div>}
  <div className="row"><button type="button" disabled={saving} onClick={onClose}>{state.kind==='uncertain'?'Close review':'Cancel'}</button>{state.kind==='uncertain'?<button type="button" className="primary" onClick={()=>void intent.retry()}>Check this task</button>:<button type="submit" className="primary" disabled={locked||!title.trim()}>{saving?'Saving…':'Create new task'}</button>}</div>
 </form></dialog>;
}
