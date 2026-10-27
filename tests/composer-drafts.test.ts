import { describe, expect, it } from 'vitest';
import type { ComposerDraft, ComposerKind } from '../src/core/task-session';
import { createComposerDrafts } from '../src/renderer/src/composer-drafts';

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((error: unknown) => void) | undefined;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return {
    promise,
    resolve(value: T) { if (!resolve) throw Error('Deferred transport was not initialized.'); resolve(value); },
    reject(error: unknown) { if (!reject) throw Error('Deferred transport was not initialized.'); reject(error); },
  };
}
function transport() {
  const calls: { taskId: string; expectedRevision: number; value: { text: string; kind: ComposerKind }; result: ReturnType<typeof deferred<ComposerDraft>> }[] = [];
  return {
    calls,
    save(taskId: string, expectedRevision: number, value: { text: string; kind: ComposerKind }) {
      const result = deferred<ComposerDraft>();
      calls.push({ taskId, expectedRevision, value, result });
      return result.promise;
    },
  };
}
function task(id: string, text = '', kind: ComposerKind = 'explain', draftRevision = 0, revision = draftRevision) {
  return { id, session: { draft: text, draftKind: kind, draftRevision, revision } };
}

describe('per-task composer drafts', () => {
  it('hydrates text and mode, exposes stable snapshots and notifies subscribers only for observable changes', () => {
    const remote = transport(), drafts = createComposerDrafts(remote.save);
    const snapshots: unknown[] = [];
    const unsubscribe = drafts.subscribe(() => snapshots.push(drafts.getSnapshot()));
    const initial = drafts.getSnapshot();
    expect(drafts.getSnapshot()).toBe(initial);
    drafts.hydrate([task('a', 'Saved question', 'experiment', 4, 7), { id: 'b' }]);
    const hydrated = drafts.getSnapshot();
    expect(hydrated).toEqual({ a: { text: 'Saved question', kind: 'experiment' }, b: { text: '', kind: 'explain' } });
    drafts.hydrate([task('a', 'Saved question', 'experiment', 4, 7), { id: 'b' }]);
    expect(drafts.getSnapshot()).toBe(hydrated);
    expect(snapshots).toHaveLength(1);
    unsubscribe();
    drafts.forget('b');
    expect(snapshots).toHaveLength(1);
    expect(remote.calls).toHaveLength(0);
  });

  it('serializes each task and coalesces to the latest edit without skipping a return to acknowledged text', async () => {
    const remote = transport(), drafts = createComposerDrafts(remote.save);
    drafts.hydrate([task('a', 'Acknowledged', 'explain', 4, 7)]);
    drafts.edit('a', { text: 'First pending' });
    await Promise.resolve();
    expect(remote.calls[0]).toMatchObject({ taskId: 'a', expectedRevision: 4, value: { text: 'First pending', kind: 'explain' } });
    drafts.edit('a', { text: 'Intermediate' });
    drafts.edit('a', { text: 'Acknowledged', kind: 'create' });
    drafts.hydrate([task('a', 'Stale hydration', 'procedure', 4, 8)]);
    expect(remote.calls).toHaveLength(1);
    expect(drafts.getSnapshot().a).toEqual({ text: 'Acknowledged', kind: 'create' });
    remote.calls[0].result.resolve({ text: 'First pending', kind: 'explain', revision: 5 });
    await Promise.resolve();
    expect(remote.calls[1]).toMatchObject({ taskId: 'a', expectedRevision: 5, value: { text: 'Acknowledged', kind: 'create' } });
    expect(drafts.getSnapshot().a).toEqual({ text: 'Acknowledged', kind: 'create' });
    const flushed = drafts.flush('a');
    remote.calls[1].result.resolve({ text: 'Acknowledged', kind: 'create', revision: 6 });
    await flushed;
    expect(remote.calls).toHaveLength(2);
  });

  it('returns the exact accepted submission token after flushing the matching local generation', async () => {
    const remote = transport(), drafts = createComposerDrafts(remote.save);
    drafts.hydrate([task('a', 'Old draft', 'explain', 4, 7)]);
    drafts.edit('a', { text: '  Submitted intent  ', kind: 'create' });
    const submission = drafts.submission('a', 'Submitted intent', 'create');
    await Promise.resolve();
    remote.calls[0].result.resolve({ text: '  Submitted intent  ', kind: 'create', revision: 5 });
    await expect(submission).resolves.toEqual({ text: '  Submitted intent  ', kind: 'create', revision: 5 });
    expect(drafts.getSnapshot().a.text).toBe('  Submitted intent  ');
  });

  it('persists same-payload edits as new intent even before dispatch and after an acknowledgement', async () => {
    const remote = transport(), drafts = createComposerDrafts(remote.save);
    drafts.hydrate([task('a', 'Keep this', 'procedure', 2, 4)]);
    drafts.edit('a', { text: 'Away' });
    drafts.edit('a', { text: 'Keep this' });
    const first = drafts.flush();
    await Promise.resolve();
    expect(remote.calls).toHaveLength(1);
    expect(remote.calls[0]).toMatchObject({ expectedRevision: 2, value: { text: 'Keep this', kind: 'procedure' } });
    remote.calls[0].result.resolve({ text: 'Keep this', kind: 'procedure', revision: 3 });
    await first;
    const snapshot = drafts.getSnapshot();
    drafts.edit('a', { text: 'Keep this', kind: 'procedure' });
    expect(drafts.getSnapshot()).toBe(snapshot);
    const second = drafts.flush();
    await Promise.resolve();
    expect(remote.calls[1]).toMatchObject({ expectedRevision: 3, value: { text: 'Keep this', kind: 'procedure' } });
    remote.calls[1].result.resolve({ text: 'Keep this', kind: 'procedure', revision: 4 });
    await second;
  });

  it.each(['different', 'away-and-back', 'same-payload'])('withholds the submission token for a newer %s generation during flush', async newer => {
    const remote = transport(), drafts = createComposerDrafts(remote.save);
    drafts.hydrate([task('a', 'Original', 'explain', 4, 7)]);
    drafts.edit('a', { text: 'Submit me' });
    const submission = drafts.submission('a', 'Submit me', 'explain');
    await Promise.resolve();
    if (newer !== 'same-payload') drafts.edit('a', { text: 'Newer unsent draft' });
    if (newer !== 'different') drafts.edit('a', { text: 'Submit me' });
    const latest = newer === 'different' ? 'Newer unsent draft' : 'Submit me';
    remote.calls[0].result.resolve({ text: 'Submit me', kind: 'explain', revision: 5 });
    await Promise.resolve();
    expect(remote.calls[1]).toMatchObject({ expectedRevision: 5, value: { text: latest, kind: 'explain' } });
    remote.calls[1].result.resolve({ text: latest, kind: 'explain', revision: 6 });
    await expect(submission).resolves.toBeUndefined();
    expect(drafts.getSnapshot().a.text).toBe(latest);
  });

  it('returns no token for a different prompt or mode and never submits an unknown task', async () => {
    const remote = transport(), drafts = createComposerDrafts(remote.save);
    drafts.hydrate([task('a', 'Saved intent', 'create', 5, 9)]);
    await expect(drafts.submission('a', 'Other intent', 'create')).resolves.toBeUndefined();
    await expect(drafts.submission('a', 'Saved intent', 'explain')).resolves.toBeUndefined();
    await expect(drafts.submission('missing', 'Saved intent', 'create')).resolves.toBeUndefined();
    await expect(drafts.submission('a', '  Saved intent  ', 'create')).resolves.toEqual({ text: 'Saved intent', kind: 'create', revision: 5 });
    expect(remote.calls).toHaveLength(0);
  });

  it('flushes nonselected tasks and tasks edited during the drain without letting acknowledgements cross tasks', async () => {
    const remote = transport(), drafts = createComposerDrafts(remote.save);
    drafts.hydrate([task('a', 'Alpha', 'explain', 2, 4), task('b', 'Beta', 'create', 7, 8)]);
    drafts.edit('a', { text: 'Alpha unsent' });
    const flushed = drafts.flush();
    await Promise.resolve();
    drafts.edit('b', { text: 'Beta unsent' });
    await Promise.resolve();
    expect(remote.calls.map(call => [call.taskId, call.expectedRevision])).toEqual([['a', 2], ['b', 7]]);
    remote.calls[1].result.resolve({ text: 'Beta unsent', kind: 'create', revision: 8 });
    await Promise.resolve();
    const beta = drafts.getSnapshot().b;
    remote.calls[0].result.resolve({ text: 'Alpha unsent', kind: 'explain', revision: 3 });
    await flushed;
    expect(drafts.getSnapshot()).toEqual({ a: { text: 'Alpha unsent', kind: 'explain' }, b: { text: 'Beta unsent', kind: 'create' } });
    expect(drafts.getSnapshot().b).toBe(beta);
  });

  it('rejects failed flushes, retains text and mode through hydration, and retries the unsaved intent explicitly', async () => {
    const remote = transport(), errors: { error: unknown; taskId: string }[] = [];
    const drafts = createComposerDrafts(remote.save, (error, taskId) => errors.push({ error, taskId }));
    drafts.hydrate([task('a', 'Old', 'explain', 4, 7)]);
    drafts.edit('a', { text: 'Do not lose this', kind: 'experiment' });
    const flushed = drafts.flush('a'), failed = expect(flushed).rejects.toThrow('Disk full');
    await Promise.resolve();
    const error = Error('Disk full');
    remote.calls[0].result.reject(error);
    await failed;
    expect(errors).toEqual([{ error, taskId: 'a' }]);
    drafts.hydrate([task('a', 'Old', 'explain', 4, 8)]);
    expect(drafts.getSnapshot().a).toEqual({ text: 'Do not lose this', kind: 'experiment' });
    const retry = drafts.flush();
    await Promise.resolve();
    expect(remote.calls[1]).toMatchObject({ expectedRevision: 4, value: { text: 'Do not lose this', kind: 'experiment' } });
    remote.calls[1].result.resolve({ text: 'Do not lose this', kind: 'experiment', revision: 5 });
    await retry;
    await expect(drafts.submission('a', 'Do not lose this', 'experiment')).resolves.toEqual({ text: 'Do not lose this', kind: 'experiment', revision: 5 });
  });

  it('accepts a clean consumed-empty draft at the same epoch and rejects older global-session hydration', () => {
    const remote = transport(), drafts = createComposerDrafts(remote.save);
    drafts.hydrate([task('a', 'Submitted', 'procedure', 4, 7)]);
    drafts.hydrate([task('a', '', 'procedure', 4, 8)]);
    expect(drafts.getSnapshot().a).toEqual({ text: '', kind: 'procedure' });
    drafts.hydrate([task('a', 'Submitted', 'procedure', 4, 7)]);
    expect(drafts.getSnapshot().a.text).toBe('');
    expect(remote.calls).toHaveLength(0);
  });

  it('freezes edits for a quit flush without blocking deletion or later unfreezing', async () => {
    const remote = transport(), drafts = createComposerDrafts(remote.save);
    drafts.hydrate([task('a'), task('b')]);
    drafts.edit('a', { text: 'Before quit' });
    drafts.setFrozen(true);
    drafts.edit('a', { text: 'After frozen' });
    drafts.edit('b', { kind: 'create' });
    drafts.forget('b');
    const flushed = drafts.flush();
    await Promise.resolve();
    expect(remote.calls[0].value.text).toBe('Before quit');
    expect(drafts.getSnapshot()).toEqual({ a: { text: 'Before quit', kind: 'explain' } });
    remote.calls[0].result.resolve({ text: 'Before quit', kind: 'explain', revision: 1 });
    await flushed;
    drafts.setFrozen(false);
    drafts.edit('a', { text: 'Quit cancelled' });
    const resumed = drafts.flush();
    await Promise.resolve();
    remote.calls[1].result.resolve({ text: 'Quit cancelled', kind: 'explain', revision: 2 });
    await resumed;
    expect(drafts.getSnapshot().a.text).toBe('Quit cancelled');
  });

  it('forgets deletion permanently despite late acknowledgements, stale hydration and edits', async () => {
    const remote = transport(), drafts = createComposerDrafts(remote.save);
    drafts.hydrate([task('a')]);
    drafts.edit('a', { text: 'Pending deletion' });
    const submission = drafts.submission('a', 'Pending deletion', 'explain');
    await Promise.resolve();
    drafts.forget('a');
    remote.calls[0].result.resolve({ text: 'Pending deletion', kind: 'explain', revision: 1 });
    await expect(submission).resolves.toBeUndefined();
    drafts.hydrate([task('a', 'Pending deletion', 'explain', 1, 1)]);
    drafts.edit('a', { text: 'Stale event' });
    await drafts.flush();
    expect(drafts.getSnapshot()).toEqual({});
    expect(remote.calls).toHaveLength(1);
  });

  it('dispatches an edit arriving between transport acknowledgement and pump cleanup', async () => {
    const remote = transport(), drafts = createComposerDrafts(remote.save);
    drafts.hydrate([task('a')]);
    drafts.edit('a', { text: 'First' });
    await Promise.resolve();
    void remote.calls[0].result.promise.then(() => drafts.edit('a', { text: 'Cleanup race' }));
    remote.calls[0].result.resolve({ text: 'First', kind: 'explain', revision: 1 });
    for (let step = 0; step < 6; step += 1) await Promise.resolve();
    expect(remote.calls[1]).toMatchObject({ expectedRevision: 1, value: { text: 'Cleanup race', kind: 'explain' } });
    remote.calls[1].result.resolve({ text: 'Cleanup race', kind: 'explain', revision: 2 });
    await drafts.flush();
  });

  it('accepts minimal clean hydration when no global-session revision is supplied', () => {
    const remote = transport(), drafts = createComposerDrafts(remote.save);
    drafts.hydrate([task('a', 'Sent', 'explain', 4, 8)]);
    drafts.hydrate([{ id: 'a', session: { draft: '', draftKind: 'explain', draftRevision: 4 } }]);
    expect(drafts.getSnapshot().a.text).toBe('');
  });

  it.each(['completion-first', 'newer-save-first'])('preserves a newer identical draft with %s server ordering', async order => {
    const remote = transport(), drafts = createComposerDrafts(remote.save);
    let server: ComposerDraft = { text: 'Keep my next intent', kind: 'create', revision: 4 };
    let sessionRevision = 7;
    const hydrate = () => drafts.hydrate([task('a', server.text, server.kind, server.revision, sessionRevision)]);
    const consume = (submitted: ComposerDraft) => {
      if (server.revision !== submitted.revision || server.text !== submitted.text || server.kind !== submitted.kind) return false;
      server = { ...server, text: '' };
      sessionRevision += 1;
      return true;
    };
    hydrate();
    const original = await drafts.submission('a', 'Keep my next intent', 'create');
    expect(original).toEqual({ text: 'Keep my next intent', kind: 'create', revision: 4 });
    if (!original) throw Error('The clean original intent must be durable.');
    drafts.edit('a', { text: 'Keep my next intent' });
    const flushed = drafts.flush();
    await Promise.resolve();
    expect(remote.calls[0]).toMatchObject({ expectedRevision: 4, value: { text: 'Keep my next intent', kind: 'create' } });
    if (order === 'completion-first') {
      expect(consume(original)).toBe(true);
      expect(server).toEqual({ text: '', kind: 'create', revision: 4 });
      hydrate();
      expect(drafts.getSnapshot().a.text).toBe('Keep my next intent');
    }
    expect(server.revision).toBe(4);
    server = { text: 'Keep my next intent', kind: 'create', revision: 5 };
    sessionRevision += 1;
    hydrate();
    remote.calls[0].result.resolve({ text: 'Keep my next intent', kind: 'create', revision: 5 });
    await flushed;
    if (order === 'newer-save-first') expect(consume(original)).toBe(false);
    hydrate();
    drafts.hydrate([task('a', '', 'create', 4, 8)]);
    expect(drafts.getSnapshot().a).toEqual({ text: 'Keep my next intent', kind: 'create' });
    await expect(drafts.submission('a', 'Keep my next intent', 'create')).resolves.toEqual({ text: 'Keep my next intent', kind: 'create', revision: 5 });
  });

  it('persists a newer generation queued behind a failed save without retrying the failed generation forever', async () => {
    const remote = transport(), errors: unknown[] = [];
    const drafts = createComposerDrafts(remote.save, error => errors.push(error));
    drafts.hydrate([task('a', '', 'explain', 3, 5)]);
    drafts.edit('a', { text: 'First attempt' });
    const flushed = drafts.flush(), failed = expect(flushed).rejects.toThrow('First attempt failed');
    await Promise.resolve();
    drafts.edit('a', { text: 'Newer intent after pending save' });
    remote.calls[0].result.reject(Error('First attempt failed'));
    await failed;
    for (let step = 0; step < 4; step += 1) await Promise.resolve();
    expect(remote.calls[1]).toMatchObject({ expectedRevision: 3, value: { text: 'Newer intent after pending save', kind: 'explain' } });
    remote.calls[1].result.resolve({ text: 'Newer intent after pending save', kind: 'explain', revision: 4 });
    await drafts.flush();
    expect(errors).toHaveLength(1);
    expect(remote.calls).toHaveLength(2);
  });

  it('rejects failed submissions and preserves their unsaved intent without an error observer', async () => {
    const remote = transport(), drafts = createComposerDrafts(remote.save);
    drafts.edit('a', { text: 'Unsent request', kind: 'procedure' });
    const submitted = drafts.submission('a', 'Unsent request', 'procedure');
    const failed = expect(submitted).rejects.toThrow('Persistence unavailable');
    await Promise.resolve();
    remote.calls[0].result.reject(Error('Persistence unavailable'));
    await failed;
    drafts.hydrate([task('a')]);
    expect(drafts.getSnapshot().a).toEqual({ text: 'Unsent request', kind: 'procedure' });
    expect(remote.calls).toHaveLength(1);
  });

  it('ignores a deleted task transport failure while preserving other tasks', async () => {
    const remote = transport(), errors: unknown[] = [];
    const drafts = createComposerDrafts(remote.save, error => errors.push(error));
    drafts.hydrate([task('a'), task('b', 'Retained')]);
    drafts.edit('a', { text: 'Deleted' });
    const flushed = drafts.flush();
    await Promise.resolve();
    drafts.forget('a');
    remote.calls[0].result.reject(Error('Task was deleted'));
    await flushed;
    expect(drafts.getSnapshot()).toEqual({ b: { text: 'Retained', kind: 'explain' } });
    expect(errors).toHaveLength(0);
  });

  it('flushes one task without waiting for an unrelated task transport', async () => {
    const remote = transport(), drafts = createComposerDrafts(remote.save);
    drafts.hydrate([task('a'), task('b')]);
    drafts.edit('a', { text: 'Alpha' });
    drafts.edit('b', { text: 'Beta' });
    const alpha = drafts.flush('a');
    await Promise.resolve();
    remote.calls[0].result.resolve({ text: 'Alpha', kind: 'explain', revision: 1 });
    await alpha;
    expect(drafts.getSnapshot().b.text).toBe('Beta');
    remote.calls[1].result.resolve({ text: 'Beta', kind: 'explain', revision: 1 });
    await drafts.flush();
  });

  it('retains dirty local text when a newer server epoch arrives and retries using that observed epoch', async () => {
    const remote = transport(), drafts = createComposerDrafts(remote.save);
    drafts.hydrate([task('a', 'Old', 'explain', 4, 7)]);
    drafts.edit('a', { text: 'Local unsaved', kind: 'create' });
    const first = drafts.flush('a'), failed = expect(first).rejects.toThrow('Revision conflict');
    await Promise.resolve();
    drafts.hydrate([task('a', 'Newer remote', 'procedure', 6, 9)]);
    expect(drafts.getSnapshot().a).toEqual({ text: 'Local unsaved', kind: 'create' });
    remote.calls[0].result.reject(Error('Revision conflict'));
    await failed;
    const retried = drafts.flush('a');
    await Promise.resolve();
    expect(remote.calls[1]).toMatchObject({ expectedRevision: 6, value: { text: 'Local unsaved', kind: 'create' } });
    remote.calls[1].result.resolve({ text: 'Local unsaved', kind: 'create', revision: 7 });
    await retried;
    await expect(drafts.submission('a', 'Local unsaved', 'create')).resolves.toEqual({ text: 'Local unsaved', kind: 'create', revision: 7 });
  });

  it('notifies each subscription once when a consumer resubscribes during notification', () => {
    const remote = transport(), drafts = createComposerDrafts(remote.save);
    let notifications = 0, resubscribed = false;
    let unsubscribe = () => {};
    const listener = () => {
      notifications += 1;
      if (!resubscribed) {
        resubscribed = true;
        unsubscribe();
        unsubscribe = drafts.subscribe(listener);
      }
    };
    unsubscribe = drafts.subscribe(listener);
    drafts.hydrate([task('a')]);
    expect(notifications).toBe(1);
    unsubscribe();
  });
});
