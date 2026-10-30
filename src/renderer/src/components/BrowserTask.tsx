import { useEffect, useId, useRef, useState } from 'react';
import type { Task } from '../../../core/types';
import type {BrowserInspectionStopResult} from '../../../shared/bridge';
import { publicErrorMessage } from '../../../shared/public-messages';
import {browserInspectionStartUrl,browserOperationOutcome,browserRequestOutcome} from '../browser-outcome';
import './browser-task.css';
import {BrowserReviewNotes} from './BrowserReviewNotes';

export function BrowserStart({ onClose, onStart }: { onClose: () => void; onStart: (url: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null), [error, setError] = useState('');
  useEffect(() => { const owner = document.activeElement; dialog.current?.showModal(); input.current?.focus(); return () => { dialog.current?.close(); if (owner instanceof HTMLElement && owner.isConnected) owner.focus(); }; }, []);
  return <dialog ref={dialog} className="browser-start" onCancel={event => { event.preventDefault(); onClose(); }}><form onSubmit={event => { event.preventDefault(); try { const url = new URL(input.current?.value ?? ''); if (url.username || url.password || !['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && url.hostname !== '127.0.0.1')) throw Error('Enter an HTTPS page address.'); onStart(url.href); } catch { setError('Enter an HTTPS page address without sign-in details.'); input.current?.focus(); } }}>
    <h2>Which page should I use?</h2><p>Open a separate browser in this task. Your personal sign-ins stay separate.</p><label htmlFor="browser-page-address">Page address</label><input id="browser-page-address" name="url" type="url" required ref={input} placeholder="https://…" autoComplete="off" aria-invalid={!!error} aria-describedby={error?'browser-page-error':undefined}/>{error && <p id="browser-page-error" className="warning" role="alert">{error}</p>}<div className="row"><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="primary">Continue</button></div>
  </form></dialog>;
}
export function BrowserActivity({ task, requestId, onInspect, onStop }: { task: Task; requestId: string; onInspect: (runId: string, operationId: string, url: string, attemptId:string) => Promise<void>; onStop:(runId:string,operationId:string,attemptId:string)=>Promise<BrowserInspectionStopResult> }) {
  const [pending, setPending] = useState<{operationId:string;attemptId:string}>(), [stopping,setStopping]=useState(false), [error, setError] = useState(''), [notice,setNotice]=useState(''), helpId=useId();
  const active=useRef<{operationId:string;attemptId:string}|undefined>(undefined),stoppingNow=useRef(false);
  async function stop(){
    const current=active.current;if(!current||stoppingNow.current)return;stoppingNow.current=true;setStopping(true);
    let waiting=false;
    try{const result=await onStop(requestId,current.operationId,current.attemptId);waiting=result.kind!=='not-active';if(active.current===current)setNotice(result.kind==='finishing'?'Finishing your review…':result.kind==='not-active'?'The check has already finished.':'Stopping the check…');}
    catch(error){if(active.current===current)setError(publicErrorMessage(error));}
    finally{if(active.current===current&&!waiting){stoppingNow.current=false;setStopping(false);}}
  }
  const run = task.session?.runs.find(run => run.id === requestId);
  if(!run){
    const request=task.requests.find(request=>request.id===requestId);
    return request?.kind==='browser'&&['failed','cancelled','interrupted'].includes(request.status)&&request.browserStart?<details className="browser-activity"><summary>Starting website</summary><p className="break">{request.browserStart.origin}</p><p className="tiny">This is the website selected for this request. Page paths, query strings and fragments are omitted from this record. No first page observation was saved, so this does not establish whether the page loaded or the website changed. Review the request before choosing a page again. Nothing is retried automatically.</p></details>:null;
  }
  if(!run.operations.length)return null;
  const request=task.requests.find(request=>request.id===requestId),uncertain=request?browserRequestOutcome(task,request)?.needsReview:run.operations.some(operation=>browserOperationOutcome(operation).needsReview);
  return <details className="browser-activity" open={uncertain || undefined}><summary>{uncertain ? 'An earlier action needs review' : `${run.operations.length} browser ${run.operations.length === 1 ? 'step' : 'steps'}`}</summary><ol>{run.operations.map((operation,index) => <li key={operation.id}><span>{operation.reason}</span><small>{browserOperationOutcome(operation).label}</small>{operation.reconciliation&&<details><summary>Reviewed page</summary><p>{operation.reconciliation.observation.url}</p><p>{operation.reconciliation.observation.text.slice(0,2000)}</p>{operation.reconciliation.observation.text.length>2000&&<small>Only an excerpt is shown.</small>}<small>{operation.reconciliation.note}</small></details>}{operation.reconciliation&&<BrowserReviewNotes task={task} runId={run.id} operationId={operation.id} disabled={!!pending}/>}{browserOperationOutcome(operation).needsReview && <form onSubmit={event => { event.preventDefault(); if (active.current) return; const data = new FormData(event.currentTarget), url = String(data.get('url') ?? ''), current={operationId:operation.id,attemptId:crypto.randomUUID()}; active.current=current;setPending(current);setError('');setNotice('');void onInspect(run.id, operation.id, url, current.attemptId).catch(error => {if(active.current===current)setError(publicErrorMessage(error));}).finally(() => {if(active.current===current){active.current=undefined;stoppingNow.current=false;setPending(undefined);setStopping(false);setNotice('');}}); }}><label>Page with the outcome<input name="url" type="url" required defaultValue={browserInspectionStartUrl(run,operation.id)} aria-describedby={`${helpId}-${index}`}/></label><small id={`${helpId}-${index}`}>Choose a page that shows the outcome. A saved page may not show the result.</small><button type="submit" disabled={!!pending}>Inspect outcome</button>{pending?.operationId===operation.id&&<button type="button" disabled={stopping} onClick={()=>void stop()}>Stop checking</button>}</form>}</li>)}</ol><div role="status" className="tiny">{notice||(pending ? 'Inspecting the selected page…' : '')}</div>{error && <p className="warning" role="alert">{error}</p>}</details>;
}
