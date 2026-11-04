import {SourceSelectionSchema} from '../shared/source-selection';
import {TaskResponseModeSchema} from '../shared/task-response-mode';
import {TaskMemoryPolicySchema} from '../shared/task-memory-policy';
import {OutputArchiveReceiptSchema,OutputArchivePendingSchema} from '../shared/task-output-archive';
import {RequestInferenceSavedSchema} from '../shared/request-inference';
import {SpeechSelectionSchema} from '../shared/document-speech';
import {ReadingPreferencesSchema} from '../shared/reading-view';
import {InstructionSkillSelectionSchema} from '../shared/instruction-skill';
import {QueuedFollowupSchema} from '../shared/queued-followup';
import { Schema } from 'effect';
import {BrowserContinuationAttemptSchema} from '../shared/browser-continuation';
import { StoredModuleStateSchema } from './module-registry';
import {composerKinds} from './composer-draft';
export {readComposerDraft,type ComposerDraft,type ComposerKind} from './composer-draft';

const text = Schema.String.pipe(Schema.maxLength(100_000));
const id = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200));
export const ComposerKindSchema=Schema.Literal(...composerKinds);
/** Historical website selection only; paths, query strings and fragments are excluded. */
export const BrowserStartReceiptSchema=Schema.Struct({origin:Schema.String.pipe(Schema.maxLength(2_000)),recordedAt:id}).pipe(Schema.filter(value=>{
 try{const url=new URL(value.origin);return url.origin===value.origin&&!url.username&&!url.password&&(url.protocol==='https:'||url.protocol==='http:'&&url.hostname==='127.0.0.1');}catch{return false;}
}));
export type BrowserStartReceipt=typeof BrowserStartReceiptSchema.Type;
export const BrowserObservationSchema = Schema.Struct({
  id, taskId: id, browserId: id, documentId: id, url: text, title: text, text, digest: id,
  targets: Schema.Array(Schema.Struct({ id, role: text, label: text, href: Schema.optional(text), value: Schema.optional(text), options: Schema.optional(Schema.Array(Schema.Struct({ value: Schema.String.pipe(Schema.maxLength(10_000)), label: Schema.String.pipe(Schema.maxLength(500)), disabled: Schema.Boolean })).pipe(Schema.maxItems(100))) })).pipe(Schema.maxItems(100)),
});
export type BrowserObservation = typeof BrowserObservationSchema.Type;
export const BrowserIntentSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('click'), snapshotId: id, targetId: id }),
  Schema.Struct({ kind: Schema.Literal('fill'), snapshotId: id, targetId: id, value: text }),
  Schema.Struct({ kind: Schema.Literal('select'), snapshotId: id, targetId: id, value: Schema.String.pipe(Schema.maxLength(10_000)) }),
);
export const BrowserOperationSchema = Schema.Struct({
  id, intent: BrowserIntentSchema,
  status: Schema.Literal('proposed', 'executing', 'observed', 'uncertain', 'failed', 'retired'),
  reason: text,
  result: Schema.optional(BrowserObservationSchema),
  receipt: Schema.optional(Schema.Struct({ status: Schema.Int, url: text, body: text })),
  reconciliation: Schema.optional(Schema.Struct({ id, outcome: Schema.Literal('completed', 'not-completed', 'uncertain'), basis: Schema.Literal('user-reviewed-observation'), note: text, observation: BrowserObservationSchema })),
  error: Schema.optional(text),
});
export const TaskSessionSchema = Schema.Struct({
  sourceSelection:Schema.optional(SourceSelectionSchema),
  responseMode:Schema.optional(TaskResponseModeSchema),
  outputArchives:Schema.optional(Schema.Array(OutputArchiveReceiptSchema).pipe(Schema.maxItems(20))),
  outputArchivePending:Schema.optional(OutputArchivePendingSchema),
  memoryPolicy:Schema.optional(TaskMemoryPolicySchema),
  instructionSkill:Schema.optional(InstructionSkillSelectionSchema),
  readingPreferences:Schema.optional(ReadingPreferencesSchema),
  requestInference:Schema.optional(RequestInferenceSavedSchema),
  speech:Schema.optional(SpeechSelectionSchema),
  /** Local pending input only; never restores browser execution authority. */
  browserContinuationAttempt:Schema.optional(BrowserContinuationAttemptSchema),
  queuedFollowups:Schema.optional(Schema.Array(QueuedFollowupSchema).pipe(Schema.maxItems(100))),
  revision: Schema.Int.pipe(Schema.nonNegative()), draft: text,
  draftKind:Schema.optional(ComposerKindSchema),
  draftRevision:Schema.optional(Schema.Int.pipe(Schema.nonNegative())),
  contextRevision: Schema.optional(Schema.Int.pipe(Schema.nonNegative())),
  browserContext: Schema.optional(Schema.Struct({ origin: text, url: text, requestId: id })),
  runs: Schema.Array(Schema.Struct({
    id, endpointKey: id, origin: text, browserId: id,
    workflow:Schema.optional(Schema.Struct({artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest:id})),
    initialObservation: BrowserObservationSchema,
    operations: Schema.Array(BrowserOperationSchema).pipe(Schema.maxItems(64)),
  })).pipe(Schema.maxItems(100)),
  moduleStates: Schema.Array(Schema.Struct({ artifactId: id, artifactRevision: Schema.Int, moduleId: Schema.optional(id), state: StoredModuleStateSchema })).pipe(Schema.maxItems(200)),
});
export type TaskSession = typeof TaskSessionSchema.Type;
export const emptyTaskSession = (): TaskSession => ({ revision: 0, draft: '', runs: [], moduleStates: [] });

/** Retain descriptions/results, never restore browser execution authority after host restart. */
export function recoverTaskSession(session: TaskSession): TaskSession {
  return { ...session,...(session.queuedFollowups?{queuedFollowups:session.queuedFollowups.map(item=>item.status==='queued'?{...item,status:'held' as const,reason:'Glint restarted. Review this exact follow-up and its current context before queueing it again.'}:item)}:{}), revision: session.revision + 1, runs: session.runs.map(run => ({ ...run,
    operations: run.operations.map(operation => operation.status === 'executing'
      ? { ...operation, status: 'uncertain', error: 'The host stopped during this action. Inspect the website before another attempt.' }
      : operation.status === 'proposed' ? { ...operation, status: 'retired', error: 'Restart retired this unexecuted proposal. Observe and approve a fresh target.' } : operation),
  })) };
}

