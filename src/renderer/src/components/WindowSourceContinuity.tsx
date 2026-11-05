import {useLayoutEffect,useRef,useState} from 'react';
import type {SourceRef,Task} from '../../../core/types';
import {sourceAffectedWork} from '../source-affected-work';
import './window-source-continuity.css';

/** Saved metadata only. Opening a reference does not observe or refresh a window. */
export function WindowSourceContinuity({task,sourceId,onReview,isCurrent}:{task:Task;sourceId:string;onReview?:(reference:SourceRef,isCurrent?:()=>boolean)=>void;isCurrent?:()=>boolean}){
 const live=useRef({task,sourceId,onReview});live.current={task,sourceId,onReview};
 const mounted=useRef(true);useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const [reviewState,setReviewState]=useState<{key:string;pending:boolean;issue?:string}>();
 const source=task.sources.find(source=>source.id===sourceId),version=source?.versions.find(version=>version.id===sourceId&&version.version===source.currentVersion);
 if(!source||version?.kind!=='window')return null;
 const ref={sourceId,version:version.version,digest:version.digest},owner=task.id,affected=sourceAffectedWork(task,sourceId).length;
 const key=JSON.stringify([owner,ref]),state=reviewState?.key===key?reviewState:undefined;
 const changed=source.freshness!=='fresh'&&source.documentChange?.kind==='changed'&&!!version.documentStamp&&!!source.documentChange.observedDigest,unavailable=source.freshness!=='fresh'&&source.documentChange?.kind==='unavailable';
 function current(){
  const current=live.current,saved=current.task.sources.find(source=>source.id===ref.sourceId),exact=saved?.versions.find(version=>version.id===ref.sourceId&&version.version===saved.currentVersion);
  return mounted.current&&current.task.id===owner&&current.sourceId===sourceId&&exact?.kind==='window'&&exact.version===ref.version&&exact.digest===ref.digest&&(isCurrent?.()??true);
 }
 async function review(){
  if(!current()||state?.pending)return;setReviewState({key,pending:true});
  try{
   const checked=await window.companion.invoke<Task>({type:'tasks.get',taskId:owner});if(!current())return;
   const saved=checked.sources.find(source=>source.id===ref.sourceId),exact=saved?.versions.find(version=>version.id===ref.sourceId&&version.version===saved.currentVersion);
   if(checked.id!==owner||exact?.kind!=='window'||exact.version!==ref.version||exact.digest!==ref.digest){setReviewState({key,pending:false,issue:'This saved window source changed or is unavailable. Return to Attachments and choose its current snapshot.'});return;}
   setReviewState({key,pending:false});live.current.onReview?.(ref,current);
  }catch{if(current())setReviewState({key,pending:false,issue:'This saved window source could not be verified. Return to Attachments and choose it again.'});}
  finally{if(mounted.current)setReviewState(previous=>previous?.key===key&&previous.pending?{key,pending:false}:previous);}
 }
 return <section className={'window-source-continuity'+(source.freshness!=='fresh'?' needs-review':'')} aria-label="Selected window source review">
  <p className="window-source-state" role="status">{changed?'Recorded window metadata change':unavailable?'Window observation unavailable':source.freshness!=='fresh'?'Window snapshot needs review':'Saved window snapshot'} · Version {version.version}</p>
  <p className="tiny">{version.label}</p>
  {changed&&<p>The application reported a document-address or edited-state change for this snapshot. The saved snapshot is historical; the changed text or pixels are unknown.</p>}
  {unavailable&&<p>The window could not be observed reliably. This does not establish that its content changed.</p>}
  {source.freshness!=='fresh'&&!changed&&!unavailable&&<p>This snapshot requires an explicit refresh or review before reuse.</p>}
  <p className="tiny">Current live content is unknown. Edits at the same address may not be detected.</p>
  {affected>0&&<p>{affected} saved {affected===1?'item needs':'items need'} source review. Results stay as saved until you explicitly revise them.</p>}
  {state?.issue&&<p role="alert">{state.issue}</p>}
  {onReview&&<button type="button" disabled={state?.pending} onClick={()=>void review()}>{state?.pending?'Checking saved source…':'Review saved window snapshot'}</button>}
 </section>;
}
