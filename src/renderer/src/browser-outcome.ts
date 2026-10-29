import type {RequestRecord,Task} from '../../core/types';
import type {TaskSession} from '../../core/task-session';

type BrowserRun=TaskSession['runs'][number];
type BrowserOperation=BrowserRun['operations'][number];
const operationLabels={proposed:'Waiting for review',executing:'In progress',observed:'Observed',uncertain:'Outcome needs review',failed:'Stopped',retired:'Not run'};

/** Suggest a saved same-site page, without treating it as evidence of the outcome. */
export function browserInspectionStartUrl(run:BrowserRun,operationId:string):string{
 const index=run.operations.findIndex(operation=>operation.id===operationId);if(index<0)return '';
 let origin:URL;
 try{origin=new URL(run.origin);}catch{return '';}
 if(origin.origin!==run.origin||origin.username||origin.password||!['https:','http:'].includes(origin.protocol)||(origin.protocol==='http:'&&origin.hostname!=='127.0.0.1'))return '';
 const action=run.operations[index],prior=run.operations.slice(0,index).reverse().flatMap(operation=>operation.result?[operation.result]:[]);
 const observations=[...(action.result?[action.result]:[]),...prior,run.initialObservation].filter(observation=>observation.browserId===run.browserId&&observation.taskId===run.initialObservation.taskId);
 for(const value of [action.receipt?.url,...observations.map(observation=>observation.url),origin.href]){
  if(!value)continue;
  try{const url=new URL(value);if(url.protocol===origin.protocol&&url.origin===origin.origin&&!url.username&&!url.password)return url.href;}catch{/* Try an earlier saved page. */}
 }
 return '';
}

export function browserOperationOutcome(operation:BrowserOperation){
 const reviewed=operation.reconciliation?.outcome;
 return {label:operation.status==='uncertain'?operationLabels.uncertain:reviewed==='completed'?'Reviewed as completed':reviewed==='not-completed'?'Reviewed as not completed':operationLabels[operation.status],needsReview:operation.status==='uncertain'};
}

/** A later human review settles its action, not every step or the model response. */
export function browserRequestOutcome(task:Task,request:RequestRecord){
 const run=request.kind==='browser'?task.session?.runs.find(run=>run.id===request.id):undefined;
 if(!run)return request.kind==='browser'&&request.status!=='running'&&/not authorized.*nothing was sent/i.test(request.error??'')?{label:'Not authorized',message:'This browser request was not authorized. Nothing was sent.',needsReview:false,reviewed:false}:undefined;
 const unknown=run.operations.filter(operation=>browserOperationOutcome(operation).needsReview).length;
 const completed=run.operations.filter(operation=>operation.status==='observed'&&operation.reconciliation?.outcome==='completed').length;
 const notCompleted=run.operations.filter(operation=>operation.status==='failed'&&operation.reconciliation?.outcome==='not-completed').length;
 const otherIncomplete=run.operations.some(operation=>['failed','retired','proposed','executing'].includes(operation.status)&&!operation.reconciliation);
 const reviewed=completed+notCompleted>0;
 const last=run.operations.at(-1),formMismatch=last?.status==='retired'&&last.error==='The intended form values did not match the current page. No submission was offered or executed.';
 const mismatchMessage='The intended form values could not be matched to the current page, so this submission was not offered or run. Review the page and your request before continuing. Earlier steps may have run.';
 if(unknown)return {label:'Outcome needs review',message:`${reviewed?'Some actions have been reviewed. ':''}${unknown===1?'One website action still needs review.':'Some website actions still need review.'} Inspect the outcome before trying another action.`,needsReview:true,reviewed};
 if(!reviewed)return request.status!=='running'&&last?.status==='retired'?{label:'Not run',message:formMismatch?mismatchMessage:'The last browser action was not run. Earlier steps remain in the conversation.',needsReview:false,reviewed:false}:undefined;
 if(request.status==='running')return {label:'Working',message:'Earlier actions were reviewed. This request is still running.',needsReview:false,reviewed};
 if(completed&&!notCompleted&&!otherIncomplete)return {label:'Reviewed as completed',message:'You reviewed a fresh page and reported that the website action completed. This is your review, not automatic verification of the whole request.',needsReview:false,reviewed};
 if(notCompleted&&!completed&&!otherIncomplete)return {label:'Reviewed as not completed',message:'You reviewed a fresh page and reported that the website action did not complete. The earlier action has not been retried.',needsReview:false,reviewed};
 return {label:'Actions partly reviewed',message:formMismatch?`Your fresh-page reviews are recorded. ${mismatchMessage}`:'Your fresh-page reviews are recorded. Other steps did not complete; review the browser steps before continuing.',needsReview:false,reviewed};
}

/** Resolve the response created by this request, including its original revision. */
export function requestArtifact(task:Task,request:RequestRecord){
 const artifact=task.artifacts.find(artifact=>artifact.id===request.artifactId);
 const revision=artifact?.revisions.find(revision=>revision.revision===(request.targetArtifactId?(request.expectedRevision??0)+1:1));
 return artifact&&revision?{artifact:{...artifact,revisions:[revision]},revision}:undefined;
}

/** A denied follow-up does not erase an earlier website effect or its recovery. */
export function earlierBrowserOutcome(task:Task,current:RequestRecord){
 const earlier=task.requests.filter(request=>request.id!==current.id).reverse().map(request=>({request,outcome:browserRequestOutcome(task,request)}));
 return earlier.find(item=>item.outcome?.needsReview)??(current.kind==='browser'&&current.status!=='completed'?earlier.find(item=>item.outcome?.reviewed):undefined);
}
