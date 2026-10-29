import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {Schema} from 'effect';
import type {NativeWindow} from './native';
import type {DocumentObservation} from '../shared/document-source';

const Reply=Schema.Union(
 Schema.Struct({kind:Schema.Literal('document'),processId:Schema.Int.pipe(Schema.positive()),digest:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),edited:Schema.optional(Schema.Boolean)}),
 Schema.Struct({kind:Schema.Literal('frozen'),reason:Schema.Literal('permission','ambiguous','metadata-unavailable')}),
);
export type DocumentSourceDependencies={
 platform:string;
 trusted():Promise<boolean>;
 foreground():Promise<NativeWindow|undefined>;
 eligible(window:NativeWindow,assertCurrent:()=>void):Promise<boolean>;
 readFocusedDocument(processId:number,signal:AbortSignal):Promise<unknown>;
};
export async function readMacFocusedDocument(processId:number,signal:AbortSignal):Promise<unknown>{
 const executable=fileURLToPath(new URL('../native/document-source',import.meta.url)).replace(/app\.asar\//,'app.asar.unpacked/');
 const {stdout}=await promisify(execFile)(executable,[String(processId)],{timeout:1500,maxBuffer:4096,signal,encoding:'utf8'});
 return JSON.parse(stdout);
}
const sameTarget=(a:NativeWindow|undefined,b:NativeWindow)=>a?.id===b.id&&a.osId===b.osId&&a.owner.processId===b.owner.processId;

/** AX reports the focused application, not a proven AX-to-CGWindowID mapping. */
export class DocumentSourceAdapter{
 constructor(private readonly dependencies:DocumentSourceDependencies){}
 async observe(target:NativeWindow,options:{assertCurrent:()=>void;signal:AbortSignal}):Promise<DocumentObservation>{
  const {assertCurrent,signal}=options,deps=this.dependencies;
  const guard=()=>{assertCurrent();if(signal.aborted)throw Error('Document observation retired.');};
  guard();if(deps.platform!=='darwin')return {kind:'frozen',reason:'unsupported'};
  if(!await deps.eligible(target,guard)){guard();return {kind:'frozen',reason:'excluded'};}guard();
  const before=await deps.foreground();guard();if(!sameTarget(before,target))return {kind:'inactive',reason:'background'};
  if(!await deps.trusted()){guard();return {kind:'frozen',reason:'permission'};}guard();
  let raw:unknown;
  try{raw=await deps.readFocusedDocument(target.owner.processId,signal);}catch{guard();return {kind:'frozen',reason:'metadata-unavailable'};}guard();
  const parsed=Schema.decodeUnknownOption(Reply,{onExcessProperty:'error'})(raw);
  if(parsed._tag==='None')return {kind:'frozen',reason:'ambiguous'};
  const after=await deps.foreground();guard();
  if(!after||!sameTarget(after,target)||after.documentToken!==before?.documentToken)return {kind:'frozen',reason:'ambiguous'};
  if(!await deps.eligible(after,guard)){guard();return {kind:'frozen',reason:'excluded'};}guard();
  if(!await deps.trusted()){guard();return {kind:'frozen',reason:'permission'};}guard();
  if(parsed.value.kind==='frozen')return parsed.value;
  if(parsed.value.processId!==target.owner.processId)return {kind:'frozen',reason:'ambiguous'};
  return {kind:'document',stamp:{method:'ax-document',evidence:'foreground-application-correlation',digest:parsed.value.digest,...(parsed.value.edited===undefined?{}:{edited:parsed.value.edited})}};
 }
}
