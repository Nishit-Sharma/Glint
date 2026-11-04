import {INDEPENDENT_TASK_LIMIT} from '../../shared/task-concurrency';
export type OrdinaryPending={taskId:string;requestId:string;kind:'explain'|'create';prompt:string};
export type TaskStream={taskId:string;requestId:string;text:string};
export function createOrdinaryTaskRequests(){
 const listeners=new Set<()=>void>();let snapshot:{requests:Readonly<Record<string,OrdinaryPending>>;streams:Readonly<Record<string,TaskStream>>}={requests:{},streams:{}};
 const publish=()=>{for(const listener of listeners)listener();};
 return {getSnapshot:()=>snapshot,subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},get:(taskId:string)=>snapshot.requests[taskId],get size(){return Object.keys(snapshot.requests).length;},
  start(request:OrdinaryPending){if(snapshot.requests[request.taskId])throw Error('Wait for the current task response.');if(Object.keys(snapshot.requests).length>=INDEPENDENT_TASK_LIMIT)throw Error('Two independent tasks are already running. Wait for one to finish or stop it.');const streams={...snapshot.streams};delete streams[request.taskId];snapshot={requests:{...snapshot.requests,[request.taskId]:request},streams};publish();},
  finish(taskId:string,requestId:string){if(snapshot.requests[taskId]?.requestId!==requestId)return;const requests={...snapshot.requests};delete requests[taskId];snapshot={...snapshot,requests};publish();},
  receive(stream:TaskStream){const previous=snapshot.streams[stream.taskId];if(previous?.requestId===stream.requestId&&previous.text===stream.text)return;snapshot={...snapshot,streams:{...snapshot.streams,[stream.taskId]:stream}};publish();},
  clearStreams(taskId?:string){const streams={...snapshot.streams};if(taskId)delete streams[taskId];else for(const id of Object.keys(streams))delete streams[id];snapshot={...snapshot,streams};publish();},
  forget(taskId:string){const requests={...snapshot.requests},streams={...snapshot.streams};delete requests[taskId];delete streams[taskId];snapshot={requests,streams};publish();},
 };
}
