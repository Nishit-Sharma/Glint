import {execFile} from 'node:child_process';
import {isAbsolute} from 'node:path';
import {promisify} from 'node:util';
import {Schema} from 'effect';
import type {SourceDragPoint} from './source-attachment';

const positiveId=Schema.Number.pipe(Schema.int(),Schema.between(1,Number.MAX_SAFE_INTEGER));
const WindowPointHitSchema=Schema.Struct({osId:positiveId,processId:positiveId,knownProtected:Schema.Boolean});
export type WindowPointHit=typeof WindowPointHitSchema.Type;
export type OwnedPointWindow=Pick<WindowPointHit,'osId'|'processId'>;
export type WindowPointTarget=(point:SourceDragPoint,ignored:readonly OwnedPointWindow[])=>Promise<WindowPointHit|undefined>;
export type WindowProtection=(osId:number,processId:number)=>Promise<WindowPointHit|undefined>;
type HelperDependencies={
 platform:string;
 run(path:string,args:readonly string[],options:{timeout:number;maxBuffer:number;encoding:'utf8'}):Promise<{stdout:string}>;
};
export class MacWindowTargetError extends Error{
 constructor(public readonly code:'TARGET_UNSUPPORTED'|'INVALID_ARGUMENT'|'WINDOW_UNAVAILABLE',message:string){super(message);this.name='MacWindowTargetError';}
}
const defaultDependencies:HelperDependencies={platform:process.platform,run:async(path,args,options)=>{
 const {stdout}=await promisify(execFile)(path,[...args],options);return {stdout};
}};

/** Static reviewed helper path only. This module never builds, downloads or installs native code. */
export function createMacWindowTarget(helperPath:string,dependencies:HelperDependencies=defaultDependencies):WindowPointTarget{
 if(!isAbsolute(helperPath)||helperPath.includes('\0'))throw new MacWindowTargetError('INVALID_ARGUMENT','Native target helper needs an absolute bundle path.');
 return async(point,ignored)=>{
  if(dependencies.platform!=='darwin')throw new MacWindowTargetError('TARGET_UNSUPPORTED','Native source targeting is unavailable on this platform. Choose a source explicitly.');
  if(![point.x,point.y].every(Number.isFinite)||Math.abs(point.x)>1_000_000||Math.abs(point.y)>1_000_000||ignored.length>8||ignored.some(window=>!Number.isSafeInteger(window.osId)||window.osId<=0||!Number.isSafeInteger(window.processId)||window.processId<=0))throw new MacWindowTargetError('INVALID_ARGUMENT','Invalid native drop point.');
  let stdout:string;
  try{({stdout}=await dependencies.run(helperPath,[String(point.x),String(point.y),...ignored.map(window=>`${window.osId}:${window.processId}`)],{timeout:2500,maxBuffer:4096,encoding:'utf8'}));}
  catch{throw new MacWindowTargetError('TARGET_UNSUPPORTED','Native source targeting is unavailable. Choose a source explicitly.');}
  try{
   if(stdout.length>4096)throw Error('Oversized native target.');
   const hit:unknown=JSON.parse(stdout);if(hit===null)return;
   return Schema.decodeUnknownSync(WindowPointHitSchema,{onExcessProperty:'error'})(hit);
  }catch{throw new MacWindowTargetError('WINDOW_UNAVAILABLE','The native target helper returned an invalid identity.');}
 };
}

/** Query one exact native ID/PID without point-based retargeting or pixels. */
export function createMacWindowProtection(helperPath:string,dependencies:HelperDependencies=defaultDependencies):WindowProtection{
 if(!isAbsolute(helperPath)||helperPath.includes('\0'))throw new MacWindowTargetError('INVALID_ARGUMENT','Native target helper needs an absolute bundle path.');
 return async(osId,processId)=>{
  if(dependencies.platform!=='darwin')throw new MacWindowTargetError('TARGET_UNSUPPORTED','Native source targeting is unavailable on this platform. Choose a source explicitly.');
  if(!Number.isSafeInteger(osId)||osId<=0||!Number.isSafeInteger(processId)||processId<=0)throw new MacWindowTargetError('INVALID_ARGUMENT','Invalid native window identity.');
  let stdout:string;
  try{({stdout}=await dependencies.run(helperPath,['--window',String(osId),String(processId)],{timeout:2500,maxBuffer:4096,encoding:'utf8'}));}
  catch{throw new MacWindowTargetError('TARGET_UNSUPPORTED','Native source targeting is unavailable. Choose a source explicitly.');}
  try{
   if(stdout.length>4096)throw Error('Oversized native target.');
   const value:unknown=JSON.parse(stdout);if(value===null)return;
   const hit=Schema.decodeUnknownSync(WindowPointHitSchema,{onExcessProperty:'error'})(value);
   if(hit.osId!==osId||hit.processId!==processId)throw Error('Native identity changed.');
   return hit;
  }catch{throw new MacWindowTargetError('WINDOW_UNAVAILABLE','The native target helper returned an invalid identity.');}
 };
}
