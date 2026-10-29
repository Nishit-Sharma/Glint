import type {RequestRecord,SourceRef,Task} from '../core/types';

export type RequestFollowupSelection={taskId:string;requestId:string;digest:string};
export type RequestFollowupCommand={readonly type:'model.run';readonly taskId:string;readonly requestId:string;readonly kind:'explain'|'create';readonly prompt:string;readonly sourceIds:readonly string[];readonly expectedSourceRefs:readonly Readonly<SourceRef>[]};
export type RequestFollowupValue={prompt:string;sourceIds:readonly string[]};
export const FOLLOWUP_PROMPT_LIMIT=16_000;
export function canPrepareRequestFollowup(request:RequestRecord){return (request.status==='failed'||request.status==='cancelled')&&(request.kind==='explain'||request.kind==='create')&&!request.targetArtifactId;}

/** Only saved plain-text context can be explicitly selected. No old approval or browser action is replayed. */
export function reviewRequestFollowup(task:Task,selection:RequestFollowupSelection){
 if(task.id!==selection.taskId)throw Error('Choose the question in its original task.');
 const request=task.requests.find(request=>request.id===selection.requestId);
 if(!request||request.digest!==selection.digest||!canPrepareRequestFollowup(request))throw Error('This exact failed or stopped text question is no longer available.');
 const kind=request.kind as 'explain'|'create';
 const sources=request.sourceRefs.map(ref=>{
  const source=task.sources.find(source=>source.id===ref.sourceId),original=source?.versions.find(version=>version.version===ref.version&&version.digest===ref.digest),current=source?.versions.find(version=>version.version===source.currentVersion);
  const label=original?.label??'Unavailable source',reason=!source||!original?'Original snapshot unavailable':original.kind!=='text'?'Window and image sources require their normal current-source flow':source.freshness!=='fresh'?'Refresh required':!current||current.version!==ref.version||current.digest!==ref.digest?'Changed since the earlier request':'Current exact pasted-text snapshot';
  const eligible=!!source&&!!original&&original.kind==='text'&&source.freshness==='fresh'&&current?.version===ref.version&&current.digest===ref.digest;
  return {ref:{...ref},label,reason,eligible,...(original?.kind==='text'?{text:original.content}:{})};
 });
 return {request,kind,sources};
}
export function prepareRequestFollowup(task:Task,selection:RequestFollowupSelection,value:RequestFollowupValue,requestId:string):RequestFollowupCommand{
 const review=reviewRequestFollowup(task,selection),prompt=value.prompt.trim();
 if(task.status!=='active')throw Error('Resume this task before sending a new question.');
 if(!prompt||prompt.length>FOLLOWUP_PROMPT_LIMIT||prompt.includes('\0'))throw Error('Enter a question of 1–16,000 characters without unsupported characters.');
 if(!requestId||requestId.length>200||requestId.includes('\0'))throw Error('This new request identity is unavailable. Close and reopen the review.');
 if(!Array.isArray(value.sourceIds)||new Set(value.sourceIds).size!==value.sourceIds.length)throw Error('Review each selected source once.');
 const refs=value.sourceIds.map(id=>{const source=review.sources.find(source=>source.ref.sourceId===id);if(!source?.eligible)throw Error('A selected source changed or is unavailable. Close this review and check Context before sending.');return Object.freeze({...source.ref});});
 return Object.freeze({type:'model.run' as const,taskId:task.id,requestId,kind:review.kind,prompt,sourceIds:Object.freeze([...value.sourceIds]),expectedSourceRefs:Object.freeze(refs)});
}
/** Receipt lookup is a local read. It never authorizes another transmission. */
export function readRequestFollowupOutcome(task:Task,command:RequestFollowupCommand):RequestRecord|undefined{
 if(task.id!==command.taskId)throw Error('This saved request belongs to another task.');
 const request=task.requests.find(request=>request.id===command.requestId);if(!request)return;
 if(request.kind!==command.kind||request.prompt!==command.prompt||request.targetArtifactId||request.sourceRefs.length!==command.expectedSourceRefs.length||new Set(request.sourceRefs.map(ref=>ref.sourceId)).size!==request.sourceRefs.length||request.sourceRefs.some(ref=>!command.expectedSourceRefs.some(expected=>expected.sourceId===ref.sourceId&&expected.version===ref.version&&expected.digest===ref.digest)))throw Error('The saved request does not match this exact reviewed question. Review Activity before sending anything else.');
 return request;
}
