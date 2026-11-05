import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import type {Checkpoint,Task} from '../../../core/types';
import {publicErrorMessage,requestStatusLabel} from '../../../shared/public-messages';
import {Button,Field,type Run} from '../ui';
import {useNavigationDraft} from '../draft-navigation';
import {ExportReview} from './ExportReview';
import {CheckpointSources} from './CheckpointSources';
import {resolveSavedNote,savedNoteIdentity} from '../../../shared/saved-work-search';
import {buildHistoryEvents,historyRevision,historyTime,requestResultReference,validCheckpointNote,type HistoryRevisionReference} from './history-events';
import './task-history.css';

export interface TaskHistoryProps {
 task:Task;
 busy:boolean;
 run:Run;
 onOpenRevision?:(reference:HistoryRevisionReference)=>void;
 selectedNote?:{taskId:string;checkpoint:Checkpoint};
 active?:boolean;
 onBackToSearch?:()=>void;
}

function CheckpointDetails({task,checkpoint,children}:{task:Task;checkpoint:Checkpoint;children:ReactNode}){
 const [open,setOpen]=useState(false);
 return <details className="history-checkpoint-revisions" onToggle={event=>setOpen(event.currentTarget.open)}><summary>Saved at this point</summary>{children}{open&&<CheckpointSources task={task} checkpoint={checkpoint}/>}</details>;
}

