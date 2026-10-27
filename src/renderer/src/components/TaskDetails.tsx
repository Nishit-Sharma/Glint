import {useEffect,useId,useRef,useState,type FormEvent,type ReactNode} from 'react';
import type {Task} from '../../../core/types';
import {Button,Field,type Run} from '../ui';
import {useNavigationDraft} from '../draft-navigation';
import './task-details.css';

export interface TaskDetailsProps {task:Task;busy:boolean;run:Run;children?:ReactNode;expanded?:boolean}
type DetailsDraft={title:string;goal:string};
const detailsOf=(task:Task):DetailsDraft=>({title:task.title,goal:task.goal});
const sameDetails=(a:DetailsDraft,b:DetailsDraft)=>a.title===b.title&&a.goal===b.goal;

/** Mount per task identity so a task switch cannot carry another task's draft. */
export function TaskDetails(props:TaskDetailsProps){return <TaskDetailsEditor key={props.task.id} {...props}/>;}
function TaskDetailsEditor({task,busy,run,children,expanded=false}:TaskDetailsProps){
 const [draft,setDraft]=useState(()=>detailsOf(task)),[saved,setSaved]=useState(()=>detailsOf(task));
 const [pending,setPending]=useState(false),[attempted,setAttempted]=useState(false),[savedMessage,setSavedMessage]=useState('');
 const operation=useRef(false),draftRef=useRef(draft),form=useRef<HTMLFormElement>(null),id=useId();draftRef.current=draft;
 const dirty=!sameDetails(draft,saved),locked=busy||pending;
 const clearNavigationDraft=useNavigationDraft(dirty);
 const titleError=!draft.title.trim()?'Enter a task name.':draft.title.length>200?'Use 200 characters or fewer.':draft.title.includes('\0')?'Remove the unsupported character from the task name.':'';
 const goalError=draft.goal.length>10000?'Use 10,000 characters or fewer.':draft.goal.includes('\0')?'Remove the unsupported character from the goal.':'';
 // Source refreshes and incoming results must never reset an unsaved details draft.
 useEffect(()=>{
  if(!dirty&&!operation.current){const next=detailsOf(task);setDraft(next);setSaved(next);}
 },[task.title,task.goal]);
 function edit(change:Partial<DetailsDraft>){setDraft(previous=>({...previous,...change}));setSavedMessage('');}
 async function save(event:FormEvent){
  event.preventDefault();if(locked||operation.current)return;
  setAttempted(true);setSavedMessage('');
  if(titleError||goalError){form.current?.querySelector<HTMLElement>(titleError?'input':'textarea')?.focus();return;}
  if(!dirty)return;
  const submitted=draft;operation.current=true;setPending(true);
  try{
   const result=await run<Task>({type:'tasks.update',taskId:task.id,title:submitted.title.trim(),goal:submitted.goal},'Task details saved');
   if(result){
    const next=detailsOf(result);setSaved(next);
    if(draftRef.current===submitted){clearNavigationDraft();setDraft(next);setAttempted(false);setSavedMessage('Details saved.');}
   }
  }finally{operation.current=false;setPending(false);}
 }
 return <details className="task-details" open={expanded||undefined}>
  <summary className={expanded?'sr-only':undefined}>Task details{dirty&&<span className="task-details-unsaved">Unsaved edits</span>}</summary>
  <div className="task-details-body">
   <form ref={form} noValidate onSubmit={save} aria-label="Edit task details">
    <Field label="Task name"><input value={draft.title} required maxLength={200} onChange={event=>edit({title:event.target.value})} aria-invalid={attempted&&!!titleError} aria-describedby={attempted&&titleError?`${id}-title-error`:undefined}/></Field>
    {attempted&&titleError&&<p className="task-details-error warning" role="alert" id={`${id}-title-error`}>{titleError}</p>}
    <Field label="Goal (optional)"><textarea value={draft.goal} maxLength={10000} rows={3} onChange={event=>edit({goal:event.target.value})} aria-invalid={attempted&&!!goalError} aria-describedby={attempted&&goalError?`${id}-goal-error`:undefined}/></Field>
    {attempted&&goalError&&<p className="task-details-error warning" role="alert" id={`${id}-goal-error`}>{goalError}</p>}
    <div className="task-details-actions"><Button type="submit" disabled={locked||!dirty}>{pending?'Saving…':'Save details'}</Button>{dirty&&<Button disabled={locked} onClick={()=>{const current=detailsOf(task);clearNavigationDraft();setDraft(current);setSaved(current);setAttempted(false);setSavedMessage('');}}>Discard detail edits</Button>}<span role="status" className="task-details-status">{savedMessage}</span></div>
   </form>
   {children&&<div className="task-details-secondary">{children}</div>}
  </div>
 </details>;
}
