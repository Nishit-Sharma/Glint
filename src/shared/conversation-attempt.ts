import {Schema} from 'effect';
import type {ArtifactRef,RequestInput,RequestRecord,SourceRef,Task} from '../core/types';

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
export const ConversationAttemptReceiptSchema=Schema.Struct({mode:Schema.Literal('edit','again'),context:Schema.Literal('preceding-text-turns-current-guidance-v1'),previousRequestId:id,previousDigest:digest,answer:Schema.Struct({artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest})});
export type ConversationAttemptReceipt=typeof ConversationAttemptReceiptSchema.Type;
export type ConversationAttemptSelection={taskId:string;requestId:string;digest:string;answer:ArtifactRef};
export type ConversationAttemptValue={prompt:string;sourceRefs:readonly SourceRef[];mode:'edit'|'again'};
export type ConversationAttemptCommand={type:'model.run';taskId:string;requestId:string;kind:'explain'|'create';prompt:string;sourceIds:string[];expectedSourceRefs:SourceRef[];conversationAttempt:ConversationAttemptReceipt};
export const CONVERSATION_ATTEMPT_PROMPT_LIMIT=16_000;
export function readConversationAttemptReceipt(input:unknown){return Schema.decodeUnknownSync(ConversationAttemptReceiptSchema,{onExcessProperty:'error'})(input);}
export function canAttemptConversation(task:Task,request:RequestRecord){
 const ref=request.answer,revision=ref&&task.artifacts.find(item=>item.id===ref.artifactId)?.revisions.find(item=>item.revision===ref.revision&&item.digest===ref.digest);
 return request.status==='completed'&&(request.kind==='explain'||request.kind==='create')&&!request.targetArtifactId&&!request.browserStart&&!request.browserContinuation&&!!revision&&revision.mimeType.startsWith('text/')&&revision.encoding!=='base64';
}
export function reviewConversationAttempt(task:Task,selection:ConversationAttemptSelection){
 const request=task.requests.find(request=>request.id===selection.requestId);
 if(task.id!==selection.taskId||!request||request.digest!==selection.digest||!canAttemptConversation(task,request)||request.answer?.artifactId!==selection.answer.artifactId||request.answer?.revision!==selection.answer.revision||request.answer?.digest!==selection.answer.digest)throw Error('This exact successful text question and answer are no longer available.');
 return request;
}
export function prepareConversationAttempt(task:Task,selection:ConversationAttemptSelection,value:ConversationAttemptValue,requestId:string):ConversationAttemptCommand{
 const original=reviewConversationAttempt(task,selection),prompt=value.prompt.trim();
 if(task.status!=='active')throw Error('Resume this task before asking again.');
 if(!prompt||prompt.length>CONVERSATION_ATTEMPT_PROMPT_LIMIT||prompt.includes('\0'))throw Error('Enter a question of 1–16,000 characters.');
 if(!requestId||requestId.length>200||requestId.includes('\0')||requestId===original.id)throw Error('This attempt needs a separate request identity.');
 if(value.mode!=='edit'&&value.mode!=='again')throw Error('Choose an edited or unchanged question.');
 if(value.mode==='again'&&prompt!==original.prompt.trim())throw Error('An unchanged attempt must keep the original question.');
 if(!Array.isArray(value.sourceRefs)||value.sourceRefs.length>64||new Set(value.sourceRefs.map(ref=>ref.sourceId)).size!==value.sourceRefs.length)throw Error('Review each selected current source once.');
 const refs=value.sourceRefs.map(ref=>{const source=task.sources.find(source=>source.id===ref.sourceId),version=source?.versions.find(version=>version.version===source.currentVersion);if(!source||source.freshness!=='fresh'||!version||version.version!==ref.version||version.digest!==ref.digest)throw Error('Selected context changed. Keep this draft and review Context before asking again.');return {...ref};});
 const receipt:ConversationAttemptReceipt={mode:value.mode,context:'preceding-text-turns-current-guidance-v1',previousRequestId:original.id,previousDigest:original.digest,answer:{...selection.answer}};
 const command:ConversationAttemptCommand={type:'model.run',taskId:task.id,requestId,kind:original.kind as 'explain'|'create',prompt,sourceIds:refs.map(ref=>ref.sourceId),expectedSourceRefs:refs,conversationAttempt:receipt};
 for(const ref of refs)Object.freeze(ref);Object.freeze(refs);Object.freeze(command.sourceIds);Object.freeze(receipt.answer);Object.freeze(receipt);return Object.freeze(command);
}
export function assertConversationAttempt(task:Task,input:RequestInput){
 const receipt=readConversationAttemptReceipt(input.conversationAttempt);
 if(input.artifactId||input.submittedDraft||input.browserContinuation||input.queuedFollowup||!['explain','create'].includes(input.kind)||input.sourceIds===undefined||input.expectedSourceRefs===undefined)throw Error('A conversation attempt must be a separate ordinary text request.');
 const selection={taskId:task.id,requestId:receipt.previousRequestId,digest:receipt.previousDigest,answer:receipt.answer},command=prepareConversationAttempt(task,selection,{prompt:input.prompt,mode:receipt.mode,sourceRefs:input.expectedSourceRefs},input.requestId);
 if(command.kind!==input.kind||JSON.stringify(command.sourceIds)!==JSON.stringify(input.sourceIds))throw Error('The original request or selected context changed.');
 return receipt;
}
export function readConversationAttemptOutcome(task:Task,command:ConversationAttemptCommand){
 if(task.id!==command.taskId)throw Error('This attempt belongs to another task.');
 const request=task.requests.find(request=>request.id===command.requestId);if(!request)return;
 if(request.kind!==command.kind||request.prompt!==command.prompt||request.targetArtifactId||JSON.stringify(request.conversationAttempt)!==JSON.stringify(command.conversationAttempt)||JSON.stringify(request.sourceRefs)!==JSON.stringify(command.expectedSourceRefs))throw Error('The saved request does not match this exact attempt. Check Activity before sending anything else.');
 return request;
}

const attemptSourceMessage='Selected context changed. Keep your edit and review Context before asking again.';
const attemptMessages=new Map([
 ['Selected source versions changed. Review the current snapshot.',attemptSourceMessage],
 ['Source changed or requires an explicit refresh.',attemptSourceMessage],
 ['Selected context changed. Keep this draft and review Context before asking again.',attemptSourceMessage],
 ['This exact successful text question and answer are no longer available.','This earlier question or answer changed. Keep your edit and choose its saved turn again.'],
]);
export function conversationAttemptPublicMessage(text:string){return attemptMessages.get(text)??([...attemptMessages.values()].includes(text)?text:undefined);}
