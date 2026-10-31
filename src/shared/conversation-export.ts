import {Schema} from 'effect';
import type {Task,SourceRef} from '../core/types';
import {withoutEmbeddedImageData} from './saved-work-search-text';
import {publicErrorMessage} from './public-messages';

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const preview=Schema.Struct({type:Schema.Literal('conversation.export.preview'),taskId:id,format:Schema.Literal('markdown','json'),includeSourceText:Schema.Boolean});
const save=Schema.Struct({type:Schema.Literal('conversation.export.save'),taskId:id,snapshotId:id,confirmed:Schema.Literal('reviewed-conversation-export')});
export type ConversationExportCommand=typeof preview.Type|typeof save.Type;
export const readConversationExportCommand=(value:unknown):ConversationExportCommand=>Schema.decodeUnknownSync(Schema.Union(preview,save),{onExcessProperty:'error'})(value);
export type ConversationExportFormat=typeof preview.Type.format;
export interface ConversationExportPreview {
 snapshotId:string;taskId:string;title:string;capturedAt:string;format:ConversationExportFormat;includeSourceText:boolean;
 byteLength:number;requestCount:number;revisionCount:number;incompleteCount:number;body:string;
}
export type ConversationExportSaved={kind:'saved';taskId:string;snapshotId:string;path:string;byteLength:number}|{kind:'cancelled';taskId:string;snapshotId:string};

