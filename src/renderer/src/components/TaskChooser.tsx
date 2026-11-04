import {useState,type ReactNode} from 'react';
import {Plus} from 'lucide-react';
import type {Task} from '../../../core/types';
import {isTaskUnread,type TaskAttentionState} from '../../../shared/task-attention';
import {orderTaskList} from '../../../shared/task-view';
import {taskAttentionLabel,tasksForReviewFilter,type TaskReviewFilter} from '../task-outcome-review';
import {TaskAttentionFilter} from './TaskAttentionFilter';
import {useTaskPagination,TaskPaginationControls} from './TaskPagination';
import {Button,Field} from '../ui';
export function TaskChooser({tasks,filter,onFilter,attention,attentionError,pinnedTaskIds,currentTaskId,onSelectTask,onCreateTask,avatar,suggestions}:{tasks:Task[];filter:TaskReviewFilter;onFilter:(filter:TaskReviewFilter)=>void;attention?:TaskAttentionState;attentionError?:string;pinnedTaskIds:readonly string[];currentTaskId?:string;onSelectTask:(task:Task)=>void;onCreateTask:()=>void;avatar?:(task:Task)=>ReactNode;suggestions?:ReactNode}){
 const [search,setSearch]=useState(''),filtered=tasksForReviewFilter(orderTaskList(tasks,pinnedTaskIds),filter,attention).filter(task=>task.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())),page=useTaskPagination(filtered,JSON.stringify([filter,search]));
 const date=(value:string)=>new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
 return <div className="task-chooser">{suggestions}<TaskAttentionFilter tasks={tasks} filter={filter} state={attention} error={attentionError} onChange={onFilter}/>{tasks.length>6&&<Field label="Find a saved task"><input type="search" value={search} onChange={event=>setSearch(event.currentTarget.value)}/></Field>}<div id={page.listId}>{page.items.map(item=><button key={item.id} type="button" className="list-row" data-unread={isTaskUnread(item,attention)} aria-label={item.title} aria-current={item.id===currentTaskId?'page':undefined} aria-description={[isTaskUnread(item,attention)?'Unread activity':undefined,taskAttentionLabel(item)].filter(Boolean).join('. ')||undefined} onClick={()=>onSelectTask(item)}>{avatar?.(item)}<span><strong>{item.title}</strong><small>{pinnedTaskIds.includes(item.id)?'Pinned · ':''}{taskAttentionLabel(item)??date(item.updatedAt)}</small></span></button>)}</div>{!filtered.length&&<p className="muted">{search?'No matching tasks.':filter==='needs-review'?'No known outcomes need review.':filter==='unread'?'No unread tasks.':filter==='needs-attention'?'No tasks need attention.':'No saved tasks.'}</p>}<TaskPaginationControls page={page} currentTaskId={currentTaskId} label="Saved tasks"/><Button onClick={onCreateTask}><Plus size={15}/>New task</Button></div>;
}
