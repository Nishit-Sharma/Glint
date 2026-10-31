import {constants} from 'node:fs';
import {mkdir,open,rename,rm} from 'node:fs/promises';
import {basename,join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Schema} from 'effect';
import {parseCurrentState,type State} from '../core/store';
import {contentOnlyState} from '../core/content-backup-state';
import {parseLearningDraftFile} from '../shared/learning-drafts';
import {BotSnapshotSchema} from '../shared/bot-catalog';
import {CharacterSnapshotSchema} from '../shared/character-catalog';
import {ResponsePreferencesSnapshotSchema} from '../shared/response-preferences';
import {TaskAttentionSavedSchema} from '../shared/task-attention';
import {CONTENT_BACKUP_FILES,CONTENT_BACKUP_FORMAT,CONTENT_BACKUP_LIMIT,CONTENT_BACKUP_ERROR,readContentBackupCommand,type ContentBackupName,type ContentBackupCommand,type ContentBackupReply,type ContentBackupSummary,type ContentBackupReview,type ContentBackupStatus} from '../shared/content-backup';
import {writeConversationExport} from './conversation-export';

const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function fail(message:string):never{throw Error('Content backup: '+message);}
const digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
const fileSchema=Schema.Struct({name:Schema.Literal(...CONTENT_BACKUP_FILES),content:Schema.NullOr(Schema.String),byteLength:Schema.Int.pipe(Schema.between(0,CONTENT_BACKUP_LIMIT)),sha256:Schema.NullOr(digest)});
const payloadSchema=Schema.Struct({createdAt:Schema.String.pipe(Schema.filter(value=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value)),appVersion:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(100)),taskSchemaVersion:Schema.Literal(2),files:Schema.Array(fileSchema).pipe(Schema.itemsCount(CONTENT_BACKUP_FILES.length))});
const backupSchema=Schema.Struct({format:Schema.Literal(CONTENT_BACKUP_FORMAT),formatVersion:Schema.Literal(1),payload:payloadSchema,checksum:digest});
export type ContentBackup=typeof backupSchema.Type;
type BackupFile=typeof fileSchema.Type;
const decode=<A,I>(schema:Schema.Schema<A,I>,value:unknown):A=>Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(value);
const characterFile=Schema.Struct({schemaVersion:Schema.Literal(1),...CharacterSnapshotSchema.fields});
const botFile=Schema.Struct({schemaVersion:Schema.Literal(2),current:BotSnapshotSchema});
const responseFile=Schema.Struct({schemaVersion:Schema.Literal(1),...ResponsePreferencesSnapshotSchema.fields});
const taskId=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const viewFile=Schema.Struct({schemaVersion:Schema.Literal(1),taskId:Schema.NullOr(taskId)});
const pinsFile=Schema.Struct({schemaVersion:Schema.Literal(1),taskIds:Schema.Array(taskId).pipe(Schema.maxItems(100),Schema.filter(values=>new Set(values).size===values.length))});

