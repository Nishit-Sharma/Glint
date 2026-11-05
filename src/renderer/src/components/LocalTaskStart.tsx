import {useId,useLayoutEffect,useRef,useState,useSyncExternalStore,type FormEvent} from 'react';
import {parseLocalTaskDraft} from '../../../shared/local-task-draft';
import {LOCAL_TASK_CONTENT_LIMIT,type LocalTaskStartResult} from '../../../shared/local-task-start';
import type {createLearningDrafts} from '../learning-drafts';
import {createLocalTaskDraftController} from '../local-task-draft-controller';
import {LearningDraftEditFeedback} from './LearningDraftEditFeedback';
import {Button,Field,type Run} from '../ui';
import './local-task-start.css';

function earlierInput(value:string|undefined){try{return value===undefined?undefined:parseLocalTaskDraft(JSON.parse(value));}catch{return undefined;}}
function EarlierLocalInput({value,name}:{value:string;name:string}){const raw=earlierInput(value);return raw?<><Field label={name+' title'}><input readOnly value={raw.title}/></Field><Field label={name+' content'}><textarea readOnly rows={6} value={raw.content}/></Field>{raw.intentId&&<p>This save may already have created a task. Trying again won’t make a duplicate.</p>}</>:<p>Your earlier text couldn’t be shown, but it’s still saved.</p>;}

type Props={kind:'text'|'draft';cache:ReturnType<typeof createLearningDrafts>;isCurrent:()=>boolean;busy:boolean;run:Run;onCreated:(result:LocalTaskStartResult)=>void;onCancel:()=>void};

