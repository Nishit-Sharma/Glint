import {useEffect,useRef,useState} from 'react';
import type {ArtifactRef,Task} from '../../../core/types';
import {AI_ATTRIBUTION_NOTE,AI_ATTRIBUTION_ELIGIBILITY_MESSAGE,aiAttributionPreview,type AiAttributionSaved} from '../../../shared/ai-attribution';
import {publicErrorMessage} from '../../../shared/public-messages';
import {useGuardedAction,useNavigationDraft} from '../draft-navigation';
import {Button,Field,type Run} from '../ui';

export function ArtifactAttribution({task,answer,isCurrent,disabled,run,onOpen}:{task:Task;answer:ArtifactRef;isCurrent:()=>boolean;disabled:boolean;run:Run;onOpen:(saved:AiAttributionSaved)=>void}){
 const [selected,setSelected]=useState(false),[saving,setSaving]=useState(false),[saved,setSaved]=useState<AiAttributionSaved>(),[error,setError]=useState('');
 const mounted=useRef(true),lock=useRef(false),latest=useRef({disabled,isCurrent});latest.current={disabled,isCurrent};
 const clear=useNavigationDraft(selected||saving),guard=useGuardedAction();
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const requests=task.requests.filter(request=>request.status==='completed'&&request.answer?.artifactId===answer.artifactId&&request.answer.revision===answer.revision&&request.answer.digest===answer.digest);
 let preview:ReturnType<typeof aiAttributionPreview>|undefined,issue='';
 try{if(requests.length===1)preview=aiAttributionPreview(task,requests[0].id,answer);}catch{issue=AI_ATTRIBUTION_ELIGIBILITY_MESSAGE;}
 if(!preview)return requests.length===1?<p role="status">{issue}</p>:null;
 const body=preview.content,requestId=requests[0].id;
 function exact(result:AiAttributionSaved){const artifacts=result.task.artifacts.filter(a=>a.id===result.artifactId),revision=artifacts.length===1&&artifacts[0].revisions.length===1?artifacts[0].revisions[0]:undefined;return revision?.revision===result.revision&&revision.digest===result.digest&&revision.content===body&&revision.mimeType==='text/plain';}
 async function save(){
  if(lock.current||!selected||latest.current.disabled||!latest.current.isCurrent())return;lock.current=true;setSaving(true);setError('');
  try{const result=await run<AiAttributionSaved>({type:'artifact.ai-attribution',taskId:task.id,requestId,answer:{...answer},binding:body,confirmed:'add-ai-attribution-note'});
   if(!mounted.current||!latest.current.isCurrent())return;
   if(result&&exact(result)){setSaved(result);setSelected(false);clear();}else if(result)throw Error('The attributed copy could not be verified. The original is kept.');
  }catch(reason){if(mounted.current)setError(publicErrorMessage(reason));}
  finally{lock.current=false;if(mounted.current)setSaving(false);}
 }
 function open(){
  if(!saved||lock.current||latest.current.disabled||!latest.current.isCurrent())return;
  const original=saved,originalCurrent=latest.current.isCurrent,current=()=>mounted.current&&originalCurrent()&&latest.current.isCurrent();
  async function read(){
   if(lock.current||!current())return;lock.current=true;setSaving(true);setError('');
   try{
    const taskNow=await run<Task>({type:'tasks.get',taskId:task.id});if(!current()||!taskNow)return;
    const next={...original,task:taskNow};if(taskNow.id!==task.id||!exact(next))throw Error('The exact attributed copy changed or is unavailable. No newer version was substituted.');
    clear();let immediate=true;
    guard(()=>{if(!current())return;if(!immediate){void read();return;}onOpen(next);});
    immediate=false;
   }catch(reason){if(current())setError(publicErrorMessage(reason));}
   finally{lock.current=false;if(mounted.current)setSaving(false);}
  }
  guard(()=>void read());
 }
 return <section aria-label="AI attribution copy"><h3>AI attribution for recipients</h3>
  <p>Optionally save a plain-text copy of this generated answer with a visible note. Export that copy to include the note in the file you share. The original stays unchanged; no email or message is sent.</p>
  <label><input type="checkbox" checked={selected} disabled={disabled||saving} onChange={event=>{if(lock.current||latest.current.disabled||!latest.current.isCurrent())return;setSelected(event.target.checked);setError('');}}/>Add an AI attribution note to a plain-text copy</label>
  <p>{AI_ATTRIBUTION_NOTE}</p>
  {selected&&<Field label="Exact plain-text copy for recipients"><textarea readOnly value={body} rows={8}/></Field>}
  <Button type="button" disabled={disabled||saving||!selected} onClick={()=>void save()}>{saving?'Working…':'Save attributed copy'}</Button>
  {saved&&<><p role="status">Attributed copy saved locally. Open it, then use Export to share these saved bytes.</p><Button type="button" disabled={disabled||saving} onClick={()=>void open()}>Open attributed copy</Button></>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
