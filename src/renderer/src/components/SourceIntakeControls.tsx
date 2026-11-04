import {useRef,useState} from 'react';
import type {Source,SourceRef,Task} from '../../../core/types';
import {redactSpans,revocationEffects} from '../../../shared/source-intake';
import {Button,Field,type Run} from '../ui';

/** Removal is reversible. Text redaction publishes a new version, never erases saved history. */
export function SourceIntakeControls({task,source,reference,busy,run,isCurrent,onSaved}:{task:Task;source:Source;reference:SourceRef;busy:boolean;run:Run;isCurrent?:()=>boolean;onSaved:(ref:SourceRef)=>void}){
 const [redacting,setRedacting]=useState(false),[span,setSpan]=useState<{start:number;end:number}>(),[issue,setIssue]=useState(''),[pending,setPending]=useState(false);
 const lock=useRef(false),owner=useRef({taskId:task.id,sourceId:source.id,version:reference.version,digest:reference.digest});owner.current={taskId:task.id,sourceId:source.id,version:reference.version,digest:reference.digest};
 const version=source.versions.at(-1)!,current=reference.version===source.currentVersion&&reference.digest===version.digest,effects=revocationEffects(task,source.id),identity=JSON.stringify(owner.current);
 async function change(type:'revoke'|'restore'|'redact'){
  if(lock.current||busy||!current||!(isCurrent?.()??true))return;
  if(type==='redact'){try{redactSpans(version.content,span?[span]:[]);}catch(error){setIssue((error as Error).message);return;}}
  lock.current=true;setPending(true);setIssue('');
  try{
   const command=type==='restore'?{type:'source-intake.restore' as const,taskId:task.id,expected:reference,revokedAt:source.revoked!.at,revocationId:source.revoked!.id}:type==='revoke'?{type:'source-intake.revoke' as const,taskId:task.id,expected:reference}:{type:'source-intake.redact' as const,taskId:task.id,expected:reference,spans:[span!]};
   const saved=await run<Task>(command,type==='redact'?'Redacted version saved':type==='restore'?'Source restored':'Source removed from requests');
   if(!saved||JSON.stringify(owner.current)!==identity||!(isCurrent?.()??true))return;
   const found=saved.sources.find(item=>item.id===source.id)?.versions.at(-1);if(found){setRedacting(false);setSpan(undefined);onSaved({sourceId:source.id,version:found.version,digest:found.digest});}
  }finally{lock.current=false;setPending(false);}
 }
 // Native readonly blocks Chromium caret selection; mutation guards keep the source immutable.
 return <section aria-label="Source request controls">
  <p>{source.revoked?'Removed from requests. Saved versions remain in this task.':current?'Only the current included version can be sent.':'Earlier saved version. Request controls apply to the current version.'}</p>
  {current&&<><p>{effects.artifactIds.length+effects.procedureIds.length} saved results use this source. Removal or redaction makes those results outdated and stops active requests. Queued requests need review.</p><div className="row"><Button disabled={busy||pending} onClick={()=>void change(source.revoked?'restore':'revoke')}>{source.revoked?'Restore source':'Remove from requests'}</Button>{!source.revoked&&version.kind==='text'&&!version.publicGithub&&!version.pdfPage&&<Button disabled={busy||pending||source.freshness!=='fresh'} onClick={()=>{setRedacting(value=>!value);setSpan(undefined);setIssue('');}}>Redact text…</Button>}</div></>}
  {redacting&&current&&!source.revoked&&<div><p>Select text below using the pointer or Shift + arrow keys, then review the replacement. Older unredacted versions stay in local history. Copies already sent or exported cannot be recalled.</p><Field label="Select text to redact"><textarea aria-readonly="true" rows={9} value={version.content} onBeforeInput={event=>event.preventDefault()} onPaste={event=>event.preventDefault()} onCut={event=>event.preventDefault()} onDrop={event=>event.preventDefault()} onChange={event=>{event.currentTarget.value=version.content;setSpan(undefined);}} onSelect={event=>{const field=event.currentTarget;if(field.value!==version.content)return;setSpan({start:field.selectionStart,end:field.selectionEnd});setIssue('');}}/></Field><p role="status">{span&&span.end>span.start?`${span.end-span.start} characters selected.`:'No text selected.'}</p>{span&&span.end>span.start&&<><h3>New current version preview</h3><pre className="source-content">{(()=>{try{return redactSpans(version.content,[span]);}catch{return 'Select whole characters within this text.';}})()}</pre></>}<div className="row"><Button disabled={busy||pending} onClick={()=>void change('redact')}>Save redacted version</Button><Button disabled={pending} onClick={()=>{setRedacting(false);setSpan(undefined);setIssue('');}}>Cancel redaction</Button></div>{issue&&<p role="alert">{issue}</p>}</div>}
 </section>;
}
