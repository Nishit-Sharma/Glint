import type {Task} from '../../core/types';
import {isTaskUnread,type TaskAttentionFilter,type TaskAttentionState} from '../../shared/task-attention';

export type TaskReviewFilter=TaskAttentionFilter;
/** Known unresolved effects only; this does not infer all unfinished work or grant retry authority. */
export function taskOutcomeReview(task:Task){
 const browserActions=(task.session?.runs??[]).reduce((count,run)=>count+(run.initialObservation.taskId===task.id&&task.requests.some(request=>request.id===run.id&&request.kind==='browser')?run.operations.filter(operation=>operation.status==='uncertain').length:0),0);
 const fileSaves=task.actions.filter(action=>action.proposal.taskId===task.id&&action.status==='uncertain').length;
 const parts=[...(browserActions?[`${browserActions} browser ${browserActions===1?'outcome':'outcomes'}`]:[]),...(fileSaves?[`${fileSaves} file ${fileSaves===1?'save':'saves'}`]:[])];
 return {browserActions,fileSaves,label:parts.length?'Needs review: '+parts.join(', '):undefined};
}
export function taskAttentionLabel(task:Task):string|undefined{
 const review=taskOutcomeReview(task).label;if(review)return review;
 const held=task.session?.queuedFollowups?.filter(item=>item.status==='held').length??0;
 const parts=[...(task.status==='paused'?['Paused']:[]),...(held?[`${held} held ${held===1?'follow-up':'follow-ups'}`]:[]),...(task.session?.browserContinuationAttempt?['Pending browser attempt']:[])];
 const waiting=task.requests.filter(request=>request.status==='running'&&request.questions?.some(question=>question.status==='waiting')).length;
 if(waiting)parts.unshift(waiting===1?'Waiting for your answer':`${waiting} questions need your answers`);
 for(const [status,label] of [['failed','failed'],['interrupted','interrupted'],['cancelled','stopped']] as const){const count=task.requests.filter(request=>request.status===status).length;if(count)parts.push(`${count} ${label} ${count===1?'response':'responses'}`);}
 return parts.length?parts.join(' · '):undefined;
}
export function tasksForReviewFilter(tasks:readonly Task[],filter:TaskReviewFilter,state?:TaskAttentionState):Task[]{return tasks.filter(task=>filter==='all'||(filter==='unread'?isTaskUnread(task,state):filter==='needs-attention'?!!taskAttentionLabel(task):!!taskOutcomeReview(task).label));}
