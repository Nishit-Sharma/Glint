import type { Companion } from './companion';
import { initialModuleState, moduleText, parseModuleAction, parseModuleAnswer, updateModuleState, type ModuleAction } from './interactive-modules';
import { emptyTaskSession } from './task-session';

/** Local user edits only. This cannot grant browser, filesystem or model authority. */
export async function editModule(core: Companion, input: { taskId: string; artifactId: string; artifactRevision: number; moduleId: string; action: ModuleAction }) {
  const task = await core.getTask(input.taskId), artifact = task.artifacts.find(artifact => artifact.id === input.artifactId), revision = artifact?.revisions.at(-1);
  if (!artifact || !revision || revision.revision !== input.artifactRevision || revision.mimeType !== 'application/vnd.window-companion.modules+json') throw Error('The answer changed. Reload it before editing this module.');
  const answer = parseModuleAnswer(JSON.parse(revision.content)), module = answer.modules.find(module => module.id === input.moduleId);
  if (!module) throw Error('This module is no longer in the answer.');
  const action = parseModuleAction(input.action, module.data);
  const session = task.session ?? emptyTaskSession();
  const existing = session.moduleStates.find(state => state.artifactId === artifact.id && state.artifactRevision === revision.revision && (state.moduleId === module.id || (state.moduleId === undefined && answer.modules.length === 1)));
  const state = updateModuleState(module.data, existing?.state ?? initialModuleState(module.data), action);
  const states = session.moduleStates.filter(state => state !== existing);
  return core.replaceSession(input.taskId, session.revision, { ...session, moduleStates: [...states, { artifactId: artifact.id, artifactRevision: revision.revision, moduleId: module.id, state }] });
}

/** Explicit snapshot of the user's current module choices into a normal editable/exportable document. */
export async function saveModuleDocument(core: Companion, input: { taskId: string; artifactId: string; artifactRevision: number; sessionRevision: number }) {
  const task = await core.getTask(input.taskId), artifact = task.artifacts.find(artifact => artifact.id === input.artifactId), revision = artifact?.revisions.at(-1), session = task.session ?? emptyTaskSession();
  if (!artifact || !revision || revision.revision !== input.artifactRevision || revision.mimeType !== 'application/vnd.window-companion.modules+json' || session.revision !== input.sessionRevision) throw Error('Your answer or choices changed. Review them before saving the document.');
  const answer = parseModuleAnswer(JSON.parse(revision.content));
  const content = [answer.markdown, ...answer.modules.map(module => {
    const saved = session.moduleStates.find(saved => saved.artifactId === artifact.id && saved.artifactRevision === revision.revision && (saved.moduleId === module.id || (saved.moduleId === undefined && answer.modules.length === 1)));
    return moduleText(module.data, saved?.state);
  }), ...(answer.modules.length ? ['Observed pages\n' + [...new Set(answer.modules.flatMap(module => module.provenance.map(source => source.url)))].map(url => `- ${url}`).join('\n')] : [])].join('\n\n');
  const title = (revision.title.slice(0, 190) + ' notes').slice(0, 200), existing = task.artifacts.find(item => { const latest = item.revisions.at(-1); return latest?.title === title && latest.content === content && latest.mimeType === 'text/markdown'; });
  if (existing) return { artifactId: existing.id, revision: existing.revisions.at(-1)!.revision };
  return core.saveArtifact(input.taskId, { title, content, mimeType: 'text/markdown', sourceRefs: revision.sourceRefs });
}