export function LocalTaskStart({kind,cache,isCurrent,busy,run,onCreated,onCancel}:Props){
 const [,render]=useState(0),alive=useRef(true),heading=useId(),titleHint=useId(),contentHint=useId();
 const current=useRef({run,onCreated,onCancel,isCurrent});current.current={run,onCreated,onCancel,isCurrent};
 useLayoutEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const [controller]=useState(()=>createLocalTaskDraftController({
  cache,form:kind,isCurrent:()=>alive.current&&current.current.isCurrent(),
  send:input=>current.current.run<LocalTaskStartResult>({type:'tasks.start-local',...input}),
  onCreated:result=>current.current.onCreated(result),
  onState:()=>{if(alive.current)render(value=>value+1);},
 }));
 const storage=useSyncExternalStore(cache.subscribe,cache.getSnapshot),state=controller.snapshot(),raw=state.draft;
 const pending=['preparing','saving','discarding'].includes(state.phase),uncertain=!!raw?.intentId,completed=state.phase==='completed'&&!state.entry?.local;
 const held=state.form.status!=='ready'||!!state.form.error||state.frozen||state.maintenance||!raw;
 const disabled=busy||held||pending||uncertain;
 async function create(event:FormEvent){event.preventDefault();if(!busy&&!held&&!pending&&!state.rejection)await controller.submit();}
 async function discard(){if(!busy&&!pending&&await controller.discard()&&alive.current)current.current.onCancel();}
 const prior=state.entry?.local??state.entry?.remote?.value;
 return <section className="local-task-start" aria-labelledby={heading} aria-busy={pending||undefined}>
  <h2 id={heading}>{kind==='text'?'Start with text':'Start with a draft'}</h2>
  <p>{kind==='text'?'Paste text to keep in this task.':'Write a document to keep in this task.'} It saves on this device and works without an AI connection.</p>
  <form onSubmit={event=>void create(event)}>
   <Field label="Title (optional)"><input value={raw?.title??''} maxLength={200} disabled={disabled} aria-describedby={titleHint} onChange={event=>controller.edit({title:event.target.value})}/></Field>
   <p className="local-task-hint" id={titleHint}>Leave blank to use the first line.</p>
   <Field label={kind==='text'?'Source text':'Draft content'}><textarea autoFocus rows={10} value={raw?.content??''} maxLength={LOCAL_TASK_CONTENT_LIMIT} disabled={disabled} aria-describedby={contentHint} onChange={event=>controller.edit({content:event.target.value})}/></Field>
   <p className="local-task-hint" id={contentHint}>Up to 100,000 characters. Creating this task does not send its text to AI.</p>
   <p className="local-task-hint">Unfinished input is kept here until the save is confirmed or you discard it.{!uncertain&&' Cancel discards this input without creating or deleting a task.'}</p>
   {state.rejection&&<LearningDraftEditFeedback rejection={state.rejection} disabled={held||pending} onUseAccepted={()=>cache.dismissEditRejection(controller.owner,controller.slot,state.rejection!.id)}/>}
   {state.entry?.status==='saving'||state.entry?.status==='unsaved'?<p role="status">Saving…</p>:state.entry?.local&&!held&&<p role="status">{uncertain?'Your text is saved on this Mac, so you can safely try again.':'Input saved on this Mac. Choose Create task to submit it.'}</p>}
   {(state.form.error||state.form.status==='recovery')&&<div role="alert"><p>Local input needs recovery. Your saved and open versions are kept; no task is created by recovery.</p><button type="button" disabled={pending||storage.frozen||storage.maintenance} onClick={()=>void cache.retry(controller.owner,controller.slot).catch(()=>{})}>Retry local draft storage</button>{prior&&<details><summary>Inspect earlier local input</summary><EarlierLocalInput value={prior.value} name="Earlier local"/>{state.entry?.remote?.value&&state.entry.remote.value.value!==prior.value&&<><h3>Last confirmed saved input</h3><EarlierLocalInput value={state.entry.remote.value.value} name="Saved local"/></>}</details>}{state.entry?.canResolve&&<><button type="button" onClick={()=>cache.resolve(controller.owner,controller.slot,state.entry!.generation,'local')}>Keep my local input</button><button type="button" onClick={()=>cache.resolve(controller.owner,controller.slot,state.entry!.generation,'remote')}>Use saved local input</button></>}</div>}
   {state.frozen&&<p role="status">Editing is paused while the app saves before closing. It resumes if closing is cancelled.</p>}
   {state.message&&(!uncertain||pending||state.form.error)&&<p className="local-task-notice" role="alert">{state.message}</p>}
   {pending&&<p role="status">{state.phase==='discarding'?'Removing this text…':state.phase==='preparing'?'Preparing this local save…':'Saving on this device…'}</p>}
   {uncertain&&!pending&&<div className="local-task-notice" role="alert"><p>{state.message||'The save result is uncertain. The task may already exist.'}</p><p>Try saving again, or go back and check your task list. Going back keeps your text and any task that was saved.</p></div>}
   {completed&&!held&&<p role="status">Saved locally. You can find this task in your task list.</p>}
   <div className="local-task-actions">
    {uncertain?<Button kind="primary" disabled={busy||held||pending||!!state.rejection} onClick={()=>void controller.retry()}>Retry same save</Button>:!completed&&<Button type="submit" kind="primary" disabled={busy||held||pending||!!state.rejection||!raw?.content.trim()}>{pending?'Saving…':'Create task'}</Button>}
    {!uncertain&&!completed&&<Button kind="text" disabled={pending} onClick={()=>current.current.onCancel()}>Back to new task</Button>}
    {uncertain||completed?<Button disabled={pending} onClick={()=>current.current.onCancel()}>Back to new task</Button>:<Button disabled={busy||held||pending} onClick={()=>void discard()}>Cancel</Button>}
   </div>
   {uncertain&&!pending&&<details><summary>Discard this local input</summary><p>The task may already exist. This only removes this local input and retry identity; it does not delete or undo a task.</p><Button disabled={busy||held||!state.entry?.canDiscard} onClick={()=>void discard()}>Discard local input and retry identity</Button></details>}
  </form>
 </section>;
}
