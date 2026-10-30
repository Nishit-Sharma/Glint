import {Schema} from 'effect';
import type {RequestRecord,Task} from '../core/types';

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const previousSchema=Schema.Struct({requestId:id,digest:id,binding:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(100_000),Schema.filter(value=>!value.includes('\0')))});
const inputSchema=Schema.Struct({taskId:id,requestId:id,previous:previousSchema,prompt:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(16_000),Schema.filter(value=>!value.includes('\0')&&value.trim()===value)),url:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(1200),Schema.filter(value=>{try{return pageAddress(value).href===value;}catch{return false;}}))});
const hash=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
export const BrowserContinuationReceiptSchema=Schema.Struct({previousRequestId:id,previousDigest:id,bindingDigest:hash,startPageDigest:hash,promptDigest:hash});
export type BrowserContinuationReceipt=typeof BrowserContinuationReceiptSchema.Type;
export const readBrowserContinuationReceipt=(value:unknown)=>Schema.decodeUnknownSync(BrowserContinuationReceiptSchema,{onExcessProperty:'error'})(value);
export type BrowserContinuationInput=typeof inputSchema.Type;
export const BrowserContinuationAttemptSchema=Schema.Struct({input:inputSchema,phase:Schema.Literal('prepared','submitted')});
export type BrowserContinuationAttempt=typeof BrowserContinuationAttemptSchema.Type;
export type BrowserContinuationRelease={kind:'retired-unstarted'|'cleared-terminal';task:Task;taskId:string;requestId:string;receipt:BrowserContinuationReceipt};
export type BrowserContinuationCommand=BrowserContinuationInput&{readonly type:'browser.continue'};
export type BrowserContinuationSelection={taskId:string;requestId:string;digest:string};
export const readBrowserContinuationInput=(value:unknown)=>Schema.decodeUnknownSync(inputSchema,{onExcessProperty:'error'})(value);
export const BROWSER_CONTINUATION_CHANGED='The saved browser work changed. Close this review and choose the current request again.';
export const BROWSER_CONTINUATION_UNCERTAIN='Inspect and resolve the earlier uncertain actions on this website before starting remaining browser work.';
const unavailable=()=>Error(BROWSER_CONTINUATION_CHANGED);
function pageAddress(value:string){try{const url=new URL(value);if(url.username||url.password||url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='127.0.0.1'))throw Error();return url;}catch{throw Error('Choose a same-site HTTPS starting page without sign-in details.');}}
export function pendingBrowserContinuation(task:Task):BrowserContinuationAttempt|undefined{
 const raw=task.session?.browserContinuationAttempt;if(raw===undefined)return;
 const attempt=Schema.decodeUnknownSync(BrowserContinuationAttemptSchema,{onExcessProperty:'error'})(raw);
 if(attempt.input.taskId!==task.id||attempt.input.requestId===attempt.input.previous.requestId||pageAddress(attempt.input.url).href!==attempt.input.url||attempt.input.prompt.trim()!==attempt.input.prompt)throw unavailable();
 return attempt;
}
export const sameBrowserContinuationInput=(a:BrowserContinuationInput,b:BrowserContinuationInput|BrowserContinuationCommand)=>{
 const input='type' in b&&b.type==='browser.continue'?(({type,...value})=>value)(b):b;
 return JSON.stringify(readBrowserContinuationInput(a))===JSON.stringify(readBrowserContinuationInput(input));
};
export function canPrepareBrowserContinuation(task:Task,request:RequestRecord){return request.kind==='browser'&&request.status!=='running'&&task.session?.runs.some(run=>run.id===request.id&&run.initialObservation.taskId===task.id);}

