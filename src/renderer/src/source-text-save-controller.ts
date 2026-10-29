import type {Source,SourceRef,Task} from '../../core/types';
import {learningDraftKey,parseLearningDraftJson} from '../../shared/learning-drafts';
import {SOURCE_TEXT_DRAFT_SLOT,emptySourceTextDraft,parseSourceTextDraft,parseSourceTextDraftBasis,sourceTextDraftBasis,sourceTextDraftOwner,sourceTextDraftWithIntent,sourceTextFields,sourceTextSubmittedFields,changeSourceTextDraft,type SourceTextFields,type SourceTextExpected} from '../../shared/source-text-draft';
import {SOURCE_TEXT_SAVE_BINDING_PREFIX,sourceTextSavePayload,sourceTextSaveBindingText,readSourceTextSave,type SourceTextSaveInput,type SourceTextSaveConfirmed,type SourceTextSaveInspectionInput} from '../../shared/source-text-save';
import type {createLearningDrafts,LearningDraftToken} from './learning-drafts';

export type SourceTextStart={reference:SourceRef;freshness:Source['freshness'];fields:SourceTextFields};
type Cache=ReturnType<typeof createLearningDrafts>;
type Phase='idle'|'preparing'|'saving'|'checking'|'uncertain'|'retry-ready'|'conflict'|'completed';
type Options={cache:Cache;taskId:string;sourceId:string;start:SourceTextStart;task:()=>Task;isCurrent:()=>boolean;send:(input:SourceTextSaveInput)=>Promise<unknown>;inspect:(input:SourceTextSaveInspectionInput)=>Promise<unknown>;onState:()=>void;onSaved:(result:SourceTextSaveConfirmed)=>void;onTask?:(task:Task)=>void;newId?:()=>string;digest?:(text:string)=>Promise<string>};
type Attempt={input:SourceTextSaveInput;basis:string;submitted:SourceTextFields;submittedEditVersion:number;freezeEpoch:number;token?:LearningDraftToken;confirmed?:SourceTextSaveConfirmed;hadNewer:boolean};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function taskShape(value:unknown,taskId:string):value is Task{return object(value)&&value.id===taskId&&typeof value.title==='string'&&typeof value.goal==='string'&&typeof value.createdAt==='string'&&typeof value.updatedAt==='string'&&['active','paused'].includes(String(value.status))&&object(value.memory)&&value.memory.enabled===false&&['sources','artifacts','requests','procedures','checkpoints','actions'].every(key=>Array.isArray(value[key]));}
function confirmation(value:unknown,input:SourceTextSaveInput):SourceTextSaveConfirmed|undefined{
 if(!object(value)||value.kind!=='confirmed'||value.intentId!==input.intentId||value.binding!==input.binding||!taskShape(value.task,input.taskId)||!object(value.reference))return;
 const ref=value.reference;if(ref.sourceId!==input.source.id||ref.version!==input.expectedSource.version+1||!hash(ref.digest))return;
 const source=value.task.sources.find(source=>source.id===ref.sourceId),versions=source?.versions.filter(version=>version.version===ref.version&&version.digest===ref.digest&&version.kind==='text');
 if(versions?.length!==1||versions[0].label!==input.source.label||versions[0].content!==input.source.content||versions[0].role!==input.source.role)return;
 return value as unknown as SourceTextSaveConfirmed;
}
function current(task:Task,expected:SourceTextExpected){const source=task.sources.find(source=>source.id===expected.sourceId),version=source?.versions.at(-1);return !!source&&!!version&&version.kind==='text'&&source.currentVersion===expected.version&&version.version===expected.version&&version.digest===expected.digest&&source.freshness===expected.freshness;}
function expected(basis:string):SourceTextExpected{const value=parseSourceTextDraftBasis(basis);return {sourceId:value.sourceId,version:value.version,digest:value.digest,freshness:value.freshness};}
async function sha256(text:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}

/** One source editor adapter over the existing cache and atomic source API.
 * Construction/reopen is inert. Unknown outcomes never allocate a new intent. */
