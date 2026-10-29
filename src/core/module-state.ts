import {truthTableGuard} from './truth-table-host';
import {admitPickingAction} from './picking-helper-host';
import {pickingCanonical} from '../shared/picking-digest';
import type { Companion,ArtifactRef,ModuleStateRef } from './companion';
import { initialModuleState, moduleText, parseModuleAction, parseModuleAnswer, readableModuleIntro, updateModuleState, type ModuleAction } from './interactive-modules';
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
  const isPicking=module.data.kind==='helper-studio'&&existing?.state.format==='semantic-table-v2';
  if((isPicking||action.kind==='begin-table-helper')&&task.status!=='active'&&action.kind!=='picking-inspect')throw Error('Resume the owning task before editing its local manifest.');
  const updated=isPicking&&module.data.kind==='helper-studio'?admitPickingAction({taskId:task.id,artifactId:artifact.id,artifactRevision:revision.revision,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version,helperId:module.data.id},existing!.state,action):updateModuleState(module.data, existing?.state ?? initialModuleState(module.data), action);
  if(isPicking&&pickingCanonical(updated)===pickingCanonical(existing!.state))return session;
  const state = Schema.decodeUnknownSync(StoredModuleStateSchema,{onExcessProperty:'error'})(updated);
  const states = session.moduleStates.filter(state => state !== existing);
  const output={artifactId:artifact.id,revision:revision.revision,digest:revision.digest};
  const guard=truthTableGuard(task,answer,output)??(module.data.kind==='grounded-join'?groundedJoinCommitGuard(task,module.data,output):module.data.kind==='workflow-lab'?workflowCommitGuard(task,module.data,output):module.data.kind==='helper-studio'?{sourceRefs:[...revision.sourceRefs],artifactRefs:[output],...((isPicking||action.kind==='begin-table-helper')?{requireActive:true}:{})}:undefined);
  return core.replaceSession(input.taskId, session.revision, { ...session, moduleStates: [...states, { artifactId: artifact.id, artifactRevision: revision.revision, moduleId: module.id, state }] },guard);
}

/** Explicit snapshot of the user's current module choices into a normal editable/exportable document. */
export async function saveModuleDocument(core: Companion, input: { taskId: string; artifactId: string; artifactRevision: number; sessionRevision: number }) {
  const task = await core.getTask(input.taskId), artifact = task.artifacts.find(artifact => artifact.id === input.artifactId), revision = artifact?.revisions.at(-1), session = task.session ?? emptyTaskSession();
  if (!artifact || !revision || revision.revision !== input.artifactRevision || revision.mimeType !== 'application/vnd.window-companion.modules+json' || session.revision !== input.sessionRevision) throw Error('Your answer or choices changed. Review them before saving the document.');
  const answer = parseModuleAnswer(JSON.parse(revision.content)),observedUrls=[...new Set(answer.modules.flatMap(module=>module.provenance.map(source=>source.url)))];
  const expectedArtifacts:ArtifactRef[]=[],expectedModuleStates:ModuleStateRef[]=[];
  const stateFor=(moduleId:string)=>session.moduleStates.find(saved=>saved.artifactId===artifact.id&&saved.artifactRevision===revision.revision&&(saved.moduleId===moduleId||(saved.moduleId===undefined&&answer.modules.length===1)))?.state;
  const content = [readableModuleIntro(answer,stateFor), ...answer.modules.map(module => {
    const saved = session.moduleStates.find(saved => saved.artifactId === artifact.id && saved.artifactRevision === revision.revision && (saved.moduleId === module.id || (saved.moduleId === undefined && answer.modules.length === 1)));
    if(module.data.kind==='grounded-join'||module.data.kind==='workflow-lab'||module.data.kind==='helper-studio'||module.id.startsWith('truth-table-v1-')){
      const output={artifactId:artifact.id,revision:revision.revision,digest:revision.digest};
      const guard=truthTableGuard(task,answer,output)??(module.data.kind==='grounded-join'?groundedJoinCommitGuard(task,module.data,output):module.data.kind==='workflow-lab'?workflowCommitGuard(task,module.data,output):{sourceRefs:[...revision.sourceRefs],artifactRefs:[output]});
      for(const ref of guard.artifactRefs)if(!expectedArtifacts.some(other=>other.artifactId===ref.artifactId))expectedArtifacts.push(ref);
      expectedModuleStates.push({artifactId:artifact.id,artifactRevision:revision.revision,moduleId:module.id,stateRevision:saved?.state.revision??0});
    }
    return moduleText(module.data, saved?.state);
  }), ...(observedUrls.length ? ['Observed pages\n' + observedUrls.map(url => `- ${url}`).join('\n')] : [])].join('\n\n');
  const title = (revision.title.slice(0, 190) + ' notes').slice(0, 200), existing = task.artifacts.find(item => { const latest = item.revisions.at(-1); return latest?.title === title && latest.content === content && latest.mimeType === 'text/markdown' && latest.sourceRefs.length === revision.sourceRefs.length && latest.sourceRefs.every((ref, index) => { const expected = revision.sourceRefs[index]; return ref.sourceId === expected.sourceId && ref.version === expected.version && ref.digest === expected.digest; }); });
  if (existing) return { artifactId: existing.id, revision: existing.revisions.at(-1)!.revision };
  return core.saveArtifact(input.taskId, { title, content, mimeType: 'text/markdown', sourceRefs: revision.sourceRefs,...(expectedArtifacts.length?{expectedArtifacts,expectedModuleStates}:{}) });
}
