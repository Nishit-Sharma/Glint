import {Schema} from 'effect';
import type {Task} from '../core/types';
import {BrowserOperationSchema} from '../core/task-session';

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
const save=Schema.Struct({taskId:id,runId:id,operationId:id,binding:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(100000)),confirmed:Schema.Literal('shown-review-notes')});
export type BrowserReviewNotesSave=typeof save.Type;
const saved=Schema.Struct({taskId:id,runId:id,operationId:id,binding:save.fields.binding,artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest,alreadySaved:Schema.Boolean});
export type BrowserReviewNotesSaved=typeof saved.Type;
export const readBrowserReviewNotesSave=(value:unknown)=>Schema.decodeUnknownSync(save,{onExcessProperty:'error'})(value);
export const readBrowserReviewNotesSaved=(value:unknown)=>Schema.decodeUnknownSync(saved,{onExcessProperty:'error'})(value);
export const BROWSER_REVIEW_NOTES_TITLE='Browser review notes';
const invalid=()=>Error('This browser review is unavailable or changed. Open the current review before saving notes.');
function excerpt(value:string){const selected=value.slice(0,2000);return /[\uD800-\uDBFF]$/.test(selected)?selected.slice(0,-1):selected;}
function block(value:string){const size=Math.max(2,...Array.from(value.matchAll(/`+/g),match=>match[0].length))+1,fence='`'.repeat(size);return `${fence}text\n${value}\n${fence}`;}

/** The displayed selection is the entire payload; targets, hidden fields and omitted page text are never copied. */
export function browserReviewNotesPreview(task:Task,runId:string,operationId:string){
 const requests=task.requests.filter(request=>request.id===runId&&request.kind==='browser'),runs=task.session?.runs.filter(run=>run.id===runId)??[];
 if(requests.length!==1||runs.length!==1)throw invalid();
 const run=runs[0],operations=run.operations.filter(operation=>operation.id===operationId);if(operations.length!==1||run.initialObservation.taskId!==task.id||run.initialObservation.browserId!==run.browserId)throw invalid();
 let operation:typeof BrowserOperationSchema.Type;try{operation=Schema.decodeUnknownSync(BrowserOperationSchema,{onExcessProperty:'error'})(operations[0]);}catch{throw invalid();}
 const review=operation.reconciliation;if(!review||review.basis!=='user-reviewed-observation'||review.observation.taskId!==task.id||operation.status!==({completed:'observed','not-completed':'failed',uncertain:'uncertain'} as const)[review.outcome])throw invalid();
 let page:URL,origin:URL;try{page=new URL(review.observation.url);origin=new URL(run.origin);}catch{throw invalid();}
 if(origin.origin!==run.origin||page.origin!==run.origin||page.username||page.password||!['https:','http:'].includes(page.protocol)||(page.protocol==='http:'&&page.hostname!=='127.0.0.1')||review.observation.url.length>4096)throw invalid();
 const selection={taskId:task.id,runId,operationId,reviewId:review.id,observationId:review.observation.id,observationDigest:review.observation.digest,outcome:review.outcome,url:review.observation.url,action:excerpt(operation.reason),note:excerpt(review.note),pageText:excerpt(review.observation.text),actionLength:operation.reason.length,noteLength:review.note.length,pageLength:review.observation.text.length};
 if(Object.values(selection).some(value=>typeof value==='string'&&value.includes('\0')))throw invalid();
 const binding=JSON.stringify(selection),outcome={completed:'User reported completed', 'not-completed':'User reported not completed',uncertain:'Still uncertain'}[review.outcome];
 const label=(name:string,value:string,total:number)=>value.length<total?`${name} — first ${value.length} of ${total} characters`:`${name} — complete saved text`;
 const content=`# ${BROWSER_REVIEW_NOTES_TITLE}\n\nAction review: ${outcome}.\n\nThis records a human review of a saved page. It is not automatic verification of the website action or the whole request, and does not retry the action.\n\n## ${label('Earlier action',selection.action,selection.actionLength)}\n\n${block(selection.action)}\n\n## Reviewed page URL\n\n${block(selection.url)}\n\n## ${label('Review note',selection.note,selection.noteLength)}\n\n${block(selection.note)}\n\n## ${label('Saved page text',selection.pageText,selection.pageLength)}\n\n${block(selection.pageText)}\n\nOnly the displayed text was copied. No hidden fields, browser sign-ins or omitted page text were saved in these notes.\n`;
 return {binding,content,outcome,url:selection.url};
}
