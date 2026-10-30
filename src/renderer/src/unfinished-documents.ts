import type {Task} from '../../core/types';
import {readScreenBrief} from '../../core/screen-brief';
import {parseLearningDraftJson} from '../../shared/learning-drafts';
import {parseSavedDocumentDraft,parseSavedDocumentDraftBasis,savedDocumentDraftBasis,SAVED_DOCUMENT_DRAFT_SLOT} from '../../shared/saved-document-draft';
import {searchableSavedFile,type SavedWorkMatch} from '../../shared/saved-work-search';
import {changedDependencies} from './editor-state';
import type {LearningDraftEntrySnapshot,LearningDraftSnapshot} from './learning-drafts';

export type UnfinishedDocumentStatus='continue'|'sources'|'revision'|'storage';
export interface UnfinishedDocument{key:string;match:Extract<SavedWorkMatch,{kind:'file'}>;status:UnfinishedDocumentStatus}
const drafts=new WeakMap<UnfinishedDocument,LearningDraftEntrySnapshot>();
export const unfinishedDocumentStatus:Record<UnfinishedDocumentStatus,string>={continue:'Continue editing',sources:'Source links need review',revision:'Saved document changed; review kept edits',storage:'Draft storage needs checking'};

/** Only owner names and navigation identity leave this selector. Draft text is
 * read locally for readiness and never becomes a saved task/search excerpt. */
export function unfinishedDocuments(tasks:readonly Task[],state:LearningDraftSnapshot):UnfinishedDocument[]{
 const result:UnfinishedDocument[]=[];
 for(const [key,entry] of Object.entries(state.entries)){
  const owner=entry.owner;if(!('kind' in owner)||owner.kind!=='saved-document-edit'||entry.slot!==SAVED_DOCUMENT_DRAFT_SLOT)continue;
  const value=entry.local??(entry.error?entry.remote?.value:undefined);if(!value)continue;
  const owners=tasks.filter(task=>task.id===owner.taskId),task=owners.length===1?owners[0]:undefined,artifacts=task?.artifacts.filter(item=>item.id===owner.artifactId),artifact=artifacts?.length===1?artifacts[0]:undefined,revision=artifact?.revisions.at(-1);
  if(!task||!artifact||!revision||!searchableSavedFile(revision)||readScreenBrief(revision.content,revision.sourceRefs))continue;
  try{
   const raw=parseSavedDocumentDraft(parseLearningDraftJson(value.value,'saved-document-edit')),basis=parseSavedDocumentDraftBasis(value.basis);
   if(!raw.present||basis.taskId!==task.id||basis.artifactId!==artifact.id)continue;
   const status:UnfinishedDocumentStatus=entry.error||state.error?'storage':basis.revision!==revision.revision||basis.digest!==revision.digest?'revision':value.basis!==savedDocumentDraftBasis(task,artifact.id,revision)||changedDependencies(task,raw.sourceRefs).length?'sources':'continue';
   const item:UnfinishedDocument={key,status,match:{kind:'file',taskId:task.id,taskTitle:task.title,title:revision.title,artifactId:artifact.id,revision:revision.revision,digest:revision.digest,mimeType:revision.mimeType,encoding:revision.encoding,contentLength:revision.content.length,contentPrefix:'',field:'File name',excerpt:''}};
   drafts.set(item,entry);result.push(item);
  }catch{continue;}
 }
 return result.sort((a,b)=>a.match.taskTitle.localeCompare(b.match.taskTitle)||a.match.title.localeCompare(b.match.title)||a.key.localeCompare(b.key));
}
export function unfinishedDocumentCurrent(item:UnfinishedDocument,state:LearningDraftSnapshot):boolean{
 const prior=drafts.get(item),entry=state.entries[item.key];
 return !!prior&&!!entry&&entry.epoch===prior.epoch&&entry.generation===prior.generation&&entry.error===prior.error&&entry.local===prior.local&&(prior.local!==null||entry.remote?.value===prior.remote?.value);
}
