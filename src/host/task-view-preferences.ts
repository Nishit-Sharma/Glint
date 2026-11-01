import {randomUUID} from 'node:crypto';
import {mkdir,open,readFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {isCode} from '../core/store';
import {Schema} from 'effect';
import {TaskViewSavedSchema,readFileFavoritesChange,favoriteFileViews,favoriteFileKey,type TaskViewSaved,type FileFavoritesChange,type FileFavoritesState,type TaskViewState,type TaskPinsState} from '../shared/task-view';
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
 private async loadDocument():Promise<TaskViewSaved>{
  try{return Schema.decodeUnknownSync(TaskViewSavedSchema,{onExcessProperty:'error'})(JSON.parse(await readFile(join(this.directory,'task-view.json'),'utf8')));}
  catch(error){if(isCode(error,'ENOENT'))return {schemaVersion:1,taskId:null};throw error;}
 }
 private async writeView(saved:TaskViewSaved,assertCurrent:()=>void=()=>{}){
  Schema.decodeUnknownSync(TaskViewSavedSchema,{onExcessProperty:'error'})(saved);
  await mkdir(this.directory,{recursive:true,mode:0o700});const temporary=join(this.directory,`.task-view-${randomUUID()}.tmp`);
  try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(JSON.stringify(saved));await file.sync();}finally{await file.close();}assertCurrent();await rename(temporary,join(this.directory,'task-view.json'));const directory=await open(this.directory,'r');try{await directory.sync();}finally{await directory.close();}}
  finally{await rm(temporary,{force:true});}
 }
 private async load():Promise<TaskViewState>{
  try{
   const {taskId}=await this.loadDocument();
   if(taskId!==null&&!await this.exists(taskId))return {kind:'missing',taskId:null,message:'The last open task is no longer available. Choose a task to continue.'};
   return {kind:'available',taskId};
  }catch(error){if(isCode(error,'ENOENT'))return {kind:'available',taskId:null};return {kind:'unavailable',taskId:null,message:'The last open task preference could not be read. Its saved bytes have been preserved.'};}
 }
 read(){return this.serialize(()=>this.load());}
 select(taskId:string|null):Promise<TaskViewState>{
  return this.serialize(async()=>{
   if(taskId!==null&&(typeof taskId!=='string'||!taskId.length||taskId.length>200||taskId.includes('\0')||!await this.exists(taskId)))throw Error('The selected task is no longer available.');
   let saved:TaskViewSaved;try{saved=await this.loadDocument();}catch{return {kind:'unavailable',taskId:null,message:'The last open task preference could not be read. Its saved bytes have been preserved.'};}
   const previous=await this.load();if(previous.kind==='unavailable')return previous;
   if(previous.kind==='available'&&previous.taskId===taskId)return previous;
   await this.writeView({...saved,taskId});return {kind:'available',taskId};
  });
 }
 readFileFavorites():Promise<FileFavoritesState>{return this.serialize(async()=>{try{const saved=await this.loadDocument();return {kind:'available',...(saved.fileFavorites??{revision:0,items:[]})};}catch{return {kind:'unavailable',message:'Favorite files could not be read. Saved view preferences have been kept.'};}});}
 changeFileFavorites(input:FileFavoritesChange,assertCurrent:()=>void=()=>{}):Promise<FileFavoritesState>{return this.serialize(async()=>{
  const {expectedRevision,change}=readFileFavoritesChange(input);assertCurrent();
  let saved:TaskViewSaved;try{saved=await this.loadDocument();}catch{return {kind:'unavailable',message:'Favorite files could not be read. Saved view preferences have been kept.'};}
  const current=saved.fileFavorites??{revision:0,items:[]};
  if(expectedRevision!==current.revision)throw Error('Favorite files changed. Reload favorites before trying again.');
  const key=favoriteFileKey(change),existing=current.items.find(item=>favoriteFileKey(item)===key);
  const task=await this.getTask?.(change.taskId).catch(()=>undefined);
  if(change.kind==='clear-unavailable'){
   if(!existing)throw Error('This favorite is no longer saved. Reload favorites.');
   if(task&&favoriteFileViews([task],[existing])[0].match)throw Error('This file is available again. Reload favorites before changing it.');
  }else{
   const files=task?.artifacts.filter(file=>file.id===change.artifactId),file=files?.length===1?files[0]:undefined,revision=file?.revisions.at(-1);
   if(!task||!file||!revision||revision.revision!==change.revision||revision.digest!==change.digest||file.revisions.filter(item=>item.revision===change.revision).length!==1)throw Error('This saved file changed or is no longer available. Search again before changing its favorite.');
   const candidate={taskId:task.id,artifactId:file.id,label:revision.title,reference:{revision:revision.revision,digest:revision.digest}};
   if(!favoriteFileViews([task],[candidate])[0].match)throw Error('Favorite files support complete plain-text and Markdown search entries only.');
   if((change.kind==='favorite')===!!existing)return {kind:'available',...current};
  }
  if(current.revision===Number.MAX_SAFE_INTEGER)throw Error('Favorite file revision limit reached. Saved preferences are kept.');
  const items=change.kind==='favorite'?[...current.items,{taskId:change.taskId,artifactId:change.artifactId,label:task!.artifacts.find(file=>file.id===change.artifactId)!.revisions.at(-1)!.title,reference:{revision:change.revision,digest:change.digest}}]:current.items.filter(item=>favoriteFileKey(item)!==key);
  if(items.length>100)throw Error('Remove a favorite before adding another. At most 100 favorite files are kept.');
  const fileFavorites={revision:current.revision+1,items};assertCurrent();await this.writeView({...saved,fileFavorites},assertCurrent);return {kind:'available',...fileFavorites};
 });}
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
