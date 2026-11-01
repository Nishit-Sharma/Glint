import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {basename,extname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {Schema} from 'effect';
import type {Companion} from '../core/companion';
import {readPickedDocumentBytes} from './document-import';
import {PDF_PAGE_LIMITS,pdfPageMessages as messages,type PdfPageOwner,type PdfPageReview,type PdfPagePreview,type PdfPageCommand,type PdfPageAddResult} from '../shared/pdf-page-import';

const exec=promisify(execFile),hash=(value:Buffer)=>createHash('sha256').update(value).digest('hex'),knownMessages=new Set<string>(Object.values(messages));
const error=Schema.Struct({kind:Schema.Literal('error'),reason:Schema.Literal('failed','pdf','text','page','render')});
const info=Schema.Struct({kind:Schema.Literal('pdf'),pageCount:Schema.Int.pipe(Schema.between(1,PDF_PAGE_LIMITS.pages))});
const page=Schema.Struct({kind:Schema.Literal('page'),page:Schema.Int.pipe(Schema.between(1,PDF_PAGE_LIMITS.pages)),pageCount:Schema.Int.pipe(Schema.between(1,PDF_PAGE_LIMITS.pages)),width:Schema.Int.pipe(Schema.between(1,1600)),height:Schema.Int.pipe(Schema.between(1,1600)),png:Schema.String.pipe(Schema.maxLength(12*1024*1024))});
export async function readPdfHelper(copy:string,mode:'inspect'|'page',signal:AbortSignal,number?:number,executable?:string){
 if(process.platform!=='darwin')throw Error('Visual PDF page import requires the macOS PDFKit helper.');
 const helper=executable??fileURLToPath(new URL('../native/pdf-text',import.meta.url)).replace(/app\.asar\//,'app.asar.unpacked/');
 const args=mode==='inspect'?['--inspect',copy]:['--page',copy,String(number)];
 try{const {stdout}=await exec(helper,args,{timeout:12000,maxBuffer:12*1024*1024,signal,encoding:'utf8'});const reply=Schema.decodeUnknownSync(Schema.Union(error,info,page),{onExcessProperty:'error'})(JSON.parse(stdout));if(reply.kind==='error')throw Error(reply.reason==='pdf'?messages.pdf:reply.reason==='page'?messages.page:messages.render);return reply;}
 catch(reason){signal.throwIfAborted();if(reason instanceof Error&&knownMessages.has(reason.message))throw reason;throw Error(messages.render);}
}
type PreparedImage=Parameters<Companion['addPdfPageSources']>[1];
type Pending={owner:PdfPageOwner;abort:AbortController;expires:number;directory?:string;copy?:string;review?:PdfPageReview;timer?:ReturnType<typeof setTimeout>;previews:Map<number,PdfPagePreview['provenance']>;ids:Map<number,string>;saving:boolean;releaseAfterSave?:boolean;prepared?:{payload:string;images:PreparedImage};result?:PdfPageAddResult};
/** One native-picker-owned immutable PDF snapshot; no renderer paths or file watching. */
export class PdfPageImports{
 private pending?:Pending;
 constructor(private readonly core:Pick<Companion,'getTask'|'addPdfPageSources'>,private readonly choose:()=>Promise<string|undefined>,private readonly helper:typeof readPdfHelper=readPdfHelper){}
 private current(pending:Pending,guard:()=>void){guard();if(this.pending!==pending||pending.abort.signal.aborted||Date.now()>=pending.expires)throw Error(messages.stale);}
 private async release(pending:Pending){pending.abort.abort();if(pending.timer)clearTimeout(pending.timer);if(this.pending===pending)this.pending=undefined;if(pending.directory)await rm(pending.directory,{recursive:true,force:true});}
 async close(){if(this.pending)await this.release(this.pending);}
 async cancel(owner:PdfPageOwner){const pending=this.pending;if(pending?.owner.taskId===owner.taskId&&pending.owner.attemptId===owner.attemptId){if(pending.saving)pending.releaseAfterSave=true;else await this.release(pending);}return null;}
 async pick(owner:PdfPageOwner,guard:()=>void):Promise<PdfPageReview|{kind:'cancelled'}>{
  guard();if(this.pending&&Date.now()<this.pending.expires)throw Error(messages.busy);if(this.pending)await this.release(this.pending);
  const pending:Pending={owner,abort:new AbortController(),expires:Date.now()+15*60_000,previews:new Map(),ids:new Map(),saving:false};this.pending=pending;
  pending.timer=setTimeout(()=>{if(pending.saving)pending.releaseAfterSave=true;else void this.release(pending);},15*60_000);pending.timer.unref();
  try{
   const task=await this.core.getTask(owner.taskId);this.current(pending,guard);if(task.status!=='active'||task.archive||task.session?.browserContext)throw Error(messages.inactive);
   const selected=await this.choose();this.current(pending,guard);if(!selected){await this.release(pending);return {kind:'cancelled'};}if(extname(selected).toLowerCase()!=='.pdf')throw Error(messages.file);
   const bytes=await readPickedDocumentBytes(selected,pending.abort.signal);this.current(pending,guard);if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw Error(messages.pdf);
   pending.directory=await mkdtemp(join(tmpdir(),'glint-visual-pdf-'));this.current(pending,guard);pending.copy=join(pending.directory,'selected.pdf');await writeFile(pending.copy,bytes,{mode:0o400});this.current(pending,guard);
   const reply=await this.helper(pending.copy,'inspect',pending.abort.signal);this.current(pending,guard);if(reply.kind!=='pdf')throw Error(messages.pdf);
   pending.review={...owner,kind:'review',fileName:basename(selected).replace(/[\u0000-\u001f\u007f]/g,'').slice(0,200)||'Selected PDF',fileDigest:hash(bytes),byteLength:bytes.length,pageCount:reply.pageCount};return pending.review;
  }catch(reason){await this.release(pending);throw reason;}
 }
 private owner(owner:PdfPageOwner,guard:()=>void){const pending=this.pending;if(!pending||pending.owner.taskId!==owner.taskId||pending.owner.attemptId!==owner.attemptId||!pending.copy||!pending.review)throw Error(messages.stale);this.current(pending,guard);return pending;}
 async preview(owner:PdfPageOwner,number:number,guard:()=>void):Promise<PdfPagePreview>{
  const pending=this.owner(owner,guard),review=pending.review!;if(!Number.isInteger(number)||number<1||number>review.pageCount)throw Error(messages.page);
  const reply=await this.helper(pending.copy!,'page',pending.abort.signal,number);this.current(pending,guard);if(reply.kind!=='page'||reply.page!==number||reply.pageCount!==review.pageCount)throw Error(messages.changed);
  const png=Buffer.from(reply.png,'base64');if(png.length<24||png.length>PDF_PAGE_LIMITS.pngBytes||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||png.readUInt32BE(16)!==reply.width||png.readUInt32BE(20)!==reply.height)throw Error(messages.render);
  const provenance={fileName:review.fileName,fileDigest:review.fileDigest,byteLength:review.byteLength,page:number,pageCount:review.pageCount,width:reply.width,height:reply.height,pngDigest:hash(png),renderedAt:new Date().toISOString(),method:'macOS PDFKit raster' as const,box:'cropBox' as const};pending.previews.set(number,provenance);return {provenance,dataUrl:'data:image/png;base64,'+reply.png};
 }
 async add(input:Extract<PdfPageCommand,{type:'source.pdf.add'}>,guard:()=>void):Promise<PdfPageAddResult>{
  const pending=this.owner(input,guard);if(pending.saving)throw Error(messages.busy);const payload=JSON.stringify(input);if(pending.prepared&&pending.prepared.payload!==payload)throw Error(messages.changed);if(pending.result)return pending.result;
  pending.saving=true;
  try{
   if(!pending.prepared){
    const images=[];for(const selected of input.pages){const reviewed=pending.previews.get(selected.page);if(!reviewed||reviewed.pngDigest!==selected.pngDigest)throw Error(messages.changed);const rendered=await this.preview(input,selected.page,guard);if(rendered.provenance.pngDigest!==selected.pngDigest||rendered.provenance.width!==reviewed.width||rendered.provenance.height!==reviewed.height)throw Error(messages.changed);const id=pending.ids.get(selected.page)??randomUUID();pending.ids.set(selected.page,id);images.push({id,kind:'image' as const,label:`${reviewed.fileName} · page ${selected.page} of ${reviewed.pageCount}`.slice(0,200),content:rendered.dataUrl,role:input.role,pdfPage:reviewed});}
    pending.prepared={payload,images};
   }
   this.current(pending,guard);const result=await this.core.addPdfPageSources(input.taskId,pending.prepared.images,()=>this.current(pending,guard));pending.result=result;return result;
  }finally{pending.saving=false;if(pending.releaseAfterSave||Date.now()>=pending.expires)await this.release(pending);}
 }
}
