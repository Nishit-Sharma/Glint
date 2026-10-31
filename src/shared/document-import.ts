import {Schema} from 'effect';
import type {SourceRef,Task} from '../core/types';

export const DOCUMENT_IMPORT_TEXT_LIMIT=100_000;
export const DOCUMENT_IMPORT_FILE_LIMIT=20*1024*1024;
export const documentImportMessages={
 unsupported:'Choose a PDF, Word (.docx or .doc), plain-text (.txt) or Markdown (.md) file.',
 platform:'PDF and Word import is available on macOS. Plain-text and Markdown files can still be imported.',
 file:'This document could not be read. Choose an accessible, ordinary local file.',
 size:'Choose a document up to 20 MiB.',
 text:'The extracted text exceeds 100,000 characters. Split the document into smaller files.',
 empty:'No readable text was found. Scanned pages and images need OCR before import; Glint does not extract their text.',
 failed:'This document could not be extracted safely. It may be damaged, encrypted or unsupported. Save a readable copy and choose it again.',
 pdf:'This PDF cannot be copied or exceeds the 200-page import limit. Choose an unlocked, smaller copy.',
 word:'This Word document exceeds the extraction resource limit. Save a smaller copy and choose it again.',
 stale:'This document review has ended. Choose the file again before adding it.',
 inactive:'Open and resume the destination task before importing a document.',
 busy:'Finish or cancel the current document import before choosing another file.',
 changed:'This import was already added with different text. Review its saved source in Context.',
} as const;
export type ImportedDocument={fileName:string;fileDigest:string;byteLength:number;format:'pdf'|'docx'|'doc'|'txt'|'md';method:string;extractedAt:string;text:string;warnings:string[];pageCount?:number};
export type DocumentImportPreview=ImportedDocument&{kind:'review';taskId:string;attemptId:string};
export type DocumentImportChoice=DocumentImportPreview|{kind:'cancelled'};
export type DocumentImportResult={task:Task;reference:SourceRef};
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const attemptId=Schema.String.pipe(Schema.pattern(/^[a-f0-9-]{36}$/));
const owner=Schema.Struct({taskId:id,attemptId});
const add=Schema.Struct({taskId:id,attemptId,label:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!!value.trim()&&!value.includes('\0'))),content:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(DOCUMENT_IMPORT_TEXT_LIMIT),Schema.filter(value=>!!value.trim()&&!value.includes('\0'))),role:Schema.Literal('fact','style','inspiration')});
export type DocumentImportOwner=typeof owner.Type;
export type DocumentImportAdd=typeof add.Type;
export const readDocumentImportOwner=(value:unknown)=>Schema.decodeUnknownSync(owner,{onExcessProperty:'error'})(value);
export const readDocumentImportAdd=(value:unknown)=>Schema.decodeUnknownSync(add,{onExcessProperty:'error'})(value);
