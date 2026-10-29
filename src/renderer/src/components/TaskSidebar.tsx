import {Plus,Search,Settings} from 'lucide-react';
import {useState,type ReactNode} from 'react';
import type {Task} from '../../../core/types';
import {taskSidebarPreview} from './task-preview';
import './task-sidebar.css';

export interface TaskSidebarProps {
 character:ReactNode;avatar?:(task:Task)=>ReactNode;tasks:Task[];currentTaskId?:string;
 onSelectTask:(task:Task)=>void;onCreateTask:()=>void;onSettings:()=>void;
}

export function TaskSidebar({character,avatar,tasks,currentTaskId,onSelectTask,onCreateTask,onSettings}:TaskSidebarProps){
 const [search,setSearch]=useState('');
 const filtered=tasks.filter(task=>task.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
 return <aside data-generation-live-region className="task-sidebar" aria-label="Task navigation">
  {character}<div className="roster-toolbar"><button type="button" className="task-sidebar-new" onClick={onCreateTask}><Plus size={17} aria-hidden="true"/><span>New task</span></button></div>
  <div className="task-sidebar-task-list">
   {tasks.length>6&&<label className="task-search"><Search size={14}/><span className="sr-only">Find a task</span><input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search"/></label>}
   {tasks.length>0?<nav aria-label="Saved tasks"><ul>{filtered.map(task=><li key={task.id}><button type="button" className="task-sidebar-task" aria-label={task.title} aria-current={task.id===currentTaskId?'page':undefined} title={task.title} onClick={()=>onSelectTask(task)}>{avatar&&<span className="task-roster-avatar">{avatar(task)}</span>}<span className="task-roster-copy"><strong className="task-roster-title">{task.title}</strong><small>{taskSidebarPreview(task)}</small></span></button></li>)}</ul>{!filtered.length&&<p className="task-sidebar-empty">No matching tasks.</p>}</nav>:null}
  </div>
  <div className="task-sidebar-bottom"><button type="button" className="task-sidebar-settings" onClick={onSettings}><Settings size={16} aria-hidden="true"/><span>Settings</span></button></div>
 </aside>;
}
