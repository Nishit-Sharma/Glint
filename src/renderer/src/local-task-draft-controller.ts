import {createLocalTaskIntent} from './local-task-intent';
import type {createLearningDrafts} from './learning-drafts';
import {learningDraftKey,serializeLearningDraftJson} from '../../shared/learning-drafts';
import {LOCAL_TASK_DRAFT_SLOT,emptyLocalTaskDraft,localTaskDraftBasis,localTaskDraftInput,localTaskDraftOwner,parseLocalTaskDraft,type LocalTaskDraft} from '../../shared/local-task-draft';
import type {LocalTaskStartInput,LocalTaskStartResult} from '../../shared/local-task-start';

type Cache=ReturnType<typeof createLearningDrafts>;
type Phase='idle'|'preparing'|'saving'|'uncertain'|'completed'|'discarding';
type Options={cache:Cache;form:'text'|'draft';send:(input:Readonly<LocalTaskStartInput>)=>Promise<unknown>;isCurrent:()=>boolean;onCreated:(result:LocalTaskStartResult)=>void;onState?:()=>void;newId?:()=>string;digest?:(text:string)=>Promise<string>};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const id=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const positive=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0;
/** Validate the trusted host reply and its owned target; replay may include later edits.
 * Raw intent is neither a receipt nor proof of ownership of arbitrary matching text. */
export function localTaskResult(value:unknown,form:'text'|'draft'):LocalTaskStartResult|undefined{
 if(!object(value)||value.kind!==form||!object(value.task))return;
 const task=value.task;
 if(!id(task.id)||typeof task.title!=='string'||typeof task.goal!=='string'||!['active','paused'].includes(String(task.status))||typeof task.createdAt!=='string'||typeof task.updatedAt!=='string'||!object(task.memory)||task.memory.enabled!==false||!['sources','artifacts','requests','procedures','checkpoints','actions'].every(key=>Array.isArray(task[key])))return;
 if(form==='text'){
  if(!id(value.sourceId))return;const source=(task.sources as unknown[]).find(item=>object(item)&&item.id===value.sourceId);
  if(!object(source)||!positive(source.currentVersion)||!Array.isArray(source.versions))return;
  const version=source.versions.find(item=>object(item)&&item.id===value.sourceId&&item.version===source.currentVersion);
  if(!object(version)||version.kind!=='text'||typeof version.content!=='string'||typeof version.label!=='string'||typeof version.digest!=='string'||!version.digest||!['fact','style','inspiration'].includes(String(version.role)))return;
 }else{
  if(!id(value.artifactId))return;const artifact=(task.artifacts as unknown[]).find(item=>object(item)&&item.id===value.artifactId);
  if(!object(artifact)||!Array.isArray(artifact.revisions)||artifact.revisions.length===0||!artifact.revisions.every(revision=>object(revision)&&positive(revision.revision)&&typeof revision.title==='string'&&typeof revision.content==='string'&&typeof revision.mimeType==='string'&&typeof revision.digest==='string'&&Array.isArray(revision.sourceRefs)))return;
 }
 return value as unknown as LocalTaskStartResult;
}
const signature=(value:LocalTaskDraft)=>serializeLearningDraftJson(value,'local-task-form');
async function sha256(text:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}

/** Adapter for the existing local-create controller and raw cache. It owns no store
 * or receipt ledger, and never runs on construction/reopen. */