export function TaskHistory({task,busy,run,onOpenRevision,selectedNote,active=true,onBackToSearch}:TaskHistoryProps){
 const [note,setNote]=useState(''),[noteError,setNoteError]=useState(''),[noteOpen,setNoteOpen]=useState(false),[discardNote,setDiscardNote]=useState(false);
 const noteRef=useRef(note),input=useRef<HTMLTextAreaElement>(null),addNote=useRef<HTMLButtonElement>(null),wasOpen=useRef(false),errorId=useId(),editorId=useId();noteRef.current=note;
 const clearNavigationDraft=useNavigationDraft(note.length>0),events=buildHistoryEvents(task);
 const foundNote=selectedNote?.taskId===task.id?resolveSavedNote(task,selectedNote.checkpoint):undefined,foundNoteRef=useRef<HTMLElement>(null),selectionKey=selectedNote?JSON.stringify([selectedNote.taskId,savedNoteIdentity(selectedNote.checkpoint)]):undefined,availableKey=foundNote?savedNoteIdentity(foundNote):undefined;
 useEffect(()=>{const node=foundNoteRef.current;if(active&&foundNote&&node?.isConnected&&!node.closest('[hidden],[inert]')){node.focus({preventScroll:true});node.scrollIntoView({block:'start'});}},[task.id,selectionKey,availableKey,active]);
 useEffect(()=>{if(noteOpen)input.current?.focus();else if(wasOpen.current)addNote.current?.focus();wasOpen.current=noteOpen;},[noteOpen]);
 function closeNote(){setNoteOpen(false);setDiscardNote(false);setNoteError('');}
 function revisionLink(reference:HistoryRevisionReference,key?:string){
  const revision=historyRevision(task,reference);
  if(!revision)return <span className="history-revision-unavailable" key={key}>Saved revision {reference.revision} is no longer available.</span>;
  const label=`${revision.title} · Revision ${revision.revision}`;
  return onOpenRevision?<button type="button" key={key} className="history-revision-link" aria-label={label} title={label} onClick={()=>onOpenRevision(reference)}>{revision.title}</button>:<span className="history-revision-label" key={key}>{label}</span>;
 }
 return <section className="task-history" aria-label="Task history records">
  {selectedNote&&!foundNote&&<div className="history-search-selection">{onBackToSearch&&<Button kind="text" onClick={onBackToSearch}>Back to search results</Button>}<p role="alert">This exact saved note changed or is no longer available. Search again to choose a current entry.</p></div>}
  <div className="history-toolbar"><button ref={addNote} type="button" className="history-add-note" aria-expanded={noteOpen} aria-controls={editorId} onClick={()=>{setDiscardNote(false);if(noteOpen)input.current?.focus();else setNoteOpen(true);}}>{noteOpen?'Edit note':'Add note'}</button></div>

  {events.length>0?<ol className="history-events" aria-label="Task events, newest first">{events.map(event=><li key={event.id} data-history-kind={event.kind}><article ref={event.kind==='checkpoint'&&event.checkpoint===foundNote?foundNoteRef:undefined} tabIndex={event.kind==='checkpoint'&&event.checkpoint===foundNote?-1:undefined} aria-label={event.kind==='checkpoint'&&event.checkpoint===foundNote?'Found history note':undefined} aria-current={event.kind==='checkpoint'&&event.checkpoint===foundNote?'location':undefined} className={'history-event history-event-'+event.kind}>
   <time className="history-time" dateTime={Number.isFinite(Date.parse(event.at))?event.at:undefined} title={event.kind==='request'?'Started '+historyTime(event.at):event.at} aria-label={event.kind==='request'?'Started '+historyTime(event.at):undefined}>{historyTime(event.at)}</time>
   {event.kind==='checkpoint'?<>{event.checkpoint===foundNote&&onBackToSearch&&<Button kind="text" onClick={onBackToSearch}>Back to search results</Button>}<p className="history-note">{event.checkpoint.note}</p>{(event.checkpoint.artifacts.length>0||event.checkpoint.sourceRefs.length>0)&&<CheckpointDetails key={task.id+':'+event.checkpoint.id} task={task} checkpoint={event.checkpoint}>{event.checkpoint.artifacts.length>0&&<><h3>Saved results</h3><ul>{event.checkpoint.artifacts.map((reference,index)=><li key={reference.artifactId+':'+reference.revision}>{revisionLink(reference,String(index))}</li>)}</ul></>}</CheckpointDetails>}</>:event.kind==='request'?<>
    {event.request.status==='completed'&&requestResultReference(event.request)?revisionLink(requestResultReference(event.request)!):<p className="history-request-status">{requestStatusLabel(event.request.status)}</p>}
    {event.request.error&&<p className="warning">{publicErrorMessage(event.request.error)}</p>}
    <details className="history-analysis-request"><summary>{event.request.kind==='brief'?'Screen analysis':'Request details'}</summary><p className="history-request-prompt">{event.request.prompt}</p><p className="history-event-meta">{requestStatusLabel(event.request.status)}{event.request.finishedAt&&<> · <time dateTime={event.request.finishedAt} aria-label={'Finished '+historyTime(event.request.finishedAt)}>{historyTime(event.request.finishedAt)}</time></>}</p></details>
   </>:<>
    {revisionLink({artifactId:event.action.proposal.artifactId,revision:event.action.proposal.revision})}
    <p className="history-export-status">{event.action.status==='verified'?'File saved':event.action.status==='uncertain'?'Save needs checking':event.action.status==='proposed'?'Export awaits approval':event.action.status==='retired'?'Export approval expired':event.action.status==='failed'?'Could not save file':'Saving file'}</p><details className="history-export-review"><summary>{event.action.status==='proposed'?'Review export':'Export details'}</summary><ExportReview taskId={task.id} action={event.action} busy={busy} run={run}/></details>
   </>}
  </article></li>)}</ol>:<p className="muted history-empty">Notes and earlier results will appear here.</p>}
  {noteOpen&&<form className="checkpoint" id={editorId} noValidate onSubmit={async event=>{
   event.preventDefault();const submitted=note;
   if(!validCheckpointNote(submitted)){setNoteError('Write a note before saving.');input.current?.focus();return;}
   setNoteError('');
   if(await run({type:'tasks.checkpoint',taskId:task.id,note:submitted},'Note saved')&&noteRef.current===submitted){clearNavigationDraft();setNote('');closeNote();}
  }}>
   <Field label="Note"><textarea ref={input} required value={note} onChange={event=>{setNote(event.target.value);if(validCheckpointNote(event.target.value))setNoteError('');}} rows={3} placeholder="What is settled, and what comes next?" aria-invalid={!!noteError} aria-describedby={noteError?errorId:undefined}/></Field>
   {noteError&&<p className="history-note-error warning" role="alert" id={errorId}>{noteError}</p>}
   <div className="history-note-actions"><Button type="submit" disabled={busy}>Save note</Button><Button disabled={busy} onClick={()=>{if(note.length)setDiscardNote(true);else closeNote();}}>Cancel</Button></div>
   {discardNote&&<div className="history-note-discard" role="group" aria-label="Discard note"><p>Discard this note? Your unsaved text will be removed.</p><div className="history-note-actions"><Button disabled={busy} onClick={()=>{setDiscardNote(false);input.current?.focus();}}>Keep note</Button><Button kind="text danger" disabled={busy} onClick={()=>{setNote('');closeNote();}}>Discard note</Button></div></div>}
  </form>}
 </section>;
}
