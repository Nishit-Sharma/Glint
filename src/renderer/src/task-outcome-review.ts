import type {Task} from '../../core/types';

export type TaskReviewFilter='all'|'needs-review';
/** Known unresolved effects only; this does not infer all unfinished work or grant retry authority. */
export function taskOutcomeReview(task:Task){
 const browserActions=(task.session?.runs??[]).reduce((count,run)=>count+(run.initialObservation.taskId===task.id&&task.requests.some(request=>request.id===run.id&&request.kind==='browser')?run.operations.filter(operation=>operation.status==='uncertain').length:0),0);
 const fileSaves=task.actions.filter(action=>action.proposal.taskId===task.id&&action.status==='uncertain').length;
 const parts=[...(browserActions?[`${browserActions} browser ${browserActions===1?'outcome':'outcomes'}`]:[]),...(fileSaves?[`${fileSaves} file ${fileSaves===1?'save':'saves'}`]:[])];
 return {browserActions,fileSaves,label:parts.length?'Needs review: '+parts.join(', '):undefined};
}
export function tasksForReviewFilter(tasks:readonly Task[],filter:TaskReviewFilter):Task[]{return tasks.filter(task=>filter==='all'||!!taskOutcomeReview(task).label);}
