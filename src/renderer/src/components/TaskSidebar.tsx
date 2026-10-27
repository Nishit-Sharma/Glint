import {Plus,Search,Settings} from 'lucide-react';
import {useState} from 'react';
import type {Task} from '../../../core/types';
import {buildHistoryEvents} from './history-events';
import './task-sidebar.css';

export interface TaskSidebarProps {
 tasks:Task[];currentTaskId?:string;
 onSelectTask:(task:Task)=>void;onCreateTask:()=>void;onSettings:()=>void;
}

export function TaskSidebar({tasks,currentTaskId,onSelectTask,onCreateTask,onSettings}:TaskSidebarProps){
 const [search,setSearch]=useState('');
 const filtered=tasks.filter(task=>task.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
 const preview=(task:Task)=>{const event=buildHistoryEvents(task)[0];if(!event)return task.artifacts.at(-1)?.revisions.at(-1)?.title||task.goal||'New task';if(event.kind==='checkpoint')return event.checkpoint.note;if(event.kind==='export')return event.action.status==='verified'?'Export saved':'Export needs review';if(event.request.kind==='brief'){const item=task.artifacts.find(a=>a.id===event.request.artifactId);return item?.revisions.at(-1)?.title||'Screen insight';}return event.request.prompt;};
 return <aside data-generation-live-region className="task-sidebar" aria-label="Task navigation">
  <div className="roster-toolbar"><button type="button" className="task-sidebar-new" onClick={onCreateTask}><Plus size={17} aria-hidden="true"/><span>New task</span></button></div>
  <div className="task-sidebar-task-list">
   {tasks.length>6&&<label className="task-search"><Search size={14}/><span className="sr-only">Find a task</span><input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search"/></label>}
   {tasks.length>0?<nav aria-label="Saved tasks"><ul>{filtered.map(task=><li key={task.id}><button type="button" className="task-sidebar-task" aria-label={task.title} aria-current={task.id===currentTaskId?'page':undefined} title={task.title} onClick={()=>onSelectTask(task)}><span className="task-roster-copy"><span className="task-roster-title"><strong>{task.title}</strong><time dateTime={task.updatedAt}>{new Date(task.updatedAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</time></span><small>{preview(task)}</small></span></button></li>)}</ul>{!filtered.length&&<p className="task-sidebar-empty">No matching tasks.</p>}</nav>:null}
  </div>
  <div className="task-sidebar-bottom"><button type="button" className="task-sidebar-settings" onClick={onSettings}><Settings size={16} aria-hidden="true"/><span>Settings</span></button></div>
 </aside>;
}
