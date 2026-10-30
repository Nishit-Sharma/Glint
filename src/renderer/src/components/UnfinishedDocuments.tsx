import {useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import type {Task} from '../../../core/types';
import {publicErrorMessage} from '../../../shared/public-messages';
import type {SavedWorkMatch} from '../../../shared/saved-work-search';
import type {createLearningDrafts} from '../learning-drafts';
import {unfinishedDocumentCurrent,unfinishedDocuments,unfinishedDocumentStatus,type UnfinishedDocument} from '../unfinished-documents';
import type {SavedWorkOpenScope} from './SavedWorkSearch';
import {Field} from '../ui';
import './saved-work-search.css';

export function UnfinishedDocuments({tasks,cache,onOpen}:{tasks:readonly Task[];cache:ReturnType<typeof createLearningDrafts>;onOpen:(match:SavedWorkMatch,scope:SavedWorkOpenScope)=>void}){
 const state=useSyncExternalStore(cache.subscribe,cache.getSnapshot),entries=useMemo(()=>unfinishedDocuments(tasks,state),[tasks,state]);
 const [query,setQuery]=useState(''),[filter,setFilter]=useState<'all'|'review'>('all'),[pending,setPending]=useState(false),[error,setError]=useState(''),generation=useRef(0),mounted=useRef(true),opening=useRef(false);
 const text=query.trim().toLocaleLowerCase(),visible=entries.filter(item=>(filter==='all'||item.status!=='continue')&&(!text||(item.match.taskTitle+'\n'+item.match.title).toLocaleLowerCase().includes(text))),rows=useRef(visible);rows.current=visible;
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
 const held=!state.ready||state.frozen||state.maintenance||!!state.error;
 function invalidate(){generation.current++;opening.current=false;setPending(false);setError('');}
 function open(item:UnfinishedDocument){
  const available=()=>rows.current.some(row=>row.key===item.key&&row.match.taskTitle===item.match.taskTitle&&row.match.title===item.match.title&&row.match.revision===item.match.revision&&row.match.digest===item.match.digest)&&unfinishedDocumentCurrent(item,cache.getSnapshot());
  const latest=cache.getSnapshot();if(opening.current||!latest.ready||latest.frozen||latest.maintenance||latest.error||!available())return;const token=++generation.current,live=()=>mounted.current&&generation.current===token;setError('');
  const current=()=>{const latest=cache.getSnapshot();return live()&&latest.ready&&!latest.frozen&&!latest.maintenance&&!latest.error&&available();};
  const scope:SavedWorkOpenScope={current,started(){if(current()){opening.current=true;setPending(true);}},finished(){if(live()){opening.current=false;setPending(false);}},failed(reason){if(live())setError(publicErrorMessage(reason));}};
  try{onOpen(item.match,scope);}catch(reason){scope.failed(reason);scope.finished();}
 }
 return <section className="saved-work-search unfinished-documents" aria-label="Unfinished documents">
  <p>Find unapplied edits to saved plain-text and Markdown documents across tasks. Names below identify the owning task and saved document. Draft text stays in its document editor.</p>
  <p className="tiny">Opening a draft does not send a request or save a document revision. Source edits, revision instructions and lesson forms remain in each task’s Files → Unfinished practice.</p>
  <form onSubmit={event=>event.preventDefault()}><Field label="Filter by task or document"><input type="search" maxLength={200} value={query} onChange={event=>{invalidate();setQuery(event.target.value);}}/></Field><Field label="Show drafts"><select value={filter} onChange={event=>{invalidate();setFilter(event.target.value==='review'?'review':'all');}}><option value="all">All document edits</option><option value="review">Needs review or storage check</option></select></Field></form>
  {!state.ready?<p role="status">Loading unfinished document edits…</p>:state.error?<p role="alert">Unfinished document edits could not be read. Existing draft bytes are kept; check draft storage in Files before continuing.</p>:state.frozen||state.maintenance?<p role="status">Draft editing is paused while storage is being checked or saved. Your edits are kept.</p>:null}
  {pending&&<p role="status">Opening the owning document…</p>}{error&&<p role="alert">{error}</p>}
  {state.ready&&!state.error&&!visible.length&&<p role="status">{entries.length?'No unfinished document edits match this view.':'No known unfinished plain-text or Markdown document edits.'}</p>}
  <ul aria-label="Unfinished document edits">{visible.map(item=><li key={item.key}><button type="button" disabled={held||pending} aria-label={`Open document edits: ${item.match.title} in ${item.match.taskTitle}`} onClick={()=>open(item)}><strong>{item.match.title}</strong><span>Task: {item.match.taskTitle}</span><small>{unfinishedDocumentStatus[item.status]}</small></button></li>)}</ul>
 </section>;
}
