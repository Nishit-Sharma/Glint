import {createHash} from 'node:crypto';
import type {Command} from '../shared/bridge';
import type {Task} from '../core/types';
import {prepareWindowWorkflowSourceContext} from '../core/window-workflow-host';
import {parseWindowWorkflowProposal} from '../learning/window-workflow-proposal';
import {WINDOW_WORKFLOW_MIME,WINDOW_WORKFLOW_PROMPT,WINDOW_WORKFLOW_PROGRESS,sameWindowSourceRef,windowWorkflowExtractionPrompt} from '../shared/window-workflow-artifact';
import type {BriefActionPlan} from './brief-action-plan';
export function prepareWindowWorkflowPlan(task:Task,command:Extract<Command,{type:'model.run'}>):BriefActionPlan{
 const selection=command.briefAction;
 if(!selection||!('kind' in selection)||selection.kind!=='review-state-transitions'||Object.keys(selection).sort().join(',')!=='artifact,kind'||task.id!==command.taskId||command.artifactId!==undefined||command.kind!=='experiment'||command.prompt!==WINDOW_WORKFLOW_PROMPT)throw Error('Invalid saved window brief action.');
 const context=prepareWindowWorkflowSourceContext(task,selection.artifact),ref=context.source.ref;
 if(command.sourceIds?.length!==1||command.sourceIds[0]!==ref.sourceId||command.expectedSourceRefs?.length!==1||!sameWindowSourceRef(command.expectedSourceRefs[0],ref))throw Error('Window review must use exactly the saved brief source.');
 const hash=createHash('sha256').update(JSON.stringify(context)).digest('hex');
 return {request:{taskId:task.id,requestId:command.requestId,kind:'experiment',prompt:WINDOW_WORKFLOW_PROMPT,sourceIds:[ref.sourceId],expectedSourceRefs:[ref],expectedArtifacts:[context.basis],executionScope:'window-workflow-proposal-v1:'+hash},review:{basisTitle:task.artifacts.find(a=>a.id===context.basis.artifactId)!.revisions.at(-1)!.title,basisRevision:context.basis.revision,purpose:'Prepare bounded image transcription and inferred state transitions for your correction.'},bind(snapshot){
  const current=prepareWindowWorkflowSourceContext(snapshot.task,context.basis);
  if(snapshot.sourceRefs.length!==1||!sameWindowSourceRef(snapshot.sourceRefs[0],ref)||JSON.stringify(current)!==JSON.stringify(context))throw Error('The exact window review context changed.');
  return {kind:'window-workflow-proposal',prompt:windowWorkflowExtractionPrompt(),progress:WINDOW_WORKFLOW_PROGRESS,finish(providerText){
   const result=parseWindowWorkflowProposal(providerText,current);
   return result.kind==='unsupported-source'?{title:'State transitions need more evidence',mimeType:'text/markdown',content:`No finite model was prepared. ${result.reason}`}:{title:'Review state transitions',mimeType:WINDOW_WORKFLOW_MIME,content:JSON.stringify(result)};
  }};
 }};
}