/** Only rendered image destinations are removed; literal code and ordinary Unicode remain exact. */
function visibleText(content:string){const normalized=content.replace(/\r\n?/g,'\n'),clean=withoutEmbeddedImageData(normalized);return clean===normalized?content:clean??'[Text omitted: embedded image data could not be safely separated.]';}
const reference=(task:Task,ref:SourceRef)=>{const source=task.sources.find(item=>item.id===ref.sourceId),version=source?.versions.find(item=>item.version===ref.version&&item.digest===ref.digest);return {sourceId:ref.sourceId,version:ref.version,...(version?{label:version.label,kind:version.kind,capturedAt:version.capturedAt}:{unavailable:true})};};
const block=(value:string,language='text')=>{let longest=2;for(const match of value.matchAll(/`+/g))longest=Math.max(longest,match[0].length);const fence='`'.repeat(longest+1);return `${fence}${language}\n${value}\n${fence}`;};

/** An allowlisted historical projection, never a serialized Task or provider/session record. */
export function conversationSnapshot(task:Task,capturedAt:string,includeSourceText:boolean){
 const artifacts=task.artifacts.map(artifact=>({artifactId:artifact.id,revisions:artifact.revisions.map(revision=>({
  revision:revision.revision,title:visibleText(revision.title),mimeType:revision.mimeType,createdAt:revision.createdAt,
  citations:revision.sourceRefs.map(ref=>reference(task,ref)),
  ...((revision.encoding==='base64'||revision.mimeType.startsWith('image/'))?{omitted:'Image or binary body excluded from conversation export.'}:{content:visibleText(revision.content)}),
 }))}));
 const requests=task.requests.map(request=>{
  const recorded=request.answer,owners=recorded?task.artifacts.filter(artifact=>artifact.id===recorded.artifactId):[],matches=recorded&&owners.length===1?owners[0].revisions.filter(revision=>revision.revision===recorded.revision):[];
  const verified=request.status==='completed'&&recorded&&(!request.artifactId||request.artifactId===recorded.artifactId)&&matches.length===1&&matches[0].digest===recorded.digest;
  return {
  requestId:request.id,kind:request.kind,question:visibleText(request.prompt),status:request.status,startedAt:request.startedAt,
  ...(request.finishedAt?{finishedAt:request.finishedAt}:{}),citations:request.sourceRefs.map(ref=>reference(task,ref)),
  answer:verified&&recorded?{artifactId:recorded.artifactId,revision:recorded.revision}:undefined,
  associatedArtifactId:request.artifactId??recorded?.artifactId,
  answerUnavailable:!verified&&(request.status==='completed'||recorded)?'The original answer is unavailable: an exact saved revision and digest could not be verified.':undefined,
  ...(request.error?{error:publicErrorMessage(request.error)}:{}),
  ...(request.status==='completed'?{}:{incomplete:request.status==='running'?'In progress at snapshot time. Live streamed text is not yet saved and is excluded.':'No completed answer was saved for this request.'}),
 };});
 const sourceText=includeSourceText?task.sources.flatMap(source=>source.versions.filter(version=>version.kind==='text').map(version=>({sourceId:source.id,version:version.version,label:visibleText(version.label),capturedAt:version.capturedAt,content:visibleText(version.content)}))):[];
 return {schemaVersion:1,kind:'glint-conversation-export',capturedAt,
  scope:{includeSourceText,description:'One saved task conversation at the snapshot time. Includes recorded questions, request outcomes, all saved artifact revisions, citations, Activity notes, saved procedures, local follow-up records and the local unsent draft. Queued and held follow-ups are unsent; cancelled follow-ups were not dispatched. Only dispatched follow-ups link to a recorded request. Image/binary bodies, browser observations, provider/account records, credentials, permissions and grants, project instructions and unrelated tasks are excluded. Live streamed text that has not been saved is excluded. Text source bodies are included only when explicitly selected.'},
  task:{taskId:task.id,title:visibleText(task.title),goal:visibleText(task.goal),status:task.status,archived:!!task.archive,createdAt:task.createdAt,updatedAt:task.updatedAt},requests,artifacts,
  notes:task.checkpoints.map(note=>({noteId:note.id,createdAt:note.createdAt,text:visibleText(note.note),citations:note.sourceRefs.map(ref=>reference(task,ref)),artifacts:note.artifacts.map(ref=>({artifactId:ref.artifactId,revision:ref.revision}))})),
  procedures:task.procedures.map(procedure=>({procedureId:procedure.id,revisions:procedure.revisions.map(revision=>({revision:revision.revision,title:visibleText(revision.title),createdAt:revision.createdAt,steps:revision.steps.map(step=>({intent:visibleText(step.intent),target:visibleText(step.target),preconditions:step.preconditions.map(condition=>({key:visibleText(condition.key),equals:visibleText(condition.equals)})),expectedResult:visibleText(step.expectedResult)})),citations:revision.sourceRefs.map(ref=>reference(task,ref))}))})),
  followups:(task.session?.queuedFollowups??[]).map(item=>({id:item.id,revision:item.revision,prompt:visibleText(item.prompt),kind:item.kind,createdAt:item.createdAt,status:item.status,...(item.reason?{reason:visibleText(item.reason)}:{}),...(item.status==='dispatched'?{dispatchedRequestId:item.dispatchedRequestId}:{}),citations:item.sourceRefs.map(ref=>reference(task,ref))})),
  unsentDraft:task.session?.draft?{status:'unsent',text:visibleText(task.session.draft),kind:task.session.draftKind??'explain'}:null,sourceText,
 };
}
export type ConversationSnapshot=ReturnType<typeof conversationSnapshot>;
export function conversationMarkdown(snapshot:ConversationSnapshot):string{
 const parts=['# Conversation transcript',block(snapshot.task.title),`Snapshot: ${snapshot.capturedAt}\n\nTask ID: ${snapshot.task.taskId}\n\nTask status: ${snapshot.task.status}${snapshot.task.archived?' · Archived':''}\n\nCreated: ${snapshot.task.createdAt}\n\nLast saved change: ${snapshot.task.updatedAt}`,'## Export scope',snapshot.scope.description,`Text source bodies: ${snapshot.scope.includeSourceText?'Included by explicit selection':'Excluded'}`,'## Saved task goal',block(snapshot.task.goal),'## Recorded conversation'];
 if(!snapshot.requests.length)parts.push('No recorded requests.');
 for(const [index,request]of snapshot.requests.entries()){
  parts.push(`### ${index+1}. Question · ${request.startedAt}`,`Request ID: ${request.requestId}\n\nKind: ${request.kind}\n\nStatus: ${request.status}${request.finishedAt?'\n\nFinished: '+request.finishedAt:''}`,block(request.question));
  if(request.incomplete)parts.push(request.incomplete);if(request.error)parts.push('Outcome: '+request.error);
  if(request.answerUnavailable)parts.push(request.answerUnavailable);if(request.associatedArtifactId&&!request.answer)parts.push('Associated artifact (historical): '+request.associatedArtifactId);
  if(request.citations.length)parts.push('Citations:\n\n'+block(JSON.stringify(request.citations,null,2),'json'));
  const answerRef=request.answer;if(answerRef){const answer=snapshot.artifacts.find(item=>item.artifactId===answerRef.artifactId)?.revisions.find(item=>item.revision===answerRef.revision);parts.push(`#### Original saved answer · Revision ${answerRef.revision}`,`Artifact ID: ${answerRef.artifactId}`);if(answer){parts.push(block(answer.title),`Saved: ${answer.createdAt}`,'content'in answer?block(answer.content,answer.mimeType==='text/markdown'?'markdown':answer.mimeType.includes('json')?'json':'text'):answer.omitted);if(answer.citations.length)parts.push('Answer citations:\n\n'+block(JSON.stringify(answer.citations,null,2),'json'));}else parts.push('The recorded answer revision is unavailable in this snapshot.');}
 }
 parts.push('## Saved artifact revisions');if(!snapshot.artifacts.length)parts.push('No saved artifacts.');
 for(const artifact of snapshot.artifacts)for(const revision of artifact.revisions){parts.push(`### ${artifact.artifactId} · Revision ${revision.revision}`,block(revision.title),`Saved: ${revision.createdAt}\n\nFormat: ${revision.mimeType}`);parts.push('content'in revision?block(revision.content,revision.mimeType==='text/markdown'?'markdown':revision.mimeType.includes('json')?'json':'text'):revision.omitted);if(revision.citations.length)parts.push('Citations:\n\n'+block(JSON.stringify(revision.citations,null,2),'json'));}
 parts.push('## Activity notes');for(const note of snapshot.notes)parts.push(`### ${note.createdAt} · ${note.noteId}`,block(note.text),block(JSON.stringify({citations:note.citations,artifacts:note.artifacts},null,2),'json'));if(!snapshot.notes.length)parts.push('No saved notes.');
 parts.push('## Saved procedures');for(const procedure of snapshot.procedures)parts.push(block(JSON.stringify(procedure,null,2),'json'));if(!snapshot.procedures.length)parts.push('No saved procedures.');
 parts.push('## Local follow-up records','Queued and held entries have not been sent. Cancelled entries were not dispatched. A dispatched entry links to its recorded request above.');for(const [index,item]of snapshot.followups.entries())parts.push(`### ${index+1}. Follow-up · ${item.createdAt}`,`Follow-up ID: ${item.id}\n\nStatus: ${item.status}\n\nKind: ${item.kind}\n\nSaved generation: ${item.revision}${item.dispatchedRequestId?'\n\nRecorded request: '+item.dispatchedRequestId:''}`,block(item.prompt),...(item.reason?['Reason: '+item.reason]:[]),...(item.citations.length?['Citations:\n\n'+block(JSON.stringify(item.citations,null,2),'json')]:[]));if(!snapshot.followups.length)parts.push('No saved follow-ups.');
 parts.push('## Local unsent draft',snapshot.unsentDraft?`Status: unsent · ${snapshot.unsentDraft.kind}\n\n${block(snapshot.unsentDraft.text)}`:'No saved unsent draft.');
 if(snapshot.scope.includeSourceText){parts.push('## Explicitly included text source versions');for(const source of snapshot.sourceText)parts.push(`### ${source.sourceId} · Version ${source.version}`,block(source.label),`Captured: ${source.capturedAt}`,block(source.content));}
 return parts.join('\n\n')+'\n';
}
export function conversationExportBody(snapshot:ConversationSnapshot,format:ConversationExportFormat){return format==='markdown'?conversationMarkdown(snapshot):JSON.stringify(snapshot,null,2)+'\n';}