function validateFile(file:BackupFile):void{
 if(file.content===null){if(file.sha256!==null||file.byteLength!==0)fail('An absent file has inconsistent metadata.');if(file.name==='tasks.json')fail('The backup does not contain its task store.');return;}
 if(Buffer.byteLength(file.content)!==file.byteLength||hash(file.content)!==file.sha256)fail('A content file checksum or byte count does not match. Nothing was restored.');
 const value:unknown=JSON.parse(file.content);
 switch(file.name){
  case 'tasks.json':{const state=parseCurrentState(value);if(new Set(state.tasks.map(task=>task.id)).size!==state.tasks.length)fail('The task store contains duplicate task identities.');break;}
  case 'learning-drafts.json':parseLearningDraftFile(value);break;
  case 'bot-catalog.json':decode(botFile,value);break;
  case 'character-preferences.json':decode(characterFile,value);break;
  case 'response-preferences.json':decode(responseFile,value);break;
  case 'task-view.json':decode(viewFile,value);break;
  case 'task-pins.json':decode(pinsFile,value);break;
  case 'task-attention.json':decode(TaskAttentionSavedSchema,value);break;
 }
}
export function readContentBackup(text:string,appVersion?:string):ContentBackup{
 try{
  if(Buffer.byteLength(text)>CONTENT_BACKUP_LIMIT)fail('Use a backup of at most 64 MiB. No partial content was read.');
  const backup=decode(backupSchema,JSON.parse(text));
  if(backup.payload.files.some((file,index)=>file.name!==CONTENT_BACKUP_FILES[index]))fail('The declared content files are unfamiliar, duplicated or out of order.');
  if(hash(JSON.stringify(backup.payload))!==backup.checksum)fail('The backup checksum does not match. Nothing was restored.');
  if(appVersion!==undefined&&backup.payload.appVersion!==appVersion)fail('This backup was made by a different Glint version. This release restores only its own current format.');
  for(const file of backup.payload.files)validateFile(file);
  return backup;
 }catch(error){if(error instanceof Error&&error.message.startsWith('Content backup: '))throw error;return fail('The backup schema or content is invalid or incompatible. Nothing was restored.');}
}
const entry=(name:ContentBackupName,content:string|null):BackupFile=>({name,content,byteLength:content===null?0:Buffer.byteLength(content),sha256:content===null?null:hash(content)});
function bundle(files:readonly BackupFile[],appVersion:string,createdAt=new Date().toISOString()):ContentBackup{
 const payload={createdAt,appVersion,taskSchemaVersion:2 as const,files:[...files]},backup={format:CONTENT_BACKUP_FORMAT,formatVersion:1 as const,payload,checksum:hash(JSON.stringify(payload))};
 if(Buffer.byteLength(JSON.stringify(backup,null,2)+'\n')>CONTENT_BACKUP_LIMIT)fail('The complete backup exceeds 64 MiB. Nothing was exported or restored.');
 return readContentBackup(JSON.stringify(backup),appVersion);
}
export function contentBackupSummary(backup:ContentBackup):ContentBackupSummary{
 const state=parseCurrentState(JSON.parse(backup.payload.files[0].content!)),raw=backup.payload.files.find(file=>file.name==='learning-drafts.json')?.content,drafts=raw?parseLearningDraftFile(JSON.parse(raw)):undefined;
 return {createdAt:backup.payload.createdAt,appVersion:backup.payload.appVersion,checksum:backup.checksum,contentChecksum:hash(JSON.stringify(backup.payload.files)),files:backup.payload.files.map(({name,byteLength,sha256,content})=>({name,byteLength,sha256,present:content!==null})),counts:{tasks:state.tasks.length,sources:state.tasks.reduce((n,task)=>n+task.sources.length,0),sourceVersions:state.tasks.reduce((n,task)=>n+task.sources.reduce((total,source)=>total+source.versions.length,0),0),artifacts:state.tasks.reduce((n,task)=>n+task.artifacts.length,0),artifactVersions:state.tasks.reduce((n,task)=>n+task.artifacts.reduce((total,artifact)=>total+artifact.revisions.length,0),0),unsentMessages:state.tasks.filter(task=>!!task.session?.draft).length,unfinishedForms:drafts?.records.filter(record=>record.value!==null).length??0,memoryFacts:state.userMemory?.facts.length??0,projects:state.projects?.length??0,schedules:state.recurringWork?.length??0}};
}
async function readLocal(path:string,limit=CONTENT_BACKUP_LIMIT):Promise<string|null>{
 let file;try{file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT')return null;throw error;}
 try{const before=await file.stat({bigint:true});if(!before.isFile()||before.size>BigInt(limit))fail('A content file is not an ordinary file or exceeds the 64 MiB limit.');const bytes=await file.readFile();if(bytes.length>limit||BigInt(bytes.length)!==before.size)fail('A content file changed while being read. Try again after editing stops.');const after=await file.stat({bigint:true});if(before.ino!==after.ino||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)fail('A content file changed while being read.');return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}finally{await file.close();}
}
async function syncDirectory(path:string){const directory=await open(path,'r');try{await directory.sync();}finally{await directory.close();}}
async function writeAtomic(path:string,text:string){const temporary=path+'.'+randomUUID()+'.tmp';try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(text,'utf8');await file.sync();}finally{await file.close();}await rename(temporary,path);}finally{await rm(temporary,{force:true});}}

export async function captureContentBackup(directory:string,state:State,appVersion:string):Promise<ContentBackup>{
 const files:BackupFile[]=[];
 for(const name of CONTENT_BACKUP_FILES){const content=await readLocal(join(directory,name));files.push(entry(name,content));}
 const disk=files[0].content;if(!disk||JSON.stringify(parseCurrentState(JSON.parse(disk)))!==JSON.stringify(parseCurrentState(state)))fail('The live task store and saved content differ. Reopen Glint before backing up.');
 files[0]=entry('tasks.json',JSON.stringify(contentOnlyState(state)));
 const catalog=files.find(file=>file.name==='bot-catalog.json');if(catalog?.content){const value=decode(botFile,JSON.parse(catalog.content));if(value.current.kind==='ready'&&value.current.examplePending)files[files.indexOf(catalog)]=entry(catalog.name,JSON.stringify({...value,current:{...value.current,examplePending:false}}));}
 return bundle(files,appVersion);
}

