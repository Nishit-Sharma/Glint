import {Schema} from 'effect';
import type {Task} from './types';
import {readTaskArtifactText} from './task-dialogue';
import {RESPONSE_BRANCH_IMAGE_LIMIT} from '../shared/public-messages';
import {LOCAL_TASK_CONTENT_LIMIT} from '../shared/local-task-start';

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const inputSchema=Schema.Struct({taskId:id,requestId:id,answer:Schema.Struct({artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))}),title:id,expectedSnapshot:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(LOCAL_TASK_CONTENT_LIMIT),Schema.filter(value=>!value.includes('\0')))});
export type ResponseBranchInput=typeof inputSchema.Type;
export type ResponseBranchSelection=Pick<ResponseBranchInput,'taskId'|'requestId'|'answer'>;
export function readResponseBranchInput(input:unknown):ResponseBranchInput{return Schema.decodeUnknownSync(inputSchema,{onExcessProperty:'error'})(input);}
export const responseBranchTitle=(task:Task)=>('Branch: '+task.title).slice(0,200).replace(/[\uD800-\uDBFF]$/u,'');

function refuseImageData(text:string){if(/data\s*:\s*image\s*\//i.test(text))throw Error(RESPONSE_BRANCH_IMAGE_LIMIT);}

/** A reviewable text copy, not inherited source, browser, helper or execution authority. */
export function responseBranchSnapshot(task:Task,selection:ResponseBranchSelection){
 if(task.id!==selection.taskId)throw Error('Choose a response in its original task.');
 const index=task.requests.findIndex(request=>request.id===selection.requestId),request=task.requests[index],ref=request?.answer;
 if(!request||request.status!=='completed'||!ref||ref.artifactId!==selection.answer.artifactId||ref.revision!==selection.answer.revision||ref.digest!==selection.answer.digest)throw Error('This exact completed response is no longer available.');
 const selected=task.artifacts.find(artifact=>artifact.id===ref.artifactId)?.revisions.find(revision=>revision.revision===ref.revision&&revision.digest===ref.digest);
 if(!selected||!selected.mimeType.startsWith('text/')||selected.encoding==='base64')throw Error('Start a branch from a saved text response. Interactive answers and images are not copied.');
 refuseImageData(task.title);
 const omissions=['Unsent drafts, linked source bodies, images, interactive/module state and later messages are not copied.','Browser sessions, action receipts, pending operations, approvals and live window access are not copied.','Original source citations are copied text only; they do not link original sources to the new task.'];
 const turns=task.requests.slice(0,index+1).map((turn,i)=>{
  refuseImageData(turn.prompt);
  let answer='[No completed readable text response copied.]';const ref=turn.answer,saved=ref&&task.artifacts.find(artifact=>artifact.id===ref.artifactId)?.revisions.find(revision=>revision.revision===ref.revision&&revision.digest===ref.digest);
  if(turn.status==='completed'&&ref&&saved?.mimeType.startsWith('text/')&&saved.encoding!=='base64'){
   refuseImageData(saved.content);
   const readable=readTaskArtifactText(task,ref.artifactId,ref.revision);if(readable.available)answer=readable.text;else omissions.push(`Turn ${i+1}: its saved response is unavailable.`);
  }else omissions.push(`Turn ${i+1}: ${turn.status==='completed'?'no supported exact text response':'the request did not complete'}; its response is omitted.`);
  return `## Turn ${i+1} · ${turn.kind==='brief'?'Saved insight request':'Saved user request'} (${turn.status})\n\n${turn.prompt}\n\n### Saved response\n\n${answer}`;
 });
 const content=['# Copied conversation context','This is a historical conversation copy, not independently verified facts. It grants no approvals or live access.',`Original task: ${task.title}\nOriginal task ID: ${task.id}\nThrough request: ${request.id}\nExact response: ${ref.artifactId} revision ${ref.revision}, digest ${ref.digest}`,'## What is not copied\n\n'+omissions.map(value=>'- '+value).join('\n'),...turns].join('\n\n');
 refuseImageData(content);
 if(content.length>LOCAL_TASK_CONTENT_LIMIT)throw Error('This conversation context exceeds 100,000 characters. Choose an earlier response or copy a smaller portion into a new task.');
 return {content,omissions,turns:turns.length};
}
