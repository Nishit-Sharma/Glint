import {Schema} from 'effect';
import type {SourceRef,Task} from '../core/types';

export const PDF_PAGE_LIMITS={fileBytes:20*1024*1024,pages:200,selected:4,pixels:1600,pngBytes:8*1024*1024} as const;
export const pdfPageMessages={file:'Choose an accessible ordinary local PDF, up to 20 MiB.',pdf:'Choose an unencrypted, copyable PDF with 1–200 pages.',page:'Choose a page from this PDF.',render:'This page cannot be rendered within the visual import limits.',busy:'Finish or cancel the current visual PDF review first.',stale:'This visual PDF review ended. Inspect Context before choosing it again.',inactive:'Open an active ordinary text task before importing visual PDF pages.',changed:'The reviewed PDF page image changed. Review that exact page again.',selection:'Select one to four reviewed pages before adding.',images:'This inspector reads only explicitly selected imported PDF page images. Screen, window and other image sources are excluded.',textOnly:'The selected model explicitly advertises text-only input. Choose an image-capable model; no request was sent.'} as const;
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0'))),digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),page=Schema.Int.pipe(Schema.between(1,PDF_PAGE_LIMITS.pages)),pixel=Schema.Int.pipe(Schema.between(1,PDF_PAGE_LIMITS.pixels));
export const PdfPageProvenanceSchema=Schema.Struct({fileName:id,fileDigest:digest,byteLength:Schema.Int.pipe(Schema.between(1,PDF_PAGE_LIMITS.fileBytes)),page,pageCount:page,width:pixel,height:pixel,pngDigest:digest,renderedAt:id,method:Schema.Literal('macOS PDFKit raster'),box:Schema.Literal('cropBox')}).pipe(Schema.filter(value=>value.page<=value.pageCount));
export type PdfPageProvenance=typeof PdfPageProvenanceSchema.Type;
const image=Schema.Struct({id,kind:Schema.Literal('image'),label:id,content:Schema.String.pipe(Schema.maxLength(12*1024*1024)),role:Schema.Literal('fact','style','inspiration'),pdfPage:PdfPageProvenanceSchema});
export const readPdfPageImages=Schema.decodeUnknownSync(Schema.Array(image).pipe(Schema.minItems(1),Schema.maxItems(PDF_PAGE_LIMITS.selected),Schema.filter(value=>new Set(value.map(item=>item.id)).size===value.length&&new Set(value.map(item=>item.pdfPage.page)).size===value.length&&value.every(item=>item.pdfPage.fileDigest===value[0].pdfPage.fileDigest))),{onExcessProperty:'error'});
export type PdfPageOwner={taskId:string;attemptId:string};
const owner={taskId:id,attemptId:Schema.String.pipe(Schema.pattern(/^[a-f0-9-]{36}$/))};
const selected=Schema.Struct({page,pngDigest:digest});
const commands=Schema.Union(
 Schema.Struct({type:Schema.Literal('source.pdf.choose'),...owner}),
 Schema.Struct({type:Schema.Literal('source.pdf.cancel'),...owner}),
 Schema.Struct({type:Schema.Literal('source.pdf.page'),...owner,page}),
 Schema.Struct({type:Schema.Literal('source.pdf.add'),...owner,pages:Schema.Array(selected).pipe(Schema.minItems(1),Schema.maxItems(PDF_PAGE_LIMITS.selected)),role:Schema.Literal('fact','style','inspiration')}),
 Schema.Struct({type:Schema.Literal('source.pdf.inspect'),taskId:id,prompt:Schema.String.pipe(Schema.maxLength(16000)),kind:Schema.Literal('explain','create'),sourceIds:Schema.Array(id).pipe(Schema.minItems(1),Schema.maxItems(12)),expectedSkillRevision:Schema.Int.pipe(Schema.between(0,Number.MAX_SAFE_INTEGER))}),
);
export type PdfPageCommand=typeof commands.Type;
export const isPdfPageCommand=(value:{type:string}):value is PdfPageCommand=>value.type.startsWith('source.pdf.');
export const readPdfPageCommand=(value:unknown)=>{const command=Schema.decodeUnknownSync(commands,{onExcessProperty:'error'})(value);if(command.type==='source.pdf.add'&&new Set(command.pages.map(item=>item.page)).size!==command.pages.length)throw Error(pdfPageMessages.selection);return command;};
export type PdfPageReview=PdfPageOwner&{kind:'review';fileName:string;fileDigest:string;byteLength:number;pageCount:number};
export type PdfPagePreview={provenance:PdfPageProvenance;dataUrl:string};
export type PdfPageAddResult={task:Task;references:SourceRef[];alreadyAdded:boolean};
