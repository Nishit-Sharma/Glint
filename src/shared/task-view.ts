export type TaskViewState=
 | {kind:'available';taskId:string|null}
 | {kind:'missing';taskId:null;message:string}
 | {kind:'unavailable';taskId:null;message:string};
export type TaskPinsState={kind:'available';taskIds:readonly string[]}|{kind:'unavailable';taskIds:readonly [];message:string};
/** Pinned task IDs are local navigation preferences, never shared model context. */
export function orderTaskList<T extends {id:string;updatedAt:string}>(tasks:readonly T[],pinnedTaskIds:readonly string[]):T[]{
 return [...tasks].sort((a,b)=>{const ai=pinnedTaskIds.indexOf(a.id),bi=pinnedTaskIds.indexOf(b.id);return ai>=0||bi>=0?ai<0?1:bi<0?-1:ai-bi:b.updatedAt.localeCompare(a.updatedAt);});
}
export function restoreTaskView<T extends {id:string}>(tasks:T[],state:TaskViewState):T|undefined{
 return state.kind==='available'&&state.taskId!==null?tasks.find(task=>task.id===state.taskId):undefined;
}
