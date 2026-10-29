import {randomUUID} from 'node:crypto';
import {isCompanionWindow,sameWindowIdentity,type OwnApplication} from './context-target';
import type {NativeWindow} from './native';

export type SourceDragPoint={x:number;y:number};
/** Host-only metadata interface. Neither method requests pixels or permissions. */
export type SourceAttachmentNative={
 windowAtPoint(point:SourceDragPoint,ignoredWindowIds:readonly string[]):Promise<NativeWindow|undefined>;
 inspect(id:string):Promise<NativeWindow>;
};
export type SourceAttachmentOptions={
 native:SourceAttachmentNative;
 own():OwnApplication;
 /** Include requested/current task, context, presentation, privacy/health and connection epochs. */
 context():{anchor:boolean;key:string};
 /** Single current host privacy owner; absence fails closed before titles or binding. */
 checkTarget(target:NativeWindow,guard:()=>void):Promise<void>;
 /** Metadata binding only. Call guard after awaits and before mutation; never capture or grant here. */
 attach(target:NativeWindow,guard:()=>void,oneSnapshot?:boolean):Promise<void>;
 ignoredWindowIds?():readonly string[];
 now?:()=>number;
};
export type SourceAttachmentResult={kind:'attached';windowId:string}|{kind:'click'|'cancelled'|'no-target'};

const validPoint=(point:SourceDragPoint)=>[point.x,point.y].every(Number.isFinite)&&Math.abs(point.x)<=1_000_000&&Math.abs(point.y)<=1_000_000;
const validIgnored=(ids:readonly string[])=>ids.length>0&&ids.length<=8&&ids.every(id=>/^window:[1-9]\d*$/.test(id)&&Number.isSafeInteger(Number(id.slice(7))));

/** Called only from the host's native anchor events. A gesture is not capture/setup authority. */
export function createSourceAttachmentGesture(options:SourceAttachmentOptions){
 const now=options.now??(()=>performance.now());
 let active:{id:string;key:string;started:number;start:SourceDragPoint;ignored:string[];dropping:boolean}|undefined;
 const cancel=()=>{active=undefined;};
 const allowed=(window:NativeWindow)=>!window.knownProtected&&!isCompanionWindow(window,options.own());
 const same=(a:NativeWindow,b:NativeWindow)=>sameWindowIdentity(a,b)&&a.osId===b.osId;
 const review=async(point:SourceDragPoint,guard:()=>void,ignored:readonly string[]):Promise<NativeWindow|undefined>=>{
  guard();if(!validPoint(point)||!validIgnored(ignored))throw Error('Invalid desktop drop point.');
  if(typeof options.checkTarget!=='function')throw Error('Source attachment eligibility is unavailable.');
  const target=await options.native.windowAtPoint({...point},ignored);guard();
  if(!target||!allowed(target))return;
  const inspected=await options.native.inspect(target.id);guard();
  if(!allowed(inspected)||!same(target,inspected))return;
  const currentIgnored=options.ignoredWindowIds?.()??ignored;
  if(!validIgnored(currentIgnored))throw Error('Native anchor identity is unavailable.');
  const atPoint=await options.native.windowAtPoint({...point},currentIgnored);guard();
  if(!atPoint||!allowed(atPoint)||!same(target,atPoint))return;
  await options.checkTarget(atPoint,guard);guard();
  return atPoint;
 };
 const begin=(point:SourceDragPoint,ignoredWindowIds:readonly string[]):string=>{
  cancel();const context=options.context();
  if(!context.anchor||!validPoint(point)||!validIgnored(ignoredWindowIds))throw Error('Start a source attachment from the minimized character.');
  const id=randomUUID();active={id,key:context.key,started:now(),start:{...point},ignored:[...ignoredWindowIds],dropping:false};return id;
 };
 const drop=async(id:string,point:SourceDragPoint,presented?:NativeWindow):Promise<SourceAttachmentResult>=>{
  const gesture=active;if(!gesture||gesture.id!==id||gesture.dropping)return {kind:'cancelled'};
  gesture.dropping=true;const release={...point};
  const current=()=>{const context=options.context(),elapsed=now()-gesture.started;return active===gesture&&context.anchor&&context.key===gesture.key&&elapsed>=0&&elapsed<15_000;};
  const guard=()=>{if(!current())throw Error('Source attachment cancelled.');};
  try{
   if(!current())return {kind:'cancelled'};
   if(!validPoint(release))throw Error('Invalid desktop drop point.');
   if(Math.hypot(release.x-gesture.start.x,release.y-gesture.start.y)<6)return {kind:'click'};
   const target=await review(release,guard,options.ignoredWindowIds?.()??gesture.ignored);guard();
   if(!target)return {kind:'no-target'};
   await options.attach(target,guard,!!presented&&same(target,presented));
   // A successful binding may deliberately expand the anchor and change its context.
   return {kind:'attached',windowId:target.id};
  }catch(error){if(!current())return {kind:'cancelled'};throw error;}
  finally{if(active===gesture)cancel();}
 };
 return {begin,drop,cancel,review};
}
