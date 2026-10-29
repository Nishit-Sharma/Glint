import {useLayoutEffect,useRef,useState,useSyncExternalStore,type FormEvent} from 'react';
import type {SourceRef,Task} from '../../../core/types';
import {learningDraftKey,parseLearningDraftJson} from '../../../shared/learning-drafts';
import {SOURCE_TEXT_DRAFT_SLOT,SOURCE_TEXT_DRAFT_STRING_LIMIT,emptySourceTextDraft,parseSourceTextDraft,sourceTextDraftOwner,type SourceTextFields} from '../../../shared/source-text-draft';
import type {createLearningDrafts} from '../learning-drafts';
import {createSourceTextSaveController,type SourceTextStart} from '../source-text-save-controller';
import type {SourceTextSaveInput,SourceTextSaveInspectionInput} from '../../../shared/source-text-save';
import {Button,Field,type Run} from '../ui';

export type SavedTextSourceStart=SourceTextStart;
type Props={task:Task;start:SavedTextSourceStart;cache:ReturnType<typeof createLearningDrafts>;busy:boolean;run:Run;saveSourceText?:(input:SourceTextSaveInput)=>Promise<unknown>;inspect?:(input:SourceTextSaveInspectionInput)=>Promise<unknown>;isCurrent?:()=>boolean;onTask?:(task:Task)=>void;onDone:(reference:SourceRef)=>void};
type Cancellation={raw:SourceTextFields;generation:number;clearedGeneration?:number;phase:'preparing'|'pending'|'uncertain'};
/** Only saved text-source raw input lives here. Committed source data stays in
 * the task store; the shared sidecar/cache holds unapplied edits. */
