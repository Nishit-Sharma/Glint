import {randomUUID} from 'node:crypto';
import {mkdir,open,readFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Schema} from 'effect';
import type {Task} from '../core/types';
import {isCode} from '../core/store';
import {TaskAttentionSavedSchema,readTaskAttentionChange,taskActivityBasis,type TaskAttentionChange,type TaskAttentionSaved,type TaskAttentionState} from '../shared/task-attention';

export async function readTaskAttention(directory:string,exists:(id:string)=>Promise<boolean>):Promise<TaskAttentionState>{
 try{
  const saved=Schema.decodeUnknownSync(TaskAttentionSavedSchema,{onExcessProperty:'error'})(JSON.parse(await readFile(join(directory,'task-attention.json'),'utf8')));
  if(new Set(saved.entries.map(entry=>entry.taskId)).size!==saved.entries.length)throw Error('Duplicate task cursor.');
  const present=await Promise.all(saved.entries.map(entry=>exists(entry.taskId)));
  return {kind:'available',revision:saved.revision,filter:saved.filter,entries:saved.entries.filter((_,index)=>present[index]),...(saved.notifications?{notifications:saved.notifications}:{})};
 }catch(error){if(isCode(error,'ENOENT'))return {kind:'available',revision:0,filter:'all',entries:[]};return {kind:'unavailable',message:'Task read state could not be read. Its saved preferences have been kept.'};}
}

/** Caller serializes this with the existing task view preferences queue. A late view never clears newer activity. */
export async function changeTaskAttention(directory:string,exists:(id:string)=>Promise<boolean>,getTask:((id:string)=>Promise<Task>)|undefined,input:TaskAttentionChange):Promise<TaskAttentionState>{
 const change=readTaskAttentionChange(input),current=await readTaskAttention(directory,exists);if(current.kind==='unavailable')return current;
 let entries=current.entries,filter=current.filter;
 if(change.kind==='filter')filter=change.filter;
 else{
  if(!await exists(change.taskId))throw Error('This task is no longer available.');
  if(change.kind==='read'&&(!getTask||taskActivityBasis(await getTask(change.taskId))!==change.basis))throw Error('The conversation changed. Review its latest activity before marking it read.');
  const basis=change.kind==='read'?change.basis:null;
  entries=[...entries.filter(entry=>entry.taskId!==change.taskId),{taskId:change.taskId,basis}];
 }
 if(filter===current.filter&&JSON.stringify(entries)===JSON.stringify(current.entries))return current;
 if(current.revision===Number.MAX_SAFE_INTEGER)throw Error('Task read state could not be saved.');
 const saved:TaskAttentionSaved=Schema.decodeUnknownSync(TaskAttentionSavedSchema)({schemaVersion:1,revision:current.revision+1,filter,entries,...(current.notifications?{notifications:current.notifications}:{})});
 await writeTaskAttention(directory,saved);return {kind:'available',revision:saved.revision,filter:saved.filter,entries:saved.entries,...(saved.notifications?{notifications:saved.notifications}:{})};
}
export async function writeTaskAttention(directory:string,saved:TaskAttentionSaved){
 Schema.decodeUnknownSync(TaskAttentionSavedSchema,{onExcessProperty:'error'})(saved);
 await mkdir(directory,{recursive:true,mode:0o700});const temporary=join(directory,`.task-attention-${randomUUID()}.tmp`);
 try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(JSON.stringify(saved));await file.sync();}finally{await file.close();}await rename(temporary,join(directory,'task-attention.json'));const folder=await open(directory,'r');try{await folder.sync();}finally{await folder.close();}}
 finally{await rm(temporary,{force:true});}
}
