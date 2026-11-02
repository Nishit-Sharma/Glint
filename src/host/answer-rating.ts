import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir,open,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Schema} from 'effect';
import type {Task} from '../core/types';
import {isCode} from '../core/store';
import {requestArtifact} from '../renderer/src/browser-outcome';
import {AnswerRatingSavedSchema,answerRatingKey,readAnswerRatingCommand,type AnswerRatingCommand,type AnswerRatingSaved,type AnswerRatingSelection,type AnswerRatingState} from '../shared/answer-rating';

const unavailable='Private answer ratings could not be read. Existing saved ratings have been kept.';
function reviewAnswer(task:Task,selection:AnswerRatingSelection){
 const requests=task.requests.filter(item=>item.id===selection.requestId),request=requests.length===1?requests[0]:undefined,ref=selection.answer,saved=request&&requestArtifact(task,request);
 if(task.id!==selection.taskId||task.status!=='active'||task.archive||!request||request.status!=='completed'||request.digest!==selection.requestDigest||request.artifactId!==ref.artifactId||request.answer?.artifactId!==ref.artifactId||request.answer.revision!==ref.revision||request.answer.digest!==ref.digest||!saved||saved.artifact.id!==ref.artifactId||saved.revision.revision!==ref.revision||saved.revision.digest!==ref.digest||task.artifacts.filter(item=>item.id===ref.artifactId).length!==1||saved.artifact.revisions.filter(item=>item.revision===ref.revision).length!==1)throw Error('This exact completed answer is no longer available. Reopen its saved conversation before rating it.');
 const artifact=task.artifacts.find(item=>item.id===ref.artifactId)!;if(artifact.revisions.filter(item=>item.revision===ref.revision).length!==1)throw Error('This exact completed answer is ambiguous. Reopen its saved conversation before rating it.');
 const revision=saved.revision;
 if(revision.encoding!==undefined&&revision.encoding!=='utf8'&&revision.encoding!=='base64'||revision.encoding==='base64'&&!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(revision.content))throw Error('This saved answer has an unsupported encoding. Its rating was not changed.');
 const bytes=Buffer.from(revision.content,revision.encoding==='base64'?'base64':'utf8');if(createHash('sha256').update(bytes).digest('hex')!==ref.digest)throw Error('The saved answer bytes changed. Its rating was not changed.');
}
export class AnswerRatings{
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private readonly directory:string,private readonly readTask:(taskId:string)=>Promise<Task>){}
 private serialize<T>(action:()=>Promise<T>):Promise<T>{const result=this.queue.then(action);this.queue=result.catch(()=>{});return result;}
 private async load():Promise<AnswerRatingSaved>{
  try{const file=await open(join(this.directory,'answer-ratings.json'),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const info=await file.stat();if(!info.isFile()||info.size>2*1024*1024)throw Error(unavailable);const bytes=await file.readFile(),text=bytes.toString('utf8');if(!Buffer.from(text,'utf8').equals(bytes))throw Error(unavailable);const saved=Schema.decodeUnknownSync(AnswerRatingSavedSchema,{onExcessProperty:'error'})(JSON.parse(text));if(new Set(saved.entries.map(item=>answerRatingKey(item.selection))).size!==saved.entries.length)throw Error(unavailable);return saved;}finally{await file.close();}}
  catch(error){if(isCode(error,'ENOENT'))return {schemaVersion:1,entries:[]};throw error;}
 }
 private state(saved:AnswerRatingSaved,selection:AnswerRatingSelection):AnswerRatingState{const entry=saved.entries.find(item=>answerRatingKey(item.selection)===answerRatingKey(selection));return {kind:'available',selection,revision:entry?.revision??0,rating:entry?.rating??null};}
 private async current(selection:AnswerRatingSelection,guard:()=>void){guard();reviewAnswer(await this.readTask(selection.taskId),selection);guard();}
 read(input:AnswerRatingCommand,guard:()=>void=()=>{}):Promise<AnswerRatingState>{
  const command=readAnswerRatingCommand(input);if(command.type!=='answerRating.read')throw Error('Choose a private rating read.');return this.serialize(async()=>{await this.current(command.selection,guard);let saved:AnswerRatingSaved;try{saved=await this.load();}catch{guard();return {kind:'unavailable',selection:command.selection,message:unavailable};}await this.current(command.selection,guard);return this.state(saved,command.selection);});
 }
 set(input:AnswerRatingCommand,guard:()=>void=()=>{}):Promise<AnswerRatingState>{
  const command=readAnswerRatingCommand(input);if(command.type!=='answerRating.set')throw Error('Choose a private rating change.');return this.serialize(async()=>{
   await this.current(command.selection,guard);let saved:AnswerRatingSaved;try{saved=await this.load();}catch{guard();return {kind:'unavailable',selection:command.selection,message:unavailable};}await this.current(command.selection,guard);const current=this.state(saved,command.selection);if(current.kind!=='available')throw Error(unavailable);
   if(command.expectedRevision!==current.revision)throw Error('This answer rating changed. Reload its saved rating before trying again.');if(current.rating===command.rating)return current;if(current.revision===Number.MAX_SAFE_INTEGER)throw Error('This answer rating reached its revision limit.');
   const key=answerRatingKey(command.selection),entries=[...saved.entries.filter(item=>answerRatingKey(item.selection)!==key),{selection:command.selection,revision:current.revision+1,rating:command.rating}];if(entries.length>1000)throw Error('The local limit of 1,000 rated answers has been reached. Existing ratings are kept.');const next=Schema.decodeUnknownSync(AnswerRatingSavedSchema,{onExcessProperty:'error'})({schemaVersion:1,entries}),text=JSON.stringify(next);if(Buffer.byteLength(text,'utf8')>2*1024*1024)throw Error('The private rating file has reached its local size limit. Existing ratings are kept.');
   await mkdir(this.directory,{recursive:true,mode:0o700});const temporary=join(this.directory,`.answer-ratings-${randomUUID()}.tmp`);
   try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(text);await file.sync();}finally{await file.close();}await this.current(command.selection,guard);await rename(temporary,join(this.directory,'answer-ratings.json'));const directory=await open(this.directory,'r');try{await directory.sync();}finally{await directory.close();}}
   finally{await rm(temporary,{force:true});}
   const confirmed=await this.load();await this.current(command.selection,guard);return this.state(confirmed,command.selection);
  });
 }
}
