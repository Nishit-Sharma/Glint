import {useCallback,useEffect,useRef,useState} from 'react';
import type {CompanionBridge} from '../../shared/bridge';
import {isTaskUnread,type TaskAttentionChange,type TaskAttentionFilter,type TaskAttentionState} from '../../shared/task-attention';

export function useTaskAttention(bridge:CompanionBridge|undefined){
 const [state,setState]=useState<TaskAttentionState>(),[filter,setFilter]=useState<TaskAttentionFilter>('all'),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 const current=useRef(state),queue=useRef(Promise.resolve()),pending=useRef(0),manualUnread=useRef(new Set<string>());current.current=state;
 const accept=useCallback((next:TaskAttentionState)=>{if(next.kind==='available'&&current.current?.kind==='available'&&next.revision<current.current.revision)return;current.current=next;setState(next);if(next.kind==='available')setFilter(next.filter);else setError(next.message);},[]);
 useEffect(()=>{if(!bridge)return;let alive=true;void bridge.invoke<TaskAttentionState>({type:'task-attention.get'}).then(next=>{if(alive&&next)accept(next);}).catch(()=>{if(alive)accept({kind:'unavailable',message:'Task read state could not be read. Reopen Glint to try again.'});});return()=>{alive=false;};},[bridge,accept]);
 const change=useCallback((change:TaskAttentionChange)=>{
  if(!bridge)return Promise.resolve();if(change.kind==='unread')manualUnread.current.add(change.taskId);else if(change.kind==='read')manualUnread.current.delete(change.taskId);pending.current++;setSaving(true);
  const result=queue.current.then(async()=>{const next=await bridge.invoke<TaskAttentionState>({type:'task-attention.change',change});accept(next);if(next.kind==='available')setError('');});
  queue.current=result.catch(()=>{});return result.catch(()=>setError('Task read state could not be saved. Use Task options to try again.')).finally(()=>{pending.current--;setSaving(pending.current>0);});
 },[bridge,accept]);
 const seen=useCallback((taskId:string,basis:string)=>{const state=current.current;if(manualUnread.current.has(taskId)||state?.kind!=='available'||state.entries.some(entry=>entry.taskId===taskId&&(entry.basis===basis||entry.basis===null)))return;void change({kind:'read',taskId,basis});},[change]);
 const selectFilter=useCallback((value:TaskAttentionFilter)=>{setFilter(value);if(current.current?.kind==='available')void change({kind:'filter',filter:value});},[change]);
 return {state,filter,error,saving,change,seen,selectFilter,isUnread:(task:Parameters<typeof isTaskUnread>[0])=>isTaskUnread(task,state)};
}
