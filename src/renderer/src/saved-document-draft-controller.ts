import {renameDocumentTitle} from './document-format';
import type {ArtifactInput,ArtifactRevision,Task} from '../../core/types';
import {SAVED_DOCUMENT_DRAFT_SLOT,emptySavedDocumentDraft,parseSavedDocumentDraft,parseSavedDocumentDraftBasis,savedDocumentDraftOwner,savedDocumentDraftBasis,ordinaryTextDocument,orderedDocumentRefs,sameDocumentRefs,type SavedDocumentDraft} from '../../shared/saved-document-draft';
import {learningDraftKey,parseLearningDraftJson,LearningDraftValidationError} from '../../shared/learning-drafts';
import {changedDependencies} from './editor-state';
import {savedDocumentSourceChanges,type SavedDocumentSourceChange} from './saved-document-source-changes';
import type {createLearningDrafts} from './learning-drafts';
type Fields=Pick<SavedDocumentDraft,'title'|'content'|'sourceRefs'>;
type SourceReview={identity:string;sourceRefs:Fields['sourceRefs'];changes:SavedDocumentSourceChange[]};
type Options={cache:ReturnType<typeof createLearningDrafts>;artifactId:string;task:()=>Task;base:()=>ArtifactRevision;isCurrent:()=>boolean;scope?:()=>string;onDiscard?:()=>void;send:(input:ArtifactInput)=>Promise<Task|undefined>;onSaved:(revision:ArtifactRevision,task:Task)=>void;notify?:()=>void};
export function createSavedDocumentDraftController(options:Options){
 const {cache,artifactId}=options,owner=savedDocumentDraftOwner(options.task().id,artifactId),slot=SAVED_DOCUMENT_DRAFT_SLOT,key=learningDraftKey(owner,slot);
 let discarding:SavedDocumentDraft|undefined;let operation=false,message='',pending:{task:Task;revision:ArtifactRevision;basis:string;stillCurrent:()=>boolean;live:()=>boolean}|undefined;
 const notify=()=>options.notify?.();
 async function tracked<T>(work:()=>Promise<T>):Promise<T>{let result!:T;await cache.runSubmission(async()=>{result=await work();});return result;}
 function snapshot(){
  const task=options.task(),base=options.base(),basis=savedDocumentDraftBasis(task,artifactId,base),form=cache.readForm(owner,slot,emptySavedDocumentDraft,basis);
  const entry=cache.getSnapshot().entries[key],earlier=form.recovery?.local??form.recovery?.remote?.value??(entry?.local===null&&entry.error?entry.remote?.value:undefined);
  const raw=discarding??parseSavedDocumentDraft(earlier?parseLearningDraftJson(earlier.value,'saved-document-edit'):form.value),fields:Fields=raw.present?{title:raw.title,content:raw.content,sourceRefs:raw.sourceRefs}:{title:base.title,content:base.content,sourceRefs:base.sourceRefs};
  const latest=task.artifacts.find(item=>item.id===artifactId)?.revisions.at(-1),changed=latest?.revision!==base.revision||latest?.digest!==base.digest||changedDependencies(task,fields.sourceRefs).length>0;
  const state=cache.getSnapshot(),held=state.frozen||state.maintenance||form.status!=='ready'||!!form.error||!!cache.getEditRejection(owner,slot)||!ordinaryTextDocument(base)||!operation&&changed||!!pending||!!discarding;
  const sourceChanges=savedDocumentSourceChanges(task,fields.sourceRefs);let sourceReview:SourceReview|undefined;
  if(options.isCurrent()&&task.id===owner.taskId&&!operation&&!pending&&!discarding&&state.ready&&!state.frozen&&!state.maintenance&&!state.error&&!form.error&&!cache.getEditRejection(owner,slot)&&ordinaryTextDocument(base)&&latest?.revision===base.revision&&latest.digest===base.digest&&(form.status==='ready'||form.status==='recovery')){
   const earlierBasis=entry?.local?parseSavedDocumentDraftBasis(entry.local.basis):undefined;
   const sameArtifact=!earlierBasis||earlierBasis.taskId===task.id&&earlierBasis.artifactId===artifactId&&earlierBasis.revision===base.revision&&earlierBasis.digest===base.digest&&sameDocumentRefs(earlierBasis.sourceRefs,base.sourceRefs);
   const sourceRefs=fields.sourceRefs.map(ref=>{const change=sourceChanges.find(item=>item.reference.sourceId===ref.sourceId);return change?.kind==='ready'?change.current:ref;});
   if(sameArtifact&&sourceChanges.length)sourceReview={identity:JSON.stringify([options.scope?.(),basis,orderedDocumentRefs(fields.sourceRefs),sourceChanges.map(change=>[change.reference.sourceId,change.kind,change.kind==='unavailable'?null:change.current])]),sourceRefs,changes:sourceChanges};
  }
  return {owner,slot,key,basis,form,raw,fields,changed,operation,pending:!!pending||!!discarding,message,held,frozen:state.frozen,entry:state.entries[key],sourceReview,sourceChanges,canSave:!held&&!operation&&!!fields.title.trim()&&!!fields.content.trim()};
 }
 function reviewSources(review:SourceReview,sourceId?:string):boolean{
  const view=snapshot();if(!view.sourceReview||view.sourceReview.identity!==review.identity)return false;
  const chosen=view.sourceReview.changes.filter(change=>sourceId===undefined||change.reference.sourceId===sourceId);if(!chosen.length||chosen.some(change=>change.kind!=='ready'))return false;
  const sourceRefs=view.fields.sourceRefs.map(ref=>{const change=chosen.find(item=>item.reference.sourceId===ref.sourceId);return change?.kind==='ready'?change.current:ref;});
  const accepted=cache.reviewDocumentSources(owner,view.entry?.generation,view.basis,{present:true,...view.fields,sourceRefs});if(accepted){message='';notify();}return accepted;
 }
 function edit(change:Partial<Fields>|((fields:Fields)=>Partial<Fields>)){
  const view=snapshot();if(view.held)return {kind:'held' as const,reason:'recovery' as const};
  message='';const base=options.base();try{return cache.tryEdit(owner,slot,emptySavedDocumentDraft,view.basis,current=>{
   const previous=current.present?current:{title:base.title,content:base.content,sourceRefs:base.sourceRefs},patch=typeof change==='function'?change(previous):change;
   const fields={...previous,...patch,...(patch.title!==undefined&&patch.content===undefined?{content:renameDocumentTitle(previous.content,previous.title,patch.title)}:{})};
   const raw=parseSavedDocumentDraft({present:true,title:fields.title,content:fields.content,sourceRefs:fields.sourceRefs});
   return raw.title===base.title&&raw.content===base.content&&sameDocumentRefs(raw.sourceRefs,base.sourceRefs)?emptySavedDocumentDraft:raw;
  });}catch(error){if(!(error instanceof LearningDraftValidationError))throw error;return cache.rejectEdit(owner,slot,emptySavedDocumentDraft,view.basis,error.reason);}
 }
 function applySaved(){
  if(!pending)return false;
  if(!pending.stillCurrent()){const current=pending.live();pending=undefined;if(current){message='The document or linked sources advanced. Your saved revision is historical; review the current document before continuing.';notify();}return false;}
  const saved=pending;pending=undefined;options.onSaved(saved.revision,saved.task);message='';notify();return true;
 }
 async function save(){
  const view=snapshot();if(!view.canSave||!options.isCurrent())return false;
  const scope=options.scope?.(),live=()=>options.isCurrent()&&options.scope?.()===scope;
  operation=true;message='Saving this document revision…';notify();
  try{return await tracked(async()=>{
   if(!view.raw.present){const accepted=cache.tryEdit(owner,slot,emptySavedDocumentDraft,view.basis,()=>({present:true,...view.fields}));if(accepted.kind!=='accepted')throw Error('The document input was not accepted.');}
   const token=cache.captureDocumentDraft(owner);if(!token)throw Error('The document input could not be captured.');
   await cache.flushForm(owner,slot);
   const current=snapshot(),base=options.base();if(!live()||current.basis!==view.basis||current.form.status!=='ready'||current.form.error||current.changed)throw Error('The document or linked sources changed before saving. Your raw edits are kept.');
   const input:ArtifactInput={artifactId,expectedRevision:base.revision,title:view.fields.title,content:view.fields.content,mimeType:base.mimeType,encoding:base.encoding,sourceRefs:structuredClone(view.fields.sourceRefs)};
   const result=await options.send(input);if(!result)throw Error('The document save was not confirmed. Check its saved versions before saving again.');
   if(!live())return false;
   const artifact=result.id===owner.taskId?result.artifacts.find(item=>item.id===artifactId):undefined,candidates=artifact?.revisions.filter(item=>item.revision===base.revision+1),saved=candidates?.length===1?candidates[0]:undefined,latest=artifact?.revisions.at(-1);
   if(!saved||latest?.revision!==saved.revision||latest.digest!==saved.digest||saved.title!==input.title||saved.content!==input.content||saved.mimeType!==input.mimeType||saved.encoding!==input.encoding||!sameDocumentRefs(saved.sourceRefs,input.sourceRefs??[])||changedDependencies(result,saved.sourceRefs).length||savedDocumentDraftBasis(options.task(),artifactId,base)!==view.basis)throw Error('The saved document or linked sources advanced. Your raw edits need review.');
   const stillCurrent=()=>{const currentTask=options.task(),currentRevision=currentTask.artifacts.find(item=>item.id===artifactId)?.revisions.at(-1);return live()&&currentTask.id===owner.taskId&&!!currentRevision&&((currentRevision.revision===base.revision&&currentRevision.digest===base.digest)||(currentRevision.revision===saved.revision&&currentRevision.digest===saved.digest))&&savedDocumentDraftBasis(currentTask,artifactId,base)===view.basis&&changedDependencies(currentTask,input.sourceRefs??[]).length===0;};
   if(!stillCurrent())throw Error('The saved document or linked sources advanced. Your raw edits need review.');
   pending={task:result,revision:saved,basis:savedDocumentDraftBasis(result,artifactId,saved),stillCurrent,live};
   if(!await cache.completeDocumentDraft(token,{expectedBasis:view.basis,basis:pending.basis},stillCurrent))throw Error('The document draft generation changed during confirmation.');
   return applySaved();
  });}catch(error){if(live()){message=error instanceof Error?error.message:'Document edits could not be saved. Your raw input is kept.';notify();}return false;}
  finally{operation=false;notify();}
 }
 async function discard(){
  if(operation||cache.getSnapshot().frozen||cache.getSnapshot().maintenance||!options.isCurrent())return false;
  const scope=options.scope?.(),live=()=>options.isCurrent()&&options.scope?.()===scope;
  operation=true;message='Discarding document edits…';notify();
  try{return await tracked(async()=>{const token=cache.captureDocumentDraft(owner);if(!token){if(snapshot().entry?.error)throw Error('Document discard is held.');options.onDiscard?.();return true;}if(!live())return false;discarding=snapshot().raw;if(!await cache.completeDocumentDraft(token,undefined,live)){discarding=undefined;throw Error('Newer document edits are kept.');}const entry=cache.getSnapshot().entries[key];if(entry?.local!==null||entry.error)throw Error('Newer document edits are kept. Choose Cancel again if you want to discard them.');if(!live())return false;discarding=undefined;message='';options.onDiscard?.();return true;});}
  catch{if(live()){message='Discarding document edits was not confirmed. Your raw input is kept; check storage before completing this discard.';notify();}return false;}finally{operation=false;notify();}
 }
 async function check(){
  if(operation||cache.getSnapshot().frozen||cache.getSnapshot().maintenance)return false;const scope=options.scope?.(),live=()=>options.isCurrent()&&options.scope?.()===scope;operation=true;notify();
  try{await cache.retry(owner,slot);if(pending&&!pending.stillCurrent())return applySaved();const entry=cache.getSnapshot().entries[key];if(discarding&&entry?.local===null&&!entry.error&&live()){discarding=undefined;message='';options.onDiscard?.();return true;}if(!pending&&snapshot().changed){if(live())message='The document or linked sources advanced. Review the saved versions before continuing.';return false;}if(live()&&pending&&(entry?.local===null||entry?.local?.basis===pending.basis)&&!entry.error)return applySaved();if(live())message='Storage was checked. Review your document edits before continuing.';return true;}
  catch{if(live())message='Document draft storage is still unconfirmed. Your raw input is kept.';return false;}finally{operation=false;notify();}
 }
 return {snapshot,edit,reviewSources,save,discard,check};
}
