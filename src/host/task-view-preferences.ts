import {randomUUID} from 'node:crypto';
import {mkdir,open,readFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {isCode} from '../core/store';
import type {TaskViewState} from '../shared/task-view';

export class TaskViewPreferences{
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private readonly directory:string,private readonly exists:(taskId:string)=>Promise<boolean>){}
 private serialize<T>(action:()=>Promise<T>):Promise<T>{const result=this.queue.then(action);this.queue=result.catch(()=>{});return result;}
 private async load():Promise<TaskViewState>{
  try{
   const value:unknown=JSON.parse(await readFile(join(this.directory,'task-view.json'),'utf8'));
   if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='schemaVersion,taskId'||!('schemaVersion' in value)||value.schemaVersion!==1||!('taskId' in value)||(value.taskId!==null&&(typeof value.taskId!=='string'||!value.taskId.length||value.taskId.length>200||value.taskId.includes('\0'))))throw Error('Unfamiliar view preference.');
   const taskId=value.taskId as string|null;
   if(taskId!==null&&!await this.exists(taskId))return {kind:'missing',taskId:null,message:'The last open task is no longer available. Choose a task to continue.'};
   return {kind:'available',taskId};
  }catch(error){if(isCode(error,'ENOENT'))return {kind:'available',taskId:null};return {kind:'unavailable',taskId:null,message:'The last open task preference could not be read. Its saved bytes have been preserved.'};}
 }
 read(){return this.serialize(()=>this.load());}
 select(taskId:string|null):Promise<TaskViewState>{
  return this.serialize(async()=>{
   if(taskId!==null&&(typeof taskId!=='string'||!taskId.length||taskId.length>200||taskId.includes('\0')||!await this.exists(taskId)))throw Error('The selected task is no longer available.');
   const previous=await this.load();if(previous.kind==='unavailable')return previous;
   if(previous.kind==='available'&&previous.taskId===taskId)return previous;
   await mkdir(this.directory,{recursive:true,mode:0o700});const temporary=join(this.directory,`.task-view-${randomUUID()}.tmp`);
   try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(JSON.stringify({schemaVersion:1,taskId}));await file.sync();}finally{await file.close();}await rename(temporary,join(this.directory,'task-view.json'));const directory=await open(this.directory,'r');try{await directory.sync();}finally{await directory.close();}return {kind:'available',taskId};}
   finally{await rm(temporary,{force:true});}
  });
 }
}
