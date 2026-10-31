import {useId} from 'react';
import type {Task} from '../../../core/types';
import type {TaskAttentionFilter,TaskAttentionState} from '../../../shared/task-attention';
import {tasksForReviewFilter} from '../task-outcome-review';
import './task-attention.css';

export function TaskAttentionFilter({tasks,filter,state,error,onChange}:{tasks:readonly Task[];filter:TaskAttentionFilter;state?:TaskAttentionState;error?:string;onChange:(filter:TaskAttentionFilter)=>void}){
 const help=useId();
 return <div className="task-review-filter"><label>Show tasks<select aria-describedby={help} value={filter} onChange={event=>onChange(event.target.value as TaskAttentionFilter)}><option value="all">Current tasks</option><option value="unread" disabled={state?.kind!=='available'}>Unread ({tasksForReviewFilter(tasks,'unread',state).length})</option><option value="needs-attention">Needs attention ({tasksForReviewFilter(tasks,'needs-attention').length})</option><option value="needs-review">Needs review ({tasksForReviewFilter(tasks,'needs-review').length})</option></select></label><small id={help}>{filter==='needs-review'?'Only unresolved browser outcomes and file saves.':filter==='needs-attention'?'Paused tasks, held questions and unfinished responses. Review them in the conversation.':filter==='unread'?'New saved activity or tasks you marked unread. Marked unread stays until you mark it read.':'Archived tasks are available in Task options.'}</small>{(error||state?.kind==='unavailable')&&<small role="status">{error||(state?.kind==='unavailable'?state.message:'')}</small>}</div>;
}
