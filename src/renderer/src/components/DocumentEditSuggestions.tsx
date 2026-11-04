import {useEffect,useRef,useState} from 'react';
import type {Task} from '../../../core/types';
import type {Command} from '../../../shared/bridge';
import {documentSuggestions,readDocumentSuggestionDecision,suggestionDocument,inspectSuggestionDecision,confirmedSuggestionInspection,type DocumentSuggestionDecision,type DocumentSuggestionInspection} from '../../../shared/document-edit-suggestions';
import type {createDocumentSuggestionsController} from '../document-edit-suggestions-controller';
import './document-edit-suggestions.css';

type Props={task:Task;artifactId:string;controller?:ReturnType<typeof createDocumentSuggestionsController>;canSuggest:boolean;blocked:boolean;busy:boolean;isCurrent:()=>boolean;scope:()=>string;canDecide:(choice:DocumentSuggestionDecision['choice'])=>boolean;invoke:(command:Command)=>Promise<Task|DocumentSuggestionInspection|undefined>;onStop:()=>void;runningRequestId?:string};
export function DocumentEditSuggestions(props:Props){
 const {task,artifactId,controller,canSuggest,blocked,busy,isCurrent,scope,runningRequestId}=props;
 const [message,setMessage]=useState(''),[pending,setPending]=useState<DocumentSuggestionDecision>(),[resolved,setResolved]=useState<{command:DocumentSuggestionDecision;kind:'applied'|'unapplied-stale'}>(),lock=useRef(false),pendingIntent=useRef<DocumentSuggestionDecision|undefined>(undefined),status=useRef<HTMLParagraphElement>(null),focusAfter=useRef(false),mounted=useRef(true),latest=useRef(props);latest.current=props;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{if(focusAfter.current){focusAfter.current=false;status.current?.focus();}},[message]);
 const renderScope=scope(),live=(expectedScope:string)=>mounted.current&&latest.current.isCurrent()&&latest.current.scope()===expectedScope&&latest.current.task.id===task.id&&latest.current.artifactId===artifactId;
 const view=controller?.snapshot(),revision=task.artifacts.find(item=>item.id===artifactId)?.revisions.at(-1);
 const proposals=task.artifacts.flatMap(artifact=>{const saved=artifact.revisions.at(-1)!,body=documentSuggestions(saved);return body?.target.artifactId===artifactId?[{artifact,saved,body}]:[];});
 const active=proposals.some(item=>item.body.phase!=='closed'),ownRunning=!!view?.activeRequestId&&view.activeRequestId===runningRequestId;
 function keepPending(command:DocumentSuggestionDecision|undefined){pendingIntent.current=command;setPending(command);}
 async function decide(command:DocumentSuggestionDecision,expectedScope=renderScope){
  const current=latest.current;
  if(lock.current||current.busy||!live(expectedScope)||command.taskId!==current.task.id||!current.canDecide(command.choice)||pendingIntent.current&&pendingIntent.current.intentId!==command.intentId)return;
  lock.current=true;keepPending(command);setResolved(undefined);setMessage('Saving this exact decision…');
  try{
   const result=await current.invoke(command),owner=result&&'artifacts' in result?result:undefined,body=owner?.artifacts.find(item=>item.id===command.proposal.artifactId)?.revisions.at(-1);
   if(!live(expectedScope))return;
   const receipt=owner&&body?inspectSuggestionDecision(owner,command):undefined;
   if(receipt?.kind!=='applied'){setMessage('This decision is unconfirmed. Check the saved review or retry this exact decision.');return;}
   keepPending(undefined);setResolved({command,kind:'applied'});focusAfter.current=true;setMessage(command.choice==='undo'?'Acceptance undone as a new saved revision. Earlier accepted changes are kept.':'Decision saved. The document shows only accepted changes.');
  }catch{if(live(expectedScope))setMessage('This decision is unconfirmed. Check the saved review before continuing.');}
  finally{lock.current=false;}
 }
 async function check(expectedScope=renderScope){
  const current=latest.current,command=pendingIntent.current;
  if(lock.current||current.busy||!live(expectedScope))return;lock.current=true;
  try{
   if(!command){const result=await current.invoke({type:'tasks.get',taskId:current.task.id});if(live(expectedScope))setMessage(result?'Saved review checked. Read its current decisions before continuing.':'The saved review could not be read.');return;}
   const result=await current.invoke({type:'document-suggestions.inspect',decision:command});if(!live(expectedScope))return;
   if(!result||!('kind' in result)){setMessage('The original decision is still unconfirmed. Keep its exact retry identity.');return;}
   const receipt=confirmedSuggestionInspection(result,command);
   if(receipt.kind==='not-observed'){setMessage('This exact decision is not yet observed on its original review. Keep it pending or retry it; another copy may still finish.');return;}
   keepPending(undefined);setResolved({command,kind:receipt.kind});focusAfter.current=true;
   setMessage(receipt.kind==='applied'?'Saved decision confirmed. No change was applied again.':'The earlier decision was not applied: its review was superseded. Review the current suggestions before choosing again.');
  }catch{if(live(expectedScope))setMessage('The original decision could not be verified. Keep it pending; no replacement action was sent.');}
  finally{lock.current=false;}
 }
 return <section className="document-suggestions" aria-label="Document edit suggestions">
  <header><h3>Suggested edits</h3><p>Review changes before they enter this document.</p></header>
  {controller&&revision&&suggestionDocument(revision)&&<div className="suggestion-actions"><button type="button" disabled={!canSuggest||blocked||busy||!!view?.operation||active} onClick={()=>{if(live(renderScope)&&latest.current.canSuggest&&!latest.current.blocked&&!latest.current.busy)return controller.submit();}}>Suggest edits from revision instructions</button>{ownRunning&&<button type="button" onClick={()=>{const current=latest.current;if(live(renderScope)&&current.runningRequestId&&current.controller?.snapshot().activeRequestId===current.runningRequestId)current.onStop();}}>Stop suggestions</button>}</div>}
  {blocked&&<p className="tiny" role="status">Document editing or storage needs review before suggestions can change this document. Your input is kept.</p>}
  {view?.message&&<p role="status" className="tiny">{view.message}</p>}
  {!proposals.length&&<p className="tiny">Use the revision instructions below for a whole-document or named-section change. Suggestions support Markdown/plain text up to 100,000 characters.</p>}
  {proposals.map(({artifact,saved,body})=>{
   const remaining=body.decisions.filter(item=>item==='pending').length,request=task.requests.find(item=>item.id===body.requestId),target=task.artifacts.find(item=>item.id===body.target.artifactId)?.revisions.at(-1),changed=target?.revision!==body.applied.revision||target.digest!==body.applied.digest;
   const stale=body.sourceRefs.some(ref=>{const source=task.sources.find(item=>item.id===ref.sourceId),version=source?.versions.at(-1);return source?.revoked!==undefined||source?.freshness!=='fresh'||version?.version!==ref.version||version.digest!==ref.digest;});
   const evidenceMissing=body.hunks.some(hunk=>!hunk.evidence),disabled=blocked||busy||!!pending||!isCurrent(),acceptDisabled=disabled||changed||stale||evidenceMissing||!props.canDecide('accept');
   const command=(choice:DocumentSuggestionDecision['choice'],index?:number)=>readDocumentSuggestionDecision({type:'document-suggestions.decide',taskId:task.id,proposal:{artifactId:artifact.id,revision:saved.revision,digest:saved.digest},intentId:crypto.randomUUID(),choice,...(index===undefined?{}:{index}),...(choice==='undo'?{undoOf:body.undo!.intentId,undoTarget:body.undo!.target}:{})});
   return <section className="suggestion-proposal" aria-label={'Suggestions for '+body.target.title} key={artifact.id}>
    {evidenceMissing&&<p role="status" className="warning">This historical proposal has no quoted evidence. Reject it and request fresh evidence-linked corrections before applying.</p>}
    <h4>{remaining?`${remaining} change${remaining===1?'':'s'} to review`:body.phase==='pending'?'Proposal pending':body.hunks.length?'Review complete':'No changes applied'}</h4><p className="tiny">{body.prompt}</p>
    {body.phase==='pending'?<><p role="status">{request?.status==='running'?'The response is still running. The saved document is unchanged.':`No completed suggestions are available${request?` (${request.status})`:''}. The saved document is unchanged.`}</p><button type="button" disabled={disabled||request?.status==='running'} onClick={()=>decide(command('reject-all'))}>Close this proposal</button></>:<>
     {body.undo&&<button type="button" disabled={disabled||changed||stale||!props.canDecide('undo')} onClick={()=>decide(command('undo'))}>Undo latest accepted changes</button>}
     {remaining>0&&<div className="suggestion-actions"><button type="button" disabled={acceptDisabled} onClick={()=>decide(command('accept-all'))}>Accept all remaining</button><button type="button" disabled={disabled} onClick={()=>decide(command('reject-all'))}>Reject all remaining</button></div>}
     {(changed||stale)&&remaining>0&&<p className="warning" role="status">The saved document or linked sources changed. Accepting is blocked; you can reject the remaining suggestions.</p>}
     {body.hunks.map((hunk,index)=>{const before=body.target.content.slice(Math.max(0,hunk.start-100),hunk.start),after=body.target.content.slice(hunk.start+hunk.remove.length,hunk.start+hunk.remove.length+100);return <article className="suggestion-change" aria-label={`Change ${index+1}`} key={index}><header><strong>Change {index+1}</strong><span>{body.decisions[index]}</span></header>{before&&<pre className="suggestion-context" aria-label="Preceding context">{before}</pre>}<div className="suggestion-pair"><section><h5>Original text</h5><pre>{hunk.remove||'No text — insertion point'}</pre></section><section><h5>Proposed text</h5><pre>{hunk.insert||'Remove this text'}</pre></section></div>{hunk.evidence&&<section aria-label={`Evidence for change ${index+1}`}><h5>Proposed reason</h5><p>{hunk.evidence.reason}</p>{hunk.evidence.anchors.map((anchor,anchorIndex)=>{const source=task.sources.find(source=>source.id===anchor.source.sourceId),version=source?.versions.find(version=>version.version===anchor.source.version&&version.digest===anchor.source.digest);return <details key={anchorIndex} className="suggestion-evidence"><summary>{version?.label??'Original source'} · version {anchor.source.version} · characters {anchor.start+1}–{anchor.start+anchor.quote.length}</summary><blockquote>{anchor.quote}</blockquote><p className="tiny">Source {anchor.source.sourceId} · SHA-256 {anchor.source.digest}</p></details>;})}<p className="tiny">Quotes are exact source excerpts. The proposed reason still needs your review.</p></section>}{after&&<pre className="suggestion-context" aria-label="Following context">{after}</pre>}{body.decisions[index]==='pending'&&<div className="suggestion-actions"><button type="button" disabled={acceptDisabled} onClick={()=>decide(command('accept',index))}>Accept change {index+1}</button><button type="button" disabled={disabled} onClick={()=>decide(command('reject',index))}>Reject change {index+1}</button></div>}</article>;})}
    </>}
   </section>;
  })}
  <p role="status" aria-live="polite" tabIndex={-1} ref={status} className="tiny" data-reconciled-intent={resolved?.kind}>{message}</p>
  <div className="suggestion-actions"><button type="button" disabled={busy} onClick={()=>check()}>Check saved review</button>{pending&&<button type="button" disabled={busy||blocked||!props.canDecide(pending.choice)} onClick={()=>decide(pending)}>Retry exact decision</button>}</div>
 </section>;
}
