import {useEffect,useRef,useState} from 'react';
import type {Task} from '../../../core/types';
import {browserReviewNotesPreview,readBrowserReviewNotesSaved} from '../../../shared/browser-review-notes';

export function BrowserReviewNotes({task,runId,operationId,disabled=false}:{task:Task;runId:string;operationId:string;disabled?:boolean}){
 const [opened,setOpened]=useState<string>(),[pending,setPending]=useState<string>(),[feedback,setFeedback]=useState<{binding:string;kind:'saved'|'unconfirmed';message:string}>(),alive=useRef(true),active=useRef<{binding:string}|undefined>(undefined);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 let preview:ReturnType<typeof browserReviewNotesPreview>|undefined;try{preview=browserReviewNotesPreview(task,runId,operationId);}catch{/* An unavailable or foreign review cannot be copied. */}
 const binding=preview?.binding,current=useRef(binding);current.current=binding;
 if(!preview)return null;
 const selected=preview,isPending=pending===selected.binding,status=feedback?.binding===selected.binding?feedback:undefined,isOpen=opened===selected.binding;
 async function save(){
  if(disabled||active.current?.binding===selected.binding||!alive.current||current.current!==selected.binding)return;
  const attempt={binding:selected.binding};active.current=attempt;setPending(selected.binding);setFeedback(undefined);
  try{
   const result=readBrowserReviewNotesSaved(await window.companion.invoke({type:'browser.review.notes',taskId:task.id,runId,operationId,binding:selected.binding,confirmed:'shown-review-notes'}));
   if(result.taskId!==task.id||result.runId!==runId||result.operationId!==operationId||result.binding!==selected.binding)throw Error('Different review receipt.');
   if(alive.current&&current.current===selected.binding&&active.current===attempt)setFeedback({binding:selected.binding,kind:'saved',message:result.alreadySaved?'This exact review was already saved. Find its notes and any later revisions in Files.':'Notes saved in Files. The browser outcome is unchanged.'});
  }catch{
   if(alive.current&&current.current===selected.binding&&active.current===attempt)setFeedback({binding:selected.binding,kind:'unconfirmed',message:'Saving was not confirmed. Reopen the current review if it changed. Trying these same shown notes again will not duplicate a confirmed save.'});
  }finally{if(active.current===attempt){active.current=undefined;if(alive.current)setPending(undefined);}}
 }
 return <div className="browser-review-notes"><button type="button" disabled={disabled||isPending} aria-expanded={isOpen} onClick={()=>{setOpened(isOpen?undefined:selected.binding);}}>Keep review as notes</button>{isOpen&&<section aria-label="Keep browser review as notes" aria-busy={isPending||undefined}><p>Review exactly what will be saved below. This copies only the shown text into a local document; it does not inspect a page, send data, retry an action, or settle its outcome.</p><p>Reviewed page: <span aria-label="Review notes page URL">{selected.url}</span></p><p>Action review: {selected.outcome}.</p><label>Review notes preview<textarea aria-label="Review notes preview" readOnly rows={12} value={selected.content}/></label><div className="row"><button type="button" disabled={isPending} onClick={()=>setOpened(undefined)}>Cancel notes</button><button type="button" disabled={disabled||isPending||status?.kind==='saved'} onClick={()=>void save()}>{isPending?'Saving notes…':'Save shown notes'}</button></div>{status&&<p role={status.kind==='saved'?'status':'alert'}>{status.message}</p>}</section>}</div>;
}
