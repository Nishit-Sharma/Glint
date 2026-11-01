import {constants} from 'node:fs';
import {lstat,mkdir,open,opendir,readFile,realpath,rename,rm} from 'node:fs/promises';
import {basename,dirname,extname,isAbsolute,join,resolve,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Schema} from 'effect';
import type {Companion} from '../core/companion';
import type {ArtifactRef,ArtifactRevision} from '../core/types';
import {CODE_FILE_BYTES,FOLDER_INSTRUCTIONS_BYTES,CODE_WORKSPACE_ERROR,LOCAL_CODE_MIME,CodeReferenceSchema,type FolderResponseGuidance,type CodeCommand,type CodeFile,type CodeFolders,type CodeFolder,type CodeListing,type CodeOpened,type CodeReceipt,type CodeReview,type CodeSaved} from '../shared/code-workspace';
const id=Schema.String,stamp=Schema.Struct({device:id,inode:id});
const instructionsSchema=Schema.mutable(Schema.Struct({revision:Schema.Int.pipe(Schema.between(0,Number.MAX_SAFE_INTEGER)),enabled:Schema.Boolean,fileId:Schema.optional(id)})).pipe(Schema.filter(value=>!value.enabled||!!value.fileId));
const folderSchema=Schema.Struct({id,taskId:id,path:id,name:id,...stamp.fields,instructions:Schema.optional(instructionsSchema)});
const receiptSchema=Schema.Struct({id,path:id,beforeDigest:id,afterDigest:id,byteLength:Schema.Int,backupPath:id,savedAt:id,status:Schema.Literal('prepared','verified','uncertain','not-written')});
const fileSchema=Schema.Struct({id,taskId:id,folderId:id,relativePath:id,artifactId:id,reference:CodeReferenceSchema,receipt:Schema.optional(receiptSchema)});
const ledgerSchema=Schema.mutable(Schema.Struct({schemaVersion:Schema.Literal(1),folders:Schema.mutable(Schema.Array(Schema.mutable(folderSchema))),files:Schema.mutable(Schema.Array(Schema.mutable(fileSchema)))}));
type Ledger=typeof ledgerSchema.Type;type Folder=Ledger['folders'][number];type File=Ledger['files'][number];
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function fail():never{throw Error(CODE_WORKSPACE_ERROR);}
const supported=new Set(['.txt','.md','.mdx','.ts','.tsx','.js','.jsx','.mjs','.cjs','.json','.css','.scss','.html','.xml','.yaml','.yml','.toml','.ini','.py','.rb','.go','.rs','.java','.c','.h','.cpp','.hpp','.cs','.swift','.kt','.sql','.sh','.zsh','.bash','.vue','.svelte','.graphql','.gql','.csv']);
const safeHidden=new Set(['.gitignore','.gitattributes','.editorconfig']);
const allowedName=(name:string)=>name.length>0&&name.length<=255&&!name.includes('\0')&&!name.includes('\\')&&!/[\x00-\x1f\x7f]/.test(name)&&(!name.startsWith('.')||safeHidden.has(name))&&!['node_modules','vendor'].includes(name);
const supportedFile=(name:string)=>safeHidden.has(name)||supported.has(extname(name).toLowerCase())||['README','LICENSE','Makefile','Dockerfile'].includes(name);
const fileView=(file:File):CodeFile=>({id:file.id,folderId:file.folderId,relativePath:file.relativePath,artifactId:file.artifactId});
const folderView=({id,taskId,path,name,instructions}:Folder):CodeFolder=>({id,taskId,path,name,...(instructions?{instructions:{...instructions}}:{})});
const reference=(artifactId:string,revision:ArtifactRevision):ArtifactRef=>({artifactId,revision:revision.revision,digest:revision.digest});
const same=(left:ArtifactRef,right:ArtifactRef)=>left.artifactId===right.artifactId&&left.revision===right.revision&&left.digest===right.digest;
/** Only private path grants and disk receipts live here. File content and versions belong to the task artifact store. */
export class CodeWorkspaces{
 private queue:Promise<unknown>=Promise.resolve();
 private readonly reviews=new Map<string,CodeReview>();
 private readonly guidanceChanges=new Map<string,AbortController>();
 constructor(private readonly options:{directory:string;core:Pick<Companion,'getTask'|'saveArtifact'>;choose:()=>Promise<string|undefined>}){}
 private serialize<T>(action:()=>Promise<T>):Promise<T>{const run=this.queue.then(action);this.queue=run.catch(()=>{});return run;}
 private guidanceController(taskId:string){let controller=this.guidanceChanges.get(taskId);if(!controller){controller=new AbortController();this.guidanceChanges.set(taskId,controller);}return controller;}
 private retireGuidance(taskId:string){this.guidanceController(taskId).abort(Error('Folder response instructions changed. Inspect the current folder and ask again.'));this.guidanceChanges.set(taskId,new AbortController());}
 private async guidanceSnapshot(taskId:string):Promise<FolderResponseGuidance|undefined>{
  const task=await this.owner(taskId,()=>{}),ledger=await this.load(),enabled=ledger.folders.filter(folder=>folder.taskId===taskId&&folder.instructions?.enabled);if(enabled.length>1)fail();const folder=enabled[0];if(!folder)return;
  const file=this.file(ledger,taskId,folder.instructions!.fileId!),saved=task.artifacts.find(item=>item.id===file.artifactId)?.revisions.at(-1);if(file.folderId!==folder.id||!saved||saved.mimeType!==LOCAL_CODE_MIME||!same(reference(file.artifactId,saved),file.reference))fail();
  const disk=await this.read(folder,file.relativePath);if(disk.digest!==saved.digest||disk.bytes.length>FOLDER_INSTRUCTIONS_BYTES)throw Error('Folder instructions changed, are unavailable, or exceed 20,000 UTF-8 bytes. Read the file and review its saved version before asking.');
  return {folderId:folder.id,folderName:folder.name,fileId:file.id,relativePath:file.relativePath,selectionRevision:folder.instructions!.revision,reference:{...file.reference},text:disk.content};
 }
 guidanceLease(taskId:string){return this.serialize(async()=>{
  const current=await this.guidanceSnapshot(taskId),basis=JSON.stringify(current??null),signal=this.guidanceController(taskId).signal;
  const assertCurrent=()=>{if(signal.aborted)throw Error('Folder response instructions changed. Inspect the current folder and ask again.');};
  return {current,signal,scope:current?'folder-instructions:v1:'+hash(basis):undefined,consent:current?`Folder response instructions: ${current.folderName}/${current.relativePath} · saved version ${current.reference.revision}\n${current.text}\nEnd of folder response instructions.\n\n`:'',assertCurrent,check:()=>this.serialize(async()=>{assertCurrent();if(JSON.stringify(await this.guidanceSnapshot(taskId)??null)!==basis)throw Error('Folder response instructions changed. Inspect the current folder and ask again.');assertCurrent();})};
 });}
 private async load():Promise<Ledger>{try{const bytes=await readFile(join(this.options.directory,'code-folder-bindings.json'));if(bytes.length>2*1024*1024)fail();return Schema.decodeUnknownSync(ledgerSchema,{onExcessProperty:'error'})(JSON.parse(bytes.toString('utf8')));}catch(error){if(error instanceof Error&&'code' in error&&error.code==='ENOENT')return {schemaVersion:1,folders:[],files:[]};return fail();}}
 private async persist(value:Ledger){
  await mkdir(this.options.directory,{recursive:true,mode:0o700});const path=join(this.options.directory,'.code-bindings-'+randomUUID()+'.tmp');
  try{const file=await open(path,'wx',0o600);try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}await rename(path,join(this.options.directory,'code-folder-bindings.json'));const dir=await open(this.options.directory,'r');try{await dir.sync();}finally{await dir.close();}}finally{await rm(path,{force:true});}
 }
 private async owner(taskId:string,guard:()=>void){guard();const task=await this.options.core.getTask(taskId);guard();if(task.id!==taskId||task.status!=='active'||task.archive)fail();return task;}
 private folder(ledger:Ledger,taskId:string,id:string){const found=ledger.folders.find(item=>item.id===id&&item.taskId===taskId);return found??fail();}
 private file(ledger:Ledger,taskId:string,id:string){const found=ledger.files.find(item=>item.id===id&&item.taskId===taskId);if(!found)fail();this.folder(ledger,taskId,found.folderId);return found;}
 private async path(folder:Folder,input:string,directory=false){
  if(isAbsolute(input)||input.includes('\\')||input.split('/').some(part=>!allowedName(part))&&input!==''||input!==''&&input.split('/').some(part=>part==='.'||part==='..'))fail();
  const root=await lstat(folder.path);if(!root.isDirectory()||root.isSymbolicLink()||String(root.dev)!==folder.device||String(root.ino)!==folder.inode||await realpath(folder.path)!==folder.path)fail();
  let path=folder.path;const parts=input?input.split('/'):[];
  for(const [index,part] of parts.entries()){path=join(path,part);const info=await lstat(path);if(info.isSymbolicLink()||index<parts.length-1&&!info.isDirectory())fail();}
  if(path!==folder.path&&!path.startsWith(folder.path+sep)||directory&&!(await lstat(path)).isDirectory())fail();return path;
 }
 private async read(folder:Folder,path:string){
  if(!supportedFile(basename(path)))fail();const full=await this.path(folder,path),file=await open(full,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const info=await file.stat({bigint:true});if(!info.isFile()||info.nlink!==1n||info.size<1n||info.size>BigInt(CODE_FILE_BYTES))fail();const buffer=Buffer.alloc(CODE_FILE_BYTES+1);let size=0;while(size<buffer.length){const result=await file.read(buffer,size,buffer.length-size,size);if(!result.bytesRead)break;size+=result.bytesRead;}if(size>CODE_FILE_BYTES||BigInt(size)!==info.size)fail();const bytes=buffer.subarray(0,size),content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(content))fail();const after=await file.stat({bigint:true}),atPath=await lstat(full,{bigint:true});if(info.dev!==after.dev||info.ino!==after.ino||info.mtimeNs!==after.mtimeNs||info.ctimeNs!==after.ctimeNs||after.ino!==atPath.ino||atPath.isSymbolicLink())fail();return {path:full,bytes,content,digest:hash(bytes),info};}finally{await file.close();}
 }
 private async snapshot(ledger:Ledger,file:File,guard:()=>void):Promise<CodeOpened>{
  const task=await this.owner(file.taskId,guard),revision=task.artifacts.find(item=>item.id===file.artifactId)?.revisions.find(item=>same(reference(file.artifactId,item),file.reference));if(!revision||revision.mimeType!==LOCAL_CODE_MIME)fail();
  const folder=this.folder(ledger,file.taskId,file.folderId);let observation:CodeOpened['observation'];try{const disk=await this.read(folder,file.relativePath);observation=disk.digest===revision.digest?{kind:'current',digest:disk.digest}:{kind:'changed',content:disk.content,digest:disk.digest};}catch{observation={kind:'unavailable'};}guard();return {kind:'opened',file:fileView(file),path:join(folder.path,file.relativePath),task,revision,observation,...(file.receipt?{receipt:file.receipt}:{})};
 }
 command(command:CodeCommand,guard:()=>void=()=>{}):Promise<CodeFolders|CodeListing|CodeOpened|CodeReview|CodeSaved|{kind:'cancelled'}>{
  return this.serialize(()=>this.execute(command,guard)).catch(()=>fail());
 }
 private async execute(c:CodeCommand,guard:()=>void):Promise<CodeFolders|CodeListing|CodeOpened|CodeReview|CodeSaved|{kind:'cancelled'}>{
  const task=await this.owner(c.taskId,guard),ledger=await this.load();guard();
  const folders=():CodeFolders=>({kind:'folders',folders:ledger.folders.filter(item=>item.taskId===c.taskId).map(folderView),files:ledger.files.filter(item=>item.taskId===c.taskId&&ledger.folders.some(folder=>folder.id===item.folderId)).map(fileView)});
  switch(c.type){
   case 'code.folder.get':return folders();
   case 'code.folder.choose':{
    const selected=await this.options.choose();await this.owner(c.taskId,guard);if(!selected)return {kind:'cancelled'};
    const selectedInfo=await lstat(resolve(selected));if(selectedInfo.isSymbolicLink()||!selectedInfo.isDirectory())fail();const path=await realpath(resolve(selected)),info=await lstat(path);if(path===dirname(path))fail();
    if(!ledger.folders.some(item=>item.taskId===c.taskId&&item.path===path)){if(ledger.folders.filter(item=>item.taskId===c.taskId).length>=8)fail();ledger.folders.push({id:randomUUID(),taskId:c.taskId,path,name:basename(path),device:String(info.dev),inode:String(info.ino)});guard();await this.persist(ledger);}return folders();
   }
   case 'code.folder.disconnect':{const folder=this.folder(ledger,c.taskId,c.folderId);ledger.folders=ledger.folders.filter(item=>item.id!==c.folderId);for(const [key,value] of this.reviews)if(ledger.files.some(file=>file.id===value.fileId&&file.folderId===c.folderId))this.reviews.delete(key);guard();await this.persist(ledger);if(folder.instructions?.enabled)this.retireGuidance(c.taskId);return folders();}
   case 'code.instructions.use':{
    const file=this.file(ledger,c.taskId,c.fileId),folder=this.folder(ledger,c.taskId,file.folderId),choice=folder.instructions??{revision:0,enabled:false};
    const latest=task.artifacts.find(item=>item.id===file.artifactId)?.revisions.at(-1);if(choice.revision!==c.expectedRevision||choice.revision===Number.MAX_SAFE_INTEGER||!same(file.reference,c.expected)||!latest||!same(file.reference,reference(file.artifactId,latest)))fail();const opened=await this.snapshot(ledger,file,guard);if(opened.observation.kind!=='current'||Buffer.byteLength(opened.revision.content)>FOLDER_INSTRUCTIONS_BYTES)fail();
    for(const other of ledger.folders.filter(item=>item.taskId===c.taskId&&item.id!==folder.id&&item.instructions?.enabled)){if(other.instructions!.revision===Number.MAX_SAFE_INTEGER)fail();other.instructions={...other.instructions!,revision:other.instructions!.revision+1,enabled:false};}
    folder.instructions={revision:choice.revision+1,enabled:true,fileId:file.id};guard();await this.persist(ledger);this.retireGuidance(c.taskId);return folders();
   }
   case 'code.instructions.disable':{const folder=this.folder(ledger,c.taskId,c.folderId),choice=folder.instructions??{revision:0,enabled:false};if(choice.revision!==c.expectedRevision||choice.revision===Number.MAX_SAFE_INTEGER)fail();folder.instructions={...choice,revision:choice.revision+1,enabled:false};guard();await this.persist(ledger);this.retireGuidance(c.taskId);return folders();}
   case 'code.folder.list':{
    const folder=this.folder(ledger,c.taskId,c.folderId),path=await this.path(folder,c.relativePath,true),entries:CodeListing['entries']=[];let omitted=0,seen=0;
    const directory=await opendir(path);for await(const entry of directory){if(++seen>1000){omitted++;break;}if(!allowedName(entry.name)||entry.isSymbolicLink()||!entry.isDirectory()&&(!entry.isFile()||!supportedFile(entry.name))||entries.length>=200){omitted++;continue;}entries.push({name:entry.name,relativePath:c.relativePath?c.relativePath+'/'+entry.name:entry.name,kind:entry.isDirectory()?'directory':'file'});}guard();return {kind:'listing',folderId:folder.id,relativePath:c.relativePath,entries:entries.sort((a,b)=>a.kind===b.kind?a.name.localeCompare(b.name):a.kind==='directory'?-1:1),omitted};
   }
   case 'code.file.open':{
    const folder=this.folder(ledger,c.taskId,c.folderId),existing=ledger.files.find(item=>item.folderId===folder.id&&item.relativePath===c.relativePath);if(existing)return this.snapshot(ledger,existing,guard);
    const disk=await this.read(folder,c.relativePath);await this.owner(c.taskId,guard);if(ledger.files.filter(item=>item.taskId===c.taskId).length>=200)fail();
    const saved=await this.options.core.saveArtifact(task.id,{title:basename(c.relativePath),content:disk.content,mimeType:LOCAL_CODE_MIME,sourceRefs:[]});const file:File={id:randomUUID(),taskId:task.id,folderId:folder.id,relativePath:c.relativePath,artifactId:saved.artifactId,reference:reference(saved.artifactId,saved.revision)};ledger.files.push(file);await this.persist(ledger);return this.snapshot(ledger,file,guard);
   }
   case 'code.file.check':return this.snapshot(ledger,this.file(ledger,c.taskId,c.fileId),guard);
   case 'code.file.reload':{
    const file=this.file(ledger,c.taskId,c.fileId),folder=this.folder(ledger,c.taskId,file.folderId),opened=await this.snapshot(ledger,file,guard);if(!same(file.reference,c.expected)||opened.observation.kind!=='changed'||opened.observation.digest!==c.observedDigest)fail();const disk=await this.read(folder,file.relativePath);if(disk.digest!==c.observedDigest)fail();await this.owner(c.taskId,guard);const saved=await this.options.core.saveArtifact(task.id,{artifactId:file.artifactId,expectedRevision:c.expected.revision,title:opened.revision.title,content:disk.content,mimeType:LOCAL_CODE_MIME,sourceRefs:[],expectedArtifacts:[c.expected]});file.reference=reference(file.artifactId,saved.revision);await this.persist(ledger);if(folder.instructions?.enabled&&folder.instructions.fileId===file.id)this.retireGuidance(c.taskId);return this.snapshot(ledger,file,guard);
   }
   case 'code.file.review':{
    const file=this.file(ledger,c.taskId,c.fileId),opened=await this.snapshot(ledger,file,guard),latest=task.artifacts.find(item=>item.id===file.artifactId)?.revisions.at(-1);if(!same(file.reference,c.expected)||!latest||!same(reference(file.artifactId,latest),c.expected)||opened.observation.kind!=='current')fail();const bytes=Buffer.from(c.content);if(bytes.length>CODE_FILE_BYTES||bytes.toString('utf8')!==c.content||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(c.content)||hash(bytes)===opened.revision.digest)fail();
    const review:CodeReview={kind:'review',id:randomUUID(),fileId:file.id,path:opened.path,before:opened.revision.content,after:c.content,beforeDigest:opened.revision.digest,afterDigest:hash(bytes),expected:c.expected};for(const [id,prior] of this.reviews)if(prior.fileId===file.id)this.reviews.delete(id);this.reviews.set(review.id,review);return structuredClone(review);
   }
   case 'code.file.save':return this.save(c,ledger,guard);
  }
 }
 private async save(c:Extract<CodeCommand,{type:'code.file.save'}>,ledger:Ledger,guard:()=>void):Promise<CodeSaved>{
  const file=this.file(ledger,c.taskId,c.fileId),folder=this.folder(ledger,c.taskId,file.folderId),review=this.reviews.get(c.reviewId);
  if(!review||review.fileId!==file.id||!same(review.expected,file.reference))fail();this.reviews.delete(c.reviewId);
  const task=await this.owner(c.taskId,guard),latest=task.artifacts.find(item=>item.id===file.artifactId)?.revisions.at(-1);if(!latest||!same(reference(file.artifactId,latest),review.expected))fail();const disk=await this.read(folder,file.relativePath);if(disk.digest!==review.beforeDigest||disk.path!==review.path)fail();
  const receipt:CodeReceipt={id:review.id,path:disk.path,beforeDigest:disk.digest,afterDigest:review.afterDigest,byteLength:Buffer.byteLength(review.after),backupPath:join(this.options.directory,'code-backups',review.id+'.bak'),savedAt:new Date().toISOString(),status:'prepared'};
  const temporary=join(dirname(disk.path),'.glint-write-'+review.id+'.tmp');let replaced=false;
  try{
   await mkdir(dirname(receipt.backupPath),{recursive:true,mode:0o700});const backup=await open(receipt.backupPath,'wx',0o600);try{await backup.writeFile(disk.bytes);await backup.sync();}finally{await backup.close();}
   file.receipt=receipt;await this.persist(ledger);
   const output=await open(temporary,'wx',Number(disk.info.mode&0o777n));try{await output.writeFile(review.after,'utf8');await output.chmod(Number(disk.info.mode&0o777n));await output.sync();}finally{await output.close();}
   await this.owner(c.taskId,guard);const current=await this.read(folder,file.relativePath);if(current.digest!==disk.digest||current.info.dev!==disk.info.dev||current.info.ino!==disk.info.ino||current.info.mtimeNs!==disk.info.mtimeNs||current.info.ctimeNs!==disk.info.ctimeNs)fail();guard();await rename(temporary,disk.path);replaced=true;
   const directory=await open(dirname(disk.path),'r');try{await directory.sync();}finally{await directory.close();}const written=await this.read(folder,file.relativePath);if(written.digest!==review.afterDigest)fail();
   const saved=await this.options.core.saveArtifact(c.taskId,{artifactId:file.artifactId,expectedRevision:review.expected.revision,title:latest.title,content:review.after,mimeType:LOCAL_CODE_MIME,sourceRefs:[],expectedArtifacts:[review.expected]});file.reference=reference(file.artifactId,saved.revision);receipt.status='verified';file.receipt=receipt;await this.persist(ledger);if(folder.instructions?.enabled&&folder.instructions.fileId===file.id)this.retireGuidance(c.taskId);return {kind:'saved',fileId:file.id,task:await this.options.core.getTask(c.taskId),revision:saved.revision,receipt};
  }catch(error){receipt.status=replaced?'uncertain':'not-written';file.receipt=receipt;try{await this.persist(ledger);}catch{}throw error;}finally{await rm(temporary,{force:true});}
 }
}
