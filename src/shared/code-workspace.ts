import {Schema} from 'effect';
import type {ArtifactRef,ArtifactRevision,Task} from '../core/types';
export const LOCAL_CODE_MIME='text/x-glint-local-file';
export const CODE_FILE_BYTES=256*1024;
export const FOLDER_INSTRUCTIONS_BYTES=20_000;
export const CODE_WORKSPACE_ERROR='This local file operation could not be confirmed. Your saved versions and unfinished edits are kept. Read the folder again before another save.';
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const path=Schema.String.pipe(Schema.maxLength(2048),Schema.filter(value=>!value.includes('\0')));
const digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
export const CodeReferenceSchema=Schema.Struct({artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest});
const owner={taskId:id},fileOwner={...owner,fileId:id};
const counter=Schema.Int.pipe(Schema.between(0,Number.MAX_SAFE_INTEGER));
const commandSchema=Schema.Union(
 Schema.Struct({type:Schema.Literal('code.folder.get','code.folder.choose'),...owner}),
 Schema.Struct({type:Schema.Literal('code.folder.disconnect'),...owner,folderId:id}),
 Schema.Struct({type:Schema.Literal('code.folder.list'),...owner,folderId:id,relativePath:path}),
 Schema.Struct({type:Schema.Literal('code.file.open'),...owner,folderId:id,relativePath:path}),
 Schema.Struct({type:Schema.Literal('code.file.check'),...fileOwner}),
 Schema.Struct({type:Schema.Literal('code.instructions.use'),...fileOwner,expectedRevision:counter,expected:CodeReferenceSchema}),
 Schema.Struct({type:Schema.Literal('code.instructions.disable'),...owner,folderId:id,expectedRevision:counter}),
 Schema.Struct({type:Schema.Literal('code.file.reload'),...fileOwner,expected:CodeReferenceSchema,observedDigest:digest}),
 Schema.Struct({type:Schema.Literal('code.file.review'),...fileOwner,expected:CodeReferenceSchema,content:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(CODE_FILE_BYTES))}),
 Schema.Struct({type:Schema.Literal('code.file.save'),...fileOwner,reviewId:id,confirmed:Schema.Literal('write-reviewed-file')})
);
export type CodeCommand=typeof commandSchema.Type;
export const readCodeCommand=(value:unknown):CodeCommand=>{try{return Schema.decodeUnknownSync(commandSchema,{onExcessProperty:'error'})(value);}catch{throw Error(CODE_WORKSPACE_ERROR);}};
export function isCodeCommand(value:{type:string}):value is CodeCommand{return value.type.startsWith('code.');}
export type CodeFolderInstructions={revision:number;enabled:boolean;fileId?:string};
export type FolderResponseGuidance={folderId:string;folderName:string;fileId:string;relativePath:string;selectionRevision:number;reference:ArtifactRef;text:string};
export type CodeFolder={id:string;taskId:string;path:string;name:string;instructions?:CodeFolderInstructions};
export type CodeFile={id:string;folderId:string;relativePath:string;artifactId:string};
export type CodeFolders={kind:'folders';folders:CodeFolder[];files:CodeFile[]};
export type CodeListing={kind:'listing';folderId:string;relativePath:string;entries:{name:string;relativePath:string;kind:'directory'|'file'}[];omitted:number};
export type CodeObservation={kind:'current';digest:string}|{kind:'changed';digest:string;content:string}|{kind:'unavailable'};
export type CodeOpened={kind:'opened';file:CodeFile;path:string;task:Task;revision:ArtifactRevision;observation:CodeObservation;receipt?:CodeReceipt};
export type CodeReview={kind:'review';id:string;fileId:string;path:string;before:string;after:string;beforeDigest:string;afterDigest:string;expected:ArtifactRef};
export type CodeReceipt={id:string;path:string;beforeDigest:string;afterDigest:string;byteLength:number;backupPath:string;savedAt:string;status:'prepared'|'verified'|'uncertain'|'not-written'};
export type CodeSaved={kind:'saved';fileId:string;task:Task;revision:ArtifactRevision;receipt:CodeReceipt};
