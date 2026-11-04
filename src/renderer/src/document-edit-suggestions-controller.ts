import type {Task,SourceRef} from '../../core/types';
import type {createLearningDrafts} from './learning-drafts';
import type {createSavedDocumentDraftController} from './saved-document-draft-controller';
import type {createRevisionInstructionsController} from './revision-instructions-controller';
import {confirmedSuggestionResult,suggestionDocument} from '../../shared/document-edit-suggestions';
import {savedDocumentDraftBasis} from '../../shared/saved-document-draft';

export type SuggestionSubmission={requestId:string;basis:string;sourceRefs:SourceRef[];prompt:string};
type Options={task:()=>Task;artifactId:string;instructions:()=>ReturnType<ReturnType<typeof createRevisionInstructionsController>['snapshot']>;cache:ReturnType<typeof createLearningDrafts>;isCurrent:()=>boolean;scope:()=>string;blocked:()=>boolean;send:(submission:SuggestionSubmission)=>Promise<Task|undefined>;notify?:()=>void};
export function createDocumentSuggestionsController(options:Options){
 let operation=false,message='',activeRequestId:string|undefined;
 const notify=()=>options.notify?.();
 function snapshot(){return {operation,message,activeRequestId};}
 async function submit(){
  const task=options.task(),revision=task.artifacts.find(item=>item.id===options.artifactId)?.revisions.at(-1),view=options.instructions();
  if(operation||!options.isCurrent()||options.blocked()||!view.canSubmit||!revision||!suggestionDocument(revision))return false;
  const basis=savedDocumentDraftBasis(task,options.artifactId,revision),prompt=view.raw.text.trim(),target={artifactId:options.artifactId,revision:revision.revision,digest:revision.digest};
  if(prompt.length>16000){message='Shorten these instructions to 16,000 characters before requesting suggestions. Your complete input is kept.';notify();return false;}
  const scope=options.scope(),live=()=>options.isCurrent()&&options.scope()===scope&&options.task().id===task.id;
  operation=true;message='Saving the exact instructions before requesting suggestions…';notify();
  let confirmed=false;
  try{
   await options.cache.runSubmission(async()=>{
    const token=options.cache.capture(view.owner,view.slot);if(!token)throw Error('These instructions could not be captured. Your input is kept.');
    await options.cache.flushForm(view.owner,view.slot);
    const current=options.instructions(),latest=options.task().artifacts.find(item=>item.id===options.artifactId)?.revisions.at(-1);
    if(!live()||options.blocked()||current.held||current.basis!==basis||current.entry?.generation!==token.generation||current.raw.text!==view.raw.text||!latest||latest.revision!==target.revision||latest.digest!==target.digest)throw Error('The document, sources or instructions changed. Review the current input before requesting suggestions.');
    activeRequestId=crypto.randomUUID();message='Preparing suggestions. The saved document is unchanged.';notify();
    const result=await options.send({requestId:activeRequestId,basis,sourceRefs:structuredClone(revision.sourceRefs),prompt});
    if(!live())return;
    if(!result||!confirmedSuggestionResult(result,activeRequestId,target,prompt))throw Error('The suggestion result is unconfirmed. Check the saved proposal before requesting another response. Your instructions are kept.');
    // Suggesting does not consume the direct-revision instruction draft.
    confirmed=true;message='Suggestions saved for review. Your revision instructions are kept.';
   });return confirmed;
  }catch(error){if(live())message=error instanceof Error?error.message:'Suggestions could not be confirmed. Your instructions are kept.';return false;}
  finally{activeRequestId=undefined;operation=false;if(!live())message='';notify();}
 }
 return {snapshot,submit};
}

// A rejection changes review metadata only; contextual source staleness alone
// does not forbid closing it. Unknown/raw/recovery document state always does.
export function documentSuggestionBlocked(cache:ReturnType<typeof createLearningDrafts>,view:ReturnType<ReturnType<typeof createSavedDocumentDraftController>['snapshot']>|undefined,task:Task,flags:{dirty:boolean;conflict:boolean;readOnly:boolean;busy:boolean},changesDocument=true){
 const state=cache.getSnapshot();
 if(!view||!state.ready||state.error||state.frozen||state.maintenance||flags.dirty||flags.conflict||flags.readOnly||flags.busy||task.status!=='active'||task.archive||view.raw.present||view.form.status!=='ready'||view.form.error||cache.getEditRejection(view.owner,view.slot)||view.operation||view.pending)return true;
 return view.held&&(changesDocument||!view.changed);
}
