import {Schema} from 'effect';
import type {SourceRef,Task} from '../core/types';

export const PUBLIC_GITHUB_ORIGIN='https://api.github.com';
export const PUBLIC_GITHUB_README_LIMIT=256*1024;
const bounded=(max:number)=>Schema.String.pipe(Schema.maxLength(max),Schema.filter(value=>!/[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)));
const id=bounded(200).pipe(Schema.minLength(1));
const repository=bounded(140).pipe(Schema.filter(value=>/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?\/[a-z0-9._-]{1,100}$/.test(value)&&!value.split('/')[0].includes('--')&&!['.','..'].includes(value.split('/')[1])));
const sha=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{40,64}$/));
const iso=Schema.String.pipe(Schema.filter(value=>/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))));
export const PublicGithubSnapshotSchema=Schema.Struct({repository,defaultBranch:bounded(250).pipe(Schema.minLength(1)),path:bounded(1000).pipe(Schema.minLength(1)),blobSha:sha,snapshotAt:iso,description:bounded(2000),stars:Schema.Int.pipe(Schema.between(0,Number.MAX_SAFE_INTEGER))});
export const PublicGithubConnectionSchema=Schema.Struct({repository,sourceId:id,checkedAt:iso,readmeSha:sha});
export type PublicGithubSnapshot=typeof PublicGithubSnapshotSchema.Type;
export type PublicGithubConnection=typeof PublicGithubConnectionSchema.Type;
const reference=Schema.Struct({sourceId:id,version:Schema.Int.pipe(Schema.positive()),digest:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))});
const capture=Schema.Struct({type:Schema.Literal('github.capture'),taskId:id,operationId:id,repository,expectedConnection:Schema.NullOr(PublicGithubConnectionSchema),expectedSource:Schema.optional(reference)});
const disconnect=Schema.Struct({type:Schema.Literal('github.disconnect'),taskId:id,expectedConnection:PublicGithubConnectionSchema});
const cancel=Schema.Struct({type:Schema.Literal('github.cancel'),taskId:id,operationId:id});
export type PublicGithubCommand=typeof capture.Type|typeof disconnect.Type|typeof cancel.Type;
export type PublicGithubCapture=typeof capture.Type;
export type PublicGithubResult={task:Task;reference:SourceRef;unchanged:boolean};
export const readPublicGithubCommand=Schema.decodeUnknownSync(Schema.Union(capture,disconnect,cancel),{onExcessProperty:'error'});
export const readPublicGithubSnapshot=Schema.decodeUnknownSync(PublicGithubSnapshotSchema,{onExcessProperty:'error'});
export function samePublicGithubConnection(a:PublicGithubConnection|undefined|null,b:PublicGithubConnection|undefined|null):boolean{return !a||!b?!a&&!b:a.repository===b.repository&&a.sourceId===b.sourceId&&a.checkedAt===b.checkedAt&&a.readmeSha===b.readmeSha;}

/** Repository links discover only this service; they never become arbitrary fetch URLs. */
export function parsePublicGithubRepository(input:string):string{
 if(input.length>250||input!==input.trim())throw Error('Enter owner/repository or an exact https://github.com/owner/repository link.');
 let value=input;
 if(value.includes('://')){
  let url:URL;try{url=new URL(value);}catch{throw Error('Enter an exact GitHub repository link.');}
  if(url.protocol!=='https:'||url.hostname!=='github.com'||url.port||url.username||url.password||url.search||url.hash||!/^https:\/\/github\.com\/[a-z0-9-]+\/[a-z0-9._-]+\/?$/i.test(value))throw Error('Only an exact https://github.com/owner/repository link is supported.');
  value=url.pathname.slice(1).replace(/\/$/,'');
 }
 value=value.replace(/\.git$/i,'').toLowerCase();
 try{return Schema.decodeUnknownSync(repository)(value);}catch{throw Error('Enter one public GitHub owner/repository, without extra paths or URL parameters.');}
}
export function publicGithubSourceRef(task:Task):SourceRef|undefined{
 const source=task.sources.find(item=>item.id===task.publicGithub?.sourceId),version=source?.versions.at(-1);
 return source&&version?{sourceId:source.id,version:version.version,digest:version.digest}:undefined;
}
