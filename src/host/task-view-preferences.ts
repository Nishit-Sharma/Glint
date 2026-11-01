import {randomUUID} from 'node:crypto';
import {mkdir,open,readFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {isCode} from '../core/store';
import {Schema} from 'effect';
import type {TaskViewState,TaskPinsState} from '../shared/task-view';
import type {Task} from '../core/types';
import type {TaskAttentionChange} from '../shared/task-attention';
import {readTaskAttention,changeTaskAttention,writeTaskAttention} from './task-attention-preferences';

import {freshNotifications,localDate,readNotificationSaved,readNotificationChange,type NotificationSaved,type NotificationState,type NotificationChange} from '../shared/task-notifications';

const Pins=Schema.Struct({schemaVersion:Schema.Literal(1),taskIds:Schema.Array(Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.pattern(/^[^\0]+$/))).pipe(Schema.maxItems(100))});

export class TaskViewPreferences{
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private readonly directory:string,private readonly exists:(taskId:string)=>Promise<boolean>,private readonly getTask?:(taskId:string)=>Promise<Task>){}
 readAttention(){return this.serialize(()=>readTaskAttention(this.directory,this.exists));}
 changeAttention(change:TaskAttentionChange){return this.serialize(()=>changeTaskAttention(this.directory,this.exists,this.getTask,change));}
 readNotifications():Promise<NotificationState>{return this.serialize(async()=>{const current=await readTaskAttention(this.directory,this.exists);return current.kind==='unavailable'?current:{kind:'available',current:current.notifications??freshNotifications()};});}
 mutateNotifications(update:(current:NotificationSaved)=>NotificationSaved):Promise<NotificationState>{return this.serialize(async()=>{const document=await readTaskAttention(this.directory,this.exists);if(document.kind==='unavailable')return document;const before=document.notifications??freshNotifications(),saved=readNotificationSaved(update(before));if(JSON.stringify(saved)!==JSON.stringify(before)){if(document.revision===Number.MAX_SAFE_INTEGER)throw Error('Notification preferences could not be saved.');await writeTaskAttention(this.directory,{schemaVersion:1,revision:document.revision+1,filter:document.filter,entries:document.entries,notifications:saved});}return {kind:'available',current:saved};});}
 changeNotifications(input:NotificationChange,now=Date.now()):Promise<NotificationState>{const change=readNotificationChange(input);return this.mutateNotifications(current=>{
  if(change.kind==='settings'){if(change.expectedRevision!==current.revision)throw Error('Notification preferences changed. Reload before saving.');return {...current,revision:current.revision+1,preferences:change.preferences};}
  if(change.kind==='snooze')return {...current,notices:current.notices.map(notice=>notice.kind==='break'?{...notice,dismissed:true}:notice),usage:{...current.usage,snoozeUntil:now+change.minutes*60_000}};
  const notice=current.notices.find(notice=>notice.id===change.noticeId);if(!notice)throw Error('This notice is no longer available.');return {...current,notices:current.notices.map(item=>item.id===notice.id?{...item,dismissed:true}:item),usage:notice.kind==='break'&&localDate(notice.createdAt)===current.usage.date?{...current.usage,breakDismissed:true}:current.usage};
 });}
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
 private async loadPins():Promise<TaskPinsState>{
  try{
   const value=Schema.decodeUnknownSync(Pins,{onExcessProperty:'error'})(JSON.parse(await readFile(join(this.directory,'task-pins.json'),'utf8')));
   if(new Set(value.taskIds).size!==value.taskIds.length)throw Error('Duplicate pinned task.');
   const present=await Promise.all(value.taskIds.map(id=>this.exists(id)));return {kind:'available',taskIds:value.taskIds.filter((_,i)=>present[i])};
  }catch(error){if(isCode(error,'ENOENT'))return {kind:'available',taskIds:[]};return {kind:'unavailable',taskIds:[],message:'Pinned tasks could not be read. Their saved preferences have been kept.'};}
 }
 readPins(){return this.serialize(()=>this.loadPins());}
 setPinned(taskId:string,pinned:boolean):Promise<TaskPinsState>{
  return this.serialize(async()=>{
   if(typeof taskId!=='string'||!taskId.length||taskId.length>200||taskId.includes('\0')||typeof pinned!=='boolean'||!await this.exists(taskId))throw Error('Choose an existing task to pin or unpin.');
   const current=await this.loadPins();if(current.kind==='unavailable')return current;
   if(current.taskIds.includes(taskId)===pinned)return current;
   const taskIds=pinned?[...current.taskIds,taskId]:current.taskIds.filter(id=>id!==taskId);if(taskIds.length>100)throw Error('Unpin a task before pinning another.');
   await mkdir(this.directory,{recursive:true,mode:0o700});const temporary=join(this.directory,`.task-pins-${randomUUID()}.tmp`);
   try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(JSON.stringify({schemaVersion:1,taskIds}));await file.sync();}finally{await file.close();}await rename(temporary,join(this.directory,'task-pins.json'));const directory=await open(this.directory,'r');try{await directory.sync();}finally{await directory.close();}return {kind:'available',taskIds};}
   finally{await rm(temporary,{force:true});}
  });
 }
}
