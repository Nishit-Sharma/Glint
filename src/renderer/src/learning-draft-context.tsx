import {parseSavedDocumentDraft,parseSavedDocumentDraftBasis,savedDocumentDraftBasis} from '../../shared/saved-document-draft';
import {REVISION_INSTRUCTIONS_SLOT,parseRevisionInstructions} from '../../shared/revision-instructions';
import {isWorkflowSourceReviewSlot,workflowSourceDraftLabel} from '../../shared/workflow-source-admission';
import {pickingHelper} from '../../learning/picking-helper';
import {pickingHelperDraftBasis,type PickingFamily} from './picking-helper-draft-basis';
import {parseSourceTextDraft,parseSourceTextDraftBasis,sourceTextDraftBasis} from '../../shared/source-text-draft';
import {workflowSourceBasis,workflowSourceCurrency} from './workflow-source-review-form';
import {createContext,useContext,useState,useSyncExternalStore,type ReactNode} from 'react';
import {isTaskLearningDraftOwner,type TaskLearningDraftOwner,learningDraftKey,learningDraftJsonPolicy,parseLearningDraftJson,type LearningDraftJson,type LearningDraftOwner} from '../../shared/learning-drafts';
import {createLearningDrafts,type LearningDraftSnapshot} from './learning-drafts';
import type {Task} from '../../core/types';
import {readScreenBrief} from '../../core/screen-brief';
import {parseModuleAnswer} from '../../core/interactive-modules';
import {helperDraftMode,isHelperDraftSlot} from '../../shared/helper-draft-slots';
import {helperStudio} from '../../learning/reusable-helper';
import {semanticHelper} from '../../learning/semantic-helper';
import {semanticHelperDraftBasis} from './semantic-helper-draft-basis';
import {legacyHelperDraftBasis} from './legacy-helper-draft-basis';
import {navigationFormBasis} from './learning-draft-basis';
import {LearningDraftEditFeedback} from './components/LearningDraftEditFeedback';

