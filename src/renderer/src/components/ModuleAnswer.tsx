import {TruthChangeTrace} from './TruthChangeTrace';
import {truthChangeTrace} from '../../../learning/truth-change-trace';
import {TruthPrediction} from './TruthPrediction';
import {comparisonModule} from '../../../core/interactive-modules';
import {readTruthBinding,truthStatus,parseBinaryAssignment,makeTruthComparison,makeTruthPrediction,TRUTH_MODULE_PREFIX,isTruthPredictionId,isTruthModuleId} from '../../../learning/truth-table';
import { Fragment, useState } from 'react';
import { Schema } from 'effect';
import type { Artifact, ArtifactRevision, Task } from '../../../core/types';
import { initialModuleState, moduleRegistry, parseModuleAnswer, readableModuleIntro, type ModuleAction } from '../../../core/interactive-modules';
import { publicErrorMessage } from '../../../shared/public-messages';
import { ReadableText } from './ReadableText';
import { ModuleView } from './InteractiveModule';
export {MODULE_MIME} from '../../../shared/module-contract';

export function ModuleAnswerView({ task, artifact, revision, onEdit, onSave, onOpenWorkflowSource }: { task: Task; artifact: Artifact; revision: ArtifactRevision; onEdit: (moduleId: string, action: ModuleAction) => Promise<void>; onSave?: () => Promise<void>; onOpenWorkflowSource?: (moduleId:string)=>void }) {
  const [pending, setPending] = useState<string>(), [error, setError] = useState('');
  let answer;
  try { answer = parseModuleAnswer(JSON.parse(revision.content)); }
  catch {
    let markdown = '';
    try { markdown = Schema.decodeUnknownSync(Schema.Struct({ markdown: Schema.String.pipe(Schema.maxLength(50_000)) }))(JSON.parse(revision.content)).markdown; } catch { /* no raw JSON fallback */ }
    return <div><p className="warning">This interactive view is unavailable. Your saved answer is kept.</p>{markdown && <ReadableText text={markdown}/>}</div>;
  }
  async function perform(key: string, action: () => Promise<void>) { if (pending) return false; setPending(key); setError(''); try { await action(); return true; } catch (error) { setError(publicErrorMessage(error)); return false; } finally { setPending(undefined); } }
  const truthModule=answer.modules.find(module=>isTruthModuleId(module.id));
  let truthUnavailable=false,truthCorrupt=false;if(truthModule)try{const binding=readTruthBinding(answer.markdown,truthModule.id),rule=binding&&parseBinaryAssignment(binding.quote);truthCorrupt=!binding||!rule||answer.modules.length!==1||truthModule.version!==1||JSON.stringify(truthModule.data)!==JSON.stringify(isTruthPredictionId(truthModule.id)?makeTruthPrediction(rule):makeTruthComparison(rule))||JSON.stringify(revision.sourceRefs)!==JSON.stringify(binding.sourceRefs)||!task.requests.some(request=>request.id.startsWith(isTruthPredictionId(truthModule.id)?'truth-pred-v1-':'truth-v1-')&&request.kind==='experiment'&&request.status==='completed'&&request.artifactId===artifact.id);truthUnavailable=truthCorrupt||truthStatus(binding??undefined,task).kind!=='current';}catch{truthUnavailable=true;truthCorrupt=true;}
  const identity = [task.id, artifact.id, revision.revision, revision.digest].join(':');
  const request=task.requests.find(request=>request.kind==='browser'&&request.artifactId===artifact.id),run=task.session?.runs.find(run=>run.id===request?.id);
  const observedUrls=[...new Set([...answer.modules.flatMap(module=>module.provenance.map(source=>source.url)),...(run?[run.initialObservation,...run.operations.flatMap(operation=>operation.result?[operation.result]:[])].map(observation=>observation.url):[])])];
  const stateFor=(moduleId:string)=>task.session?.moduleStates.find(saved=>saved.artifactId===artifact.id&&saved.artifactRevision===revision.revision&&(saved.moduleId===moduleId||(saved.moduleId===undefined&&answer.modules.length===1)))?.state;
  return <div className="module-answer">{truthUnavailable&&<p role="alert">The truth table source changed or its binding needs review. Saved choices remain available for inspection.</p>}<ReadableText text={readableModuleIntro(answer,stateFor)}/>{answer.modules.map(module => {
    const saved = task.session?.moduleStates.find(saved => saved.artifactId === artifact.id && saved.artifactRevision === revision.revision && (saved.moduleId === module.id || (saved.moduleId === undefined && answer.modules.length === 1)));
    let state = initialModuleState(module.data);
    try { if (saved) state = moduleRegistry[module.data.kind].parseState(saved.state); } catch { return <p className="warning" key={module.id}>This saved choice needs review before editing.</p>; }
    if(truthCorrupt&&isTruthModuleId(module.id))return <p className="warning" key={module.id}>This saved truth table needs review. Its stored data is kept.</p>;
    if(isTruthPredictionId(module.id)){try{const binding=readTruthBinding(answer.markdown,module.id),rule=binding&&parseBinaryAssignment(binding.quote);if(!rule||module.data.kind!=='comparison'||state.kind!=='comparison')throw Error('Invalid prediction');return <TruthPrediction key={module.id} data={comparisonModule.parse(module.data)} state={comparisonModule.parseState(state)} rule={rule} pending={!!pending||truthUnavailable} onAction={action=>perform(module.id,()=>onEdit(module.id,action))}/>;}catch{return <p className="warning" key={module.id}>This saved prediction needs review. Its stored data is kept.</p>;}}
    let trace:ReturnType<typeof truthChangeTrace>|undefined;if(module.id.startsWith(TRUTH_MODULE_PREFIX)){try{const binding=readTruthBinding(answer.markdown,module.id);if(!binding||state.kind!=='comparison')throw Error('Invalid truth comparison');trace=truthChangeTrace(binding.quote,state.selectedRowId);}catch{return <p className="warning" key={module.id}>This saved input pair needs review. Its stored data is kept.</p>;}}
    return <Fragment key={module.id}><ModuleView onOpenSourceDocument={onOpenWorkflowSource?()=>onOpenWorkflowSource(module.id):undefined} task={task} data={module.data} state={state} pending={!!pending||truthUnavailable} motion={{identity:[identity,module.id,module.version].join(':'),arrivalIdentity:identity}} draftOwner={{taskId:task.id,artifactId:artifact.id,artifactRevision:revision.revision,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version}} onAction={action => perform(module.id, () => onEdit(module.id, action))}/>{trace!==undefined&&<TruthChangeTrace trace={trace} stale={truthUnavailable}/>}</Fragment>;
  })}<div className="module-answer-actions">{onSave && <button type="button" className="conversation-open" disabled={!!pending||truthUnavailable} onClick={() => void perform('save', onSave)}>Save as document</button>}{!!observedUrls.length&&<details className="module-answer-sources"><summary>Observed pages</summary><ul>{observedUrls.map(url => <li key={url}>{url}</li>)}</ul></details>}</div><div role="status" className="tiny">{pending ? 'Saving…' : ''}</div>{error && <p className="warning" role="alert">{error}</p>}</div>;
}
export default ModuleAnswerView;
