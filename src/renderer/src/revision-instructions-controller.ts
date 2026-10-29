import type {ArtifactRevision,Task} from '../../core/types';
import {REVISION_INSTRUCTIONS_SLOT,emptyRevisionInstructions,parseRevisionInstructions,assertRevisionInstructionRequest,confirmedRevisionInstructionResult,type RevisionInstructionSubmission,type RevisionInstructions} from '../../shared/revision-instructions';
import {savedDocumentDraftOwner,savedDocumentDraftBasis,parseSavedDocumentDraftBasis,ordinaryTextDocument} from '../../shared/saved-document-draft';
import {learningDraftKey,parseLearningDraftJson} from '../../shared/learning-drafts';
import type {createLearningDrafts} from './learning-drafts';
type Options={cache:ReturnType<typeof createLearningDrafts>;artifactId:string;task:()=>Task;base:()=>ArtifactRevision;scope:()=>string;isCurrent:()=>boolean;send:(prompt:string,submission:RevisionInstructionSubmission)=>Promise<Task|undefined>;notify?:()=>void};
export function createRevisionInstructionsController(options:Options){
 const {cache,artifactId}=options,owner=savedDocumentDraftOwner(options.task().id,artifactId),slot=REVISION_INSTRUCTIONS_SLOT,key=learningDraftKey(owner,slot);
 let operation=false,message='',discarding:RevisionInstructions|undefined,pendingClear=false,activeRequestId:string|undefined;
 const notify=()=>options.notify?.();
 function snapshot(){
  const task=options.task(),base=options.base(),basis=savedDocumentDraftBasis(task,artifactId,base),form=cache.readForm(owner,slot,emptyRevisionInstructions,basis),state=cache.getSnapshot(),entry=state.entries[key];
  const prior=form.recovery?.local??form.recovery?.remote?.value??(entry?.local===null&&entry.error?entry.remote?.value:undefined),raw=discarding??parseRevisionInstructions(prior?parseLearningDraftJson(prior.value):form.value);
  let changed=false;try{assertRevisionInstructionRequest(task,artifactId,basis,base.sourceRefs.map(ref=>ref.sourceId),base.sourceRefs);}catch{changed=true;}
  const held=!options.isCurrent()||task.id!==owner.taskId||state.frozen||state.maintenance||form.status!=='ready'||!!form.error||!!cache.getEditRejection(owner,slot)||!ordinaryTextDocument(base)||changed||!!discarding||pendingClear;
  return {owner,slot,key,basis,form,raw,entry,changed,held,operation,message,pendingClear,activeRequestId,frozen:state.frozen,canSubmit:!held&&!operation&&!!raw.text.trim()};
 }
 function edit(text:string){const view=snapshot();if(view.held)return {kind:'held' as const,reason:'recovery' as const};message='';return cache.tryEdit(owner,slot,emptyRevisionInstructions,view.basis,()=>({present:true,text}));}
 async function submit(text?:string){
  const view=snapshot(),prompt=view.raw.text.trim();if(!view.canSubmit||text!==undefined&&text!==prompt)return false;
  if(prompt.length>16_000){message='These instructions are too long to send. Shorten them; the full text is kept.';notify();return false;}
  const scope=options.scope(),basis=parseSavedDocumentDraftBasis(view.basis),live=()=>options.isCurrent()&&options.scope()===scope&&options.task().id===owner.taskId;
  operation=true;message='Saving these instructions before sending…';notify();
  try{
   let confirmed=false;
   await cache.runSubmission(async()=>{
    const token=cache.capture(owner,slot);if(!token)throw Error('Revision instructions could not be captured.');
    await cache.flushForm(owner,slot);const current=snapshot();
    if(!live()||current.basis!==view.basis||current.form.status!=='ready'||current.form.error||current.changed||current.entry?.generation!==token.generation)throw Error('The document, instructions or linked sources changed before sending. Your input is kept.');
    const submission:RevisionInstructionSubmission={requestId:crypto.randomUUID(),basis:view.basis,sourceRefs:structuredClone(options.base().sourceRefs)};
    activeRequestId=submission.requestId;
    const result=await options.send(prompt,submission),answer=result?confirmedRevisionInstructionResult(result,submission,prompt):undefined;
    if(!result||!answer)throw Error('The revision result was not confirmed. Your instructions are kept; check task Activity before trying again.');
    if(!live())return;
    const currentTask=options.task(),original=currentTask.artifacts.find(item=>item.id===artifactId)?.revisions.find(revision=>revision.revision===basis.revision&&revision.digest===basis.digest);
    const latest=currentTask.artifacts.find(item=>item.id===artifactId)?.revisions.at(-1);
    if(!original||savedDocumentDraftBasis(currentTask,artifactId,original)!==view.basis||!latest||!((latest.revision===basis.revision&&latest.digest===basis.digest)||(latest.revision===answer.revision&&latest.digest===answer.digest)))throw Error('The document or linked sources advanced. Your instructions are kept for review.');
    if(cache.acknowledge(token)){pendingClear=true;await cache.flushForm(owner,slot);pendingClear=false;if(live())message='Revision completed. Its submitted instructions were cleared.';}
    else message='Revision completed. Newer instructions are kept for review.';
    confirmed=true;
   });return confirmed;
  }catch(error){if(live()){message=error instanceof Error?error.message:'Revision instructions could not be saved. Your input is kept.';notify();}return false;}
  finally{activeRequestId=undefined;if(!live())message='';operation=false;notify();}
 }
 async function check(){
  if(operation||cache.getSnapshot().frozen||cache.getSnapshot().maintenance||!options.isCurrent())return false;const scope=options.scope(),live=()=>options.isCurrent()&&options.scope()===scope;operation=true;notify();
  try{await cache.retry(owner,slot);const entry=cache.getSnapshot().entries[key];if(!entry||entry.status==='clean'){pendingClear=false;discarding=undefined;}if(live())message='Instruction storage was checked. Review the shown input before sending.';return true;}
  catch{if(live())message='Instruction storage is still unconfirmed. Your input is kept.';return false;}finally{operation=false;notify();}
 }
 async function discard(expectedGeneration?:number){
  const view=snapshot();if(operation||view.frozen||cache.getSnapshot().maintenance||!options.isCurrent()||!view.entry?.canDiscard||expectedGeneration!==undefined&&expectedGeneration!==view.entry.generation)return false;
  const scope=options.scope(),live=()=>options.isCurrent()&&options.scope()===scope;
  operation=true;discarding=view.raw;notify();
  try{await cache.runSubmission(async()=>{if(!cache.discard(owner,slot,view.entry!.generation)){discarding=undefined;throw Error('Newer instructions are kept.');}await cache.flushForm(owner,slot);discarding=undefined;pendingClear=false;if(live())message='Earlier revision instructions discarded.';});return true;}
  catch{if(live())message='Discarding these instructions was not confirmed. Check storage before continuing.';return false;}finally{operation=false;notify();}
 }
 return {snapshot,edit,submit,check,discard};
}
