import {randomUUID} from 'node:crypto';
import {open,link,unlink,realpath,lstat} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';
import type {UserMemory} from '../shared/user-memory';
import {memoryExportSnapshot,readMemoryExportCommand,type MemoryExportCommand,type MemoryExportResult} from '../shared/memory-export';
async function publishMemoryExport(path:string,body:string){
 if(!isAbsolute(path)||path!==resolve(path)||path.includes('\0'))throw Error('Choose an exact memory export destination.');
 const parent=await realpath(dirname(path)),before=await lstat(parent),destination=join(parent,basename(path)),temporary=join(parent,`.glint-memory-export-${randomUUID()}.tmp`);let published=false;
 try{
  const file=await open(temporary,'wx',0o600);try{await file.writeFile(body,'utf8');await file.sync();}finally{await file.close();}
  const after=await lstat(parent);if(before.dev!==after.dev||before.ino!==after.ino)throw Error('The memory export destination changed. Choose it again.');
  await link(temporary,destination);published=true;
  const directory=await open(parent,'r');try{await directory.sync();}finally{await directory.close();}
 }catch(error){
  if(published)throw Error('The memory file may have been saved. Check the destination before exporting again.');
  if(error&&typeof error==='object'&&'code'in error&&error.code==='EEXIST')throw Error('A file already exists at this destination. Choose a new filename.');
  if(error instanceof Error&&error.message==='The memory export destination changed. Choose it again.')throw error;
  throw Error('The memory export could not be saved. No destination file was created.');
 }finally{await unlink(temporary).catch(()=>{});}
}
/** One user-selected local JSON write. The destination can only come from the native chooser. */
export class MemoryExports{
 private busy=false;
 constructor(private readonly readCurrent:()=>Promise<UserMemory>,private readonly choose:(info:{count:number})=>Promise<string|null>,private readonly now=()=>new Date()){}
 async save(input:MemoryExportCommand,assertCurrent:()=>void=()=>{}):Promise<MemoryExportResult>{
  const command=readMemoryExportCommand(input);if(this.busy)throw Error('Finish the current memory export before starting another.');this.busy=true;
  try{
   assertCurrent();memoryExportSnapshot(await this.readCurrent(),command,this.now().toISOString());
   const path=await this.choose({count:command.facts.length});if(!path)return {kind:'cancelled'};
   assertCurrent();const current=await this.readCurrent();assertCurrent();const snapshot=memoryExportSnapshot(current,command,this.now().toISOString()),body=JSON.stringify(snapshot,null,2)+'\n';
   await publishMemoryExport(path,body);return {kind:'saved',path,count:snapshot.facts.length,byteLength:Buffer.byteLength(body,'utf8'),memoryRevision:current.revision};
  }finally{this.busy=false;}
 }
}
