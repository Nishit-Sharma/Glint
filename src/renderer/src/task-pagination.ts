export const TASK_PAGE_SIZE=10;
export interface TaskPage<T>{items:readonly T[];total:number;shown:number;limit:number;hasMore:boolean;hasLess:boolean}
/** Project the existing ordered result only; never fetch, reorder, select or mutate tasks. */
export function taskPage<T>(ordered:readonly T[],requested=TASK_PAGE_SIZE):TaskPage<T>{
 const safe=Number.isSafeInteger(requested)&&requested>0?requested:TASK_PAGE_SIZE,max=Math.max(TASK_PAGE_SIZE,Math.ceil(ordered.length/TASK_PAGE_SIZE)*TASK_PAGE_SIZE),limit=Math.min(max,Math.max(TASK_PAGE_SIZE,Math.ceil(safe/TASK_PAGE_SIZE)*TASK_PAGE_SIZE)),items=ordered.slice(0,limit);
 return {items,total:ordered.length,shown:items.length,limit,hasMore:items.length<ordered.length,hasLess:limit>TASK_PAGE_SIZE};
}
