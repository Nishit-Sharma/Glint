import {readExperimentResultDraft} from '../../shared/experiment-result-draft';
import {readSourceComparisonDraft} from '../../shared/source-comparison-draft';
import {parseNewDocumentDraft} from '../../shared/authored-document';
import {parseWindowReviewRaw,windowReviewRawKeepsIdentity} from '../../shared/learning-draft-form-policy';
import {readCanvasRaw,readCanvasPrompt} from '../../shared/design-canvas';
import {emptySavedDocumentDraft,parseSavedDocumentDraft,parseSavedDocumentDraftBasis,SAVED_DOCUMENT_DRAFT_SLOT,type SavedDocumentDraft,type SavedDocumentDraftOwner} from '../../shared/saved-document-draft';
import {samePickingCaseShape} from '../../shared/picking-draft-form-policy';
import {
 LEARNING_DRAFT_LIMITS,learningDraftTaskId,LearningDraftValidationError,learningDraftKey,learningDraftJsonPolicy,parseLearningDraftEpoch,parseLearningDraftJson,parseLearningDraftOwner,parseLearningDraftRecord,parseLearningDraftRecoveryToken,parseLearningDraftSlot,parseLearningDraftValue,type LearningDraftValidationReason,type LearningDraftJsonPolicy,
 serializeLearningDraftJson,type LearningDraftJson,type LearningDraftOwner,type LearningDraftReadResult,
 type LearningDraftCleanupResult,type LearningDraftRecord,type LearningDraftRecoverResult,type LearningDraftSaveResult,type LearningDraftValue,
} from '../../shared/learning-drafts';
import {SOURCE_TEXT_DRAFT_SLOT,emptySourceTextDraft,parseSourceTextDraft,parseSourceTextDraftBasis,clearSourceTextAttempt,sourceTextSubmittedFields,type SourceTextFields} from '../../shared/source-text-draft';

export type LearningDraftTransport={
 read:()=>Promise<LearningDraftReadResult>;
 save:(owner:LearningDraftOwner,slot:string,expectedEpoch:string,expectedRevision:number,value:LearningDraftValue|null)=>Promise<LearningDraftSaveResult>;
 recover?:(token:string)=>Promise<LearningDraftRecoverResult>;
 cleanup?:()=>Promise<LearningDraftCleanupResult>;
};
export type LearningDraftEntrySnapshot={
 readonly owner:LearningDraftOwner;readonly slot:string;readonly generation:number;readonly epoch:string;
 readonly local:LearningDraftValue|null;readonly remote:LearningDraftRecord|null;
 readonly status:'clean'|'saving'|'unsaved'|'conflict'|'error';readonly error?:string;readonly canDiscard:boolean;readonly canResolve:boolean;
};
export type LearningDraftEditRejection={readonly id:number;readonly owner:LearningDraftOwner;readonly slot:string;readonly reason:LearningDraftValidationReason};
export type LearningDraftEditResult={kind:'accepted'}|{kind:'rejected';reason:LearningDraftValidationReason;rejection:LearningDraftEditRejection}|{kind:'held';reason:'loading'|'frozen'|'maintenance'|'deleted'|'storage'|'recovery'|'unavailable'};
export type LearningDraftSnapshot={readonly revision:number;readonly ready:boolean;readonly maintenance:boolean;readonly frozen:boolean;readonly epoch?:string;readonly error?:string;readonly recoveryToken?:string;readonly cleanupNeeded:boolean;readonly maintenanceError?:string;readonly editRejections?:Readonly<Record<string,LearningDraftEditRejection>>;readonly entries:Readonly<Record<string,LearningDraftEntrySnapshot>>};
export type LearningDraftRecovery={readonly generation:number;readonly local:LearningDraftValue|null;readonly remote:LearningDraftRecord|null;readonly canDiscard:boolean;readonly canResolve:boolean};
export type LearningDraftForm<T>={readonly value:T;readonly status:'ready'|'loading'|'unavailable'|'recovery';readonly generation?:number;readonly recovery?:LearningDraftRecovery;readonly preparationError?:true;readonly error?:string};
export type LearningDraftToken={readonly owner:LearningDraftOwner;readonly slot:string;readonly generation:number};
type Attempt={generation:number;expectedEpoch:string;expectedRevision:number;predecessor:LearningDraftRecord|null;value:LearningDraftValue|null};
type Failure={kind:'uncertain'|'stale-epoch';message:string;attempt:Attempt}|{kind:'conflict';message:string;attempt:Attempt;reconciled:boolean};
type Entry={owner:LearningDraftOwner;slot:string;epoch:string;generation:number;savedGeneration:number;local:LearningDraftValue|null;remote:LearningDraftRecord|null;pending?:Promise<void>;failure?:Failure};

