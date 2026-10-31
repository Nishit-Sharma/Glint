import type {ArtifactRevision,RequestRecord,Task} from '../core/types';

export interface SavedConversationMessage {
 requestId:string;requestIdentity:string;message:'question'|'answer';text:string;
 answer?:{artifactId:string;revision:ArtifactRevision};
}
/** Bind the recorded turn, including its original answer, independently of later file edits. */
export const savedConversationRequestIdentity=(request:RequestRecord)=>JSON.stringify([request.id,request.kind,request.prompt,request.digest,request.status,request.startedAt,request.finishedAt,request.artifactId,request.targetArtifactId,request.expectedRevision,request.answer]);
export function savedConversationAnswer(task:Task,request:RequestRecord):SavedConversationMessage['answer']{
 if(request.status!=='completed')return;
 const artifacts=task.artifacts.filter(item=>item.id===request.artifactId),artifact=artifacts.length===1?artifacts[0]:undefined;
 const revisions=artifact?.revisions.filter(item=>item.revision===(request.targetArtifactId?(request.expectedRevision??0)+1:1)),revision=revisions?.length===1?revisions[0]:undefined;
 if(!artifact||!revision||!['text/plain','text/markdown'].includes(revision.mimeType)||revision.encoding==='base64')return;
 if(request.answer&&(request.answer.artifactId!==artifact.id||request.answer.revision!==revision.revision||request.answer.digest!==revision.digest))return;
 return {artifactId:artifact.id,revision};
}
export function resolveSavedConversationMessage(task:Task,message:SavedConversationMessage):RequestRecord|undefined{
 const requests=task.requests.filter(item=>item.id===message.requestId),request=requests.length===1?requests[0]:undefined;
 if(!request||request.status==='running'||savedConversationRequestIdentity(request)!==message.requestIdentity)return;
 if(message.message==='question')return request.kind!=='brief'&&request.prompt===message.text&&!message.answer?request:undefined;
 const answer=savedConversationAnswer(task,request);
 return answer&&answer.revision.content===message.text&&JSON.stringify(answer)===JSON.stringify(message.answer)?request:undefined;
}
