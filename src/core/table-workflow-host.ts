import {Schema} from 'effect';
import type {Task,SourceRef} from './types';
import type {LocalDemonstrationOwner} from '../learning/local-demonstration';
import {tableWorkflow,TableWorkflowActionSchema,tableWorkflowReport,type TableWorkflowAction,type TableWorkflowSource,type TableWorkflowState} from '../learning/table-workflow';
import {pickingCanonical,pickingDigest,pickingTextDigest} from '../shared/picking-digest';

/** Admission is called only by the existing atomic module-edit path. Nothing here grants external effects. */
export function admitTableWorkflow(task:Task,owner:LocalDemonstrationOwner,previous:unknown,actionValue:unknown):{state:TableWorkflowState;sourceRefs:SourceRef[]}{
 if(task.id!==owner.taskId||task.status!=='active')throw Error('Open and resume the original owning task.');
 const action=Schema.decodeUnknownSync(TableWorkflowActionSchema,{onExcessProperty:'error'})(actionValue);
 const matches=task.session?.moduleStates.filter(item=>item.artifactId===owner.artifactId&&item.artifactRevision===owner.artifactRevision&&(item.moduleId===owner.moduleId||item.moduleId===undefined))??[];if(matches.length>1)throw Error('The table workflow has conflicting saved states.');
 if(action.kind==='begin-table-workflow'){
  if(!previous||typeof previous!=='object'||'format'in previous||!('revision'in previous)||previous.revision!==0||action.expectedRevision!==0)throw Error('Choose table workflow only from a new unchanged helper.');
  return {state:{...tableWorkflow.initial(owner.helperId,owner),revision:1},sourceRefs:[]};
 }
 if(matches.length!==1)throw Error('The table workflow has missing or conflicting saved states.');
 const state=tableWorkflow.parseState(owner.helperId,previous);if(!state.owner||pickingCanonical(state.owner)!==pickingCanonical(owner))throw Error('The table workflow owner changed. Open the original helper.');
 let source:TableWorkflowSource|undefined;
 if(action.kind==='table-workflow-start'||action.kind==='table-workflow-run'){
  const selected=task.sources.find(item=>item.id===action.sourceRef.sourceId),current=selected?.versions.at(-1);
  if(!selected||selected.freshness!=='fresh'||selected.currentVersion!==action.sourceRef.version||current?.version!==action.sourceRef.version||current.digest!==action.sourceRef.digest||current.kind!=='text')throw Error('The selected CSV source changed or needs review. Choose its current version explicitly.');
  source={ref:action.sourceRef,label:current.label,content:current.content};
 }
 return {state:tableWorkflow.update(owner.helperId,state,action,{owner,...(source?{source}:{})}),sourceRefs:source?[source.ref]:[]};
}
export const isTableWorkflowAction=(action:{kind:string},state:unknown)=>action.kind==='begin-table-workflow'||action.kind.startsWith('table-workflow-')||!!state&&typeof state==='object'&&'format'in state&&state.format==='table-workflow-v1';

/** Explicit publication reuses the existing atomic request/artifact journal. A local run is its stable save identity. */
export async function saveTableWorkflowDocument(core:import('./companion').Companion,task:Task,owner:LocalDemonstrationOwner,state:TableWorkflowState):Promise<{artifactId:string;revision:number}>{
 const run=state.lastRun;if(task.status!=='active'||!run||run.result.status!=='completed')throw Error('Only a complete table workflow run in the active owning task can be published. No partial table was saved.');
 if(!state.owner||pickingCanonical(state.owner)!==pickingCanonical(owner)||state.revision!==run.atRevision||state.activeVersion!==run.version)throw Error('The workflow changed after this run. Run the current active version again before publishing. Earlier saved reports stay in Files.');
 const content=tableWorkflowReport(state),title=(state.versions.find(item=>item.version===run.version)!.definition.name+' — table report').slice(0,200);
 const binding=pickingDigest({format:'local-table-workflow-report-v1',owner,run}),requestId='table-workflow-report-'+binding;
 const input={taskId:task.id,requestId,kind:'create',prompt:'Save the explicitly reviewed complete local table workflow result as an ordinary document.',executionScope:'local-table-workflow-report:v1',sourceIds:[run.source.ref.sourceId],expectedSourceRefs:[run.source.ref],expectedArtifacts:[{artifactId:owner.artifactId,revision:owner.artifactRevision,digest:owner.artifactDigest}],expectedModuleStates:[{artifactId:owner.artifactId,artifactRevision:owner.artifactRevision,moduleId:owner.moduleId,stateRevision:state.revision}]};
 const original=task.requests.find(request=>request.id===requestId);
 // Reconcile only the exact already-completed journal entry before any current-source admission.
 // A lost acknowledgment must not turn a historical saved result into another publication.
 if(original){
  const expectedDigest=pickingTextDigest(JSON.stringify({...input,sourceRefs:[run.source.ref]}));
  if(original.digest!==expectedDigest)throw Error('The original report identity has a different payload. No replacement was created.');
  const artifact=task.artifacts.find(item=>item.id===original.answer?.artifactId),revision=artifact?.revisions.find(item=>item.revision===original.answer?.revision&&item.digest===original.answer?.digest);
  if(original.status!=='completed'||!original.answer||!artifact||!revision||revision.title!==title||revision.content!==content||revision.mimeType!=='text/markdown'||pickingCanonical(revision.sourceRefs)!==pickingCanonical([run.source.ref]))throw Error('The original table report is not confirmed or is no longer available. Check Files for this exact run. A terminal attempt needs a new explicit local run; no replacement was created.');
  return {artifactId:artifact.id,revision:revision.revision};
 }
 const result=await core.runRequest(input,async()=>({title,content,mimeType:'text/markdown'}));
 if(result.status!=='completed'||!result.answer)throw Error('The table report was not confirmed. Check Files for this exact run before another action. A terminal attempt needs a new explicit local run; no automatic retry or partial report was produced.');
 const saved=await core.getTask(task.id),artifact=saved.artifacts.find(item=>item.id===result.answer!.artifactId),revision=artifact?.revisions.find(item=>item.revision===result.answer!.revision&&item.digest===result.answer!.digest);
 if(!revision||revision.title!==title||revision.content!==content||revision.mimeType!=='text/markdown'||pickingCanonical(revision.sourceRefs)!==pickingCanonical([run.source.ref]))throw Error('The original table report needs review in Files. No replacement was created.');
 return {artifactId:artifact!.id,revision:revision.revision};
}