export function createLocalTaskDraftController(options:Options){
 const {cache,form}=options,owner=localTaskDraftOwner(form),slot=LOCAL_TASK_DRAFT_SLOT,basis=localTaskDraftBasis(form),key=learningDraftKey(owner,slot);
 let phase:Phase='idle',message='',operation=false;
 const notify=()=>options.onState?.();
 const read=()=>cache.readForm(owner,slot,emptyLocalTaskDraft,basis);
 const raw=()=>parseLocalTaskDraft(read().value);
 const entry=()=>cache.getSnapshot().entries[key];
 function setPhase(next:Phase){phase=next;notify();}
 function ready(generation:number,expected:string,freezeEpoch:number){
  const state=cache.getSnapshot(),current=read();
  if(cache.getFreezeEpoch()!==freezeEpoch||!options.isCurrent()||state.frozen||state.maintenance||state.error||cache.getEditRejection(owner,slot)||current.status!=='ready'||current.error||(current.generation??0)!==generation||signature(parseLocalTaskDraft(current.value))!==expected)throw Error('This local input changed or is held. Review it before creating the task.');
 }
 function snapshot(){
  const current=read();let value:LocalTaskDraft|undefined;
  try{value=parseLocalTaskDraft(current.value);}catch{}
  return {form:current,draft:value,phase:phase==='idle'&&value?.intentId?'uncertain' as const:phase,message,entry:entry(),rejection:cache.getEditRejection(owner,slot),frozen:cache.getSnapshot().frozen,maintenance:cache.getSnapshot().maintenance};
 }
 async function dispatch(retry:boolean):Promise<boolean>{
  if(operation)return false;
  operation=true;message='';setPhase('preparing'); // Freeze visible fields synchronously on Create.
  let confirmed=false;const freezeEpoch=cache.getFreezeEpoch();
  try{
   const current=read(),value=parseLocalTaskDraft(current.value),generation=current.generation??0,expected=signature(value);
   ready(generation,expected,freezeEpoch);
   if(retry!==!!value.intentId)throw Error(retry?'No saved local attempt is ready to retry.':'This local save has an earlier attempt. Retry that same save or inspect your task list.');
   const normalized=localTaskDraftInput(form,value,value.intentId||'validating-local-input');
   const binding='local-task-start-form:v1:'+await (options.digest??sha256)(JSON.stringify({kind:normalized.kind,title:normalized.title,content:normalized.content}));
   ready(generation,expected,freezeEpoch);
   if(value.intentId&&value.binding!==binding)throw Error('This saved attempt does not match its frozen input. Keep a copy and inspect your task list; it cannot be retried here.');
   const prepared=value.intentId?value:parseLocalTaskDraft({...value,intentId:(options.newId??(()=>crypto.randomUUID()))(),binding});
   if(!value.intentId&&!cache.edit(owner,slot,emptyLocalTaskDraft,basis,()=>prepared))throw Error('The local attempt could not be prepared.');
   const submitted=read(),submittedGeneration=submitted.generation??0,submittedSignature=signature(prepared),token=cache.capture(owner,slot);
   if(!token)throw Error('The local attempt could not be captured.');
   await cache.flushForm(owner,slot);ready(submittedGeneration,submittedSignature,freezeEpoch);
   await cache.runSubmission(async()=>{
    let acknowledged=false,clearedGeneration:number|undefined;
    const intent=createLocalTaskIntent({
     createId:()=>prepared.intentId,
     send:async input=>{
      const result=localTaskResult(await options.send(input),form);
      if(!result)throw Error('The local save reply was not confirmed. The task may already exist.');
      confirmed=true;
      acknowledged=cache.acknowledge(token);clearedGeneration=entry()?.generation;
      await cache.flushForm(owner,slot);
      return result;
     },
     // Dispatch was already admitted. Its exact acknowledgement must survive unmount.
     isActive:()=>true,
     onState:state=>{setPhase(state.kind==='saving'?'saving':state.kind==='completed'?'completed':state.kind==='uncertain'?'uncertain':'idle');},
     // Closing/resuming retires automatic opening, never the exact acknowledgement above.
     onCreated:result=>{if(cache.getFreezeEpoch()===freezeEpoch&&acknowledged&&entry()?.local===null&&entry()?.generation===clearedGeneration&&!cache.getSnapshot().frozen&&!cache.getSnapshot().maintenance&&options.isCurrent())options.onCreated(result);},
    });
    await intent.submit({kind:form,title:prepared.title,content:prepared.content});
    if(intent.snapshot().kind==='uncertain'){message=confirmed?'The task was saved, but clearing its local input was not confirmed. Keep it open and retry draft storage.':'The save result is uncertain. The task may already exist. Retry this same save, or inspect your task list.';notify();}
   });
   return confirmed;
  }catch(error){
   message=error instanceof Error?error.message:'This local save was not confirmed.';
   let pending=false;try{pending=!!raw().intentId;}catch{}
   setPhase(pending?'uncertain':'idle');return false;
  }finally{operation=false;notify();}
 }
 return {
  owner,slot,basis,snapshot,
  edit(change:Partial<Pick<LocalTaskDraft,'title'|'content'>>){
   if(operation||raw().intentId)return {kind:'held' as const,reason:'frozen' as const};
   const value={...raw(),...change};
   if(value.title.length>200||value.content.length>100_000)return cache.rejectEdit(owner,slot,emptyLocalTaskDraft,basis,'text-too-long');
   message='';const result=cache.tryEdit(owner,slot,emptyLocalTaskDraft,basis,()=>value);notify();return result;
  },
  submit:()=>dispatch(false),retry:()=>dispatch(true),
  async discard():Promise<boolean>{
   if(operation||cache.getSnapshot().frozen||cache.getSnapshot().maintenance||cache.getSnapshot().error)return false;operation=true;message='';setPhase('discarding');
   try{
    if(entry()?.error)await cache.retry(owner,slot);
    const current=entry();
    if(current?.local){
     if(!cache.discard(owner,slot,current.generation))throw Error('This local input changed or needs recovery before discarding.');
     const generation=entry()?.generation;
     await cache.flushForm(owner,slot);
     if(entry()?.local!==null||entry()?.generation!==generation)throw Error('Newer local input is kept. Review it before discarding.');
    }else{
     await cache.flushForm(owner,slot);
     if(entry()?.local)throw Error('Newer local input is kept. Review it before discarding.');
    }
    const rejection=cache.getEditRejection(owner,slot);if(rejection)cache.dismissEditRejection(owner,slot,rejection.id);
    setPhase('idle');return true;
   }catch(error){message=error instanceof Error?error.message:'Discarding local input was not confirmed.';setPhase('idle');return false;}
   finally{operation=false;notify();}
  },
 };
}