function sameShape(left:LearningDraftJson,right:LearningDraftJson,variableArrays:readonly string[]=[],path='',policy?:LearningDraftJsonPolicy):boolean{
 if(path===''&&policy==='experiment-result-copy'){readExperimentResultDraft(left);readExperimentResultDraft(right);return true;}
 if(path===''&&policy==='new-document-edit'){parseNewDocumentDraft(left);parseNewDocumentDraft(right);return true;}
 if(path===''&&policy==='source-comparison'){readSourceComparisonDraft(left);readSourceComparisonDraft(right);return true;}
 if(path===''&&policy==='window-workflow-review'&&left!==null&&typeof left==='object'&&!Array.isArray(left)&&Object.hasOwn(left,'states'))return windowReviewRawKeepsIdentity(parseWindowReviewRaw(left),parseWindowReviewRaw(right));
 if(path===''&&policy==='design-canvas-prompt'){readCanvasPrompt(left);readCanvasPrompt(right);return true;}
 if(path===''&&policy==='design-canvas-edit'){readCanvasRaw(left);readCanvasRaw(right);return true;}
 if(path===''&&policy==='saved-document-edit'){parseSavedDocumentDraft(left);parseSavedDocumentDraft(right);return true;}
 if(path===''&&policy==='picking-helper-cases')return samePickingCaseShape(left,right);
 if(left===null||right===null)return left===right;
 if(typeof left!=='object'||typeof right!=='object')return typeof left===typeof right;
 if(Array.isArray(left)||Array.isArray(right)){
  if(!Array.isArray(left)||!Array.isArray(right))return false;
  if(variableArrays.includes(path))return left.length>0&&right.length<=LEARNING_DRAFT_LIMITS.arrayItems&&right.every((value,index)=>sameShape(left[0],value,variableArrays,`${path}.${index}`));
  return left.length===right.length&&left.every((value,index)=>sameShape(value,right[index],variableArrays,`${path}.${index}`));
 }
 const keys=Object.keys(left);
 return keys.length===Object.keys(right).length&&keys.every(key=>Object.hasOwn(right,key)&&sameShape(left[key],right[key],variableArrays,path?`${path}.${key}`:key));
}
const errorMessage=(error:unknown)=>error instanceof Error?error.message:'Draft storage is unavailable.';
const sameValue=(left:LearningDraftValue|null,right:LearningDraftValue|null)=>left===null||right===null?left===right:left.initial===right.initial&&left.value===right.value&&left.basis===right.basis;
const sameRecord=(left:LearningDraftRecord|null,right:LearningDraftRecord|null)=>left===null||right===null?left===right:left.revision===right.revision&&learningDraftKey(left.owner,left.slot)===learningDraftKey(right.owner,right.slot)&&sameValue(left.value,right.value);
function immutableRecord(input:LearningDraftRecord):LearningDraftRecord{
 const record=parseLearningDraftRecord(input);
 return Object.freeze({...record,owner:Object.freeze({...record.owner}),value:record.value===null?null:Object.freeze({...record.value})});
}
async function waitForAll(work:Promise<void>[]):Promise<void>{
 const results=await Promise.allSettled(work),failed=results.find(result=>result.status==='rejected');
 if(failed?.status==='rejected')throw failed.reason;
}
const canResolve=(entry:Entry)=>entry.failure?.kind==='conflict'&&entry.failure.reconciled;
const canDiscard=(entry:Entry)=>!entry.failure||canResolve(entry);
const recovery=(entry:Entry,blocked=false):LearningDraftRecovery=>Object.freeze({generation:entry.generation,local:entry.local,remote:entry.remote,canDiscard:!blocked&&canDiscard(entry),canResolve:!blocked&&canResolve(entry)});
function reconcileRecord(entry:Entry,failure:Failure,current:LearningDraftRecord|null,readEpoch:string){
 const attempt=failure.attempt;entry.epoch=readEpoch;
 if(entry.local===null&&current===null){entry.remote=null;entry.savedGeneration=entry.generation;entry.failure=undefined;}
 else if(current&&current.revision===attempt.expectedRevision+1&&sameValue(current.value,attempt.value)){entry.remote=current;entry.savedGeneration=attempt.generation;entry.failure=undefined;}
 else if(sameRecord(current,attempt.predecessor)&&(readEpoch===attempt.expectedEpoch||current!==null)){entry.remote=current;entry.failure=undefined;}
 else{entry.remote=current;entry.failure={kind:'conflict',message:'Draft changed elsewhere. Local text has been preserved.',attempt,reconciled:true};}
}

