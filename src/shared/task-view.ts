export type TaskViewState=
 | {kind:'available';taskId:string|null}
 | {kind:'missing';taskId:null;message:string}
 | {kind:'unavailable';taskId:null;message:string};
export function restoreTaskView<T extends {id:string}>(tasks:T[],state:TaskViewState):T|undefined{
 return state.kind==='available'&&state.taskId!==null?tasks.find(task=>task.id===state.taskId):undefined;
}
