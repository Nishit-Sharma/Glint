import type {SourceRef,Task} from '../../core/types';
import {NEW_DOCUMENT_DRAFT_SLOT,emptyNewDocumentDraft,newDocumentDraftOwner,newDocumentDraftBasis,parseNewDocumentDraft,readAuthoredDocumentInput,type AuthoredDocumentInput,type AuthoredDocumentResult} from '../../shared/authored-document';
import {learningDraftKey,serializeLearningDraftJson,LearningDraftValidationError} from '../../shared/learning-drafts';
import {sameDocumentRefs} from '../../shared/saved-document-draft';
import {renameDocumentTitle} from './document-format';
import {changedDependencies,currentSourceRefs} from './editor-state';
import type {createLearningDrafts} from './learning-drafts';
type Fields={title:string;content:string;sourceRefs:SourceRef[]};
type Options={cache:ReturnType<typeof createLearningDrafts>;task:()=>Task;isCurrent:()=>boolean;scope:()=>string;send:(input:AuthoredDocumentInput)=>Promise<unknown>;onSaved:(result:AuthoredDocumentResult)=>void;notify:()=>void};
const signature=(value:unknown)=>serializeLearningDraftJson(value,'new-document-edit');
async function sha256(text:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
/** Only the blank new-document entry owns this raw input and creation intent. */
export function createNewDocumentDraftController(options:Options){
 const {cache}=options,owner=newDocumentDraftOwner(options.task().id),slot=NEW_DOCUMENT_DRAFT_SLOT,basis=newDocumentDraftBasis(owner.taskId),key=learningDraftKey(owner,slot);
 let operation=false,message='';
 const read=()=>cache.readForm(owner,slot,emptyNewDocumentDraft,basis),entry=()=>cache.getSnapshot().entries[key];
 function snapshot(){
  const form=read(),raw=parseNewDocumentDraft(form.value),task=options.task(),state=cache.getSnapshot();
  const sourceRefs=currentSourceRefs(task).filter(ref=>{const source=task.sources.find(source=>source.id===ref.sourceId)!;return !source.revoked&&source.freshness==='fresh'&&(!task.session?.sourceSelection||task.session.sourceSelection.sourceIds.includes(ref.sourceId));});
  const fields:Fields=raw.present?{title:raw.title,content:raw.content,sourceRefs:raw.sourceRefs}:{title:'',content:'',sourceRefs},changed=changedDependencies(task,fields.sourceRefs).length>0||fields.sourceRefs.some(ref=>task.sources.find(source=>source.id===ref.sourceId)?.revoked||task.session?.sourceSelection&&!task.session.sourceSelection.sourceIds.includes(ref.sourceId));
  const held=!options.isCurrent()||task.id!==owner.taskId||task.status!=='active'||!!task.archive||state.frozen||state.maintenance||!!state.error||form.status!=='ready'||!!form.error||!!cache.getEditRejection(owner,slot)||operation||!!raw.intentId;
  return {owner,slot,basis,key,scope:options.scope(),form,raw,fields,changed,held,operation,message,entry:entry(),pending:!!raw.intentId,frozen:state.frozen,canSave:!held&&!changed&&!!fields.title.trim()&&!!fields.content.trim()};
 }
 function ready(generation:number,expected:string,scope:string,epoch:number){
  const view=snapshot();if(!options.isCurrent()||options.scope()!==scope||cache.getFreezeEpoch()!==epoch||view.frozen||cache.getSnapshot().maintenance||cache.getSnapshot().error||view.form.status!=='ready'||view.form.error||cache.getEditRejection(owner,slot)||(view.form.generation??0)!==generation||signature(view.raw)!==expected)throw Error('This new document input changed or is held. Review it before saving.');
 }
 async function save(expectedScope=options.scope()):Promise<boolean>{
  if(operation||expectedScope!==options.scope())return false;const scope=options.scope(),epoch=cache.getFreezeEpoch();operation=true;message='';options.notify();let confirmed=false;
  try{
   const view=snapshot(),raw=view.raw,generation=view.form.generation??0,expected=signature(raw);ready(generation,expected,scope,epoch);
   const input=readAuthoredDocumentInput({taskId:owner.taskId,intentId:raw.intentId||'validating',...view.fields}),{intentId:_,...payload}=input,binding=await sha256(JSON.stringify({operation:'authored-document:v1',...payload}));ready(generation,expected,scope,epoch);
   if(raw.intentId&&raw.binding!==binding)throw Error('The original document input no longer matches its save identity. Check Files before discarding this input.');
   const prepared=raw.intentId?raw:parseNewDocumentDraft({present:true,...view.fields,intentId:crypto.randomUUID(),binding});
   if(!raw.intentId&&!cache.edit(owner,slot,emptyNewDocumentDraft,basis,()=>prepared))throw Error('The new document save identity could not be kept.');
   const token=cache.capture(owner,slot),submitted=read(),submittedSignature=signature(prepared);if(!token)throw Error('The new document input could not be captured.');
   await cache.flushForm(owner,slot);ready(submitted.generation??0,submittedSignature,scope,epoch);
   const intentHash=await sha256(prepared.intentId);ready(submitted.generation??0,submittedSignature,scope,epoch);
   await cache.runSubmission(async()=>{
    const value=await options.send({...input,intentId:prepared.intentId}),result=value as AuthoredDocumentResult|undefined,first=result?.task?.artifacts?.find(artifact=>artifact.id===result.artifactId)?.revisions[0],origin=first?.contextOrigin;
    if(!result||result.task.id!==owner.taskId||result.revision!==1||result.payloadDigest!==binding||result.intentHash!==intentHash||!first||first.revision!==1||first.digest!==result.digest||first.title!==input.title||first.content!==input.content||first.mimeType!=='text/markdown'||!sameDocumentRefs(first.sourceRefs,input.sourceRefs)||origin?.kind!=='authored-document-v1'||origin.taskId!==owner.taskId||origin.artifactId!==result.artifactId||origin.contentDigest!==result.digest||origin.intentHash!==intentHash||origin.payloadDigest!==binding)throw Error('The document save reply was not confirmed. Check Files or retry this exact save.');
    confirmed=true;const acknowledged=cache.acknowledge(token),cleared=entry()?.generation;await cache.flushForm(owner,slot);
    if(acknowledged&&entry()?.local===null&&entry()?.generation===cleared&&options.isCurrent()&&options.scope()===scope&&cache.getFreezeEpoch()===epoch&&!cache.getSnapshot().frozen&&!cache.getSnapshot().maintenance)options.onSaved(result);
   });
   return confirmed;
  }catch(error){if(options.isCurrent()&&options.scope()===scope&&cache.getFreezeEpoch()===epoch)message=error instanceof Error?error.message:'This document save was not confirmed.';return confirmed;}
  finally{operation=false;options.notify();}
 }
 return {owner,slot,snapshot,save,
  edit(change:Partial<Fields>|((fields:Fields)=>Partial<Fields>),expectedScope=options.scope()){
   const view=snapshot();if(view.held||expectedScope!==options.scope())return {kind:'held' as const,reason:'recovery' as const};message='';
   try{return cache.tryEdit(owner,slot,emptyNewDocumentDraft,basis,()=>{const patch=typeof change==='function'?change(view.fields):change;return parseNewDocumentDraft({present:true,...view.fields,...patch,...(patch.title!==undefined&&patch.content===undefined?{content:renameDocumentTitle(view.fields.content,view.fields.title,patch.title)}:{}),intentId:'',binding:''});});}
   catch(error){if(!(error instanceof LearningDraftValidationError))throw error;return cache.rejectEdit(owner,slot,emptyNewDocumentDraft,basis,error.reason);}
  },
  async check(){try{await cache.retry(owner,slot);message='';}catch(error){message=error instanceof Error?error.message:'Draft storage is unavailable.';}options.notify();},
  async discard(expectedScope=options.scope()){
   if(operation||expectedScope!==options.scope()||!options.isCurrent()||options.task().id!==owner.taskId||cache.getSnapshot().frozen||cache.getSnapshot().maintenance)return false;operation=true;message='';options.notify();
   try{const current=entry();if(current?.local&&!cache.discard(owner,slot,current.generation))throw Error('This input changed or needs recovery before discarding.');const generation=entry()?.generation;await cache.flushForm(owner,slot);if(entry()?.local||entry()?.generation!==generation)throw Error('Newer document input is kept.');return true;}
   catch(error){message=error instanceof Error?error.message:'Discarding input was not confirmed.';return false;}finally{operation=false;options.notify();}
  },
 };
}
