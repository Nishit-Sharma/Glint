import {admitTableWorkflow,isTableWorkflowAction,saveTableWorkflowDocument} from './table-workflow-host';
import {tableWorkflow} from '../learning/table-workflow';
import {semanticHelper} from '../learning/semantic-helper';
import {admitSourceHelperPractice,sourceHelperPracticeDuplicate} from '../shared/helper-source-learning';
import {isTruthPredictionId} from '../learning/truth-table';
import {truthTableGuard} from './truth-table-host';
import {admitPickingAction} from './picking-helper-host';
import {pickingCanonical} from '../shared/picking-digest';
import type { Companion } from './companion';
import { initialModuleState, parseModuleAction, parseModuleAnswer, updateModuleState, type ModuleAction } from './interactive-modules';
import { emptyTaskSession } from './task-session';
import {groundedJoinCommitGuard} from './grounded-join-host';
import {workflowCommitGuard} from './workflow-lab-host';
import {Schema} from 'effect';
import {StoredModuleStateSchema} from './module-registry';

/** Local user edits only. This cannot grant browser, filesystem or model authority. */
export async function editModule(core: Companion, input: { taskId: string; artifactId: string; artifactRevision: number; moduleId: string; action: ModuleAction }) {
  const task = await core.getTask(input.taskId), artifact = task.artifacts.find(artifact => artifact.id === input.artifactId), revision = artifact?.revisions.at(-1);
  if (!artifact || !revision || revision.revision !== input.artifactRevision || revision.mimeType !== 'application/vnd.window-companion.modules+json') throw Error('The answer changed. Reload it before editing this module.');
  const answer = parseModuleAnswer(JSON.parse(revision.content)), module = answer.modules.find(module => module.id === input.moduleId);
  if (!module) throw Error('This module is no longer in the answer.');
  const action = parseModuleAction(input.action, module.data);
  const session = task.session ?? emptyTaskSession();
  const existing = session.moduleStates.find(state => state.artifactId === artifact.id && state.artifactRevision === revision.revision && (state.moduleId === module.id || (state.moduleId === undefined && answer.modules.length === 1)));
  if(isTruthPredictionId(module.id)&&existing?.state.selectedRowId!==undefined)throw Error('This saved prediction cannot be replaced in this version.');
  const isPicking=module.data.kind==='helper-studio'&&existing?.state.format==='semantic-table-v2';
  if((isPicking||action.kind==='begin-table-helper')&&task.status!=='active'&&action.kind!=='picking-inspect')throw Error('Resume the owning task before editing its local manifest.');
  const isLocalDemonstration=action.kind.endsWith('semantic-demonstration')||action.kind==='perform-semantic-demonstration-step';
  const sourcePracticeOwner=module.data.kind==='helper-studio'&&action.kind==='submit-source-helper-practice'?{taskId:task.id,artifactId:artifact.id,artifactRevision:revision.revision,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version,helperId:module.data.id}:null;
  const sourcePracticeState=sourcePracticeOwner?semanticHelper.parseState(sourcePracticeOwner.helperId,existing?.state??initialModuleState(module.data)):null;
  if(sourcePracticeOwner&&sourcePracticeState&&sourceHelperPracticeDuplicate(sourcePracticeOwner,sourcePracticeState,action))return session;
  const sourcePractice=sourcePracticeOwner&&sourcePracticeState?admitSourceHelperPractice(task,sourcePracticeOwner,sourcePracticeState,action):undefined;
  if((isLocalDemonstration||module.data.kind==='document-recipe')&&task.status!=='active')throw Error('Resume the owning task before demonstrating local actions.');
  const flow=module.data.kind==='helper-studio'&&isTableWorkflowAction(action,existing?.state)?admitTableWorkflow(task,{taskId:task.id,artifactId:artifact.id,artifactRevision:revision.revision,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version,helperId:module.data.id},existing?.state??initialModuleState(module.data),action):undefined;
  const updated=flow?flow.state:sourcePracticeOwner?semanticHelper.update(sourcePracticeOwner.helperId,existing?.state??initialModuleState(module.data),action,undefined,sourcePractice):isLocalDemonstration&&module.data.kind==='helper-studio'?semanticHelper.update(module.data.id,existing?.state??initialModuleState(module.data),action,{taskId:task.id,artifactId:artifact.id,artifactRevision:revision.revision,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version,helperId:module.data.id}):isPicking&&module.data.kind==='helper-studio'?admitPickingAction({taskId:task.id,artifactId:artifact.id,artifactRevision:revision.revision,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version,helperId:module.data.id},existing!.state,action):updateModuleState(module.data, existing?.state ?? initialModuleState(module.data), action);
  if(isPicking&&pickingCanonical(updated)===pickingCanonical(existing!.state))return session;
  const state = Schema.decodeUnknownSync(StoredModuleStateSchema,{onExcessProperty:'error'})(updated);
  const states = session.moduleStates.filter(state => state !== existing);
  const output={artifactId:artifact.id,revision:revision.revision,digest:revision.digest};
  const guard=truthTableGuard(task,answer,output)??(module.data.kind==='grounded-join'?groundedJoinCommitGuard(task,module.data,output):module.data.kind==='workflow-lab'?workflowCommitGuard(task,module.data,output):module.data.kind==='document-recipe'?{sourceRefs:[],artifactRefs:[output],requireActive:true}:module.data.kind==='helper-studio'?{sourceRefs:[...revision.sourceRefs,...(flow?flow.sourceRefs:[]),...(sourcePractice?[sourcePractice.submitted.lesson.sourceRef]:[])].filter((ref,index,refs)=>refs.findIndex(other=>pickingCanonical(other)===pickingCanonical(ref))===index),artifactRefs:[output],...((isPicking||action.kind==='begin-table-helper'||isLocalDemonstration||sourcePractice||flow)?{requireActive:true}:{})}:undefined);
  try{return await core.replaceSession(input.taskId, session.revision, { ...session, moduleStates: [...states, { artifactId: artifact.id, artifactRevision: revision.revision, moduleId: module.id, state }] },guard);}catch(cause){
    if(sourcePracticeOwner){
      const latest=await core.getTask(input.taskId),saved=latest.session?.moduleStates.find(item=>item.artifactId===artifact.id&&item.artifactRevision===revision.revision&&(item.moduleId===module.id||(item.moduleId===undefined&&answer.modules.length===1)));
      if(saved&&sourceHelperPracticeDuplicate(sourcePracticeOwner,semanticHelper.parseState(sourcePracticeOwner.helperId,saved.state),action))return latest.session!;
    }
    throw cause;
  }
}