const journalSchema=Schema.Struct({schemaVersion:Schema.Literal(1),id:Schema.String.pipe(Schema.pattern(/^[a-f0-9-]{36}$/)),phase:Schema.Literal('prepared','committed'),beforeChecksum:digest,afterChecksum:digest});
type Journal=typeof journalSchema.Type;
const journalName='content-restore-journal.json',receiptName='content-restore-receipt.json';
async function writeFiles(directory:string,backup:ContentBackup,recoveryDirectory:string){
 for(const file of backup.payload.files){
  const path=join(directory,file.name),current=await readLocal(path);if(current===file.content)continue;
  if(current!==null){await rename(path,join(recoveryDirectory,'replaced-'+randomUUID()+'-'+file.name));}
  if(file.content!==null)await writeAtomic(path,file.content);
 }
 await syncDirectory(directory);await syncDirectory(recoveryDirectory);
 for(const file of backup.payload.files)if(await readLocal(join(directory,file.name))!==file.content)fail('The restored bytes could not be confirmed. Keep the recovery copies.');
}
const receiptSchema=Schema.Struct({outcome:Schema.Literal('restored','recovered-prior-content'),priorCopyPath:Schema.String,at:Schema.String});
async function saveReceipt(directory:string,outcome:'restored'|'recovered-prior-content',priorCopyPath:string){await writeAtomic(join(directory,receiptName),JSON.stringify({outcome,priorCopyPath,at:new Date().toISOString()}));await syncDirectory(directory);}
/** Startup runs this before opening any store or starting timers. An interrupted prepare rolls back the complete prior content set. */
export async function recoverContentRestore(directory:string):Promise<void>{
 const text=await readLocal(join(directory,journalName),4096);if(text===null)return;
 const journal=decode(journalSchema,JSON.parse(text)),recoveryDirectory=join(directory,'content-recovery',journal.id),before=readContentBackup((await readLocal(join(recoveryDirectory,'before.glint-backup.json')))!);
 const after=readContentBackup((await readLocal(join(recoveryDirectory,'after.glint-backup.json')))!);
 if(before.checksum!==journal.beforeChecksum||after.checksum!==journal.afterChecksum)fail('The restore recovery checksum changed. Keep all files and reopen after recovery review.');
 if(journal.phase==='prepared'){await writeFiles(directory,before,recoveryDirectory);await saveReceipt(directory,'recovered-prior-content',join(recoveryDirectory,'before.glint-backup.json'));}
 else{for(const file of after.payload.files)if(await readLocal(join(directory,file.name))!==file.content)fail('A committed restore differs from its recovery copy. Keep all files for recovery review.');await saveReceipt(directory,'restored',join(recoveryDirectory,'before.glint-backup.json'));}
 await rm(join(directory,journalName));await syncDirectory(directory);
}

export class ContentBackupGate{
 private blocked=false;private sealed=false;private active=new Set<Promise<unknown>>();
 get busy(){return this.blocked;}
 seal(){this.sealed=true;}
 async run<T>(type:string,operation:()=>Promise<T>):Promise<T>{if(this.sealed)fail('Restart Glint before writing to restored content. Earlier renderer input remains frozen.');if(this.blocked&&!['draft.save','draft.flushed','learning-drafts.read','learning-drafts.save'].includes(type))fail('Content is frozen for a backup or restore. Finish that operation first.');const result=Promise.resolve().then(operation);this.active.add(result);try{return await result;}finally{this.active.delete(result);}}
 async maintain<T>(operation:()=>Promise<T>,options:{before:()=>Promise<void>;freeze:()=>Promise<string>;resume:(id:string|undefined)=>void}):Promise<T>{
  if(this.blocked)fail('Finish the current backup or restore first.');this.blocked=true;let freezeId:string|undefined;
  try{await Promise.all([...this.active]);await options.before();freezeId=await options.freeze();await Promise.all([...this.active]);return await operation();}
  finally{if(!this.sealed){this.blocked=false;options.resume(freezeId);}}
 }
}

