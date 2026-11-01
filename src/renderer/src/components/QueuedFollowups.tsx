import {useState} from 'react';
import type {Task} from '../../../core/types';
import type {QueuedFollowup} from '../../../shared/queued-followup';

export function QueuedFollowups({task,disabled,canRecover,onHold,onSave,onCancel,onRecover}:{task:Task;disabled:boolean;canRecover:boolean;onHold:()=>Promise<void>;onSave:(item:QueuedFollowup,prompt:string)=>Promise<void>;onCancel:(item:QueuedFollowup)=>Promise<void>;onRecover:(item:QueuedFollowup)=>void}){
 const [editing,setEditing]=useState<{id:string;revision:number;text:string}>(),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const items=task.session?.queuedFollowups?.filter(item=>item.status!=='dispatched')??[];
 if(!items.length)return null;
 const pending=items.filter(item=>item.status!=='cancelled');
 async function act(action:()=>Promise<void>){if(saving)return;setSaving(true);setError('');try{await action();}catch(error){setError(error instanceof Error?error.message:'The follow-up could not be saved. Its original text is kept.');}finally{setSaving(false);}}
 return <details className="queued-followups"><summary>{pending.length} queued follow-up{pending.length===1?'':'s'}{pending.some(item=>item.status==='held')?' · review needed':''}</summary>
  <p>Text only, in order. Each item keeps its selected source versions and guidance. A context change holds it for review. Restart never sends queued text.</p>
  <ol>{items.map(item=><li key={item.id}>
   <div className="queue-item-heading"><strong>{item.status==='queued'?'Waiting':item.status==='held'?'Held for review':'Cancelled'}</strong><span>{item.kind==='create'?'Draft':'Question'} · version {item.revision}</span></div>
   {editing?.id===item.id?<label>Queued message<textarea aria-label="Edit queued message" value={editing.text} maxLength={16000} disabled={disabled||saving} onChange={event=>setEditing({...editing,text:event.target.value})}/></label>:<p className="queue-prompt">{item.prompt}</p>}
   <p className="queue-context">{item.sourceRefs.length?item.sourceRefs.map(ref=>{const source=task.sources.find(source=>source.id===ref.sourceId),version=source?.versions.find(version=>version.version===ref.version&&version.digest===ref.digest);return `${version?.label??'Earlier source'} · version ${ref.version}`;}).join(', '):'No sources selected'} · same-task history, including preceding responses</p>
   {item.inference&&<p className="queue-context">Saved model choice: {item.inference.model} · {item.inference.effort} reasoning · {item.inference.tier==='priority'?'Fast':'Standard'} speed. Later task choices do not change this follow-up.</p>}
   {item.reason&&<p role="status">{item.reason}</p>}
   <div className="row">
    {editing?.id===item.id?<><button type="button" disabled={disabled||saving||!editing.text.trim()} onClick={()=>void act(async()=>{await onSave(item,editing.text);setEditing(undefined);})}>Save and queue with current context</button><button type="button" disabled={saving} onClick={()=>setEditing(undefined)}>Keep original</button></>:item.status!=='cancelled'?<><button type="button" disabled={disabled||saving} onClick={()=>void act(async()=>{await onHold();setEditing({id:item.id,revision:item.revision,text:item.prompt});})}>{item.status==='held'?'Review or edit':'Edit'}</button><button type="button" disabled={disabled||saving} onClick={()=>void act(()=>onCancel(item))}>Cancel follow-up</button></>:<button type="button" disabled={disabled||!canRecover} onClick={()=>onRecover(item)}>Use text in composer</button>}
   </div>
  </li>)}</ol>{!canRecover&&items.some(item=>item.status==='cancelled')&&<p>Finish or clear your current message before recovering cancelled text.</p>}{error&&<p role="alert">{error}</p>}
 </details>;
}
