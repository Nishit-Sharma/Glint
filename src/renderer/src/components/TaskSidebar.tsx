import {Clock,Folder,Pin,Plus,Search,Settings} from 'lucide-react';
import {useId,useState,type ReactNode} from 'react';
import type {Task} from '../../../core/types';
import {taskOutcomeReview,tasksForReviewFilter,type TaskReviewFilter} from '../task-outcome-review';
import {orderTaskList} from '../../../shared/task-view';
import {taskSidebarPreview} from './task-preview';
import './task-sidebar.css';

export interface TaskSidebarProps {
 character:ReactNode;reviewFilter?:TaskReviewFilter;onReviewFilter?:(filter:TaskReviewFilter)=>void;pinnedTaskIds?:readonly string[];avatar?:(task:Task)=>ReactNode;tasks:Task[];currentTaskId?:string;
 onSelectTask:(task:Task)=>void;onCreateTask:()=>void;onSettings:()=>void;onProjects?:()=>void;onSchedules?:()=>void;
}

export function TaskSidebar({character,avatar,tasks,pinnedTaskIds=[],reviewFilter='all',onReviewFilter,currentTaskId,onSelectTask,onCreateTask,onSettings,onProjects,onSchedules}:TaskSidebarProps){
 const [search,setSearch]=useState(''),filterHelp=useId();
 const filtered=orderTaskList(tasksForReviewFilter(tasks,reviewFilter).filter(task=>task.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())),pinnedTaskIds);
 return <aside data-generation-live-region className="task-sidebar" aria-label="Task navigation">
  {character}<div className="roster-toolbar"><button type="button" className="task-sidebar-new" onClick={onCreateTask}><Plus size={17} aria-hidden="true"/><span>New task</span></button></div>
  {onReviewFilter&&<div className="task-review-filter"><label>Show tasks<select aria-describedby={filterHelp} value={reviewFilter} onChange={event=>onReviewFilter(event.target.value==='needs-review'?'needs-review':'all')}><option value="all">Current tasks</option><option value="needs-review">Needs review ({tasksForReviewFilter(tasks,'needs-review').length})</option></select></label><small id={filterHelp}>{reviewFilter==='needs-review'?'Only unresolved browser outcomes and file saves.':'Archived tasks are available in Task options.'}</small></div>}
  <div className="task-sidebar-task-list">
   {tasks.length>6&&<label className="task-search"><Search size={14}/><span className="sr-only">Find a task</span><input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search"/></label>}
   {tasks.length>0?<nav aria-label="Saved tasks"><ul>{filtered.map(task=><li key={task.id}><button type="button" className="task-sidebar-task" aria-label={task.title} aria-current={task.id===currentTaskId?'page':undefined} title={task.title} aria-description={[pinnedTaskIds.includes(task.id)?'Pinned task':undefined,taskOutcomeReview(task).label].filter(Boolean).join('. ')||undefined} onClick={()=>onSelectTask(task)}>{avatar&&<span className="task-roster-avatar">{avatar(task)}</span>}<span className="task-roster-copy"><strong className="task-roster-title">{task.title}</strong><small>{taskOutcomeReview(task).label??taskSidebarPreview(task)}</small></span>{pinnedTaskIds.includes(task.id)&&<Pin size={14} aria-hidden="true"/>}</button></li>)}</ul>{!filtered.length&&<p className="task-sidebar-empty">{reviewFilter==='needs-review'&&!search?'No known outcomes need review.':'No matching tasks.'}</p>}</nav>:null}
  </div>
  <div className="task-sidebar-bottom">{onSchedules&&<button type="button" className="task-sidebar-settings" onClick={onSchedules}><Clock size={16} aria-hidden="true"/><span>Schedules</span></button>}{onProjects&&<button type="button" onClick={onProjects}><Folder size={16} aria-hidden="true"/><span>Projects</span></button>}<button type="button" className="task-sidebar-settings" onClick={onSettings}><Settings size={16} aria-hidden="true"/><span>Settings</span></button></div>
 </aside>;
}