/** Explicit snapshot of the user's current module choices into a normal editable/exportable document. */
export async function saveModuleDocument(core: Companion, input: { taskId: string; artifactId: string; artifactRevision: number; sessionRevision: number }, assertCurrent:()=>void=()=>{}) {
  assertCurrent();const task = await core.getTask(input.taskId), artifact = task.artifacts.find(artifact => artifact.id === input.artifactId), revision = artifact?.revisions.at(-1), session = task.session ?? emptyTaskSession();
  if (!artifact || !revision || revision.revision !== input.artifactRevision || revision.mimeType !== 'application/vnd.window-companion.modules+json' || session.revision !== input.sessionRevision) throw Error('Your answer or choices changed. Review them before saving the document.');
  const answer = parseModuleAnswer(JSON.parse(revision.content)),observedUrls=[...new Set(answer.modules.flatMap(module=>module.provenance.map(source=>source.url)))];
  const flowModules=answer.modules.filter(module=>module.data.kind==='helper-studio'&&session.moduleStates.some(saved=>saved.artifactId===artifact.id&&saved.artifactRevision===revision.revision&&(saved.moduleId===module.id||(saved.moduleId===undefined&&answer.modules.length===1))&&saved.state.format==='table-workflow-v1'));
  if(flowModules.length){if(answer.modules.length!==1||flowModules.length!==1)throw Error('Save this local table workflow from its original single-helper answer.');const module=flowModules[0];if(module.data.kind!=='helper-studio')throw Error('Open the original helper.');const matches=session.moduleStates.filter(saved=>saved.artifactId===artifact.id&&saved.artifactRevision===revision.revision&&(saved.moduleId===module.id||saved.moduleId===undefined));if(matches.length!==1)throw Error('The workflow has conflicting saved states.');return saveTableWorkflowDocument(core,{taskId:input.taskId,artifactId:input.artifactId,artifactRevision:input.artifactRevision,sessionRevision:input.sessionRevision},assertCurrent);}
  return core.saveModuleNotes({taskId:input.taskId,artifactId:input.artifactId,artifactRevision:input.artifactRevision,sessionRevision:input.sessionRevision},assertCurrent);
}
