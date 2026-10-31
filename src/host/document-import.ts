import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {constants} from 'node:fs';
import {open,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {basename,extname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {Schema} from 'effect';
import type {Companion} from '../core/companion';
import {DOCUMENT_IMPORT_FILE_LIMIT,DOCUMENT_IMPORT_TEXT_LIMIT,documentImportMessages as messages,type ImportedDocument,type DocumentImportOwner,type DocumentImportAdd,type DocumentImportChoice,type DocumentImportResult} from '../shared/document-import';

const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const exec=promisify(execFile);
const knownMessages=new Set<string>(Object.values(messages));
const PdfReply=Schema.Union(Schema.Struct({kind:Schema.Literal('error'),reason:Schema.Literal('failed','pdf','text')}),Schema.Struct({kind:Schema.Literal('text'),text:Schema.String.pipe(Schema.maxLength(DOCUMENT_IMPORT_TEXT_LIMIT)),pageCount:Schema.Int.pipe(Schema.positive(),Schema.lessThanOrEqualTo(200)),emptyPages:Schema.Array(Schema.Int.pipe(Schema.positive(),Schema.lessThanOrEqualTo(200)))}));
const formatOf=(path:string):ImportedDocument['format']=>{
 const ext=extname(path).toLowerCase().slice(1);
 if(ext==='pdf'||ext==='docx'||ext==='doc'||ext==='txt'||ext==='md')return ext;
 throw Error(messages.unsupported);
};
function readable(text:string){
 if(text.length>DOCUMENT_IMPORT_TEXT_LIMIT)throw Error(messages.text);
 if(!text.trim())throw Error(messages.empty);
 if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))throw Error(messages.failed);
 return text;
}
/** Only a native-picker path enters this function. Parse an immutable private copy. */
export async function extractDocument(path:string,signal:AbortSignal):Promise<ImportedDocument>{
 const format=formatOf(path);if(!['txt','md'].includes(format)&&process.platform!=='darwin')throw Error(messages.platform);
 let bytes:Buffer;
 try{
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const before=await file.stat();if(!before.isFile())throw Error(messages.file);if(before.size>DOCUMENT_IMPORT_FILE_LIMIT)throw Error(messages.size);
   bytes=Buffer.alloc(before.size+1);let offset=0;while(offset<bytes.length){const result=await file.read(bytes,offset,bytes.length-offset,null);if(!result.bytesRead)break;offset+=result.bytesRead;}
   const after=await file.stat();if(offset!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error(messages.file);bytes=bytes.subarray(0,offset);
  }finally{await file.close();}
 }catch(error){if(error instanceof Error&&knownMessages.has(error.message))throw error;throw Error(messages.file);}
 signal.throwIfAborted();
 let text='',method='',pageCount:number|undefined;const warnings:string[]=[];
 if(format==='txt'||format==='md'){
  try{const encoding=bytes[0]===0xff&&bytes[1]===0xfe?'utf-16le':bytes[0]===0xfe&&bytes[1]===0xff?'utf-16be':'utf-8';text=new TextDecoder(encoding,{fatal:true}).decode(bytes);method=`Local ${encoding} text decoding`;}catch{throw Error(messages.failed);}
 }else{
  const directory=await mkdtemp(join(tmpdir(),'glint-document-'));
  try{
   const copy=join(directory,'selected.'+format);await writeFile(copy,bytes,{mode:0o600});signal.throwIfAborted();
   if(format==='pdf'){
    if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw Error(messages.failed);
    const executable=fileURLToPath(new URL('../native/pdf-text',import.meta.url)).replace(/app\.asar\//,'app.asar.unpacked/');
    const {stdout}=await exec(executable,[copy],{timeout:12_000,maxBuffer:2*1024*1024,signal,encoding:'utf8'});
    const reply=Schema.decodeUnknownSync(PdfReply,{onExcessProperty:'error'})(JSON.parse(stdout));if(reply.kind==='error')throw Error(messages[reply.reason]);
    text=reply.text;pageCount=reply.pageCount;method='macOS PDFKit text layer';
    warnings.push('Only the PDF text layer is imported. Reading order and tables may need correction; images, handwriting and scanned text are not extracted.');
    if(reply.emptyPages.length)warnings.push(`No text was extracted from ${reply.emptyPages.length} page(s): ${reply.emptyPages.slice(0,20).join(', ')}${reply.emptyPages.length>20?'…':''}. These pages may be blank or scanned.`);
   }else{
    if(format==='docx'){
     if(bytes.readUInt32LE(0)!==0x04034b50)throw Error(messages.failed);
     const {stdout:summary}=await exec('/usr/bin/unzip',['-Z','-t',copy],{timeout:3000,maxBuffer:4096,signal,encoding:'utf8',env:{...process.env,LC_ALL:'C'}});
     const totals=/^(\d+) files?, (\d+) bytes uncompressed/m.exec(summary);if(!totals||Number(totals[1])>2000||Number(totals[2])>64*1024*1024)throw Error(messages.word);
    }else if(!bytes.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex')))throw Error(messages.failed);
    const {stdout}=await exec('/usr/bin/textutil',['-convert','txt','-stdout','-encoding','UTF-8','-format',format,'-noload','-nostore','--',copy],{timeout:12_000,maxBuffer:800_000,signal,encoding:'utf8'});
    text=stdout;method='macOS textutil '+format.toUpperCase()+' text conversion';warnings.push('Only readable document text is imported. Images, comments, tracked-change history and layout are not preserved. Check tables and reading order before adding.');
   }
  }catch(error){signal.throwIfAborted();if(error instanceof Error&&knownMessages.has(error.message))throw error;throw Error(messages.failed);}
  finally{await rm(directory,{recursive:true,force:true});}
 }
 signal.throwIfAborted();
 return {fileName:basename(path).replace(/[\u0000-\u001f\u007f]/g,'').slice(0,200),fileDigest:hash(bytes),byteLength:bytes.length,format,method,extractedAt:new Date().toISOString(),text:readable(text),warnings,...(pageCount===undefined?{}:{pageCount})};
}

type Pending={owner:DocumentImportOwner;abort:AbortController;expires:number;document?:ImportedDocument;sourceId:string;saving:boolean;payload?:string;result?:DocumentImportResult};
/** A single local review receipt binds file bytes and reviewed text to one task. */
export class DocumentImports{
 private pending:Pending|undefined;
 constructor(private readonly core:Pick<Companion,'getTask'|'putSource'>,private readonly choose:()=>Promise<string|undefined>){}
 cancel(owner:DocumentImportOwner){const pending=this.pending;if(pending?.owner.taskId===owner.taskId&&pending.owner.attemptId===owner.attemptId&&!pending.saving){pending.abort.abort();this.pending=undefined;}return null;}
 private current(pending:Pending,guard:()=>void){guard();if(this.pending!==pending||pending.abort.signal.aborted||Date.now()>=pending.expires)throw Error(messages.stale);}
 async pick(owner:DocumentImportOwner,guard:()=>void):Promise<DocumentImportChoice>{
  guard();if(this.pending&&Date.now()<this.pending.expires)throw Error(messages.busy);this.pending?.abort.abort();
  const pending:Pending={owner,abort:new AbortController(),expires:Date.now()+15*60_000,sourceId:randomUUID(),saving:false};this.pending=pending;
  try{const task=await this.core.getTask(owner.taskId);this.current(pending,guard);if(task.status!=='active'||task.archive)throw Error(messages.inactive);const path=await this.choose();this.current(pending,guard);if(!path){this.pending=undefined;return {kind:'cancelled'};}pending.document=await extractDocument(path,pending.abort.signal);this.current(pending,guard);return {...pending.document,...owner,kind:'review'};}
  catch(error){if(this.pending===pending)this.pending=undefined;throw error;}
 }
 async add(input:DocumentImportAdd,guard:()=>void):Promise<DocumentImportResult>{
  const pending=this.pending;if(!pending||pending.owner.taskId!==input.taskId||pending.owner.attemptId!==input.attemptId||!pending.document)throw Error(messages.stale);
  this.current(pending,guard);const payload=JSON.stringify(input);if(pending.result){if(pending.payload!==payload)throw Error(messages.changed);return pending.result;}if(pending.saving)throw Error(messages.busy);
  pending.saving=true;
  try{
   const task=await this.core.getTask(input.taskId);this.current(pending,guard);if(task.status!=='active'||task.archive)throw Error(messages.inactive);
   const doc=pending.document,content=['# Imported document snapshot',`File: ${JSON.stringify(doc.fileName)}\nFormat: ${doc.format.toUpperCase()}\nFile SHA-256: ${doc.fileDigest}\nOriginal size: ${doc.byteLength} bytes\nExtracted locally: ${doc.extractedAt}\nMethod: ${doc.method}${doc.pageCount===undefined?'':`\nPDF pages: ${doc.pageCount}`}\nExtracted text SHA-256: ${hash(doc.text)}\nReviewed text: ${input.content===doc.text?'unchanged':'corrected by user before adding'}`,'This is an independent local text snapshot. The original file is not linked or monitored. Images and scanned text were not extracted.',...doc.warnings,'## Reviewed document text',readable(input.content)].join('\n\n');
   const saved=await this.core.putSource(input.taskId,{id:pending.sourceId,kind:'text',label:input.label.trim(),content,role:input.role},task,undefined,()=>this.current(pending,guard),{preserveBrowserContextForNewText:true});
   const version=saved.sources.find(source=>source.id===pending.sourceId)!.versions.at(-1)!;pending.payload=payload;pending.result={task:saved,reference:{sourceId:pending.sourceId,version:version.version,digest:version.digest}};return pending.result;
  }finally{pending.saving=false;}
 }
}
