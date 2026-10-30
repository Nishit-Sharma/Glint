import type {Artifact,ArtifactRef,Task} from '../../core/types';
import {readScreenBrief} from '../../core/screen-brief';
import {learningDraftKey,serializeLearningDraftJson} from '../../shared/learning-drafts';
import {SAVED_DOCUMENT_DRAFT_SLOT,emptySavedDocumentDraft,ordinaryTextDocument,parseSavedDocumentDraft,savedDocumentDraftBasis,savedDocumentDraftOwner} from '../../shared/saved-document-draft';
import {savedDocumentSourceChanges} from './saved-document-source-changes';
import type {createLearningDrafts} from './learning-drafts';

export type SavedRevisionDraftResult={kind:'ready'}|{kind:'held'|'existing-draft';message:string};
export function savedRevisionDraftSelection(artifact:Artifact,reference:ArtifactRef){
 const latest=artifact.revisions.at(-1),revision=artifact.id===reference.artifactId?artifact.revisions.find(item=>item.revision===reference.revision&&item.digest===reference.digest):undefined;
 if(!latest||!revision||revision.revision>=latest.revision||!ordinaryTextDocument(revision)||!ordinaryTextDocument(latest)||revision.mimeType!==latest.mimeType||revision.encoding!==latest.encoding)return;
 if(readScreenBrief(revision.content,revision.sourceRefs)||readScreenBrief(latest.content,latest.sourceRefs))return;
 return {revision,latest};
}

/** Stage exact historical fields under the latest document basis. Saved history
 * changes only through the existing document controller's explicit Save. */
export async function prepareSavedRevisionDraft({cache,taskId,reference,task,isCurrent}:{cache:ReturnType<typeof createLearningDrafts>;taskId:string;reference:ArtifactRef;task:()=>Task|undefined;isCurrent:()=>boolean}):Promise<SavedRevisionDraftResult>{
 const current=task(),artifact=current?.artifacts.find(item=>item.id===reference.artifactId),selection=artifact&&savedRevisionDraftSelection(artifact,reference);
 if(!isCurrent()||current?.id!==taskId||!selection)return {kind:'held',message:'This exact earlier text revision is unavailable or has a different format. Saved versions are unchanged.'};
 const {revision,latest}=selection,owner=savedDocumentDraftOwner(taskId,reference.artifactId),slot=SAVED_DOCUMENT_DRAFT_SLOT,key=learningDraftKey(owner,slot),basis=savedDocumentDraftBasis(current,reference.artifactId,latest),form=cache.readForm(owner,slot,emptySavedDocumentDraft,basis),state=cache.getSnapshot();
 if(form.status==='recovery'||form.value.present||state.entries[key]?.local)return {kind:'existing-draft',message:'An unfinished draft already exists. Open it to save or explicitly discard its edits before using this revision. Your existing input is kept.'};
 if(!state.ready||state.frozen||state.maintenance||state.error||form.status!=='ready'||form.error)return {kind:'held',message:'Draft storage is not ready. Check the current document before preparing this revision.'};
 if(savedDocumentSourceChanges(current,revision.sourceRefs).some(change=>change.kind==='unavailable'))return {kind:'held',message:'An original source snapshot is unavailable. This revision remains readable, but cannot be prepared as a draft.'};
 let raw;try{raw=parseSavedDocumentDraft({present:true,title:revision.title,content:revision.content,sourceRefs:revision.sourceRefs});}catch{return {kind:'held',message:'This saved revision exceeds the supported draft limits. Saved versions are unchanged.'};}
 const accepted=cache.tryEdit(owner,slot,emptySavedDocumentDraft,basis,()=>raw);
 if(accepted.kind!=='accepted')return {kind:'held',message:'The draft could not be prepared. Existing input and saved versions are unchanged.'};
 const generation=cache.getSnapshot().entries[key]?.generation;
 try{await cache.flushForm(owner,slot);}catch{return {kind:'held',message:'The recovered draft could not be confirmed in storage. Open the current document to check its input before saving.'};}
 const after=task(),entry=cache.getSnapshot().entries[key],afterState=cache.getSnapshot(),afterLatest=after?.artifacts.find(item=>item.id===reference.artifactId)?.revisions.at(-1);
 if(!isCurrent()||after?.id!==taskId||!afterLatest||savedDocumentDraftBasis(after,reference.artifactId,afterLatest)!==basis||afterState.frozen||afterState.maintenance||afterState.error||!entry||entry.generation!==generation||entry.error||entry.local?.basis!==basis||entry.local.value!==serializeLearningDraftJson(raw,'saved-document-edit'))return {kind:'held',message:'The document or draft changed. Open the current version to review the kept input before continuing.'};
 return {kind:'ready'};
}