export function createSourceTextSaveController(options:Options){
 const {cache}=options,owner=sourceTextDraftOwner(options.taskId,options.sourceId),slot=SOURCE_TEXT_DRAFT_SLOT,key=learningDraftKey(owner,slot);
 let start=options.start,phase:Phase='idle',message='',operation=false,attempt:Attempt|undefined,observedTask:Task|undefined;
 const notify=()=>options.onState();
 const entry=()=>cache.getSnapshot().entries[key];
 function liveTask(){
  const supplied=options.task();if(!observedTask||supplied.id!==options.taskId)return supplied;
  const suppliedSource=supplied.sources.find(source=>source.id===options.sourceId),observed=observedTask.sources.find(source=>source.id===options.sourceId);
  if(suppliedSource&&observed&&(suppliedSource.currentVersion<observed.currentVersion||suppliedSource.currentVersion===observed.currentVersion&&suppliedSource.freshness==='fresh'&&observed.freshness==='refresh-required'))return observedTask;
  return supplied;
 }
 function read(){
  const record=entry(),value=record?.local??(record?.error?record.remote?.value:null);
  const raw=value?parseSourceTextDraft(parseLearningDraftJson(value.value,'source-text-edit')):emptySourceTextDraft;
  const basis=raw.intentId&&value?value.basis:sourceTextDraftBasis(start.reference,start.freshness);
  const form=cache.readForm(owner,slot,emptySourceTextDraft,basis),pending=!!raw.intentId||!!attempt;
  const state=cache.getSnapshot(),changed=!current(liveTask(),{...start.reference,freshness:start.freshness});
  const fields=raw.present?sourceTextFields(raw):attempt?.submitted??start.fields;
  const storageHeld=!state.ready||state.frozen||state.maintenance||!!state.error||!!form.error||form.status!=='ready';
  return {record,raw,basis,form,pending,changed,fields,state,storageHeld};
 }
 function snapshot(){
  const value=read(),shownPhase=phase==='idle'&&value.pending?'uncertain':phase;
  return {...value,phase:shownPhase,message,operation,owner,slot,start,
   canEdit:options.isCurrent()&&!value.storageHeld&&(value.pending||phase==='preparing'||!value.changed),
   canSubmit:options.isCurrent()&&!operation&&!value.pending&&!value.storageHeld&&!value.changed&&!!value.fields.content.trim(),
   canRetry:!operation&&shownPhase==='retry-ready'&&!value.storageHeld,
   original:value.raw.intentId?sourceTextSubmittedFields(value.raw):attempt?.submitted};
 }
 function edit(change:Partial<SourceTextFields>){
  const view=snapshot();if(!view.canEdit)return {kind:'held' as const};
  const result=cache.tryEdit(owner,slot,emptySourceTextDraft,view.basis,raw=>changeSourceTextDraft(raw,start.fields,change));
  if(result.kind==='accepted'){if(!view.pending){phase='idle';message='';}notify();}return result;
 }
 function inspection(input:SourceTextSaveInput):SourceTextSaveInspectionInput{return {taskId:input.taskId,sourceId:input.source.id,expectedSource:input.expectedSource,intentId:input.intentId,binding:input.binding};}
 function restoreAttempt(view=read()):Attempt{
  if(attempt)return attempt;
  if(!view.raw.intentId)throw Error('No earlier source save is ready to check.');
  const submitted=sourceTextSubmittedFields(view.raw),payload=sourceTextSavePayload(options.taskId,expected(view.basis),submitted);
  attempt={input:readSourceTextSave({...payload,intentId:view.raw.intentId,binding:view.raw.binding}),basis:view.basis,submitted,submittedEditVersion:view.raw.submittedEditVersion,freezeEpoch:cache.getFreezeEpoch(),hadNewer:view.raw.editVersion!==view.raw.submittedEditVersion};
  return attempt;
 }
 async function finish(value:SourceTextSaveConfirmed,original:Attempt){
  original.confirmed=value;observedTask=value.task;
  const ownCurrent=current(liveTask(),{...value.reference,freshness:'fresh'}),version=value.task.sources.find(source=>source.id===options.sourceId)?.versions.find(version=>version.version===value.reference.version&&version.digest===value.reference.digest);
  if(!version)throw Error('The saved source version could not be reconciled.');
  if(ownCurrent)start={reference:value.reference,freshness:'fresh',fields:sourceTextFields(version)};
  if(options.isCurrent())options.onTask?.(value.task);
  const before=read();original.hadNewer||=before.raw.editVersion!==original.submittedEditVersion;
  if(before.record?.error&&!before.raw.intentId){await cache.retry(owner,slot);}
  const record=entry();let exact=false;
  if(record?.local){
   const raw=parseSourceTextDraft(parseLearningDraftJson(record.local.value,'source-text-edit'));
   if(raw.intentId){
    const token=original.token??cache.captureSourceSubmission(owner,slot,original.input.intentId,original.input.binding);
    if(!token)throw Error('The original source draft changed. Its current text is kept.');
    const completed=await cache.completeSourceSubmission(token,{intentId:original.input.intentId,binding:original.input.binding,basis:ownCurrent?sourceTextDraftBasis(value.reference,'fresh'):original.basis,applied:ownCurrent?sourceTextFields(version):undefined,retain:!ownCurrent});
    exact=completed.exact;original.hadNewer||=completed.kind==='retained';
   }
  }else if(record?.error){await cache.retry(owner,slot);exact=!original.hadNewer;}
  else exact=!original.hadNewer;
  const after=entry();original.hadNewer||=!!after?.local;
  if(after?.error)throw Error('The source was saved, but saving its remaining raw input was not confirmed.');
  const stillCurrent=ownCurrent&&current(liveTask(),{...value.reference,freshness:'fresh'});
  phase=stillCurrent?'completed':'conflict';message=stillCurrent?(after?.local?'The earlier edit is saved. Your newer text is still unapplied.':'Source saved.'): 'The earlier edit was saved, then this source changed. Your raw text is kept for copy and review.';
  attempt=undefined;notify();
  if(stillCurrent&&exact&&!after?.local&&!original.hadNewer&&cache.getFreezeEpoch()===original.freezeEpoch&&!cache.getSnapshot().frozen&&options.isCurrent())options.onSaved(value);
 }
 async function reconcile(original:Attempt){
  const value=await options.inspect(inspection(original.input)),confirmed=confirmation(value,original.input);
  if(confirmed){await finish(confirmed,original);return;}
  if(!object(value)||value.kind!=='uncommitted'||value.intentId!==original.input.intentId||value.binding!==original.input.binding||!taskShape(value.task,options.taskId)||typeof value.expectedUnchanged!=='boolean')throw Error('The original source save could not be checked.');
  observedTask=value.task;if(options.isCurrent())options.onTask?.(value.task);
  const unchanged=value.expectedUnchanged&&current(liveTask(),original.input.expectedSource);
  phase=unchanged?'retry-ready':'conflict';message=unchanged?'The original edit has not been saved. Retry that same edit, or keep this text for review.':'This source changed before the original edit was confirmed. Your text is kept for copy and review.';notify();
 }
 async function dispatch(retry:boolean){
  if(operation)return false;const view=read();
  if(view.storageHeld||!options.isCurrent()||!retry&&(view.pending||view.changed)||retry&&phase!=='retry-ready')return false;
  operation=true;message='';phase='preparing';notify();
  const freezeEpoch=cache.getFreezeEpoch();
  try{
   await cache.runSubmission(async()=>{
    let original:Attempt;
    if(retry)original=restoreAttempt();
    else{
     const submitted=sourceTextFields(view.fields),payload=sourceTextSavePayload(options.taskId,{...start.reference,freshness:start.freshness},submitted);
     const binding=SOURCE_TEXT_SAVE_BINDING_PREFIX+await (options.digest??sha256)(sourceTextSaveBindingText(payload));
     if(!options.isCurrent()||cache.getFreezeEpoch()!==freezeEpoch||cache.getSnapshot().frozen||!current(liveTask(),payload.expectedSource))throw Error('This source or editor changed before saving. Your text is kept.');
     const latest=read();if(latest.storageHeld||latest.raw.intentId)throw Error('The current source input needs review.');
     const intentId=(options.newId??(()=>crypto.randomUUID()))(),raw=latest.raw.present?latest.raw:{...emptySourceTextDraft,present:true,...latest.fields};
     const prepared=sourceTextDraftWithIntent(raw,submitted,intentId,binding,view.raw.editVersion);
     if(!cache.edit(owner,slot,emptySourceTextDraft,view.basis,()=>prepared))throw Error('The original source edit could not be prepared.');
     original={input:readSourceTextSave({...payload,intentId,binding}),basis:view.basis,submitted,submittedEditVersion:view.raw.editVersion,freezeEpoch,hadNewer:prepared.editVersion!==prepared.submittedEditVersion};attempt=original;
    }
    await cache.flushForm(owner,slot);
    if(!options.isCurrent()||cache.getFreezeEpoch()!==freezeEpoch||cache.getSnapshot().frozen||!current(liveTask(),original.input.expectedSource))throw Error('This source or editor changed before dispatch. The original edit is kept for checking.');
    const binding=SOURCE_TEXT_SAVE_BINDING_PREFIX+await (options.digest??sha256)(sourceTextSaveBindingText(original.input));if(binding!==original.input.binding)throw Error('The original source edit no longer matches its saved input.');
    original.freezeEpoch=freezeEpoch;original.token=cache.captureSourceSubmission(owner,slot,original.input.intentId,original.input.binding);if(!original.token)throw Error('The original source input could not be captured.');
    phase='saving';notify();
    const value=await options.send(original.input);if(!confirmation(value,original.input))throw Error('The save reply was not confirmed.');
    await reconcile(original);
   });
   return snapshot().phase==='completed';
  }catch(error){phase=attempt||read().raw.intentId?'uncertain':'idle';message=attempt?'The original edit may already be saved. Your current text is kept; check the saved source before trying again.':error instanceof Error?error.message:'This source edit could not be saved.';notify();return false;}
  finally{operation=false;notify();}
 }
 async function check(){
  if(operation||cache.getSnapshot().frozen||cache.getSnapshot().maintenance)return false;
  operation=true;phase='checking';message='Checking the original source edit…';notify();
  try{await cache.runSubmission(async()=>{await reconcile(restoreAttempt());});return snapshot().phase==='completed';}
  catch{phase='uncertain';message='The original edit could not be checked. Your current text is kept for copying; no save was retried.';notify();return false;}
  finally{operation=false;notify();}
 }
 return {snapshot,edit,submit:()=>dispatch(false),retry:()=>dispatch(true),check};
}