type Options={directory:string;appVersion:string;snapshot:()=>Promise<State>;maintain:<T>(operation:()=>Promise<T>)=>Promise<T>;chooseSave:()=>Promise<string|undefined>;chooseOpen:()=>Promise<string|undefined>;restoreUnderOwnership:<T>(transaction:()=>Promise<T>)=>Promise<T>;restart:()=>void};
export class ContentBackups{
 private review?:{value:ContentBackupReview;incoming:ContentBackup};private restartRequired=false;
 constructor(private readonly options:Options){}
 async command(input:ContentBackupCommand):Promise<ContentBackupReply>{
  const command=readContentBackupCommand(input);
  if(command.type==='content-backup.status'){let lastRestore:ContentBackupStatus['lastRestore'];try{const text=await readLocal(join(this.options.directory,receiptName),4096);if(text)lastRestore=decode(receiptSchema,JSON.parse(text));}catch{}return {kind:'status',restartRequired:this.restartRequired,...(lastRestore?{lastRestore}:{})};}
  if(command.type==='content-backup.restart'){if(!this.restartRequired)fail('Restore content before restarting from this control.');this.options.restart();return {kind:'restarting'};}
  if(this.restartRequired)fail('Restart Glint to open the restored content.');
  try{return await this.options.maintain(async()=>{
   const current=await captureContentBackup(this.options.directory,await this.options.snapshot(),this.options.appVersion);
   if(command.type==='content-backup.export'){
    const bytes=Buffer.from(JSON.stringify(current,null,2)+'\n');if(bytes.length>CONTENT_BACKUP_LIMIT)fail('The complete backup exceeds 64 MiB. Nothing was exported.');const path=await this.options.chooseSave();if(!path)return {kind:'cancelled'};
    await writeConversationExport(path,bytes);return {kind:'exported',path,byteLength:bytes.length,sha256:hash(bytes),summary:contentBackupSummary(current)};
   }
   if(command.type==='content-backup.choose'){
    const path=await this.options.chooseOpen();if(!path)return {kind:'cancelled'};const text=await readLocal(resolve(path));if(text===null)fail('The selected backup is unavailable.');const incoming=readContentBackup(text,this.options.appVersion),value:ContentBackupReview={kind:'review',reviewId:randomUUID(),filename:basename(path),incoming:contentBackupSummary(incoming),current:contentBackupSummary(current),retiredAuthority:['All schedules and condition watches remain paused until explicit review.','Queued follow-ups are held; running requests become interrupted.','Export and browser approvals are retired; uncertain outcomes remain unverified.','Window sources require a new capture; folder grants and current security settings are not imported.']};
    this.review={value,incoming};return value;
   }
   const selected=this.review;if(!selected||selected.value.reviewId!==command.reviewId||selected.value.incoming.checksum!==command.checksum||selected.value.current.contentChecksum!==command.currentChecksum||contentBackupSummary(current).contentChecksum!==command.currentChecksum)fail('Current content or the selected backup changed. Choose the backup again to review the exact replacement.');
   const nextFiles=selected.incoming.payload.files.map(file=>file.name==='tasks.json'?entry(file.name,JSON.stringify(contentOnlyState(parseCurrentState(JSON.parse(file.content!))))):file.name==='bot-catalog.json'&&file.content?(()=>{const value=decode(botFile,JSON.parse(file.content));return entry(file.name,JSON.stringify(value.current.kind==='ready'?{...value,current:{...value.current,examplePending:false}}:value));})():file),after=bundle(nextFiles,this.options.appVersion),id=randomUUID(),recoveryDirectory=join(this.options.directory,'content-recovery',id);
   if(await readLocal(join(this.options.directory,journalName),4096)!==null)fail('An earlier restore needs startup recovery before another restore.');
   await mkdir(join(this.options.directory,'content-recovery'),{recursive:true,mode:0o700});await mkdir(recoveryDirectory,{mode:0o700});
   const priorCopyPath=join(recoveryDirectory,'before.glint-backup.json');await writeAtomic(priorCopyPath,JSON.stringify(current,null,2)+'\n');await writeAtomic(join(recoveryDirectory,'after.glint-backup.json'),JSON.stringify(after,null,2)+'\n');await syncDirectory(recoveryDirectory);
   const journal:Journal={schemaVersion:1,id,phase:'prepared',beforeChecksum:current.checksum,afterChecksum:after.checksum};await writeAtomic(join(this.options.directory,journalName),JSON.stringify(journal));await syncDirectory(this.options.directory);
   this.restartRequired=true;this.review=undefined;
   return await this.options.restoreUnderOwnership(async()=>{
    try{await writeFiles(this.options.directory,after,recoveryDirectory);await writeAtomic(join(this.options.directory,journalName),JSON.stringify({...journal,phase:'committed'}));await syncDirectory(this.options.directory);await saveReceipt(this.options.directory,'restored',priorCopyPath);return {kind:'restored' as const,priorCopyPath,checksum:selected.incoming.checksum,restartRequired:true as const};}
    catch{await recoverContentRestore(this.options.directory);return {kind:'restore-failed' as const,priorCopyPath,restartRequired:true as const};}
   });
  });}catch(error){if(error instanceof Error&&error.message.startsWith('Content backup: '))throw error;if(this.restartRequired)fail('Restore needs recovery. Keep the app content and recovery copies; restart Glint before continuing.');throw Error(CONTENT_BACKUP_ERROR);}
 }
}
