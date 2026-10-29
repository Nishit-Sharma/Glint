import type {ReactNode} from 'react';
import {ArrowUpRight} from 'lucide-react';
import type {Artifact,ArtifactRevision,Task} from '../../../core/types';
import {readScreenBrief} from '../../../core/screen-brief';
import {requestStatusLabel,publicErrorMessage} from '../../../shared/public-messages';
import {readModelDraft} from './ModelDraftReview';
import {ReadableText} from './ReadableText';
import {StreamingText} from './StreamingText';
import {ReadyArtifact} from './ReadyArtifact';
import {MODULE_MIME} from '../../../shared/module-contract';
import {WINDOW_WORKFLOW_MIME} from '../../../shared/window-workflow-artifact';
import {BrowserActivity} from './BrowserTask';
import {browserRequestOutcome,requestArtifact} from '../browser-outcome';

/** Durable requests supply the transcript. A proactive brief has no invented
 * user message. Each reply resolves its original revision, not a later edit. */
export function Conversation({task,pendingId,pendingKind,pendingPrompt,stream,active,renderBrief,onArtifact,onConnection,onInspectBrowser}:{task:Task;pendingId?:string;pendingKind?:string;pendingPrompt?:string;stream?:{requestId:string;text:string};active:boolean;renderBrief:(artifact:Artifact)=>ReactNode;onArtifact:(artifact:Artifact)=>void;onConnection:()=>void;onInspectBrowser?:(runId:string,operationId:string,url:string)=>Promise<void>}){
 function result(item:Artifact,revision:ArtifactRevision){
  const exact={...item,revisions:[revision]},identity=[task.id,item.id,revision.revision,revision.digest].join(':');
  if(readScreenBrief(revision.content,revision.sourceRefs))return renderBrief(exact);
  if(revision.mimeType===MODULE_MIME)return renderBrief(exact);
  if(revision.mimeType==='application/json'&&readModelDraft(revision))return <ReadyArtifact identity={identity}><button className="conversation-artifact" data-view-focus={'artifact:'+item.id} onClick={()=>onArtifact(item)}><span><strong>{revision.title}</strong><small>{readModelDraft(revision)?.kind==='experiment'?'Explore inputs and calculate':'Review the procedure'}</small></span><ArrowUpRight size={16}/></button></ReadyArtifact>;
  if(revision.mimeType==='image/png'&&revision.encoding==='base64')return <ReadyArtifact identity={identity} variant="image"><button className="conversation-image" data-view-focus={'artifact:'+item.id} aria-label={'Open '+revision.title} onClick={()=>onArtifact(item)}><img src={'data:image/png;base64,'+revision.content} alt={revision.title}/></button></ReadyArtifact>;
  return <><ReadableText text={revision.mimeType===WINDOW_WORKFLOW_MIME?'Image transcription and state transitions are ready for correction.':revision.mimeType==='application/json'?'This saved file is available in your work.':revision.content}/><button className="conversation-open" data-view-focus={'artifact:'+item.id} onClick={()=>onArtifact(item)}>Open {revision.title}<ArrowUpRight size={14}/></button></>;
 }
 return <div className="conversation" aria-label="Task conversation">{task.requests.map(request=>{
  const saved=requestArtifact(task,request),item=saved?.artifact,revision=saved?.revision,outcome=browserRequestOutcome(task,request);
  return <article key={request.id} className="conversation-turn" aria-label={request.kind==='brief'?'Screen insight':'Conversation turn'}>
   {request.kind!=='brief'&&<div className="conversation-question"><p>{request.prompt}</p></div>}
   <div className="conversation-answer">{request.id===pendingId?<StreamingText text={stream?.requestId===request.id?stream.text:request.kind==='brief'?'Reading this snapshot…':'Preparing a response…'} streaming={active}/>:<>{outcome&&<><p className="conversation-status">{outcome.label}</p><p className={outcome.needsReview?'warning':'tiny'} role={outcome.needsReview&&request.id===task.requests.at(-1)?.id?'alert':undefined}>{outcome.message}</p>{outcome.reviewed&&request.status!=='completed'&&<details><summary>Original request interruption</summary><p>{requestStatusLabel(request.status)}. The request ended before a completed response was saved. The website outcome was reviewed later.</p></details>}</>}{request.status==='completed'&&item&&revision?result(item,revision):<>{!outcome&&<><p className="conversation-status">{requestStatusLabel(request.status)}</p>{request.error&&<><p className="warning" role={request.id===task.requests.at(-1)?.id?'alert':undefined}>{publicErrorMessage(request.error)}</p>{/connection|service may still/i.test(publicErrorMessage(request.error))&&<button type="button" className="conversation-open" onClick={onConnection}>Check connection</button>}</>}</>}{stream?.requestId===request.id&&<StreamingText text={stream.text} streaming={false}/>}</>}</>}</div>
   {request.kind==='browser'&&onInspectBrowser&&<BrowserActivity task={task} requestId={request.id} onInspect={onInspectBrowser}/>}
  </article>;
 })}{pendingId&&!task.requests.some(request=>request.id===pendingId)&&<article className="conversation-turn" aria-label={pendingKind==='brief'?'Screen insight':'Conversation turn'}>{pendingKind!=='brief'&&<div className="conversation-question"><p>{pendingPrompt}</p></div>}<div className="conversation-answer"><StreamingText text={stream?.requestId===pendingId?stream.text:pendingKind==='brief'?'Reading this snapshot…':'Preparing a response…'} streaming={active}/></div></article>}</div>;
}