/** Saved history is a review basis, never a restored execution point or approval. */
export function reviewBrowserContinuation(task:Task,selection:BrowserContinuationSelection){
 if(task.id!==selection.taskId)throw unavailable();
 const requests=task.requests.filter(request=>request.id===selection.requestId),runs=task.session?.runs.filter(run=>run.id===selection.requestId)??[];
 if(requests.length!==1||runs.length!==1||requests[0].digest!==selection.digest||!canPrepareBrowserContinuation(task,requests[0]))throw unavailable();
 const request=requests[0],run=runs[0],initial=run.initialObservation;
 let origin:URL;try{origin=pageAddress(run.origin);if(origin.origin!==run.origin||pageAddress(initial.url).origin!==run.origin)throw unavailable();}catch{throw unavailable();}
 if(initial.taskId!==task.id||initial.browserId!==run.browserId||new Set(run.operations.map(operation=>operation.id)).size!==run.operations.length)throw unavailable();
 for(const operation of run.operations){
  const result=operation.result,review=operation.reconciliation;
  try{if(result&&(result.taskId!==task.id||result.browserId!==run.browserId||pageAddress(result.url).origin!==run.origin)||operation.receipt&&pageAddress(operation.receipt.url).origin!==run.origin||review&&(review.basis!=='user-reviewed-observation'||review.observation.taskId!==task.id||pageAddress(review.observation.url).origin!==run.origin||operation.status!==({completed:'observed','not-completed':'failed',uncertain:'uncertain'} as const)[review.outcome]))throw unavailable();}catch{throw unavailable();}
 }
 const reference=(page:typeof initial)=>({id:page.id,digest:page.digest,taskId:page.taskId,browserId:page.browserId,documentId:page.documentId,url:page.url});
 const binding=JSON.stringify({request:{id:request.id,digest:request.digest,status:request.status},run:{id:run.id,endpointKey:run.endpointKey,origin:run.origin,browserId:run.browserId,initial:reference(initial),operations:run.operations.map(operation=>({id:operation.id,intent:operation.intent,status:operation.status,...(operation.result?{result:reference(operation.result)}:{}),...(operation.receipt?{receipt:{status:operation.receipt.status,url:operation.receipt.url}}:{}),...(operation.reconciliation?{review:{id:operation.reconciliation.id,outcome:operation.reconciliation.outcome,basis:operation.reconciliation.basis,note:operation.reconciliation.note,observation:reference(operation.reconciliation.observation)}}:{})}))}});
 if(binding.length>100_000||binding.includes('\0'))throw unavailable();
 const candidates=[...run.operations].reverse().flatMap(operation=>[operation.reconciliation?.observation.url,operation.result?.url]).concat([initial.url,origin.href]);
 const url=candidates.find(value=>{try{return !!value&&value.length<=1200&&pageAddress(value).origin===run.origin;}catch{return false;}})??origin.href;
 const uncertain=(task.session?.runs??[]).filter(run=>run.origin===origin.origin).reduce((count,run)=>count+run.operations.filter(operation=>operation.status==='uncertain'||operation.status==='executing').length,0);
 return {request,origin:origin.origin,url,binding,uncertain,observedSteps:run.operations.filter(operation=>operation.status==='observed').length,stoppedSteps:run.operations.filter(operation=>operation.status==='failed'||operation.status==='retired').length};
}

export function prepareBrowserContinuation(task:Task,selection:BrowserContinuationSelection,value:{prompt:string;url:string},requestId:string,expectedBinding:string):BrowserContinuationCommand{
 const review=reviewBrowserContinuation(task,selection);
 if(review.binding!==expectedBinding)throw unavailable();
 if(task.status!=='active')throw Error('Resume this task before starting remaining browser work.');
 if(review.uncertain)throw Error(BROWSER_CONTINUATION_UNCERTAIN);
 if(task.requests.some(request=>request.status==='running'&&request.id!==requestId))throw Error('Wait for the current request to finish before planning remaining browser work.');
 const prompt=value.prompt.trim(),url=pageAddress(value.url.trim());
 if(url.origin!==review.origin)throw Error('Choose a starting page on the original website.');
 if(requestId===selection.requestId)throw Error('Remaining browser work needs a new request identity.');
 const input=readBrowserContinuationInput({taskId:task.id,requestId,previous:{requestId:selection.requestId,digest:selection.digest,binding:expectedBinding},prompt,url:url.href});
 const pending=pendingBrowserContinuation(task);if(pending&&!sameBrowserContinuationInput(pending.input,input))throw Error('A saved remaining-work attempt needs checking before a new continuation can be prepared.');
 return Object.freeze({type:'browser.continue' as const,...input,previous:Object.freeze({...input.previous})});
}

/** A local status read only. No missing receipt grants resend authority. */
async function textDigest(value:string){const bytes=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');}
export async function browserContinuationReceipt(input:BrowserContinuationInput):Promise<BrowserContinuationReceipt>{return {previousRequestId:input.previous.requestId,previousDigest:input.previous.digest,bindingDigest:await textDigest(input.previous.binding),startPageDigest:await textDigest(input.url),promptDigest:await textDigest(input.prompt)};}
export async function readBrowserContinuationOutcome(task:Task,command:BrowserContinuationCommand):Promise<RequestRecord|undefined>{
 if(task.id!==command.taskId)throw unavailable();
 const matches=task.requests.filter(request=>request.id===command.requestId);if(!matches.length)return;
 const request=matches[0],origin=pageAddress(command.url).origin,runs=task.session?.runs.filter(run=>run.id===command.requestId)??[];
 const expected=await browserContinuationReceipt(command);let receipt:BrowserContinuationReceipt|undefined;try{receipt=readBrowserContinuationReceipt(request.browserContinuation);}catch{/* Missing or unrecognized receipts stay unconfirmed. */}
 if(!receipt||Object.keys(expected).some(key=>receipt![key as keyof BrowserContinuationReceipt]!==expected[key as keyof BrowserContinuationReceipt])||matches.length!==1||request.kind!=='browser'||request.prompt!==command.prompt||request.sourceRefs.length||request.targetArtifactId||request.browserStart&&request.browserStart.origin!==origin||runs.length>1||runs.some(run=>run.origin!==origin||run.initialObservation.taskId!==task.id||run.initialObservation.browserId!==run.browserId))throw Error('The saved request does not match this exact remaining-work attempt. Review the task before any new action.');
 return request;
}
