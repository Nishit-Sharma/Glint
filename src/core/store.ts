import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import {DocumentStampSchema,DocumentChangeSchema} from '../shared/document-source';
import type { Task } from './types';
import { TaskSessionSchema,BrowserStartReceiptSchema } from './task-session';

const list = <A, I, R>(schema: Schema.Schema<A, I, R>) => Schema.mutable(Schema.Array(schema));
const optionalText = Schema.optional(Schema.String);
const sourceFields = {
  id: Schema.String, kind: Schema.Literal('text', 'image', 'window'), label: Schema.String,
  content: Schema.String, role: Schema.Literal('fact', 'style', 'inspiration'),
  windowId: optionalText, documentToken: optionalText, windowProcessId: Schema.optional(Schema.Int.pipe(Schema.positive())), documentStamp:Schema.optional(DocumentStampSchema), title: optionalText, boundsToken: optionalText,
};
const Ref = Schema.Struct({ sourceId: Schema.String, version: Schema.Int, digest: Schema.String });
const SourceVersion = Schema.Struct({ ...sourceFields, version: Schema.Int, digest: Schema.String, capturedAt: Schema.String });
const Source = Schema.Struct({ id: Schema.String, currentVersion: Schema.Int, versions: list(SourceVersion), freshness: Schema.Literal('fresh', 'refresh-required'), staleReason: optionalText, documentChange:Schema.optional(DocumentChangeSchema) });
const ArtifactRevision = Schema.Struct({ revision: Schema.Int, title: Schema.String, content: Schema.String, mimeType: Schema.String, encoding: Schema.optional(Schema.Literal('utf8', 'base64')), sourceRefs: list(Ref), digest: Schema.String, createdAt: Schema.String });
const Artifact = Schema.Struct({ id: Schema.String, revisions: list(ArtifactRevision) });
const Request = Schema.Struct({ id: Schema.String, kind: Schema.String, prompt: Schema.String, digest: Schema.String, status: Schema.Literal('running', 'completed', 'cancelled', 'interrupted', 'failed'), sourceRefs: list(Ref), startedAt: Schema.String, finishedAt: optionalText, artifactId: optionalText, answer: Schema.optional(Schema.Struct({ artifactId: Schema.String, revision: Schema.Int, digest: Schema.String })), targetArtifactId: optionalText, expectedRevision: Schema.optional(Schema.Int), error: optionalText, browserStart:Schema.optional(BrowserStartReceiptSchema) });
const Step = Schema.Struct({ intent: Schema.String, target: Schema.String, preconditions: list(Schema.Struct({ key: Schema.String, equals: Schema.String })), expectedResult: Schema.String });
const Observation = Schema.Struct({ artifactId: Schema.String, revision: Schema.Int, digest: Schema.String, summary: Schema.String, limitations: list(Schema.String) });
const Procedure = Schema.Struct({ id: Schema.String, revisions: list(Schema.Struct({ revision: Schema.Int, title: Schema.String, scope: Schema.Struct({ taskId: Schema.String, project: optionalText }), steps: list(Step), sourceRefs: list(Ref), createdAt: Schema.String, observation: Schema.optional(Observation) })) });
const Checkpoint = Schema.Struct({ id: Schema.String, note: Schema.String, createdAt: Schema.String, sourceRefs: list(Ref), artifacts: list(Schema.Struct({ artifactId: Schema.String, revision: Schema.Int })) });
const Proposal = Schema.Struct({ id: Schema.String, taskId: Schema.String, artifactId: Schema.String, revision: Schema.Int, path: Schema.String, parentRealPath: Schema.String, parentDevice: Schema.String, parentInode: Schema.String, artifactDigest: Schema.String, sourceRefs: list(Ref), byteLength: Schema.Int, digest: Schema.String, createdAt: Schema.String });
const Evidence = Schema.Struct({ path: Schema.String, byteLength: Schema.Int, digest: Schema.String, verifiedAt: Schema.String });
const Action = Schema.Struct({ proposal: Proposal, status: Schema.Literal('proposed', 'approved', 'executing', 'verified', 'failed', 'uncertain', 'retired'), approvalId: optionalText, approvalRetiredAt: optionalText, requestId: optionalText, evidence: Schema.optional(Evidence), error: optionalText });
const taskFields = { id: Schema.String, title: Schema.String, goal: Schema.String, status: Schema.Literal('active', 'paused'), createdAt: Schema.String, updatedAt: Schema.String, sources: list(Source), artifacts: list(Artifact), requests: list(Request), procedures: list(Procedure), checkpoints: list(Checkpoint), actions: list(Action), memory: Schema.Struct({ enabled: Schema.Literal(false) }) };
const LegacyStateSchema = Schema.Struct({ schemaVersion: Schema.Literal(1), tasks: list(Schema.Struct(taskFields)), usedRequestIds: list(Schema.String) });
const TaskSchema = Schema.Struct({ ...taskFields, assignedBotId: optionalText, provenance: Schema.optional(Schema.Literal('local-example')), session: Schema.optional(TaskSessionSchema) });
const StateSchema = Schema.Struct({ schemaVersion: Schema.Literal(2), tasks: list(TaskSchema), usedRequestIds: list(Schema.String) });
export interface State { schemaVersion: 2; tasks: Task[]; usedRequestIds: string[] }
export class StateValidationError extends Error {
  constructor(cause: unknown) { super('Task-store draft failed validation; existing data was preserved.', { cause }); this.name = 'StateValidationError'; }
}

export function readState(dataDir: string): Effect.Effect<State, Error> {
  return Effect.tryPromise({
    try: async () => {
      try {
        const raw = await readFile(join(dataDir, 'tasks.json'), 'utf8');
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && 'schemaVersion' in parsed && parsed.schemaVersion === 1) {
          const legacy = Schema.decodeUnknownSync(LegacyStateSchema, { onExcessProperty: 'error' })(parsed);
          return { ...legacy, schemaVersion: 2 };
        }
        return Schema.decodeUnknownSync(StateSchema, { onExcessProperty: 'error' })(parsed);
      } catch (error) {
        if (isCode(error, 'ENOENT')) return { schemaVersion: 2, tasks: [], usedRequestIds: [] };
        throw new Error('Task store is unreadable or incompatible; existing data was preserved.', { cause: error });
      }
    },
    catch: error => error instanceof Error ? error : new Error(String(error)),
  });
}

/** Write + fsync + same-directory rename: readers observe an old or complete new ledger. */
export function writeState(dataDir: string, state: State): Effect.Effect<void, Error> {
  return Effect.tryPromise({
    try: async () => {
      let validated: State;
      try { validated = Schema.decodeUnknownSync(StateSchema, { onExcessProperty: 'error' })(state); }
      catch (cause) { throw new StateValidationError(cause); }
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      const temporaryPath = join(dataDir, `.tasks-${randomUUID()}.tmp`);
      try {
        const file = await open(temporaryPath, 'wx', 0o600);
        try { await file.writeFile(JSON.stringify(validated)); await file.sync(); } finally { await file.close(); }
        await rename(temporaryPath, join(dataDir, 'tasks.json'));
        const directory = await open(dataDir, 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      } finally { await rm(temporaryPath, { force: true }); }
    },
    catch: error => error instanceof Error ? error : new Error(String(error)),
  });
}

export function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