type DraftCache=ReturnType<typeof createLearningDrafts>;
const Cache=createContext<DraftCache|null>(null);
const Owner=createContext<LearningDraftOwner|undefined>(undefined);
const empty:LearningDraftSnapshot={revision:0,ready:false,maintenance:false,frozen:false,cleanupNeeded:false,entries:{}};
const subscribe=()=>()=>{};
const snapshot=()=>empty;
export function LearningDraftProvider({cache,children}:{cache:DraftCache;children:ReactNode}){return <Cache.Provider value={cache}>{children}</Cache.Provider>;}
export function LearningDraftMaintenance({cache}:{cache:DraftCache}){
 const state=useSyncExternalStore(cache.subscribe,cache.getSnapshot),[pending,setPending]=useState(false),[message,setMessage]=useState('');
 const act=async(action:()=>Promise<unknown>,success:string)=>{if(pending)return;setPending(true);setMessage('');try{await action();setMessage(success);}catch{setMessage('Practice storage recovery was not confirmed. Original bytes and open input are kept. A recovery attempt may leave a complete or incomplete backup in the app data folder; deleting a task does not remove it. Check the storage problem, then retry.');}finally{setPending(false);}};
 if(!state.error&&!state.recoveryToken&&!state.cleanupNeeded&&!message)return null;
 return <section className="learning-draft-maintenance" aria-label="Practice draft recovery">
  {state.error&&<><p role="alert">Saved practice could not be read. Its original bytes are preserved in the original file or a local recovery backup; lesson results and messages are separate.</p><button type="button" disabled={pending||state.maintenance||state.frozen} onClick={()=>void act(()=>cache.retry(),'Saved practice was read again.')}>Retry reading practice drafts</button></>}
  {state.recoveryToken&&<details><summary>Recover unreadable practice drafts</summary><p>Preserve the exact unreadable file in a separate local backup, then start fresh draft storage. The backup stays in the app data folder until you remove it; deleting a task does not remove this unreadable backup. It is not automatically restored. Open unsaved input stays available for explicit review. This does not change lesson results or messages.</p><button type="button" disabled={pending||state.maintenance||state.frozen} onClick={()=>void act(()=>cache.recoverUnreadable(),'Original file preserved in a local backup. Fresh practice draft storage is ready; review any open edits before saving them.')}>Preserve file and start fresh practice drafts</button></details>}
  {state.cleanupNeeded&&<><p>Draft cleanup for a deleted task has not been confirmed. The deleted task cannot reopen.</p><button type="button" disabled={pending||state.maintenance||state.frozen} onClick={()=>void act(()=>cache.cleanupDeleted(),'Deleted-task practice drafts were removed from current storage. Local recovery backups may still contain them and are not deleted with the task.')}>Retry deleted-practice cleanup</button></>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
export function LearningDraftScope({owner,children}:{owner?:LearningDraftOwner;children:ReactNode}){
 const cache=useContext(Cache),state=useSyncExternalStore(cache?.subscribe??subscribe,cache?.getSnapshot??snapshot,cache?.getSnapshot??snapshot);
 const entries=owner?Object.values(state.entries).filter(entry=>learningDraftKey(entry.owner,'')===learningDraftKey(owner,'')):[];
 const failed=state.error||entries.some(entry=>entry.error),saving=entries.some(entry=>entry.status==='saving'||entry.status==='unsaved'),rejected=owner&&Object.values(state.editRejections??{}).some(entry=>learningDraftKey(entry.owner,'')===learningDraftKey(owner,''));
 return <Owner.Provider value={owner}>{owner&&cache&&<div className="learning-draft-status" role={failed||rejected?'alert':'status'}>{failed?<><p>Unfinished practice could not be saved. Your input is kept in this open app. Resolve this before quitting.</p><button type="button" disabled={state.maintenance||state.frozen} onClick={()=>void cache.retry().catch(()=>{})}>Retry saving practice drafts</button></>:rejected?'A form change was not applied. Review its message and the shown accepted values before submitting.':saving?'Saving unapplied edits…':entries.some(entry=>entry.local)?'Unapplied edits saved on this Mac. Review them in Files → Unfinished practice. They do not change the lesson result.':null}</div>}{owner&&cache?<fieldset className="learning-draft-fields" disabled={!state.ready||!!state.error||state.frozen}>{children}</fieldset>:children}</Owner.Provider>;
}
function readable(value:LearningDraftJson,indent=''):string{
 if(typeof value==='string')return value;
 if(value===null||typeof value!=='object')return String(value);
 if(Array.isArray(value))return value.map((entry,index)=>`${indent}${index+1}. ${readable(entry,indent+'  ')}`).join('\n');
 return Object.entries(value).map(([key,entry])=>`${indent}${key.replace(/([a-z])([A-Z])/g,'$1 $2')}: ${readable(entry,indent+'  ')}`).join('\n');
}
export function learningDraftFormName(slot:string){const sourceLabel=workflowSourceDraftLabel(slot);if(sourceLabel)return sourceLabel;if(slot==='window-workflow:proposal')return 'State transition proposal';if(slot.startsWith('window-workflow:review:'))return 'State transition review';if(slot.startsWith('window-workflow:publication:'))return 'Finite experiment publication';if(slot.startsWith('helper:table:'))return ({candidate:'Manifest steps',context:'Manifest table and request',recording:'Manifest action choices',cases:'Declared manifest cases',correction:'Manifest reason correction',run:'Manifest run selection'} as Record<string,string>)[slot.split(':')[2]]??'Earlier helper edit';if(isHelperDraftSlot(slot)){const name=slot.split(':').at(-1);return ({details:'Helper details',demonstration:'Text example',operation:'Text operation',exception:'Text exception',check:'Text check',version:'Version note',run:'Helper input',steps:'Record steps',record:'Record example',checks:'Record checks',correction:'Reason correction'} as Record<string,string>)[name??'']??'Earlier helper edit';}return slot.includes(':prediction:')?'Prediction':slot.includes(':rule:')?'Rule change':slot.includes(':sequence:')?'Event sequence':slot.includes(':initial:')?'Starting state':slot.includes(':cell:')?'Table value correction':slot.includes(':type:')?'Column type':slot.includes(':row:')?'Table row':'Join keys';}
export function LearningDraftReview({task,cache}:{task:Task;cache:DraftCache}){
 const state=useSyncExternalStore(cache.subscribe,cache.getSnapshot),entries=Object.values(state.entries).filter((entry):entry is typeof entry&{owner:TaskLearningDraftOwner}=>isTaskLearningDraftOwner(entry.owner)&&entry.owner.taskId===task.id&&(entry.local!==null||!!entry.error));
 if(!entries.length&&!state.error)return null;
 return <details className="learning-draft-review"><summary>Unfinished practice</summary><p>These are unapplied editing drafts. Opening this list never runs a lesson, captures a window or sends a request.</p>{state.error&&<p role="alert">Saved practice could not be read. Its original bytes are preserved. Retry after resolving the storage problem.</p>}{entries.map(entry=>{
  const owner=entry.owner;
  if('kind' in owner&&owner.kind==='source-text-edit'){
   const source=task.sources.find(source=>source.id===owner.sourceId),version=source?.versions.at(-1),value=entry.local??entry.remote?.value;
   const raw=value?parseSourceTextDraft(parseLearningDraftJson(value.value,'source-text-edit')):undefined;
   let current=false;try{const basis=value&&parseSourceTextDraftBasis(value.basis);current=!!basis&&!!source&&!!version&&value?.basis===sourceTextDraftBasis({sourceId:source.id,version:version.version,digest:version.digest},source.freshness);}catch{}
   return <article key={learningDraftKey(owner,entry.slot)}><h4>{version?.label??'Earlier source'} · Source edits</h4><p>{current?'Open this source to continue editing.':'The original source or its freshness changed. Copy any useful text; these edits cannot be applied automatically.'}</p>{raw&&<pre className="source-content">{readable({label:raw.label,content:raw.content,role:raw.role})}</pre>}{entry.error&&<p role="alert">Saving these source edits was not confirmed. Your raw input is kept.</p>}<button type="button" disabled={state.maintenance||state.frozen} onClick={()=>void cache.retry(owner,entry.slot).catch(()=>{})}>Check latest saved source edits</button>{raw?.intentId&&<p>A source save needs checking. Open this source before discarding its input.</p>}<button type="button" disabled={!entry.canDiscard||!!raw?.intentId} onClick={()=>cache.discard(owner,entry.slot,entry.generation)}>Discard source edits</button></article>;
  }
  if('kind' in owner&&owner.kind==='saved-document-edit'){
   if(entry.slot===REVISION_INSTRUCTIONS_SLOT){
    const artifact=task.artifacts.find(item=>item.id===owner.artifactId),revision=artifact?.revisions.at(-1),value=entry.local??entry.remote?.value,raw=value?parseRevisionInstructions(parseLearningDraftJson(value.value)):undefined;
    let current=false;try{current=!!revision&&!!value&&value.basis===savedDocumentDraftBasis(task,owner.artifactId,revision);if(value)parseSavedDocumentDraftBasis(value.basis);}catch{}
    return <article key={learningDraftKey(owner,entry.slot)}><h4>{revision?.title??'Earlier document'} · Revision instructions</h4><p>{current?'Open this document to review its unsent instructions.':'The saved document or linked sources changed. Copy useful text; these instructions will not be sent or applied automatically.'}</p>{raw&&<pre className="source-content">{raw.text}</pre>}{entry.error&&<p role="alert">Saving or clearing these instructions was not confirmed. Check storage before continuing.</p>}<button type="button" disabled={state.maintenance||state.frozen} onClick={()=>void cache.retry(owner,entry.slot).catch(()=>{})}>Check latest saved instructions</button><button type="button" disabled={!entry.canDiscard} onClick={()=>cache.discard(owner,entry.slot,entry.generation)}>Discard revision instructions</button></article>;
   }
   const artifact=task.artifacts.find(item=>item.id===owner.artifactId),revision=artifact?.revisions.at(-1),value=entry.local??entry.remote?.value,raw=value?parseSavedDocumentDraft(parseLearningDraftJson(value.value,'saved-document-edit')):undefined;
   let current=false;try{current=!!revision&&!!value&&value.basis===savedDocumentDraftBasis(task,owner.artifactId,revision);if(value)parseSavedDocumentDraftBasis(value.basis);}catch{}
   return <article key={learningDraftKey(owner,entry.slot)}><h4>{revision?.title??'Earlier document'} · Document edits</h4><p>{current?'Open this document to continue editing.':'The saved document or linked sources changed. Copy useful text; these edits cannot be applied automatically.'}</p>{raw&&<pre className="source-content">{readable({title:raw.title,content:raw.content,sourceRefs:raw.sourceRefs})}</pre>}{entry.error&&<p role="alert">Saving these document edits was not confirmed. Your raw input is kept.</p>}<button type="button" disabled={state.maintenance||state.frozen} onClick={()=>void cache.retry(owner,entry.slot).catch(()=>{})}>Check latest saved document edits</button><button type="button" disabled={!entry.canDiscard} onClick={()=>cache.discard(owner,entry.slot,entry.generation)}>Discard document edits</button></article>;
  }
  const artifact=task.artifacts.find(item=>item.id===owner.artifactId),revision=artifact?.revisions.find(item=>item.revision===owner.artifactRevision&&item.digest===owner.artifactDigest);
  let current=false;try{
   if(revision&&artifact?.revisions.at(-1)===revision){
    if('kind' in owner){if(owner.kind==='window-workflow-review')current=!!readScreenBrief(revision.content,revision.sourceRefs);else{const basis={artifactId:artifact.id,revision:revision.revision,digest:revision.digest},identity=workflowSourceBasis(basis,revision.sourceRefs),expected=isWorkflowSourceReviewSlot(entry.slot)?navigationFormBasis(null,{slot:entry.slot,basisMode:'explicit',basis:identity,variableArrays:['eventSequence']}):identity;current=revision.mimeType.startsWith('text/')&&revision.encoding!=='base64'&&!workflowSourceCurrency(task,task.id,{basis,sourceRefs:revision.sourceRefs})&&[entry.local,entry.remote?.value??null].every(value=>value===null||value.basis===expected);}}
    else{
    const moduleOwner=owner,answer=parseModuleAnswer(JSON.parse(revision.content)),module=answer.modules.find(item=>item.id===moduleOwner.moduleId&&item.version===moduleOwner.moduleVersion);
    current=!!module;
    if(module?.data.kind==='helper-studio'){
     const mode=helperDraftMode(entry.slot),matches=task.session?.moduleStates.filter(item=>item.artifactId===artifact.id&&item.artifactRevision===revision.revision&&(item.moduleId===module.id||(item.moduleId===undefined&&answer.modules.length===1)))??[];
     if(!mode||matches.length>1)current=false;
     else{
      const raw=matches[0]?.state,semantic=raw?.format==='semantic-record-v1',table=raw?.format==='semantic-table-v2';
      if((table?'table':semantic?'semantic':'text')!==mode)current=false;
      else{
       const family=entry.slot.split(':')[2],helperState=table?pickingHelper.parseState(module.data.id,raw):semantic?semanticHelper.parseState(module.data.id,raw):raw?helperStudio.parseState(module.data,raw):helperStudio.initial(module.data);
       const basis=table?pickingHelperDraftBasis(helperState as ReturnType<typeof pickingHelper.parseState>,family as PickingFamily):semantic?semanticHelperDraftBasis(helperState as ReturnType<typeof semanticHelper.parseState>,family as Parameters<typeof semanticHelperDraftBasis>[1]):legacyHelperDraftBasis(helperState as ReturnType<typeof helperStudio.parseState>,family as 'details'|'demonstration'|'operation'|'exception'|'check'|'version'|'run');
       const expected=navigationFormBasis(null,{slot:entry.slot,basisMode:'explicit',basis,...(table&&family==='context'?{variableArrays:['rows']}:{} )});
       current=[entry.local,entry.remote?.value??null].every(value=>value===null||value.basis===expected);
      }
     }
    }else if(isHelperDraftSlot(entry.slot))current=false;
    }
   }
  }catch{current=false;}
  return <article key={learningDraftKey(owner,entry.slot)}><h4>{revision?.title??'Earlier answer'} · {learningDraftFormName(entry.slot)}</h4><p>Answer revision {owner.artifactRevision}. {current?'Review the applied inputs before continuing.':'The original answer or module changed. Copy any useful text; these edits cannot be applied here.'}</p><h5>Your unapplied edits</h5>{entry.local?<pre className="source-content">{readable(parseLearningDraftJson(entry.local.value,learningDraftJsonPolicy(owner,entry.slot)))}</pre>:<p>This draft was cleared after submission, but removing its saved copy was not confirmed.</p>}{entry.remote?.value&&entry.remote.value.value!==entry.local?.value&&<><h5>Last confirmed saved edits</h5><pre className="source-content">{readable(parseLearningDraftJson(entry.remote.value.value,learningDraftJsonPolicy(owner,entry.slot)))}</pre></>}{entry.error&&<p role="alert">The saved draft changed or its write was not confirmed. Inspect both versions before choosing.</p>}<div><button type="button" disabled={state.maintenance||state.frozen} onClick={()=>void cache.retry(owner,entry.slot).catch(()=>{})}>Check latest saved draft</button>{current&&entry.canResolve&&<><button type="button" onClick={()=>cache.resolve(owner,entry.slot,entry.generation,'local')}>Keep my edits</button><button type="button" onClick={()=>cache.resolve(owner,entry.slot,entry.generation,'remote')}>{entry.remote?.value?'Use saved edits':'Use applied inputs and discard this draft'}</button></>}<button type="button" disabled={!entry.canDiscard} onClick={()=>cache.discard(owner,entry.slot,entry.generation)}>Discard this practice draft</button></div></article>;
 })}</details>;
}
export function useLearningDraft<T extends LearningDraftJson>(initial:T,slot:string,basis:string,variableArrays:readonly string[]=[]){
 const cache=useContext(Cache),owner=useContext(Owner);
 const state=useSyncExternalStore(cache?.subscribe??subscribe,cache?.getSnapshot??snapshot,cache?.getSnapshot??snapshot);
 if(!cache||!owner||!slot)return undefined;
 const form=cache.readForm(owner,slot,initial,basis,variableArrays),token=cache.capture(owner,slot),rejection=cache.getEditRejection(owner,slot);
 const recovery=form.recovery;
 const prior=recovery?.local??recovery?.remote?.value;
 const feedback=recovery?<><p role="status">Review the earlier unapplied edits before editing this form.</p><details className="learning-draft-recovery"><summary>Earlier unapplied edits need review</summary><p>The applied inputs or saved draft changed. These edits have not been applied to the current example. Inspect the versions or review them in Files → Unfinished practice.</p>{prior&&<><h5>Your unapplied edits</h5><pre className="source-content">{readable(parseLearningDraftJson(prior.value,learningDraftJsonPolicy(owner,slot)))}</pre></>}{recovery.remote?.value&&recovery.remote.value.value!==recovery.local?.value&&<><h5>Last confirmed saved edits</h5><pre className="source-content">{readable(parseLearningDraftJson(recovery.remote.value.value,learningDraftJsonPolicy(owner,slot)))}</pre></>}<button type="button" disabled={state.maintenance||state.frozen} onClick={()=>void cache.retry(owner,slot).catch(()=>{})}>Check latest saved draft</button>{recovery.canResolve&&<><button type="button" onClick={()=>cache.resolve(owner,slot,recovery.generation,'local')}>Keep my edits</button><button type="button" onClick={()=>cache.resolve(owner,slot,recovery.generation,'remote')}>{recovery.remote?.value?'Use saved edits':'Use applied inputs and discard this draft'}</button></>}<button type="button" disabled={!recovery.canDiscard} onClick={()=>cache.discard(owner,slot,form.generation??0)}>Discard earlier unapplied edits</button></details></>:form.preparationError?<p role="alert">This form exceeds the supported input limits. No partial form was loaded. Earlier saved work remains available in Files → Unfinished practice.</p>:form.error?<p role="alert">This form is held until its practice draft can be saved. Your input is kept.</p>:null;
 return {cache,owner,slot,form,token,rejection,feedback:<>{feedback}{rejection&&<LearningDraftEditFeedback rejection={rejection} disabled={state.frozen||state.maintenance||form.status!=='ready'||!!form.error} onUseAccepted={()=>cache.dismissEditRejection(owner,slot,rejection.id)}/>}</>,maintenance:state.maintenance,frozen:state.frozen};
}

/** Observation only: a raw-form edit/undo must not revive a previous confirmation. */
export function useLearningDraftGeneration(slot:string):number|undefined{
 const cache=useContext(Cache),owner=useContext(Owner),state=useSyncExternalStore(cache?.subscribe??subscribe,cache?.getSnapshot??snapshot,cache?.getSnapshot??snapshot);
 return owner&&cache?(state.entries[learningDraftKey(owner,slot)]?.generation??0):undefined;
}

/** Non-consuming core actions still participate in the existing quit barrier.
 * This does not acknowledge any editing family or infer a saved raw generation. */
export function useLearningDraftSubmission(){
 const cache=useContext(Cache),owner=useContext(Owner);
 return async <T,>(work:()=>T|Promise<T>):Promise<T>=>{
  if(!cache||!owner)return work();
  let result!:T;await cache.runSubmission(async()=>{result=await work();});return result;
 };
}
