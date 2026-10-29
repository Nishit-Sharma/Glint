import {prepareWindowWorkflowPlan} from './window-workflow-plan';
import {createHash} from 'node:crypto';
import type {Command} from '../shared/bridge';
import {MODULE_MIME} from '../shared/module-contract';
import type {ArtifactRef,RequestInput,RequestContext,RequestOutput,SourceRef,Task} from '../core/types';
import {readScreenBrief,SQL_JOIN_REVIEW_PROGRESS} from '../core/screen-brief';
import {admitJoinExtraction,joinExtractionPrompt,prepareJoinSourceContext} from '../core/grounded-join-host';
import {parseJoinExtractionOutput} from '../core/join-extraction-output';
import {groundedJoin} from '../learning/grounded-join';
import {exampleLesson} from '../learning/example';

type ModelRunCommand=Extract<Command,{type:'model.run'}>;
type BoundResponse={kind:'ordinary'}|{kind:'join-extraction'|'window-workflow-proposal';prompt:string;progress:string;finish(providerText:string):RequestOutput};
export interface BriefActionPlan {
 request:RequestInput;
 review:{basisTitle:string;basisRevision:number;purpose:string};
 bind(context:Pick<RequestContext,'task'|'sourceRefs'>):BoundResponse;
}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sameRefs=(a:readonly SourceRef[],b:readonly SourceRef[])=>a.length===b.length&&a.every((ref,index)=>ref.sourceId===b[index].sourceId&&ref.version===b[index].version&&ref.digest===b[index].digest);
const fail=(reason:string):never=>{throw Error(`Brief action unavailable: ${reason}`);};
function resolve(task:Task,selection:Extract<NonNullable<ModelRunCommand['briefAction']>,{actionIndex:number}>){
 const basis=selection.artifact,current=task.artifacts.find(a=>a.id===basis.artifactId)?.revisions.at(-1);
 if(!current||current.revision!==basis.revision||current.digest!==basis.digest)return fail('the source artifact changed. Select its current revision.');
 const brief=readScreenBrief(current.content,current.sourceRefs),action=brief?.actions[selection.actionIndex];
 if(!action)return fail('the saved action is missing or invalid.');
 return {current,action};
}

/** Resolves a saved suggestion; the existing host shell retains all execution authority. */
export function prepareBriefActionPlan(task:Task,command:ModelRunCommand):BriefActionPlan|undefined {
 if(command.briefAction===undefined)return undefined;
 const selection=command.briefAction;
 if(selection&&typeof selection==='object'&&'kind' in selection)return prepareWindowWorkflowPlan(task,command);
 if(!selection||typeof selection!=='object'||Array.isArray(selection)||Object.keys(selection).sort().join(',')!=='actionIndex,artifact'||!Number.isSafeInteger(selection.actionIndex)||selection.actionIndex<0||selection.actionIndex>2)return fail('invalid action selection.');
 const basis=selection.artifact;
 if(!basis||typeof basis!=='object'||Array.isArray(basis)||Object.keys(basis).sort().join(',')!=='artifactId,digest,revision'||typeof basis.artifactId!=='string'||!basis.artifactId.trim()||basis.artifactId.length>200||typeof basis.digest!=='string'||!basis.digest.trim()||basis.digest.length>128||!Number.isSafeInteger(basis.revision)||basis.revision<1)return fail('invalid basis reference.');
 if(task.id!==command.taskId||command.artifactId!==undefined)return fail('the action must create separate work in its own task.');
 const {current,action}=resolve(task,selection);
 if(command.kind!==action.requestKind||command.prompt!==action.seedPrompt||!command.expectedSourceRefs||!sameRefs(command.expectedSourceRefs,action.sourceRefs)||!command.sourceIds||command.sourceIds.length!==action.sourceRefs.length||!command.sourceIds.every((id,index)=>id===action.sourceRefs[index].sourceId))return fail('the submitted intent differs from the exact saved action.');
 const selected=new Set(action.sourceRefs.map(r=>r.sourceId));
 const context=action.capability==='sql-join'?prepareJoinSourceContext(task,basis):undefined;
 const orderedRefs=context?.sourceRefs??task.sources.filter(s=>selected.has(s.id)).map(s=>action.sourceRefs.find(r=>r.sourceId===s.id)!);
 if(orderedRefs.length!==action.sourceRefs.length)return fail('a selected source is missing.');
 if(context&&(context.sourceRefs.length!==action.sourceRefs.length||!context.sourceRefs.every(r=>action.sourceRefs.some(a=>sameRefs([r],[a])))))return fail('SQL requires the complete exact one-or-two-source basis.');
 const assignment=context?{id:`source-join-${hash({taskId:task.id,requestId:command.requestId}).slice(0,40)}`,title:'Review the cited tables',version:1,transfer:'example-transfer-v1'}:undefined;
 const actionDigest=hash(action),artifact:ArtifactRef={...basis};
 const request:RequestInput={taskId:task.id,requestId:command.requestId,kind:action.requestKind,prompt:action.seedPrompt,sourceIds:orderedRefs.map(r=>r.sourceId),expectedSourceRefs:structuredClone(orderedRefs),expectedArtifacts:[artifact],executionScope:JSON.stringify({policy:'brief-action-v1',basis:artifact,actionIndex:selection.actionIndex,actionDigest,...(assignment?{assignment}:{})}),...(command.submittedDraft?{submittedDraft:command.submittedDraft}:{})};
 const frozenTaskId=task.id,selectionCopy=structuredClone(selection),expected=structuredClone(orderedRefs);
 return {request,review:{basisTitle:current.title,basisRevision:current.revision,purpose:action.outcome},bind(snapshot){
  if(snapshot.task.id!==frozenTaskId||!sameRefs(snapshot.sourceRefs,expected))return fail('runner source order or identity changed.');
  const boundTask=structuredClone(snapshot.task),saved=resolve(boundTask,selectionCopy);
  if(hash(saved.action)!==actionDigest)return fail('the saved action changed.');
  if(!assignment)return {kind:'ordinary'};
  const bound=prepareJoinSourceContext(boundTask,artifact);
  if(!sameRefs(bound.sourceRefs,expected))return fail('runner source context changed.');
  const prompt=joinExtractionPrompt(bound)+'\n\nIf the supplied sources do not actually show two useful tables with visible row data, return exactly {"schemaVersion":1,"kind":"unsupported-source","reason":"A short plain-prose reason."}. Do not invent missing tables or rows. No additional keys, Markdown, URLs, host identity, corrections, transfer, computed rows or answers. Both tables need at least one visible row.';
  return {kind:'join-extraction',prompt,progress:SQL_JOIN_REVIEW_PROGRESS,finish(providerText){
   const result=parseJoinExtractionOutput(providerText);
   if(result.kind==='unsupported-source')return {title:'Source needs more table evidence',mimeType:'text/markdown',content:`A reviewed join experiment could not be prepared. ${result.reason}`};
   const data=admitJoinExtraction(boundTask,{id:assignment.id,title:assignment.title,version:assignment.version,basis:artifact,proposal:result.proposal,transfer:structuredClone(exampleLesson.transfer)});
   const problem=groundedJoin.observe(data,groundedJoin.initial(data)).problemError;
   if(problem)throw Error(problem);
   return {title:assignment.title,mimeType:MODULE_MIME,content:JSON.stringify({schemaVersion:1,markdown:'Review the cited transcription before using this local equality-join model. Unreadable values require an explicit correction.',modules:[{id:assignment.id,version:assignment.version,data,provenance:[]}]})};
  }};
 }};
}
