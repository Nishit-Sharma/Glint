import {useEffect,useId,useState} from 'react';
import {taskPage,TASK_PAGE_SIZE,type TaskPage} from '../task-pagination';
import {Button} from '../ui';
export interface TaskPaginationModel<T extends{id:string}> extends TaskPage<T>{ordered:readonly T[];listId:string;more():void;less():void;reveal(id:string):void}
export function useTaskPagination<T extends{id:string}>(ordered:readonly T[],filterKey:string):TaskPaginationModel<T>{
 const basis=JSON.stringify([filterKey,ordered.map(task=>task.id)]),[saved,setSaved]=useState(()=>({basis,limit:TASK_PAGE_SIZE})),listId=useId(),page=taskPage(ordered,saved.basis===basis?saved.limit:TASK_PAGE_SIZE);
 useEffect(()=>{setSaved(previous=>previous.basis===basis?previous:{basis,limit:TASK_PAGE_SIZE});},[basis]);
 return {...page,ordered,listId,more(){setSaved({basis,limit:page.limit+TASK_PAGE_SIZE});},less(){setSaved({basis,limit:Math.max(TASK_PAGE_SIZE,page.limit-TASK_PAGE_SIZE)});},reveal(id){const index=ordered.findIndex(task=>task.id===id);if(index>=0)setSaved({basis,limit:Math.max(page.limit,Math.ceil((index+1)/TASK_PAGE_SIZE)*TASK_PAGE_SIZE)});}};
}
export function TaskPaginationControls({page,currentTaskId,label}:{page:TaskPaginationModel<{id:string}>;currentTaskId?:string;label:string}){
 const currentIndex=currentTaskId?page.ordered.findIndex(task=>task.id===currentTaskId):-1;
 return <div aria-label={label+' pagination'}><p className="tiny" role="status" aria-live="polite">Showing {page.shown?1:0}–{page.shown} of {page.total} tasks in this view. Pinned tasks first, then recent activity.</p><div className="row"><button type="button" disabled={!page.hasMore} aria-controls={page.listId} onClick={page.more}>Show more tasks</button>{page.hasLess&&<button type="button" aria-controls={page.listId} onClick={page.less}>Show fewer tasks</button>}{currentIndex>=page.shown&&<Button onClick={()=>page.reveal(currentTaskId!)}>Show current task</Button>}</div>{currentTaskId&&currentIndex<0&&<p className="tiny">The current task is outside this view. Clear the search or choose Current tasks to find it.</p>}</div>;
}
