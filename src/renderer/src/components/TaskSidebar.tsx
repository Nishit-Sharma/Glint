import {ChevronDown,ChevronRight,Clock,Folder,Pin,Plus,Search,Settings,Star} from 'lucide-react';
import {useId,useState,type ReactNode} from 'react';
import type {Task} from '../../../core/types';
import {activeProjects,type Project} from '../../../shared/projects';
import {taskAttentionLabel,tasksForReviewFilter,type TaskReviewFilter} from '../task-outcome-review';
import {isTaskUnread,type TaskAttentionState} from '../../../shared/task-attention';
import {TaskAttentionFilter} from './TaskAttentionFilter';
import {orderTaskList} from '../../../shared/task-view';
import {taskSidebarPreview} from './task-preview';
import {SidebarTaskSections} from './SidebarTaskSections';
import {useTaskPagination,TaskPaginationControls} from './TaskPagination';
import './task-sidebar.css';

export interface TaskSidebarProps {
 runningTaskIds?:readonly string[];
 character:ReactNode;attention?:TaskAttentionState;attentionError?:string;reviewFilter?:TaskReviewFilter;onReviewFilter?:(filter:TaskReviewFilter)=>void;pinnedTaskIds?:readonly string[];avatar?:(task:Task)=>ReactNode;tasks:Task[];currentTaskId?:string;
 onSelectTask:(task:Task)=>void;onCreateTask:()=>void;onSettings:()=>void;onProjects?:()=>void;onSchedules?:()=>void;
 projects?:readonly Project[];pinnedProjectIds?:readonly string[];selectedProjectId?:string;projectsError?:string;onSelectProject?:(project:Project)=>void;onReloadProjects?:()=>void;
 projectsCollapsed?:boolean;projectsCollapseDisabled?:boolean;onToggleProjects?:()=>void;
}

export function TaskSidebar({character,avatar,tasks,runningTaskIds=[],attention,attentionError,pinnedTaskIds=[],reviewFilter='all',onReviewFilter,currentTaskId,onSelectTask,onCreateTask,onSettings,onProjects,onSchedules,projects,pinnedProjectIds=[],selectedProjectId,projectsError,onSelectProject,onReloadProjects,projectsCollapsed=false,projectsCollapseDisabled=false,onToggleProjects}:TaskSidebarProps){
 const [search,setSearch]=useState('');
 const projectListId=useId();
 const filtered=orderTaskList(tasksForReviewFilter(tasks,reviewFilter,attention).filter(task=>task.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())),pinnedTaskIds);
 const page=useTaskPagination(filtered,JSON.stringify([search,reviewFilter]));
 const orderedProjects=projects?activeProjects(projects).sort((a,b)=>Number(pinnedProjectIds.includes(b.id))-Number(pinnedProjectIds.includes(a.id))):undefined;
 return <aside data-generation-live-region className="task-sidebar" aria-label="Task navigation">
  {character}<div className="roster-toolbar"><button type="button" className="task-sidebar-new" onClick={onCreateTask}><Plus size={17} aria-hidden="true"/><span>New task</span></button></div>
  {onReviewFilter&&<TaskAttentionFilter tasks={tasks} filter={reviewFilter} state={attention} error={attentionError} onChange={onReviewFilter}/>}
  <div className="task-sidebar-task-list">
   {onProjects&&<nav className="task-sidebar-projects" aria-label="Projects"><div className="task-sidebar-projects-header"><button type="button" className="task-sidebar-projects-heading" onClick={onProjects}><Folder size={16} aria-hidden="true"/><span>Projects</span></button>{onToggleProjects&&<button type="button" className="task-sidebar-projects-toggle" aria-label={projectsCollapsed?'Expand Projects':'Collapse Projects'} aria-expanded={!projectsCollapsed} aria-controls={projectListId} disabled={projectsCollapseDisabled} onClick={onToggleProjects}>{projectsCollapsed?<ChevronRight size={15} aria-hidden="true"/>:<ChevronDown size={15} aria-hidden="true"/>}</button>}</div>
    {projectsError&&<div className="task-sidebar-empty" role="alert"><p>{projectsError}</p>{onReloadProjects&&<button type="button" onClick={onReloadProjects}>Reload projects</button>}</div>}
    <div id={projectListId} hidden={projectsCollapsed}>{!projectsError&&(!orderedProjects?<p className="task-sidebar-empty" role="status">Loading projects…</p>:!orderedProjects.length?<p className="task-sidebar-empty">No projects yet.</p>:<ul>{orderedProjects.map(project=>{const pinned=pinnedProjectIds.includes(project.id);return <li key={project.id}><button type="button" className="task-sidebar-project" aria-label={project.name} aria-description={pinned?'Starred project':undefined} aria-current={selectedProjectId===project.id?'page':undefined} title={project.name} onClick={()=>onSelectProject?.(project)}>{pinned?<Star size={14} fill="currentColor" aria-hidden="true"/>:<Folder size={14} aria-hidden="true"/>}<span>{project.name}</span></button></li>;})}</ul>)}</div>
   </nav>}
   {tasks.length>6&&<label className="task-search"><Search size={14}/><span className="sr-only">Find a task</span><input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search"/></label>}
   {tasks.length>0?<><div id={page.listId}><SidebarTaskSections tasks={page.items} allTasks={tasks} renderTask={task=><button type="button" className="task-sidebar-task" data-unread={isTaskUnread(task,attention)} aria-label={task.title} aria-current={task.id===currentTaskId?'page':undefined} title={task.title} aria-description={[runningTaskIds.includes(task.id)||task.requests.some(request=>request.status==='running')?'Response in progress':undefined,pinnedTaskIds.includes(task.id)?'Pinned task':undefined,isTaskUnread(task,attention)?'Unread activity':undefined,taskAttentionLabel(task)].filter(Boolean).join('. ')||undefined} onClick={()=>onSelectTask(task)}>{avatar&&<span className="task-roster-avatar">{avatar(task)}</span>}<span className="task-roster-copy"><strong className="task-roster-title">{task.title}</strong><small>{runningTaskIds.includes(task.id)||task.requests.some(request=>request.status==='running')?'Response in progress':taskAttentionLabel(task)??taskSidebarPreview(task)}</small></span>{pinnedTaskIds.includes(task.id)&&<Pin size={14} aria-hidden="true"/>}</button>}/></div>{!filtered.length&&<p className="task-sidebar-empty">{!search&&reviewFilter==='needs-review'?'No known outcomes need review.':!search&&reviewFilter==='unread'?'No unread tasks.':!search&&reviewFilter==='needs-attention'?'No tasks need attention.':'No matching tasks.'}</p>}<TaskPaginationControls page={page} currentTaskId={currentTaskId} label="Sidebar tasks"/></>:null}
  </div>
  <div className="task-sidebar-bottom">{onSchedules&&<button type="button" className="task-sidebar-settings" onClick={onSchedules}><Clock size={16} aria-hidden="true"/><span>Schedules</span></button>}<button type="button" className="task-sidebar-settings" onClick={onSettings}><Settings size={16} aria-hidden="true"/><span>Settings</span></button></div>
 </aside>;
}
