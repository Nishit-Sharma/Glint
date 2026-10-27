import {readComposerDraft,type ComposerDraft} from '../../core/composer-draft';
import type {TaskSession} from '../../core/task-session';

export type ComposerValue = Pick<ComposerDraft, 'text' | 'kind'>;
export type SaveComposerDraft = (taskId: string, expectedDraftRevision: number, value: ComposerValue) => Promise<ComposerDraft>;
type DraftTask = { readonly id: string; readonly session?: Pick<TaskSession, 'draft' | 'draftKind' | 'draftRevision'> & { readonly revision?: number } };
type Snapshot = Readonly<Record<string, Readonly<ComposerValue>>>;
type Entry = {
  value: ComposerValue;
  durable: ComposerDraft;
  generation: number;
  savedGeneration: number;
  sessionRevision: number | undefined;
  pending?: Promise<void>;
};

export function createComposerDrafts(save: SaveComposerDraft, onError?: (error: unknown, taskId: string) => void) {
  const entries = new Map<string, Entry>();
  const forgotten = new Set<string>();
  const listeners = new Set<() => void>();
  let snapshot: Snapshot = Object.freeze({});
  let frozen = false;

  function publish() { for (const listener of [...listeners]) listener(); }
  function setValue(taskId: string, value: ComposerValue) {
    const previous = snapshot[taskId];
    if (previous?.text === value.text && previous.kind === value.kind) return false;
    snapshot = Object.freeze({ ...snapshot, [taskId]: Object.freeze({ ...value }) });
    return true;
  }
  function hydrate(tasks: readonly DraftTask[]) {
    let changed = false;
    for (const task of tasks) {
      if (forgotten.has(task.id)) continue;
      const durable = readComposerDraft(task.session);
      const sessionRevision = task.session?.revision;
      let entry = entries.get(task.id);
      if (!entry) {
        entry = { value: { text: durable.text, kind: durable.kind }, durable, generation: 0, savedGeneration: 0, sessionRevision };
        entries.set(task.id, entry);
      } else {
        if (durable.revision < entry.durable.revision || (sessionRevision !== undefined && entry.sessionRevision !== undefined && sessionRevision < entry.sessionRevision)) continue;
        entry.durable = durable;
        if (sessionRevision !== undefined) entry.sessionRevision = sessionRevision;
        if (entry.pending || entry.generation !== entry.savedGeneration) continue;
        entry.value = { text: durable.text, kind: durable.kind };
      }
      changed = setValue(task.id, entry.value) || changed;
    }
    if (changed) publish();
  }
  function pump(taskId: string, entry: Entry): Promise<void> {
    if (entry.pending) return entry.pending;
    if (entry.generation === entry.savedGeneration) return Promise.resolve();
    let failed = false;
    let attemptedGeneration = entry.generation;
    const running = Promise.resolve().then(async () => {
      while (entries.get(taskId) === entry && entry.generation !== entry.savedGeneration) {
        const generation = entry.generation;
        attemptedGeneration = generation;
        const value = { ...entry.value };
        const accepted = await save(taskId, entry.durable.revision, value);
        if (entries.get(taskId) !== entry) return;
        if (accepted.revision > entry.durable.revision) entry.durable = { ...accepted };
        entry.savedGeneration = generation;
      }
    }).catch(error => {
      failed = true;
      if (entries.get(taskId) !== entry) return;
      try { onError?.(error, taskId); } catch { /* An error observer cannot change the persistence outcome. */ }
      throw error;
    });
    entry.pending = running.finally(() => {
      entry.pending = undefined;
      if (entries.get(taskId) === entry && entry.generation !== entry.savedGeneration && (!failed || entry.generation > attemptedGeneration)) {
        void pump(taskId, entry).catch(() => undefined);
      }
    });
    return entry.pending;
  }
  function edit(taskId: string, partial: Partial<ComposerValue>) {
    if (frozen || forgotten.has(taskId)) return;
    let entry = entries.get(taskId);
    if (!entry) {
      const durable = readComposerDraft();
      entry = { value: { text: durable.text, kind: durable.kind }, durable, generation: 0, savedGeneration: 0, sessionRevision: undefined };
      entries.set(taskId, entry);
    }
    entry.value = { text: partial.text ?? entry.value.text, kind: partial.kind ?? entry.value.kind };
    entry.generation += 1;
    void pump(taskId, entry).catch(() => undefined);
    if (setValue(taskId, entry.value)) publish();
  }
  async function flush(taskId?: string): Promise<void> {
    while (true) {
      const work = [...entries].filter(([id, entry]) => (taskId === undefined || id === taskId) && (entry.pending || entry.generation !== entry.savedGeneration));
      if (work.length === 0) return;
      await Promise.all(work.map(([id, entry]) => pump(id, entry)));
    }
  }
  async function submission(taskId: string, text: string, kind: ComposerDraft['kind']): Promise<ComposerDraft | undefined> {
    const entry = entries.get(taskId);
    if (!entry) return undefined;
    const generation = entry.generation;
    await flush(taskId);
    if (entries.get(taskId) !== entry || generation !== entry.generation || entry.value.text.trim() !== text.trim() || entry.value.kind !== kind) return undefined;
    if (entry.durable.text !== entry.value.text || entry.durable.kind !== entry.value.kind) return undefined;
    return { ...entry.durable };
  }
  function forget(taskId: string) {
    forgotten.add(taskId);
    entries.delete(taskId);
    if (!Object.hasOwn(snapshot, taskId)) return;
    const next = { ...snapshot };
    delete next[taskId];
    snapshot = Object.freeze(next);
    publish();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    hydrate, edit, flush, submission, forget,
    setFrozen(value: boolean) { frozen = value; },
  };
}
