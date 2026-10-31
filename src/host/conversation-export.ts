import {randomUUID,createHash} from 'node:crypto';
import {open,realpath,lstat,link,unlink,readFile} from 'node:fs/promises';
import {isAbsolute,resolve,dirname,basename,join} from 'node:path';
import type {Task} from '../core/types';
import {conversationSnapshot,conversationExportBody,type ConversationExportCommand,type ConversationExportPreview,type ConversationExportSaved} from '../shared/conversation-export';

const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
/** The native chooser supplies the destination. Publishing a fully synced sibling
 * with link() is atomic and refuses every existing file, including symlinks. */
export async function writeConversationExport(path:string,bytes:Buffer):Promise<void>{
 if(!isAbsolute(path)||path!==resolve(path)||path.includes('\0'))throw Error('Choose an exact export destination.');
 const parent=await realpath(dirname(path)),initial=await lstat(parent),destination=join(parent,basename(path)),temporary=join(parent,'.glint-conversation-'+randomUUID()+'.tmp');
 const file=await open(temporary,'wx',0o600);let published=false;
 try{
  try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  const current=await lstat(parent);if(current.dev!==initial.dev||current.ino!==initial.ino)throw Error('Export destination changed. Choose it again.');
  await link(temporary,destination);published=true;
  const saved=await readFile(destination);if(saved.length!==bytes.length||digest(saved)!==digest(bytes))throw Error('The file may have been saved. Check the destination before trying again.');
 }catch(error){if(published)throw Error('The file may have been saved. Check the destination before trying again.');if(error&&typeof error==='object'&&'code'in error&&error.code==='EEXIST')throw Error('Destination already exists. Choose a new filename.');throw error;}
 finally{await unlink(temporary).catch(()=>{});}
}
export class ConversationExports{
 private snapshots=new Map<string,{preview:ConversationExportPreview;bytes:Buffer;saving:boolean}>();
 constructor(private readonly readTask:(taskId:string)=>Promise<Task>,private readonly now=()=>new Date()){}
 async preview(command:Extract<ConversationExportCommand,{type:'conversation.export.preview'}>):Promise<ConversationExportPreview>{
  const task=await this.readTask(command.taskId);if(task.id!==command.taskId)throw Error('Open the original task before exporting.');
  const snapshot=conversationSnapshot(task,this.now().toISOString(),command.includeSourceText),body=conversationExportBody(snapshot,command.format),bytes=Buffer.from(body,'utf8');
  if(bytes.length>64*1024*1024)throw Error('This conversation is too large to export in one file. No partial transcript was created.');
  const preview:ConversationExportPreview={snapshotId:randomUUID(),taskId:task.id,title:task.title,capturedAt:snapshot.capturedAt,format:command.format,includeSourceText:command.includeSourceText,byteLength:bytes.length,requestCount:snapshot.requests.length,revisionCount:snapshot.artifacts.reduce((count,item)=>count+item.revisions.length,0),incompleteCount:snapshot.requests.filter(item=>item.status!=='completed').length,body};
  for(const [id,entry]of this.snapshots)if(entry.preview.taskId===task.id&&!entry.saving)this.snapshots.delete(id);
  if(this.snapshots.size>=8){const oldest=[...this.snapshots].find(([,entry])=>!entry.saving);if(oldest)this.snapshots.delete(oldest[0]);else throw Error('Finish another export before preparing a new snapshot.');}
  this.snapshots.set(preview.snapshotId,{preview,bytes,saving:false});return preview;
 }
 async save(command:Extract<ConversationExportCommand,{type:'conversation.export.save'}>,choose:(preview:ConversationExportPreview)=>Promise<string|null>,isCurrent:()=>void):Promise<ConversationExportSaved>{
  const entry=this.snapshots.get(command.snapshotId);if(!entry||entry.preview.taskId!==command.taskId||entry.saving)throw Error('Review this conversation export again before saving.');
  entry.saving=true;
  try{const path=await choose(entry.preview);isCurrent();if(!path)return {kind:'cancelled',taskId:command.taskId,snapshotId:command.snapshotId};await writeConversationExport(path,entry.bytes);return {kind:'saved',taskId:command.taskId,snapshotId:command.snapshotId,path,byteLength:entry.bytes.length};}
  finally{entry.saving=false;}
 }
}
