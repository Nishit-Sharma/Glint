import { useState } from 'react';
import { Schema } from 'effect';
import type { Artifact, ArtifactRevision, Task } from '../../../core/types';
import { initialModuleState, moduleRegistry, parseModuleAnswer, type ModuleAction } from '../../../core/interactive-modules';
import { publicErrorMessage } from '../../../shared/public-messages';
import { ReadableText } from './ReadableText';
import { ModuleView } from './InteractiveModule';
export {MODULE_MIME} from '../../../shared/module-contract';

export function ModuleAnswerView({ task, artifact, revision, onEdit, onSave }: { task: Task; artifact: Artifact; revision: ArtifactRevision; onEdit: (moduleId: string, action: ModuleAction) => Promise<void>; onSave?: () => Promise<void> }) {
  const [pending, setPending] = useState<string>(), [error, setError] = useState('');
  let answer;
  try { answer = parseModuleAnswer(JSON.parse(revision.content)); }
  catch {
    let markdown = '';
    try { markdown = Schema.decodeUnknownSync(Schema.Struct({ markdown: Schema.String.pipe(Schema.maxLength(50_000)) }))(JSON.parse(revision.content)).markdown; } catch { /* no raw JSON fallback */ }
    return <div><p className="warning">This interactive view is unavailable. Your saved answer is kept.</p>{markdown && <ReadableText text={markdown}/>}</div>;
  }
  async function perform(key: string, action: () => Promise<void>) { if (pending) return; setPending(key); setError(''); try { await action(); } catch (error) { setError(publicErrorMessage(error)); } finally { setPending(undefined); } }
  const identity = [task.id, artifact.id, revision.revision, revision.digest].join(':');
  const request=task.requests.find(request=>request.kind==='browser'&&request.artifactId===artifact.id),run=task.session?.runs.find(run=>run.id===request?.id);
  const observedUrls=[...new Set([...answer.modules.flatMap(module=>module.provenance.map(source=>source.url)),...(run?[run.initialObservation,...run.operations.flatMap(operation=>operation.result?[operation.result]:[])].map(observation=>observation.url):[])])];
  return <div className="module-answer"><ReadableText text={answer.markdown}/>{answer.modules.map(module => {
    const saved = task.session?.moduleStates.find(saved => saved.artifactId === artifact.id && saved.artifactRevision === revision.revision && (saved.moduleId === module.id || (saved.moduleId === undefined && answer.modules.length === 1)));
    let state = initialModuleState(module.data);
    try { if (saved) state = moduleRegistry[module.data.kind].parseState(saved.state); } catch { return <p className="warning" key={module.id}>This saved choice needs review before editing.</p>; }
    return <ModuleView key={module.id} data={module.data} state={state} pending={!!pending} motion={{identity:[identity,module.id,module.version].join(':'),arrivalIdentity:identity}} onAction={action => void perform(module.id, () => onEdit(module.id, action))}/>;
  })}<div className="module-answer-actions">{onSave && <button type="button" className="conversation-open" disabled={!!pending} onClick={() => void perform('save', onSave)}>Save as document</button>}{!!observedUrls.length&&<details className="module-answer-sources"><summary>Observed pages</summary><ul>{observedUrls.map(url => <li key={url}>{url}</li>)}</ul></details>}</div><div role="status" className="tiny">{pending ? 'Saving…' : ''}</div>{error && <p className="warning" role="alert">{error}</p>}</div>;
}
export default ModuleAnswerView;
