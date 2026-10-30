import {useId,useLayoutEffect,useRef,useState} from 'react';
import type {Task} from '../../../core/types';
import {publicErrorMessage} from '../../../shared/public-messages';
import {savedWorkSearchLimits,searchSavedWork,type SavedWorkMatch,type SavedWorkSearchState} from '../../../shared/saved-work-search';
import {Button,Field} from '../ui';
import './saved-work-search.css';

export interface SavedWorkOpenScope{current():boolean;started():void;finished():void;failed(error:unknown):void}
export function SavedWorkSearch({tasks,state,onChange,onOpen}:{tasks:readonly Task[];state:SavedWorkSearchState;onChange(next:SavedWorkSearchState):void;onOpen(match:SavedWorkMatch,scope:SavedWorkOpenScope):void}){
 const [pending,setPending]=useState(false),[error,setError]=useState(''),generation=useRef(0),mounted=useRef(true),opening=useRef(false),activeSearch=useRef<SavedWorkSearchState['results']>(undefined),help=useId();
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
 const invalidate=()=>{generation.current++;activeSearch.current=undefined;opening.current=false;setPending(false);setError('');};
 const results=state.results?.query===state.query.trim()&&state.results.scope===state.scope?state.results:undefined;
 activeSearch.current=results;
 function open(match:SavedWorkMatch){
  if(opening.current||!results||activeSearch.current!==results)return;const token=++generation.current;setError('');
  const current=()=>mounted.current&&generation.current===token;
  onOpen(match,{current,started(){if(current()){opening.current=true;setPending(true);}},finished(){if(current()){opening.current=false;setPending(false);}},failed(reason){if(current())setError(publicErrorMessage(reason));}});
 }
 return <section className="saved-work-search" aria-label="Find saved work">
  <p id={help}>Search on this device: saved task names and goals, and the latest plain-text and Markdown files. Unsaved edits, older revisions, context sources, images and interactive results are excluded. Embedded image data and verified internal practice markers are omitted. Code examples in files that fit the limits remain searchable.</p>
  <form onSubmit={event=>{event.preventDefault();invalidate();try{onChange({...state,results:searchSavedWork(tasks,state.query,state.scope)});}catch(reason){setError(publicErrorMessage(reason));}}}>
   <Field label="Search saved work"><input type="search" value={state.query} maxLength={savedWorkSearchLimits.query} aria-describedby={help} onChange={event=>{invalidate();onChange({query:event.target.value,scope:state.scope});}}/></Field>
   <Field label="Search in"><select value={state.scope} onChange={event=>{invalidate();onChange({query:state.query,scope:event.target.value==='tasks'?'tasks':event.target.value==='files'?'files':'all'});}}><option value="all">Tasks and files</option><option value="tasks">Tasks</option><option value="files">Files</option></select></Field>
   <Button type="submit" disabled={!state.query.trim()}>Search</Button>
  </form>
  <p className="tiny">Names count toward the limits: 20,000 characters per task, 100,000 per file and 2,000,000 total. Files are searched only when their whole title and text fit the per-file and remaining search limits. At most 50 matches are shown, with recently updated tasks first.</p>
  {pending&&<p role="status">Opening saved work…</p>}{error&&<p role="alert" className="warning">{error}</p>}
  {results&&<><p role="status">{results.matchCount?`${results.matchCount} match${results.matchCount===1?'':'es'}${results.matchCount>results.matches.length?`; showing the first ${results.matches.length}`:''}.`:'No matches in the searched saved work.'} Searched {results.searched} task or file {results.searched===1?'entry':'entries'}.{results.partial>0&&` ${results.partial} ${results.partial===1?'entry was':'entries were'} searched only in part.`}{results.omitted>0&&` ${results.omitted} entries were not searched because the local size limit was reached. Choose Tasks or Files to narrow the search.`}{results.unsearchedFiles>0&&` ${results.unsearchedFiles} file ${results.unsearchedFiles===1?'entry was':'entries were'} not searched.`}{results.unsearchedFiles>results.unavailable&&` ${results.unsearchedFiles-results.unavailable} did not fit the complete-file or remaining search limits.`}{results.unavailable>0&&` ${results.unavailable} could not be projected safely.`}{results.unsearchedFiles>0&&` Open Files to review ${results.unsearchedFiles===1?'it':'them'}.`}</p><p className="tiny">Matches reflect this search. Opening rechecks the owner and the latest saved revision. Files open read-only; choose “Open current version” there to edit.</p><ul aria-label="Saved work matches">{results.matches.map(match=><li key={JSON.stringify([match.kind,match.taskId,match.kind==='file'?match.artifactId:''])}><button type="button" disabled={pending} onClick={()=>open(match)} aria-label={match.kind==='file'?`Open saved revision: ${match.title} in ${match.taskTitle}`:`Open task: ${match.taskTitle}`}><strong>{match.title}</strong><span>{match.kind==='file'?`${match.taskTitle} · Saved revision ${match.revision}`:'Task'}</span><small>{match.field}</small><span className="saved-work-excerpt">{match.excerpt}</span></button></li>)}</ul></>}
 </section>;
}
