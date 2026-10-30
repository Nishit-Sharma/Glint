import type {Task} from '../../../core/types';
import type {BrowserObservation} from '../../../core/task-session';

/** Display only the already persisted action data. This grants no browser authority. */
export function BrowserActionEvidence({task,runId,operationId}:{task:Task;runId:string;operationId:string}){
 const runs=task.session?.runs.filter(run=>run.id===runId)??[];
 if(runs.length!==1||task.requests.filter(request=>request.id===runId&&request.kind==='browser').length!==1)return null;
 const run=runs[0],operations=run.operations.filter(operation=>operation.id===operationId);
 if(operations.length!==1||run.initialObservation.taskId!==task.id||run.initialObservation.browserId!==run.browserId)return null;
 function sameSite(value:string){
  try{const url=new URL(value),origin=new URL(run.origin);return origin.origin===run.origin&&url.origin===run.origin&&!url.username&&!url.password&&(url.protocol==='https:'||url.protocol==='http:'&&url.hostname==='127.0.0.1');}catch{return false;}
 }
 if(!sameSite(run.initialObservation.url))return null;
 const action=operations[0];
 if(!action.receipt&&!action.result&&!action.reconciliation&&action.status!=='uncertain')return null;
 const receipt=action.receipt&&sameSite(action.receipt.url)&&Number.isInteger(action.receipt.status)&&action.receipt.status>=100&&action.receipt.status<=599?action.receipt:undefined;
 const ownsPage=(page:BrowserObservation,original:boolean)=>page.taskId===task.id&&(!original||page.browserId===run.browserId)&&sameSite(page.url);
 const result=action.result&&ownsPage(action.result,true)?action.result:undefined;
 const review=action.reconciliation&&action.reconciliation.basis==='user-reviewed-observation'&&ownsPage(action.reconciliation.observation,false)&&action.status===({completed:'observed','not-completed':'failed',uncertain:'uncertain'} as const)[action.reconciliation.outcome]?action.reconciliation:undefined;
 const reviewLabel=review&&({completed:'You reported that the action completed.','not-completed':'You reported that the action did not complete.',uncertain:'Your review left the outcome uncertain.'} as const)[review.outcome];
 return <details className="browser-action-evidence">
  <summary>Compare saved action evidence</summary>
  <p className="tiny">Saved evidence may be out of date. Only stored text is shown; it may not include the whole page. A response status or an observed page does not verify the website effect. Opening this comparison does not inspect a page, retry an action, or change its outcome.</p>
  <div className="browser-evidence-comparison">
   <section aria-label="Original action evidence">
    <h4>Original action</h4>
    {receipt?<><p>Recorded response status: {receipt.status}</p><p className="break">{receipt.url}</p><small>This is the stored page excerpt associated with the response, not the full network response.</small>{receipt.body?<div className="browser-evidence-text" role="region" aria-label="Saved receipt page excerpt" tabIndex={0}>{receipt.body}</div>:<p>No page text was retained with this receipt.</p>}</>:<p>{action.receipt?'The saved response receipt could not be matched to this website. It is not shown.':'No website response receipt was saved for this action. A missing receipt does not establish whether the website changed.'}</p>}
    <h5>Page read after the action</h5>
    {result?<><p className="break">{result.url}</p>{result.text?<div className="browser-evidence-text" role="region" aria-label="Saved post-action page text" tabIndex={0}>{result.text}</div>:<p>This saved page observation contains no text.</p>}</>:<p>{action.result?'The saved post-action page could not be matched to this task, browser and website. It is not shown.':'No post-action page observation was saved. This is missing evidence, not an empty page.'}</p>}
   </section>
   <section aria-label="Later outcome review">
    <h4>Reviewed page</h4>
    {review?<><p>{reviewLabel}</p><p className="break">{review.observation.url}</p><small>This page was read later in a separate inspection. It is saved history, not a live view or automatic verification.</small>{review.observation.text?<div className="browser-evidence-text" role="region" aria-label="Saved reviewed page text" tabIndex={0}>{review.observation.text}</div>:<p>This reviewed page observation contains no text.</p>}<p className="browser-evidence-note">{review.note}</p></>:<p>{action.reconciliation?'The saved review could not be matched to this action’s current outcome. It is not shown.':'No later outcome review is saved for this action.'}</p>}
   </section>
  </div>
 </details>;
}