export function SavedTextSourceEditor(props:Props){
 const {task,start,cache,busy,run,onDone}=props;
 const state=useSyncExternalStore(cache.subscribe,cache.getSnapshot),owner=sourceTextDraftOwner(task.id,start.reference.sourceId),slot=SOURCE_TEXT_DRAFT_SLOT,key=learningDraftKey(owner,slot);
 const [cancellation,setCancellation]=useState<Cancellation>();const cancelLock=useRef(false),checkingCancel=useRef(false);
 const [,refresh]=useState(0),[message,setMessage]=useState('');
 const latest=useRef(props);latest.current=props;
 const mounted=useRef(true);useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const holder=useRef<ReturnType<typeof createSourceTextSaveController>|undefined>(undefined);
 if(!holder.current)holder.current=createSourceTextSaveController({cache,taskId:task.id,sourceId:start.reference.sourceId,start,
  task:()=>latest.current.task,isCurrent:()=>mounted.current&&(latest.current.isCurrent?.()??true),
  send:input=>latest.current.saveSourceText?latest.current.saveSourceText(input):latest.current.run({...{type:'source.text' as const},taskId:input.taskId,source:input.source,expectedSource:input.expectedSource,edit:{intentId:input.intentId,binding:input.binding}}),
  inspect:input=>latest.current.inspect?latest.current.inspect(input):latest.current.run({type:'source.text.inspect',...input}),
  onState:()=>{if(mounted.current)refresh(value=>value+1);},onSaved:result=>latest.current.onDone(result.reference),onTask:task=>latest.current.onTask?.(task)});
 const controller=holder.current,view=controller.snapshot(),form=view.form,entry=state.entries[key];
 const value=cancellation?.raw??view.fields,held=!!cancellation||!view.canEdit,saving=view.operation,changed=view.changed&&!view.pending;
 function edit(change:Partial<SourceTextFields>){setMessage('');controller.edit(change);}
 function finishCancellation(attempt:Cancellation){
  const after=cache.getSnapshot().entries[key];
  if(attempt.clearedGeneration===undefined||after?.generation!==attempt.clearedGeneration||after.local!==null||after.error)return false;
  cancelLock.current=false;if(mounted.current){setCancellation(undefined);setMessage('');onDone(controller.snapshot().start.reference);}return true;
 }
 async function cancel(){
  if(saving||cancelLock.current||state.frozen||state.maintenance)return;
  const current=cache.getSnapshot().entries[key];
  if(!current?.local){if(!current?.error)onDone(controller.snapshot().start.reference);return;}
  const raw=parseSourceTextDraft(parseLearningDraftJson(current.local.value,'source-text-edit'));
  if(raw.intentId){setMessage('Check the pending source save before discarding its input.');return;}
  let attempt:Cancellation={raw:{label:raw.label,content:raw.content,role:raw.role},generation:current.generation,phase:'preparing'};
  cancelLock.current=true;setCancellation(attempt);setMessage('');
  try{
   await cache.flushForm(owner,slot);
   const ready=cache.getSnapshot().entries[key];
   if(ready?.generation!==attempt.generation||!ready.local){cancelLock.current=false;if(mounted.current){setCancellation(undefined);setMessage('Newer source edits are kept. Choose Cancel again if you want to discard them.');}return;}
   if(!cache.discard(owner,slot,attempt.generation))throw Error('Source discard is held.');
   attempt={...attempt,clearedGeneration:cache.getSnapshot().entries[key]?.generation,phase:'pending'};if(mounted.current)setCancellation(attempt);
   await cache.flushForm(owner,slot);
   if(!finishCancellation(attempt)){cancelLock.current=false;if(mounted.current){setCancellation(undefined);setMessage('Newer source edits are kept. Choose Cancel again if you want to discard them.');}}
  }catch{if(mounted.current){setCancellation({...attempt,phase:'uncertain'});setMessage('Discarding these source edits was not confirmed. Your exact raw input remains visible. Check the saved draft before completing this discard.');}}
 }
 async function checkCancellation(){
  if(!cancellation||checkingCancel.current||state.frozen||state.maintenance)return;
  checkingCancel.current=true;const attempt=cancellation;setCancellation({...attempt,phase:'pending'});
  try{
   // Existing cache retry reads the authoritative record and reconciles the
   // exact predecessor/attempt before any explicit same-discard retry.
   await cache.retry(owner,slot);
   if(attempt.clearedGeneration===undefined){cancelLock.current=false;if(mounted.current){setCancellation(undefined);setMessage('Your source edits are saved. Choose Cancel again to discard them.');}}
   else if(!finishCancellation(attempt))throw Error('The discard generation changed.');
  }catch{if(mounted.current){setCancellation({...attempt,phase:'uncertain'});setMessage('Discarding these source edits was not confirmed. Your exact raw input remains visible. Check the saved draft before completing this discard.');}}
  finally{checkingCancel.current=false;}
 }
 async function save(event:FormEvent){event.preventDefault();if(!busy&&!cancellation)await controller.submit();}
 const earlier=form.recovery?.local??form.recovery?.remote?.value;
 const prior=earlier?parseSourceTextDraft(parseLearningDraftJson(earlier.value,'source-text-edit')):undefined;
 return <section className="source-intake-editor"><h2>Edit source</h2>
  {changed&&<p role="alert">This source changed while the editor was open. Your raw edits are kept for copy and review; saving is held.</p>}
  {form.status==='recovery'&&<details open><summary>Earlier source edits need review</summary><p>The saved source or its freshness changed. Copy any useful text; these edits have not been applied.</p>{prior&&<><Field label="Earlier source name"><input readOnly value={prior.label}/></Field><Field label="Earlier source text"><textarea readOnly rows={5} value={prior.content}/></Field><p>Earlier role: {prior.role}</p></>}</details>}
  <form onSubmit={save}><Field label="Source text"><textarea autoFocus rows={9} required maxLength={SOURCE_TEXT_DRAFT_STRING_LIMIT} readOnly={held} disabled={state.frozen||state.maintenance||form.status==='loading'} value={value.content} onChange={event=>edit({content:event.target.value})} placeholder="Paste the text to use…"/></Field><div className="two-fields"><Field label="Source name (optional)"><input maxLength={200} readOnly={held} disabled={state.frozen||state.maintenance||form.status==='loading'} value={value.label} onChange={event=>edit({label:event.target.value})} placeholder="Named from your text"/></Field><Field label="Use as"><select disabled={(busy&&!view.pending)||held} value={value.role} onChange={event=>edit({role:event.target.value as SourceTextFields['role']})}><option value="fact">Source material</option><option value="style">Style reference</option><option value="inspiration">Inspiration</option></select></Field></div><div className="row"><Button kind="primary" type="submit" disabled={busy||!!cancellation||!view.canSubmit}>Save new version</Button><Button disabled={saving||view.pending||!!cancellation||state.frozen||state.maintenance||!!entry&&!entry.canDiscard} onClick={()=>void cancel()}>Cancel</Button></div></form>
  {(view.message||view.pending)&&<p role={view.operation||view.phase==='completed'?'status':'alert'}>{view.message||(view.operation?'Saving the original edit. You can keep newer text here.':'The original edit may already be saved. Your current text is kept here; check the saved source before another save.')}</p>}
  {view.pending&&!view.operation&&<div className="row"><Button disabled={state.frozen||state.maintenance} onClick={()=>void controller.check()}>Check saved source</Button>{view.canRetry&&<Button onClick={()=>void controller.retry()}>Retry original source save</Button>}</div>}
  {state.frozen?<p role="status">Editing is paused while the app saves before closing. Your source edits are kept.</p>:message||form.error||state.error?<><p role="alert">{message||'Source edits could not be saved. Your shown input is kept; resolve this before closing.'}</p>{cancellation?.phase==='uncertain'?<Button disabled={state.maintenance} onClick={()=>void checkCancellation()}>Retry source edit discard</Button>:!cancellation&&<Button onClick={()=>void cache.retry(owner,slot).catch(()=>{})}>Retry source edit storage</Button>}</>:cancellation?<p role="status">Discarding these source edits…</p>:state.editRejections?.[key]?<p role="alert">That source change was not accepted. Keep the name within 200 characters and text within 1,000,000 characters; the shown accepted input is kept.</p>:view.pending?null:entry?.local?<p role="status">{entry.status==='clean'?'Unapplied source edits saved on this Mac.':'Saving unapplied source edits…'}</p>:null}
 </section>;
}
