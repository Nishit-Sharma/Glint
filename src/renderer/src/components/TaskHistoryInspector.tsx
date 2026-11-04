import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {Task} from '../../../core/types';
import {readTaskHistoryPreview,type TaskHistoryPreview} from '../../../shared/task-history-preview';
import './task-history-inspector.css';

export function TaskHistoryInspector({task,sourceIds,prompt}:{task:Task;sourceIds:string[];prompt:string}){
 const [preview,setPreview]=useState<{basis:string;value:TaskHistoryPreview}>(),[working,setWorking]=useState(false),[message,setMessage]=useState('');
 const alive=useRef(true),locked=useRef(false),generation=useRef(0);
 const refs=task.sources.filter(source=>sourceIds.includes(source.id)).map(source=>({sourceId:source.id,version:source.currentVersion,digest:source.versions.at(-1)!.digest}));
 const basis=JSON.stringify([task,prompt,sourceIds]),current=useRef(basis);current.current=basis;
 useLayoutEffect(()=>{alive.current=true;generation.current++;locked.current=false;setWorking(false);setPreview(undefined);setMessage('');return()=>{alive.current=false;generation.current++;};},[task.id]);
 useEffect(()=>{generation.current++;locked.current=false;setWorking(false);setPreview(undefined);setMessage('');},[basis]);
 useEffect(()=>window.companion.subscribe(event=>{if(event.type==='changed'){generation.current++;locked.current=false;setWorking(false);setPreview(undefined);}}),[task.id]);
 async function inspect(){
  if(locked.current)return;locked.current=true;setWorking(true);setPreview(undefined);setMessage('');const captured=basis,token=++generation.current;
  try{const value=readTaskHistoryPreview(await window.companion.invoke({type:'history.preview',taskId:task.id,sourceIds,expectedSourceRefs:refs}));if(!alive.current||token!==generation.current||captured!==current.current)return;if(value.taskId!==task.id||value.taskUpdatedAt!==task.updatedAt||value.sessionRevision!==(task.session?.revision??0)||JSON.stringify(value.sourceRefs)!==JSON.stringify(refs))throw Error();JSON.parse(value.history);setPreview({basis:captured,value});}
  catch{if(alive.current&&token===generation.current&&captured===current.current)setMessage('Task history could not be inspected. Reload the task and inspect again.');}
  finally{if(token===generation.current){locked.current=false;if(alive.current)setWorking(false);}}
 }
 const shown=preview?.basis===basis?preview.value:undefined;
 return <section className="task-history-inspector" aria-label="Task history inspection">
  <button type="button" disabled={working||task.status!=='active'||!!task.archive} onClick={()=>void inspect()}>{working?'Inspecting history…':'Inspect task history for this question'}</button>
  {shown&&<><p>This saved history is included with the current source selection. Your new message, selected source contents, saved memory and other guidance are supplied separately.</p><details><summary>Exact task history</summary><pre tabIndex={0}>{JSON.stringify(JSON.parse(shown.history),null,2)}</pre></details><p className="tiny">Nothing was sent. This snapshot clears when context changes. Sending uses current context; earlier decisions do not grant permission to act.</p></>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
