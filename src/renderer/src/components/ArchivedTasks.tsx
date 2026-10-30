import {useState} from 'react';
import type {Task} from '../../../core/types';
import {archivedTasks} from '../../../shared/task-archive';
import {taskOutcomeReview} from '../task-outcome-review';
import {Button,Field} from '../ui';
import './saved-work-search.css';

export function ArchivedTasks({tasks,busy,onRestore}:{tasks:Task[];busy:boolean;onRestore:(task:Task)=>void}){
 const [query,setQuery]=useState(''),matches=archivedTasks(tasks,query);
 return <section className="saved-work-search" aria-label="Archived tasks"><h2>Archived tasks</h2><p>Archived tasks are out of the current task list. Saved documents and helpers can still appear in search and be opened. Your work and unfinished edits are kept. A restored task stays paused.</p><Field label="Find archived task"><input type="search" maxLength={200} value={query} onChange={event=>setQuery(event.currentTarget.value)}/></Field>{matches.length?<ul aria-label="Archived task matches">{matches.map(task=><li key={task.id}><strong>{task.title}</strong><p className="tiny">Archived {new Date(task.archive!.archivedAt).toLocaleString()} · Paused{taskOutcomeReview(task).label?' · '+taskOutcomeReview(task).label:''}</p><Button disabled={busy} title={`Restore task: ${task.title}`} onClick={()=>onRestore(task)}>Restore task</Button></li>)}</ul>:<p>{query?'No matching archived tasks.':'No archived tasks.'}</p>}</section>;
}

export function TaskArchiveControl({task,busy,onArchive,onRestore}:{task:Task;busy:boolean;onArchive:()=>void;onRestore:()=>void}){
 const [confirm,setConfirm]=useState(false);
 return <section className="saved-work-search" aria-label="Task archive"><h3>{task.archive?'Archived task':'Archive task'}</h3>{task.archive?<><p>This task’s saved work and unfinished edits are kept. Saved documents and helpers can still appear in search and be opened. Restore it before resuming.</p><Button disabled={busy} onClick={onRestore}>Restore task</Button></>:<><p>Archive a paused task to move it out of the current task list. Saved documents and helpers can still appear in search and be opened. Sources, saved results and unfinished edits stay on this Mac.</p>{task.status!=='paused'?<p className="tiny">Pause this task from Task options before archiving it.</p>:confirm?<><p>Archive “{task.title}”? It will stay paused.</p><div className="row"><Button disabled={busy} onClick={()=>setConfirm(false)}>Keep task</Button><Button disabled={busy} onClick={()=>{if(!busy&&task.status==='paused')onArchive();}}>Archive task</Button></div></>:<Button disabled={busy} onClick={()=>setConfirm(true)}>Archive paused task…</Button>}</>}</section>;
}
