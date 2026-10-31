import {useEffect,useRef,useState} from 'react';
import {publicErrorMessage} from '../../../shared/public-messages';
import type {Task} from '../../../core/types';
import {readRecurringWorkView,type RecurringWork,type RecurringWorkChange,type RecurringWorkView} from '../../../shared/recurring-work';
import {useNavigationDraft} from '../draft-navigation';
import {Button,Field} from '../ui';
import './recurring-work.css';

const displayTime=(value:string,timeZone?:string)=>new Date(value).toLocaleString(undefined,timeZone?{timeZone}:undefined);
const localTime=(value:string)=>{const date=new Date(value);return new Date(date.getTime()-date.getTimezoneOffset()*60_000).toISOString().slice(0,16);};
export function RecurringWorkPanel({onOpenTask}:{onOpenTask:(task:Task)=>void}){
 const [view,setView]=useState<RecurringWorkView>(),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[editing,setEditing]=useState<RecurringWork|null>(),[deleting,setDeleting]=useState<string>();
 const alive=useRef(true),lock=useRef(false),reads=useRef(0);
 async function load(){const request=++reads.current;try{const value=readRecurringWorkView(await window.companion.invoke({type:'schedules.get'}));if(alive.current&&request===reads.current)setView(value);}catch{if(alive.current&&request===reads.current)setError('Schedules could not be opened. Your saved work has not been changed.');}}
 useEffect(()=>{alive.current=true;void load();const unsubscribe=window.companion.subscribe(event=>{if(event.type==='schedules.changed')void load();});return()=>{alive.current=false;reads.current++;unsubscribe();};},[]);
 async function change(change:RecurringWorkChange){
  if(lock.current)return false;lock.current=true;setBusy(true);setError('');setMessage('');
  try{const value=readRecurringWorkView(await window.companion.invoke({type:'schedules.change',change}));if(!alive.current)return false;reads.current++;setView(value);setDeleting(undefined);setMessage(change.kind==='delete'?'Schedule deleted. Previously prepared tasks are kept.':change.kind==='pause'?'Schedule paused. No new occurrences will start.':change.kind==='resume'?'Schedule resumed. The latest overdue occurrence will run soon.':change.kind==='save'&&change.mode==='response'?'Schedule saved paused. Choose Authorize and resume to review and authorize this question for this app session.':'Schedule saved on this Mac.');return true;}
  catch(error){if(alive.current){setError(publicErrorMessage(error));void load();}return false;}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 async function openTask(id:string){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const task=await window.companion.invoke<Task>({type:'tasks.get',taskId:id});if(alive.current)onOpenTask(task);}catch{if(alive.current)setError('This prepared task is no longer available. Its preparation history is kept.');}finally{lock.current=false;if(alive.current)setBusy(false);}}
 return <section className="recurring-work" aria-label="Recurring local work">
  <p>Run a saved question on a recurring schedule, or prepare it as an unsent draft. Generated answers stay in separate local tasks.</p>
  <p className="preference-explanation">Glint must be open. Sleep delays work; only the latest missed occurrence runs when authorized. Generated responses need authorization after edits or restart, and pause on any unverified result. Browser, capture, export and message actions stay off.</p>
  {view&&<p className="tiny" role={view.runtime.state==='error'?'alert':'status'}>{view.runtime.message}{view.runtime.checkedAt&&<> Last checked: {displayTime(view.runtime.checkedAt)}.</>}</p>}
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  <div className="row"><Button disabled={busy} onClick={()=>{setError('');void load();}}>Reload schedules</Button>{editing===undefined&&<Button disabled={busy||!view} onClick={()=>{setEditing(null);setMessage('');setError('');}}>New schedule</Button>}</div>
  {editing!==undefined?<RecurringWorkForm key={editing?.id??'new'} initial={editing} busy={busy} save={change} onDone={()=>setEditing(undefined)}/>:!view?<p role="status">Opening schedules…</p>:<>
   {!view.items.length&&<p className="muted">No recurring schedules yet.</p>}
   <ul className="schedule-list">{[...view.items].sort((a,b)=>a.nextDueAt.localeCompare(b.nextDueAt)).map(item=><li key={item.id}><article aria-label={item.title}>
    <h3>{item.title}</h3><p>{item.enabled?'On':'Paused'} · Every {item.intervalHours} hours</p><p>{item.enabled?'Next due':'Saved due time'}: {displayTime(item.nextDueAt,item.timeZone)}{item.timeZone?' · '+item.timeZone:''}</p><p>{item.mode==='response'?'Generate a response · authorization lasts this app session':'Prepare an unsent question'}</p>{item.blockedReason&&<p role="status">{item.blockedReason}</p>}<p className="schedule-instruction">{item.instruction}</p>
    <div className="row"><Button disabled={busy} onClick={()=>{setEditing(item);setMessage('');setError('');}}>Edit schedule</Button><Button disabled={busy} onClick={()=>void change({kind:item.enabled?'pause':'resume',id:item.id,expectedRevision:item.revision})}>{item.enabled?'Pause schedule':item.mode==='response'?'Authorize and resume':'Resume schedule'}</Button><Button disabled={busy} onClick={()=>setDeleting(item.id)}>Delete schedule</Button></div>
    {deleting===item.id&&<div className="schedule-delete" role="group" aria-label="Confirm schedule deletion"><p>Delete this schedule and its preparation history? Tasks already prepared will stay in your task list.</p><div className="row"><Button disabled={busy} onClick={()=>void change({kind:'delete',id:item.id,expectedRevision:item.revision})}>Delete this schedule</Button><Button disabled={busy} onClick={()=>setDeleting(undefined)}>Keep schedule</Button></div></div>}
    <details><summary>{item.mode==='response'?'Run history':'Preparation history'} ({item.history.length})</summary><p className="tiny">Latest 50 occurrences. Failed or unverified responses are never retried automatically.</p>{!item.history.length?<p>No occurrences yet.</p>:<ol className="schedule-history">{[...item.history].reverse().map(run=><li key={run.taskId}><strong>{run.status==='completed'?'Response saved':run.status==='running'?'Response running':run.status?'Response unverified — not retried':'Prepared unsent task'}</strong><p>Due: {displayTime(run.scheduledFor,item.timeZone)}<br/>Started: {displayTime(run.preparedAt,item.timeZone)}</p>{run.error&&<p>{run.error}</p>}{run.skipped>0&&<p>{run.skipped} earlier missed {run.skipped===1?'time':'times'} skipped.</p>}<Button disabled={busy} onClick={()=>void openTask(run.taskId)}>{run.status?'Open result task':'Open prepared task'}</Button></li>)}</ol>}</details>
   </article></li>)}</ul>
  </>}
 </section>;
}
function RecurringWorkForm({initial,busy,save,onDone}:{initial:RecurringWork|null;busy:boolean;save:(change:RecurringWorkChange)=>Promise<boolean>;onDone:()=>void}){
 const [id]=useState(()=>initial?.id??crypto.randomUUID()),[mode,setMode]=useState<'response'|'draft'>(initial?initial.mode??'draft':'response'),[title,setTitle]=useState(initial?.title??''),[instruction,setInstruction]=useState(initial?.instruction??''),[intervalHours,setInterval]=useState<24|168>(initial?.intervalHours??24),[next,setNext]=useState(()=>localTime(initial?.nextDueAt??new Date(Date.now()+3_600_000).toISOString())),[error,setError]=useState('');
 const [initialNext]=useState(next);
 const dirty=mode!==(initial?initial.mode??'draft':'response')||title!==(initial?.title??'')||instruction!==(initial?.instruction??'')||intervalHours!==(initial?.intervalHours??24)||next!==initialNext,clearDraft=useNavigationDraft(dirty||busy);
 return <form aria-label={initial?'Edit recurring schedule':'New recurring schedule'} onSubmit={event=>{event.preventDefault();setError('');const time=new Date(next);if(!Number.isFinite(time.getTime())||localTime(time.toISOString())!==next){setError('Choose a valid due time. This local time may fall in a daylight saving clock change.');return;}void save({kind:'save',id,expectedRevision:initial?.revision??0,title,instruction,intervalHours,nextDueAt:time.toISOString(),...(mode==='response'?{mode:'response'}:{}),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}).then(saved=>{if(saved){clearDraft();onDone();}});}}>
  <h3>{initial?'Edit schedule':'New schedule'}</h3>
  <Field label="Schedule title"><input required maxLength={200} value={title} disabled={busy} onChange={event=>setTitle(event.target.value)}/></Field>
  <Field label="Scheduled action"><select value={mode} disabled={busy} onChange={event=>setMode(event.target.value==='response'?'response':'draft')}><option value="response">Generate a response</option><option value="draft">Prepare an unsent question</option></select></Field>
  <Field label="Saved question"><textarea required rows={5} maxLength={10_000} value={instruction} disabled={busy} onChange={event=>setInstruction(event.target.value)}/></Field>
  <Field label="Repeat"><select value={intervalHours} disabled={busy} onChange={event=>setInterval(event.target.value==='168'?168:24)}><option value={24}>Every 24 hours</option><option value={168}>Every 7 days (168 hours)</option></select></Field>
  <Field label={initial?'Next due time':'First due time'}><input type="datetime-local" required value={next} disabled={busy} onChange={event=>setNext(event.target.value)}/></Field>
  <p className="tiny">Time zone: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Repeats use elapsed hours, so local time can shift when daylight saving changes. Choose Use current time to run the latest due occurrence on the next check after authorization. Saving a response schedule pauses it until you authorize it again. Each response uses only this saved question and your explicitly reviewed response preferences; no sources or saved user memory are included.</p>
  <p className="tiny">Exact first/next instant: {Number.isFinite(new Date(next).getTime())?new Date(next).toISOString():'Choose a valid time'}.</p>
  <Button disabled={busy} onClick={()=>setNext(localTime(new Date().toISOString()))}>Use current time</Button>
  {error&&<p role="alert">{error}</p>}
  <div className="row"><Button type="submit" disabled={busy||!title.trim()||!instruction.trim()}>{busy?'Saving…':'Save schedule'}</Button><Button disabled={busy} onClick={()=>{clearDraft();onDone();}}>Cancel editing</Button></div>
 </form>;
}