/** One live form value per exact owner and slot, shared by every renderer mirror. */
export function createLearningDrafts(transport:LearningDraftTransport){
 const entries=new Map<string,Entry>(),forgotten=new Set<string>(),listeners=new Set<()=>void>();
 const editRejections=new Map<string,LearningDraftEditRejection>();let rejectionId=0;
 const tokens=new WeakMap<LearningDraftToken,{key:string;entry:Entry;generation:number}>();
 const retries=new Map<Promise<void>,readonly string[]>();
 const submissions=new Set<Promise<void>>();
 let snapshot:LearningDraftSnapshot=Object.freeze({revision:0,ready:false,maintenance:false,frozen:false,cleanupNeeded:false,entries:Object.freeze({})});
 let loading:Promise<void>|undefined;
 let epoch:string|undefined;
 let observedEpoch:string|undefined,observedRecords=new Map<string,LearningDraftRecord>();
 let recoveryToken:string|undefined,cleanupNeeded=false,cleanupNotice=0,maintenanceError:string|undefined;
 let maintenance:Promise<unknown>|undefined,recovering:Promise<LearningDraftRecoverResult>|undefined,cleaning:Promise<LearningDraftCleanupResult>|undefined;
 let frozen=false,freezeEpoch=0;
 const isForgotten=(owner:LearningDraftOwner)=>{const id=learningDraftTaskId(owner);return id!==undefined&&forgotten.has(id);};
 function publish(error=snapshot.error){
  const values:Record<string,LearningDraftEntrySnapshot>={};
  const blocked=!!error||!!maintenance||frozen;
  for(const [key,entry] of entries)values[key]=Object.freeze({owner:entry.owner,slot:entry.slot,epoch:entry.epoch,generation:entry.generation,local:entry.local,remote:entry.remote,canDiscard:!blocked&&canDiscard(entry),canResolve:!blocked&&canResolve(entry),status:entry.failure?(entry.failure.kind==='conflict'?'conflict':'error'):entry.pending?'saving':entry.generation===entry.savedGeneration?'clean':'unsaved',...(entry.failure?{error:entry.failure.message}:{})});
  snapshot=Object.freeze({revision:snapshot.revision+1,ready:snapshot.ready,maintenance:!!maintenance,frozen,cleanupNeeded,...(epoch?{epoch}:{}),...(recoveryToken?{recoveryToken}:{}),...(maintenanceError?{maintenanceError}:{}),...(error?{error}:{}),...(editRejections.size?{editRejections:Object.freeze(Object.fromEntries(editRejections))}:{}),entries:Object.freeze(values)});
  for(const listener of [...listeners]){try{listener();}catch{/* An observer cannot change persistence outcomes. */}}
 }
 function unavailable(result:Extract<LearningDraftReadResult,{kind:'unavailable'}>){
  recoveryToken=undefined;
  recoveryToken=result.recoveryToken===undefined?undefined:parseLearningDraftRecoveryToken(result.recoveryToken);
  snapshot={...snapshot,error:result.message};
 }
 function available(result:Extract<LearningDraftReadResult,{kind:'available'}>,notice:number){
  if(result.cleanup!==undefined&&result.cleanup!=='needed')throw Error('Draft cleanup status is invalid.');
  if(cleanupNotice===notice)cleanupNeeded=result.cleanup==='needed';else if(result.cleanup==='needed')cleanupNeeded=true;
  recoveryToken=undefined;maintenanceError=undefined;snapshot={...snapshot,error:undefined};
 }
 function reconcileNamespace(key:string,entry:Entry,betweenAttempts=false){
  if(!epoch||observedEpoch!==epoch||entry.epoch===epoch||entry.failure)return;
  const current=observedRecords.get(key)??null;
  // A new namespace alone cannot authorize replay of an old revision-zero intent.
  // Exact surviving records retain their CAS revision and every local generation.
  if(sameRecord(current,entry.remote)&&(current!==null||entry.local===null)){
   entry.epoch=epoch;
   if(current===null){entry.remote=null;entry.savedGeneration=entry.generation;}
   return;
  }
  // Its response may prove an in-flight write is the record in this fresh read.
  if(entry.pending&&!betweenAttempts)return;
  const attempt:Attempt={generation:entry.generation,expectedEpoch:entry.epoch,expectedRevision:entry.remote?.revision??0,predecessor:entry.remote,value:entry.local};
  entry.epoch=epoch;entry.remote=current;entry.generation+=1;
  entry.failure={kind:'conflict',message:'Draft changed elsewhere. Local text has been preserved.',attempt,reconciled:true};
  return entry.failure;
 }
 function observe(readEpoch:string,records:readonly LearningDraftRecord[]){
  epoch=readEpoch;observedEpoch=readEpoch;observedRecords=new Map(records.map(record=>[learningDraftKey(record.owner,record.slot),record]));
  for(const [key,entry] of entries)reconcileNamespace(key,entry);
 }
 function load():Promise<void>{
  if(loading)return loading;
  loading=Promise.resolve().then(async()=>{
   let failure:string|undefined;
   try{
    const notice=cleanupNotice,result=await transport.read();
    if(result.kind==='unavailable'){unavailable(result);failure=result.message;}
    else{
     const loadedEpoch=parseLearningDraftEpoch(result.epoch),records=result.records.map(immutableRecord),seen=new Set<string>();
     for(const record of records){const key=learningDraftKey(record.owner,record.slot);if(seen.has(key))throw Error('Duplicate draft identity.');seen.add(key);}
     available(result,notice);
     for(const record of records){const key=learningDraftKey(record.owner,record.slot);if(isForgotten(record.owner)||entries.has(key))continue;entries.set(key,{owner:record.owner,slot:record.slot,epoch:loadedEpoch,generation:0,savedGeneration:0,local:record.value,remote:record});}
     observe(loadedEpoch,records);
    }
   }catch(error){failure=errorMessage(error);}
   snapshot={revision:snapshot.revision,ready:true,maintenance:!!maintenance,frozen,cleanupNeeded,entries:snapshot.entries};publish(failure);
  });
  return loading;
 }
 function readForm<T extends LearningDraftJson>(owner:LearningDraftOwner,slot:string,initial:T,basis:string,variableArrays:readonly string[]=[]):LearningDraftForm<T>{
  try{return checkedForm(owner,slot,initial,basis,variableArrays);}catch(error){if(!(error instanceof LearningDraftValidationError))throw error;return {value:initial,status:'unavailable',preparationError:true,error:'This form exceeds the supported input limits. Earlier saved work remains available in Files → Unfinished practice.'};}
 }
 function checkedForm<T extends LearningDraftJson>(owner:LearningDraftOwner,slot:string,initial:T,basis:string,variableArrays:readonly string[]=[]):LearningDraftForm<T>{
  const policy=learningDraftJsonPolicy(owner,slot),serialized=serializeLearningDraftJson(initial,policy),entry=entries.get(learningDraftKey(owner,slot));
  parseLearningDraftValue({initial:serialized,value:serialized,basis},owner,slot);
  if(!snapshot.ready)return {value:initial,status:'loading'};
  if(snapshot.error){
   if(entry?.local!==null&&entry?.local!==undefined){const value=parseLearningDraftJson(entry.local.value,policy);if(entry.local.initial===serialized&&entry.local.basis===basis&&sameShape(initial,value,variableArrays,'',policy))return {value:value as T,status:'unavailable',error:snapshot.error,generation:entry.generation};return {value:initial,status:'recovery',error:snapshot.error,generation:entry.generation,recovery:recovery(entry,true)};}
   return {value:initial,status:'unavailable',error:snapshot.error};
  }
  if(!entry)return {value:initial,status:'ready'};
  if(entry.local===null)return {value:initial,status:entry.failure?.kind==='conflict'?'recovery':'ready',generation:entry.generation,...(entry.failure?{error:entry.failure.message}:{}),...(entry.failure?.kind==='conflict'?{recovery:recovery(entry,!!maintenance||frozen)}:{})};
  const value=parseLearningDraftJson(entry.local.value,policy);
  if(entry.local.initial!==serialized||entry.local.basis!==basis||!sameShape(initial,value,variableArrays,'',policy))return {value:initial,status:'recovery',generation:entry.generation,recovery:recovery(entry,!!maintenance||frozen),...(entry.failure?{error:entry.failure.message}:{})};
  // The canonical parser and exact recursive shape comparison validate this boundary.
  if(entry.failure?.kind==='conflict')return {value:value as T,status:'recovery',generation:entry.generation,recovery:recovery(entry,!!maintenance||frozen),error:entry.failure.message};
  return {value:value as T,status:'ready',generation:entry.generation,...(entry.failure?{error:entry.failure.message}:{})};
 }
 function pump(key:string,entry:Entry):Promise<void>{
  if(entry.pending)return entry.pending;
  if(maintenance)return Promise.resolve();
  if(entry.failure)return Promise.reject(Error(entry.failure.message));
  if(entry.generation===entry.savedGeneration)return Promise.resolve();
  const running=Promise.resolve().then(async()=>{
   while(entries.get(key)===entry&&entry.generation!==entry.savedGeneration&&!entry.failure&&!maintenance){
    const conflict=reconcileNamespace(key,entry,true);
    if(conflict){publish();throw Error(conflict.message);}
    if(entry.generation===entry.savedGeneration){publish();break;}
    if(entry.local===null&&entry.remote===null){entry.savedGeneration=entry.generation;publish();break;}
    const attempt:Attempt={generation:entry.generation,expectedEpoch:entry.epoch,expectedRevision:entry.remote?.revision??0,predecessor:entry.remote,value:entry.local};
    try{
     const result=await transport.save(entry.owner,entry.slot,attempt.expectedEpoch,attempt.expectedRevision,attempt.value);
     if(entries.get(key)!==entry)return;
     const acceptedEpoch=parseLearningDraftEpoch(result.epoch);
     if(result.kind==='stale-epoch'||acceptedEpoch!==attempt.expectedEpoch){entry.failure={kind:'stale-epoch',message:'Unfinished practice storage changed. Local text has been preserved. Retry to review saved edits.',attempt};throw Error(entry.failure.message);}
     if(result.kind==='conflict'){
      const current=result.current===null?null:immutableRecord(result.current);
      if(current&&learningDraftKey(current.owner,current.slot)!==key)throw Error('Draft storage returned another form identity.');
      entry.remote=current;entry.failure={kind:'conflict',message:'Draft changed elsewhere. Local text has been preserved.',attempt,reconciled:false};
      throw Error(entry.failure.message);
     }
     const record=immutableRecord(result.record);
     if(learningDraftKey(record.owner,record.slot)!==key||record.revision!==attempt.expectedRevision+1||!sameValue(record.value,attempt.value))throw Error('Draft storage returned an unconfirmed save.');
     entry.remote=record;entry.savedGeneration=attempt.generation;publish();
    }catch(error){
     if(entries.get(key)!==entry)return;
     entry.failure??={kind:'uncertain',message:errorMessage(error),attempt};publish();throw error;
    }
   }
  });
  entry.pending=running.finally(()=>{
   entry.pending=undefined;
   if(entries.get(key)!==entry)return;
   reconcileNamespace(key,entry);
   publish();
   if(!maintenance&&!snapshot.error&&!entry.failure&&entry.generation!==entry.savedGeneration)void pump(key,entry).catch(()=>undefined);
  });
  publish();return entry.pending;
 }
 function edit<T extends LearningDraftJson>(owner:LearningDraftOwner,slot:string,initial:T,basis:string,transform:(latest:T)=>T,variableArrays:readonly string[]=[]):boolean{
  if(frozen||maintenance||isForgotten(owner)||!snapshot.ready||snapshot.error||!epoch)return false;
  const parsedOwner=Object.freeze({...parseLearningDraftOwner(owner)}),parsedSlot=parseLearningDraftSlot(slot),key=learningDraftKey(parsedOwner,parsedSlot),existing=entries.get(key);
  if(existing?.failure)return false;
  const form=readForm(parsedOwner,parsedSlot,initial,basis,variableArrays);
  if(form.status!=='ready')return false;
  const policy=learningDraftJsonPolicy(parsedOwner,parsedSlot),initialText=serializeLearningDraftJson(initial,policy),latest=parseLearningDraftJson(serializeLearningDraftJson(form.value,policy),policy);
  // The live value has already passed the form's exact initial, basis and shape checks.
  const nextText=serializeLearningDraftJson(transform(latest as T),policy),value=parseLearningDraftValue({initial:initialText,value:nextText,basis},parsedOwner,parsedSlot);
  if(!sameShape(parseLearningDraftJson(initialText,policy),parseLearningDraftJson(nextText,policy),variableArrays,'',policy))throw new LearningDraftValidationError('shape-changed','Draft form shape changed.');
  const entry:Entry=existing??{owner:parsedOwner,slot:parsedSlot,epoch,generation:0,savedGeneration:0,local:null,remote:null};
  entry.local=nextText===initialText||value===null?null:Object.freeze({...value});entry.generation+=1;entries.set(key,entry);editRejections.delete(key);publish();
  void pump(key,entry).catch(()=>undefined);return true;
 }
 /** UI-only disposition. Legacy edit remains boolean/throw; rejected payload is never retained. */
 function recordEditRejection(owner:LearningDraftOwner,slot:string,reason:LearningDraftValidationReason):LearningDraftEditResult{
  if(!['too-large','text-too-long','invalid-data','shape-changed'].includes(reason))throw Error('Draft rejection reason is invalid.');
  const parsedOwner=Object.freeze({...parseLearningDraftOwner(owner)}),parsedSlot=parseLearningDraftSlot(slot),rejection=Object.freeze({id:++rejectionId,owner:parsedOwner,slot:parsedSlot,reason});editRejections.set(learningDraftKey(parsedOwner,parsedSlot),rejection);publish();return {kind:'rejected',reason,rejection};
 }
 function editHold<T extends LearningDraftJson>(owner:LearningDraftOwner,slot:string,initial:T,basis:string,variableArrays:readonly string[]=[]):Extract<LearningDraftEditResult,{kind:'held'}>|undefined{
  const form=()=>readForm(owner,slot,initial,basis,variableArrays);
  const reason=isForgotten(owner)?'deleted':frozen?'frozen':maintenance?'maintenance':!snapshot.ready?'loading':snapshot.error||entries.get(learningDraftKey(owner,slot))?.failure?'storage':form().status==='recovery'?'recovery':form().status!=='ready'?'unavailable':undefined;
  return reason?{kind:'held',reason}:undefined;
 }
 /** A known control limit may refuse an attempted value before constructing raw
  * form data. Share only its fixed code; never retain that attempted payload. */
 function rejectEdit<T extends LearningDraftJson>(owner:LearningDraftOwner,slot:string,initial:T,basis:string,reason:LearningDraftValidationReason,variableArrays:readonly string[]=[]):LearningDraftEditResult{
  return editHold(owner,slot,initial,basis,variableArrays)??recordEditRejection(owner,slot,reason);
 }
 function tryEdit<T extends LearningDraftJson>(owner:LearningDraftOwner,slot:string,initial:T,basis:string,transform:(latest:T)=>T,variableArrays:readonly string[]=[]):LearningDraftEditResult{
  let transformed=false;
  try{
   if(edit(owner,slot,initial,basis,current=>{const value=transform(current);transformed=true;return value;},variableArrays))return {kind:'accepted'};
  }catch(error){
   if(!transformed||!(error instanceof LearningDraftValidationError))throw error;
   return recordEditRejection(owner,slot,error.reason);
  }
  return editHold(owner,slot,initial,basis,variableArrays)??{kind:'held',reason:'unavailable'};
 }
 const getEditRejection=(owner:LearningDraftOwner,slot:string)=>editRejections.get(learningDraftKey(owner,slot));
 function dismissEditRejection(owner:LearningDraftOwner,slot:string,id:number):boolean{
  const key=learningDraftKey(owner,slot);if(frozen||maintenance||snapshot.error||editRejections.get(key)?.id!==id)return false;
  editRejections.delete(key);publish();return true;
 }
 async function drain(taskId?:string,formKey?:string):Promise<void>{
  await load();
  while(true){
   if(maintenance)await maintenance;
   if(snapshot.error)throw Error(snapshot.error);
   const relevantRetries=[...retries].filter(([,keys])=>keys.some(key=>(formKey===undefined||key===formKey)&&(taskId===undefined||(entries.get(key)?learningDraftTaskId(entries.get(key)!.owner):undefined)===taskId))).map(([operation])=>operation);
   if(relevantRetries.length>0)await waitForAll(relevantRetries);
   const work=[...entries].filter(([key,entry])=>(formKey===undefined||key===formKey)&&(taskId===undefined||learningDraftTaskId(entry.owner)===taskId)&&(entry.pending||entry.generation!==entry.savedGeneration));
   if(work.length===0)return;
   await waitForAll(work.map(([key,entry])=>pump(key,entry)));
  }
 }
 const flush=(taskId?:string)=>drain(taskId);
 const flushForm=(owner:LearningDraftOwner,slot:string)=>drain(learningDraftTaskId(owner),learningDraftKey(owner,slot));
 /** Register before calling work: it may synchronously dispatch a core mutation.
  * Normal form flushes exclude this set so pre-dispatch flushes cannot await themselves. */
 function runSubmission(work:()=>void|Promise<void>):Promise<void>{
  if(frozen||maintenance||!snapshot.ready||snapshot.error)return Promise.reject(Error('Practice submission is currently held.'));
  let finish!:()=>void;const completion=new Promise<void>(resolve=>{finish=resolve;});submissions.add(completion);
  const complete=()=>{submissions.delete(completion);finish();};
  try{return Promise.resolve(work()).finally(complete);}catch(error){complete();return Promise.reject(error);}
 }
 /** The caller freezes edits first. Confirmations may then schedule exact-token
  * tombstones; drain those writes before acknowledging this particular freeze. */
 async function flushForQuit():Promise<void>{
  const expectedFreeze=freezeEpoch;
  const assertFrozen=()=>{if(!frozen||freezeEpoch!==expectedFreeze)throw Error('Quit draft saving was cancelled when editing resumed.');};
  assertFrozen();await load();assertFrozen();
  while(true){
   while(submissions.size){await Promise.all([...submissions]);assertFrozen();}
   await drain();assertFrozen();
   if(submissions.size===0)return;
  }
 }
 function retry(owner?:LearningDraftOwner,slot?:string):Promise<void>{
  if(maintenance)return Promise.reject(Error('Practice draft maintenance is already in progress.'));
  const requestedKey=owner&&slot!==undefined?learningDraftKey(owner,slot):undefined;
  const retryKeys=[...entries].filter(([key,entry])=>(requestedKey===undefined||requestedKey===key)&&entry.failure).map(([key])=>key);
  const operation=Promise.resolve().then(async()=>{
   const loaded=load();await loaded;
   if(snapshot.error){if(loading===loaded)loading=undefined;await load();if(snapshot.error)throw Error(snapshot.error);}
   const requested=owner&&slot!==undefined?learningDraftKey(owner,slot):undefined;
   const targets=[...entries].filter(([key,entry])=>(requested===undefined||requested===key)&&entry.failure).map(([key,entry])=>({key,entry,failure:entry.failure}));
   if(targets.length===0)return;
   await Promise.all(targets.map(({entry})=>entry.pending?.catch(()=>undefined)));
   let records:LearningDraftRecord[],readEpoch:string;
   try{
    const notice=cleanupNotice,result=await transport.read();if(result.kind==='unavailable'){unavailable(result);throw Error(result.message);}
    readEpoch=parseLearningDraftEpoch(result.epoch);records=result.records.map(immutableRecord);
    const seen=new Set<string>();for(const record of records){const key=learningDraftKey(record.owner,record.slot);if(seen.has(key))throw Error('Duplicate draft identity.');seen.add(key);}
    available(result,notice);
   }catch(error){
    let active=false;
    for(const {key,entry,failure} of targets)if(entries.get(key)===entry&&failure&&entry.failure===failure){entry.failure={...failure,message:errorMessage(error)};active=true;}
    publish();if(active)throw error;return;
   }
   observe(readEpoch,records);
   const work:Promise<void>[]=[];
   for(const {key,entry,failure} of targets){
    if(entries.get(key)!==entry||!failure||entry.failure!==failure)continue;
    const current=records.find(record=>learningDraftKey(record.owner,record.slot)===key)??null;
    reconcileRecord(entry,failure,current,readEpoch);
    work.push(pump(key,entry));
   }
   publish();await waitForAll(work);
  });
  retries.set(operation,retryKeys);void operation.finally(()=>{retries.delete(operation);}).catch(()=>undefined);
  return operation;
 }
 function capture(owner:LearningDraftOwner,slot:string):LearningDraftToken|undefined{
  const key=learningDraftKey(owner,slot),entry=entries.get(key);
  if(frozen||maintenance||snapshot.error||!entry||entry.local===null||entry.failure)return undefined;
  const token=Object.freeze({owner:entry.owner,slot:entry.slot,generation:entry.generation});
  tokens.set(token,{key,entry,generation:entry.generation});return token;
 }
 function captureSourceSubmission(owner:LearningDraftOwner,slot:string,intentId:string,binding:string):LearningDraftToken|undefined{
  const key=learningDraftKey(owner,slot),entry=entries.get(key);
  if(!('kind' in owner)||owner.kind!=='source-text-edit'||slot!==SOURCE_TEXT_DRAFT_SLOT||!entry||isForgotten(owner))return;
  const value=entry.local??(entry.failure?entry.remote?.value:null);if(!value)return;
  const raw=parseSourceTextDraft(parseLearningDraftJson(value.value,'source-text-edit'));
  if(raw.intentId!==intentId||raw.binding!==binding)return;
  const token=Object.freeze({owner:entry.owner,slot:entry.slot,generation:entry.generation});tokens.set(token,{key,entry,generation:entry.generation});return token;
 }
 function clear(key:string,entry:Entry){
  entry.local=null;entry.generation+=1;publish();
  void pump(key,entry).catch(()=>undefined);
 }
 /** Call only after the core mutation captured by this exact token succeeded. */
 function acknowledge(token:LearningDraftToken):boolean{
  const captured=tokens.get(token);tokens.delete(token);
  if(!captured||entries.get(captured.key)!==captured.entry||captured.entry.generation!==captured.generation)return false;
  clear(captured.key,captured.entry);return true;
 }
 /** Only an already confirmed source save may retire its own original payload.
  * Newer user edits keep their logical generation even across renderer reopen.
  * Reconcile failed sidecar writes before staging the smaller confirmed value;
  * this avoids retrying an oversized dual snapshot merely to remove it. */
 async function completeSourceSubmission(token:LearningDraftToken,confirmed:{intentId:string;binding:string;basis:string;applied?:SourceTextFields;retain?:boolean}){
  const captured=tokens.get(token);
  if(!captured||entries.get(captured.key)!==captured.entry)return {kind:'retired' as const,exact:false};
  const {entry,key}=captured,owner=entry.owner;
  if(!('kind' in owner)||owner.kind!=='source-text-edit'||entry.slot!==SOURCE_TEXT_DRAFT_SLOT||parseSourceTextDraftBasis(confirmed.basis).sourceId!==owner.sourceId)throw Error('Exact source draft confirmation required.');
  await entry.pending?.catch(()=>undefined);
  if(entries.get(key)!==entry||isForgotten(owner))return {kind:'retired' as const,exact:false};
  if(entry.failure){
   const failure=entry.failure,notice=cleanupNotice,result=await transport.read();
   if(result.kind!=='available'){unavailable(result);throw Error(result.message);}
   const readEpoch=parseLearningDraftEpoch(result.epoch),records=result.records.map(immutableRecord),seen=new Set<string>();
   for(const record of records){const identity=learningDraftKey(record.owner,record.slot);if(seen.has(identity))throw Error('Duplicate draft identity.');seen.add(identity);}
   available(result,notice);observe(readEpoch,records);
   if(entries.get(key)!==entry||entry.failure!==failure)throw Error('Source draft reconciliation changed.');
   reconcileRecord(entry,failure,records.find(record=>learningDraftKey(record.owner,record.slot)===key)??null,readEpoch);publish();
   if(entry.failure)throw Error(entry.failure.message);
  }
  if(entry.local===null){tokens.delete(token);return {kind:'retired' as const,exact:false};}
  const raw=parseSourceTextDraft(parseLearningDraftJson(entry.local.value,'source-text-edit'));
  if(raw.intentId!==confirmed.intentId||raw.binding!==confirmed.binding){tokens.delete(token);return {kind:'retired' as const,exact:false};}
  const exact=!confirmed.retain&&entry.generation===captured.generation&&raw.editVersion===raw.submittedEditVersion;
  tokens.delete(token);
  if(exact)clear(key,entry);
  else{
   const next=clearSourceTextAttempt(raw),submitted=sourceTextSubmittedFields(raw);
   const fields=confirmed.applied&&next.label===submitted.label?{...next,label:confirmed.applied.label}:next;
   const value=parseLearningDraftValue({initial:serializeLearningDraftJson(emptySourceTextDraft,'source-text-edit'),value:serializeLearningDraftJson(fields,'source-text-edit'),basis:confirmed.basis},owner,entry.slot);
   if(value===null)throw Error('Expected retained source input.');
   entry.local=value;entry.generation+=1;publish();void pump(key,entry).catch(()=>undefined);
  }
  await flushForm(owner,entry.slot);
  return {kind:exact?'cleared' as const:'retained' as const,exact};
 }
 function captureDocumentDraft(owner:LearningDraftOwner):LearningDraftToken|undefined{
  const slot=SAVED_DOCUMENT_DRAFT_SLOT,key=learningDraftKey(owner,slot),entry=entries.get(key);
  if(!('kind' in owner)||owner.kind!=='saved-document-edit'||!entry||entry.local===null||isForgotten(owner))return;
  const token=Object.freeze({owner:entry.owner,slot,generation:entry.generation});tokens.set(token,{key,entry,generation:entry.generation});return token;
 }
 function reviewDocumentSources(owner:SavedDocumentDraftOwner,expectedGeneration:number|undefined,basis:string,raw:SavedDocumentDraft):boolean{
  const slot=SAVED_DOCUMENT_DRAFT_SLOT,key=learningDraftKey(owner,slot),existing=entries.get(key);
  if(frozen||maintenance||isForgotten(owner)||!snapshot.ready||snapshot.error||!epoch||existing?.failure||existing?.generation!==expectedGeneration)return false;
  const parsedBasis=parseSavedDocumentDraftBasis(basis);if(parsedBasis.taskId!==owner.taskId||parsedBasis.artifactId!==owner.artifactId)throw Error('Document source review belongs to another owner.');
  const value=parseLearningDraftValue({initial:serializeLearningDraftJson(emptySavedDocumentDraft,'saved-document-edit'),value:serializeLearningDraftJson(parseSavedDocumentDraft(raw),'saved-document-edit'),basis},owner,slot);
  const entry:Entry=existing??{owner:Object.freeze({...owner}),slot,epoch,generation:0,savedGeneration:0,local:null,remote:null};
  entry.local=value;entry.generation+=1;entries.set(key,entry);editRejections.delete(key);publish();void pump(key,entry).catch(()=>undefined);return true;
 }
 async function completeDocumentDraft(token:LearningDraftToken,confirmation?:{expectedBasis:string;basis:string},isCurrent:()=>boolean=()=>true):Promise<boolean>{
  const captured=tokens.get(token);if(!captured||entries.get(captured.key)!==captured.entry)return false;
  const {key,entry}=captured,owner=entry.owner;
  if(!('kind' in owner)||owner.kind!=='saved-document-edit'||entry.slot!==SAVED_DOCUMENT_DRAFT_SLOT)throw Error('Exact saved-document draft required.');
  if(confirmation){const basis=parseSavedDocumentDraftBasis(confirmation.basis);if(basis.taskId!==owner.taskId||basis.artifactId!==owner.artifactId)throw Error('Document confirmation belongs to another owner.');}
  await entry.pending?.catch(()=>undefined);
  if(entries.get(key)!==entry||isForgotten(owner))return false;
  if(entry.failure){
   const failure=entry.failure,notice=cleanupNotice,result=await transport.read();
   if(result.kind!=='available'){unavailable(result);throw Error(result.message);}
   const readEpoch=parseLearningDraftEpoch(result.epoch),records=result.records.map(immutableRecord),seen=new Set<string>();
   for(const record of records){const identity=learningDraftKey(record.owner,record.slot);if(seen.has(identity))throw Error('Duplicate draft identity.');seen.add(identity);}
   available(result,notice);observe(readEpoch,records);if(entries.get(key)!==entry||entry.failure!==failure)throw Error('Document draft reconciliation changed.');
   reconcileRecord(entry,failure,records.find(record=>learningDraftKey(record.owner,record.slot)===key)??null,readEpoch);publish();if(entry.failure)throw Error(entry.failure.message);
  }
  if(!isCurrent()||!entry.local)return false;
  if(confirmation&&entry.local.basis!==confirmation.expectedBasis)return false;
  const exact=entry.generation===captured.generation;
  if(!confirmation&&!exact)return false;
  if(exact)clear(key,entry);
  else if(confirmation){const value=parseLearningDraftValue({...entry.local,basis:confirmation.basis},owner,entry.slot);entry.local=value;entry.generation+=1;publish();void pump(key,entry).catch(()=>undefined);}
  await flushForm(owner,entry.slot);tokens.delete(token);return true;
 }
 function discard(owner:LearningDraftOwner,slot:string,expectedGeneration:number):boolean{
  const key=learningDraftKey(owner,slot),entry=entries.get(key);
  if(frozen||maintenance||snapshot.error||!entry||isForgotten(owner)||(entry.local===null&&!entry.failure)||entry.generation!==expectedGeneration||!canDiscard(entry))return false;
  entry.failure=undefined;clear(key,entry);return true;
 }
 function resolve(owner:LearningDraftOwner,slot:string,expectedGeneration:number,choice:'local'|'remote'):boolean{
  const key=learningDraftKey(owner,slot),entry=entries.get(key);
  if(frozen||maintenance||snapshot.error||isForgotten(owner)||!entry||entry.generation!==expectedGeneration||!canResolve(entry))return false;
  entry.failure=undefined;entry.generation+=1;
  if(choice==='remote'){
   entry.local=entry.remote?.value??null;entry.savedGeneration=entry.generation;publish();
  }else{
   publish();void pump(key,entry).catch(()=>undefined);
  }
  return true;
 }
 function forgetTask(taskId:string){
  forgotten.add(taskId);let changed=false;
  for(const [key,entry] of entries)if(learningDraftTaskId(entry.owner)===taskId){entries.delete(key);changed=true;}
  for(const [key,rejection] of editRejections)if(learningDraftTaskId(rejection.owner)===taskId){editRejections.delete(key);changed=true;}
  if(changed)publish();
 }
 async function waitForPending(){
  while(true){const work:Promise<unknown>[]=[...retries.keys(),...[...entries.values()].flatMap(entry=>entry.pending?[entry.pending]:[])];if(work.length===0)return;await Promise.allSettled(work);}
 }
 function maintain<T>(action:()=>Promise<T>):Promise<T>{
  const operation=Promise.resolve().then(async()=>{await load();await waitForPending();return action();});
  maintenance=operation;publish();void operation.finally(()=>{
   if(maintenance===operation){
    maintenance=undefined;
    if(!snapshot.error)for(const [key,entry] of entries)if(!entry.pending&&!entry.failure&&entry.generation!==entry.savedGeneration)void pump(key,entry).catch(()=>undefined);
   }
   publish();
  }).catch(()=>undefined);return operation;
 }
 function recoverUnreadable():Promise<LearningDraftRecoverResult>{
  if(recovering)return recovering;
  const token=recoveryToken,recover=transport.recover;
  if(frozen||maintenance||!token||!recover)return Promise.reject(Error('Unreadable draft recovery is not currently available.'));
  recovering=maintain<LearningDraftRecoverResult>(async()=>{
   try{
    if(recoveryToken!==token)throw Error('The unreadable draft changed.');
    const result=await recover(token),recoveredEpoch=parseLearningDraftEpoch(result.epoch);
    if(result.kind!=='recovered'||recoveredEpoch==='initial'||recoveredEpoch===epoch||!/^learning-drafts-recovery-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/.test(result.backupBasename))throw Error('Draft recovery was not confirmed.');
    epoch=recoveredEpoch;observedEpoch=recoveredEpoch;observedRecords=new Map();recoveryToken=undefined;maintenanceError=undefined;cleanupNeeded=false;snapshot={...snapshot,error:undefined};
    for(const entry of entries.values()){
     const priorEpoch=entry.epoch,predecessor=entry.remote;
     entry.epoch=recoveredEpoch;entry.remote=null;entry.generation+=1;
     if(entry.local===null){entry.savedGeneration=entry.generation;entry.failure=undefined;}
     // A reset confirms an empty file, never permission to replay an older intent on Retry.
     else{const attempt:Attempt={generation:entry.generation,expectedEpoch:priorEpoch,expectedRevision:predecessor?.revision??0,predecessor,value:entry.local};entry.failure={kind:'conflict',message:'Saved practice was reset. Choose which open edits to keep.',attempt,reconciled:true};}
    }
    publish();return {kind:'recovered',epoch:recoveredEpoch,backupBasename:result.backupBasename};
   }catch{
    recoveryToken=undefined;maintenanceError='Draft recovery could not be confirmed. Check saved drafts before trying recovery again.';snapshot={...snapshot,error:maintenanceError};publish();throw Error(maintenanceError);
   }
  });
  const operation=recovering;void operation.finally(()=>{if(recovering===operation)recovering=undefined;}).catch(()=>undefined);return operation;
 }
 function cleanupDeleted():Promise<LearningDraftCleanupResult>{
  if(cleaning)return cleaning;
  const cleanup=transport.cleanup;
  if(frozen||maintenance||!cleanup)return Promise.reject(Error('Deleted draft cleanup is not currently available.'));
  cleaning=maintain<LearningDraftCleanupResult>(async()=>{
   const notice=cleanupNotice;
   try{
    const result=await cleanup(),cleanedEpoch=parseLearningDraftEpoch(result.epoch);
    if(result.kind!=='cleaned'||!Number.isSafeInteger(result.removed)||result.removed<0||result.removed>LEARNING_DRAFT_LIMITS.entries||(result.removed>0&&(cleanedEpoch==='initial'||cleanedEpoch===epoch)))throw Error('Draft cleanup was not confirmed.');
    const read=await transport.read();if(read.kind==='unavailable'){unavailable(read);throw Error(read.message);}
    const readEpoch=parseLearningDraftEpoch(read.epoch),records=read.records.map(immutableRecord),seen=new Set<string>();
    if(readEpoch!==cleanedEpoch)throw Error('Draft cleanup changed before reconciliation.');
    for(const record of records){const key=learningDraftKey(record.owner,record.slot);if(seen.has(key))throw Error('Duplicate draft identity.');seen.add(key);}
    available(read,notice);observe(readEpoch,records);publish();return {kind:'cleaned',epoch:cleanedEpoch,removed:result.removed};
   }catch{
    cleanupNeeded=true;maintenanceError='Deleted draft cleanup could not be confirmed. Try cleanup again.';publish();throw Error(maintenanceError);
   }
  });
  const operation=cleaning;void operation.finally(()=>{if(cleaning===operation)cleaning=undefined;}).catch(()=>undefined);return operation;
 }
 function noteCleanupNeeded(){cleanupNotice+=1;cleanupNeeded=true;publish();}
 return {
  load,getSnapshot:()=>snapshot,getFreezeEpoch:()=>freezeEpoch,
  subscribe(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};},
  readForm,edit,tryEdit,rejectEdit,getEditRejection,dismissEditRejection,flush,flushForm,runSubmission,flushForQuit,capture,captureSourceSubmission,captureDocumentDraft,reviewDocumentSources,completeDocumentDraft,acknowledge,completeSourceSubmission,retry,discard,resolve,forgetTask,recoverUnreadable,cleanupDeleted,noteCleanupNeeded,
  setFrozen(value:boolean){if(frozen!==value){frozen=value;freezeEpoch+=1;publish();}},
 };
}
