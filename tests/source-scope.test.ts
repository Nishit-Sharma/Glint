import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCompanion, type Companion, type RequestContext, type RequestInput } from '../src/core/companion';

let root: string, core: Companion;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'window-companion-source-scope-'));
  core = await createCompanion({ dataDir: join(root, 'store') });
});
afterEach(async () => {
  await core.close().catch(() => undefined);
  await rm(root, { recursive: true, force: true });
});
const output = { title: 'Synthetic answer', content: 'An editable response.' };
const brief = { id: 'brief', kind: 'text' as const, label: 'Synthetic brief', role: 'fact' as const, content: 'Current synthetic facts.' };
async function prepared() {
  const task = await core.createTask({ title: 'Synthetic scoped task' });
  await core.putSource(task.id, { ...brief, content: 'Historical synthetic facts.' });
  await core.putSource(task.id, brief);
  await core.putSource(task.id, { id: 'background', kind: 'window', label: 'Synthetic background', role: 'style', content: 'Excluded synthetic capture.', windowId: 'window-2', documentToken: 'capture-1' });
  return task;
}
function pendingRequest(taskId: string, requestId: string, sourceIds: string[], kind: RequestInput['kind'] = 'create') {
  let started: () => void = () => undefined, release: () => void = () => undefined;
  let signal: AbortSignal | undefined;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const input = { taskId, requestId, kind, prompt: 'Synthetic pending request.', sourceIds };
  const pending = core.runRequest(input, async context => {
    signal = context.signal; started();
    await new Promise<void>(resolve => { release = resolve; });
    return output;
  });
  return { input, ready, pending, release: () => release(), aborted: () => signal?.aborted };
}

describe('explicit request source scope', () => {
  it('supplies only selected current versions, ignoring excluded stale history', async () => {
    const task = await prepared();
    await core.invalidateSource(task.id, 'background', 'Synthetic background changed.');
    let context: RequestContext | undefined;
    const input = { taskId: task.id, requestId: 'scoped', kind: 'create', prompt: 'Use the selected brief.', sourceIds: ['brief'] };
    const request = await core.runRequest(input, async captured => { context = captured; return output; });
    expect(request.status).toBe('completed');
    expect(context?.task.sources.map(source => source.id)).toEqual(['brief']);
    expect(context?.task.sources[0].versions.map(version => [version.version, version.content])).toEqual([[2, 'Current synthetic facts.']]);
    expect(request.sourceRefs).toEqual([{ sourceId: 'brief', version: 2, digest: context?.task.sources[0].versions[0].digest }]);
    const saved = await core.getTask(task.id);
    expect(saved.artifacts[0].revisions[0].sourceRefs).toEqual(request.sourceRefs);
    expect(saved.sources.map(source => source.versions.length)).toEqual([2, 1]);
    expect(saved.actions).toEqual([]);
  });

  it('keeps omitted scope as all sources and requires their freshness', async () => {
    const task = await prepared();
    let context: RequestContext | undefined;
    const request = await core.runRequest({ taskId: task.id, requestId: 'all', kind: 'create', prompt: 'Use every source.' }, async captured => { context = captured; return output; });
    expect(request.sourceRefs.map(ref => [ref.sourceId, ref.version])).toEqual([['brief', 2], ['background', 1]]);
    expect(context?.task.sources.map(source => [source.id, source.versions.length])).toEqual([['brief', 1], ['background', 1]]);
    await core.invalidateSource(task.id, 'background', 'Synthetic background changed.');
    let ran = false;
    await expect(core.runRequest({ taskId: task.id, requestId: 'all-stale', kind: 'create', prompt: 'Use every source.' }, async () => { ran = true; return output; })).rejects.toMatchObject({ code: 'stale' });
    expect(ran).toBe(false);
    expect((await core.getTask(task.id)).requests.map(record => record.id)).toEqual(['all']);
  });

  it('permits explicit prompt-only requests with no source transmission or provenance', async () => {
    const task = await prepared();
    await core.invalidateSource(task.id, 'brief', 'Synthetic brief changed.');
    await core.invalidateSource(task.id, 'background', 'Synthetic background changed.');
    const input = { taskId: task.id, requestId: 'prompt-only', kind: 'create', prompt: 'Answer only the prompt.', sourceIds: [] };
    let sources: string[] | undefined;
    const request = await core.runRequest(input, async context => {
      sources = context.task.sources.map(source => source.id);
      expect(context.sourceRefs).toEqual([]);
      return output;
    });
    expect(request.status).toBe('completed');
    expect(sources).toEqual([]);
    expect(request.sourceRefs).toEqual([]);
    expect((await core.getTask(task.id)).artifacts[0].revisions[0].sourceRefs).toEqual([]);
  });

  it('fails closed before invoking the runner when a selected source is stale', async () => {
    const task = await prepared();
    await core.invalidateSource(task.id, 'brief', 'Synthetic brief needs review.');
    let ran = false;
    const input = { taskId: task.id, requestId: 'selected-stale', kind: 'create', prompt: 'Use the selected brief.', sourceIds: ['brief'] };
    await expect(core.runRequest(input, async () => { ran = true; return output; })).rejects.toMatchObject({ code: 'stale' });
    expect(ran).toBe(false);
    expect((await core.getTask(task.id)).requests).toEqual([]);
    await core.putSource(task.id, { ...brief, content: 'Explicitly refreshed synthetic brief.' });
    expect((await core.runRequest(input, async () => output)).status).toBe('completed');
  });

  it.each([
    ['a null selection', null],
    ['a string selection', 'brief'],
    ['an object selection', { id: 'brief' }],
    ['a numeric source ID', [123]],
    ['an empty source ID', ['']],
    ['an oversized source ID', ['x'.repeat(201)]],
    ['a source ID with a null byte', ['brief\0']],
    ['duplicate IDs', ['brief', 'brief']],
    ['an unavailable ID', ['other-task-source']],
    ['more than 64 source IDs', Array.from({ length: 65 }, (_, index) => `source-${index}`)],
  ])('rejects %s without consuming request identity or changing stored work', async (_label, sourceIds) => {
    const task = await prepared();
    // JSON represents an untrusted runtime caller bypassing TypeScript.
    const input = JSON.parse(JSON.stringify({ taskId: task.id, requestId: 'malformed', kind: 'create', prompt: 'Synthetic request.', sourceIds }));
    let ran = false;
    await expect(core.runRequest(input, async () => { ran = true; return output; })).rejects.toMatchObject({ code: 'invalid' });
    expect(ran).toBe(false);
    const saved = await core.getTask(task.id);
    expect(saved.requests).toEqual([]);
    expect(saved.artifacts).toEqual([]);
    expect((await core.runRequest({ ...input, sourceIds: ['brief'] }, async () => output)).status).toBe('completed');
  });

  it('binds durable idempotency to the selected source/version set', async () => {
    const task = await prepared();
    const input = { taskId: task.id, requestId: 'durable-scope', kind: 'create', prompt: 'Use selected sources.', sourceIds: ['brief', 'background'] };
    const request = await core.runRequest(input, async () => output);
    const replay = () => { throw new Error('A durable request must not run again.'); };
    // Array order does not change a selection set.
    expect(await core.runRequest({ ...input, sourceIds: ['background', 'brief'] }, replay)).toEqual(request);
    await core.close(); core = await createCompanion({ dataDir: join(root, 'store') });
    expect(await core.runRequest(input, replay)).toEqual(request);
    await expect(core.runRequest({ ...input, sourceIds: ['brief'] }, replay)).rejects.toMatchObject({ code: 'conflict' });
    await expect(core.runRequest({ ...input, sourceIds: [] }, replay)).rejects.toMatchObject({ code: 'conflict' });
    await core.putSource(task.id, { ...brief, content: 'A later synthetic version.' });
    await expect(core.runRequest(input, replay)).rejects.toMatchObject({ code: 'conflict' });
    expect((await core.getTask(task.id)).requests).toHaveLength(1);
  });

  it('keeps a scoped replay unchanged after an excluded source changes', async () => {
    const task = await prepared();
    const input = { taskId: task.id, requestId: 'excluded-replay', kind: 'create', prompt: 'Use the selected brief.', sourceIds: ['brief'] };
    const request = await core.runRequest(input, async () => output);
    await core.putSource(task.id, { id: 'background', kind: 'text', label: 'Background correction', role: 'fact', content: 'Different excluded synthetic facts.' });
    expect(await core.runRequest(input, async () => { throw new Error('Excluded changes must not replay a request.'); })).toEqual(request);
  });

  it('binds omitted scope to the all-source snapshot used by that request', async () => {
    const task = await prepared();
    const input = { taskId: task.id, requestId: 'all-snapshot', kind: 'create', prompt: 'Use all sources.' };
    const request = await core.runRequest(input, async () => output);
    const replay = () => { throw new Error('An existing request must never run again.'); };
    expect(await core.runRequest(input, replay)).toEqual(request);
    await core.putSource(task.id, { ...brief, content: 'A corrected synthetic brief.' });
    await expect(core.runRequest(input, replay)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('freezes caller-owned request selection before queued work begins', async () => {
    const task = await prepared();
    const input = { taskId: task.id, requestId: 'frozen-selection', kind: 'create', prompt: 'Use the selected brief.', sourceIds: ['brief'] };
    let sources: string[] | undefined;
    const pending = core.runRequest(input, async context => { sources = context.task.sources.map(source => source.id); return output; });
    input.sourceIds[0] = 'background'; input.prompt = 'Changed after submission.';
    const request = await pending;
    expect(sources).toEqual(['brief']);
    expect(request.prompt).toBe('Use the selected brief.');
    expect(request.sourceRefs.map(ref => ref.sourceId)).toEqual(['brief']);
  });

  it('rejects a source that exists only in a different task', async () => {
    const task = await prepared();
    const other = await core.createTask({ title: 'Other synthetic task' });
    await core.putSource(other.id, { ...brief, id: 'other-task-source' });
    const input = { taskId: task.id, requestId: 'cross-task', kind: 'create', prompt: 'Use a foreign source.', sourceIds: ['other-task-source'] };
    await expect(core.runRequest(input, async () => output)).rejects.toMatchObject({ code: 'invalid' });
    expect((await core.getTask(task.id)).requests).toEqual([]);
  });

  it.each(['refresh', 'invalidate', 'observe'] as const)('%s cancels only requests bound to the changed source', async operation => {
    const aborted: boolean[] = [], during: unknown[] = [], statuses: string[] = [], artifactRefs: string[][] = [];
    for (const [requestId, sourceIds] of [['using-brief', ['brief']], ['using-window', ['background']], ['using-prompt', []]] as const) {
      const task = await prepared(), request = pendingRequest(task.id, requestId, [...sourceIds]);
      await request.ready;
      const before = (await core.getTask(task.id)).requests[0];
      expect(before).toMatchObject({ status: 'running', concurrency: 'ordinary', contextSkillRefs: [] });
      expect(before.sourceRefs.map(ref => ref.sourceId)).toEqual(sourceIds);
      expect(before.contextSourceRefs).toEqual(before.sourceRefs);
      await expect(core.runRequest({...request.input, requestId: requestId+'-overlap'}, async () => output)).rejects.toThrow('Wait for the current task response to finish or stop.');
      if (operation === 'refresh') await core.putSource(task.id, { id: 'background', kind: 'window', label: 'Refreshed synthetic background', role: 'style', content: 'New synthetic capture.', windowId: 'window-2', documentToken: 'capture-2' });
      else if (operation === 'invalidate') await core.invalidateSource(task.id, 'background', 'Synthetic window became unavailable.');
      else await core.observeWindow(task.id, { windowId: 'window-2', documentToken: 'capture-2' });
      aborted.push(request.aborted()!);
      during.push(...(await core.getTask(task.id)).requests.map(request => [request.id, request.status]));
      request.release(); statuses.push((await request.pending).status);
      const saved = await core.getTask(task.id);
      artifactRefs.push(...saved.artifacts.map(artifact => artifact.revisions[0].sourceRefs.map(ref => ref.sourceId)));
      expect(saved.actions).toEqual([]);
    }
    expect(aborted).toEqual([false, true, false]);
    expect(during).toEqual([['using-brief', 'running'], ['using-window', 'cancelled'], ['using-prompt', 'running']]);
    expect(statuses).toEqual(['completed', 'cancelled', 'completed']);
    expect(artifactRefs).toEqual([['brief'], []]);
  });

  it.each(['procedure', 'browser'] as const)('%s core requests retain source scoping without launching a helper or browser', async kind => {
    for (const sourceIds of [[], ['background']]) {
      const task = await prepared(), request = pendingRequest(task.id, kind+'-'+sourceIds.length, sourceIds, kind);
      await request.ready;
      expect((await core.getTask(task.id)).requests[0].concurrency).toBe('exclusive');
      await core.putSource(task.id, { ...brief, id: 'background', content: 'Updated unrelated-or-selected source.' });
      expect(request.aborted()).toBe(sourceIds.length > 0);
      request.release();
      expect((await request.pending).status).toBe(sourceIds.length ? 'cancelled' : 'completed');
      expect((await core.getTask(task.id)).artifacts).toHaveLength(sourceIds.length ? 0 : 1);
    }
  });

  it('preserves explicit stop and duplicate suppression for a prompt-only request', async () => {
    const task = await prepared();
    const request = pendingRequest(task.id, 'prompt-stop', []);
    await request.ready;
    const replay = () => { throw new Error('Stopped request must never rerun.'); };
    expect((await core.runRequest(request.input, replay)).status).toBe('running');
    expect((await core.cancelRequest(task.id, request.input.requestId)).status).toBe('cancelled');
    expect(request.aborted()).toBe(true);
    request.release();
    expect((await request.pending).status).toBe('cancelled');
    expect((await core.runRequest(request.input, replay)).status).toBe('cancelled');
    expect((await core.getTask(task.id)).artifacts).toEqual([]);
  });

  it('preserves pause cancellation for selected-source and prompt-only requests', async () => {
    const aborted: boolean[] = [], statuses: string[] = [];
    for (const [requestId, sourceIds] of [['pause-selected', ['brief']], ['pause-prompt', []]] as const) {
      const task = await prepared(), request = pendingRequest(task.id, requestId, [...sourceIds]);
      await request.ready;
      await core.pause(task.id);
      aborted.push(request.aborted()!); request.release(); statuses.push((await request.pending).status);
      await expect(core.runRequest({ ...request.input, requestId: requestId+'-while-paused' }, async () => output)).rejects.toMatchObject({ code: 'conflict' });
      expect((await core.getTask(task.id)).artifacts).toEqual([]);
    }
    expect(aborted).toEqual([true, true]);
    expect(statuses).toEqual(['cancelled', 'cancelled']);
  });

  it('keeps interrupted scoped requests durable without replay after restart', async () => {
    const task = await prepared();
    const selected = pendingRequest(task.id, 'interrupted-scoped', ['brief']);
    await selected.ready;
    // The host stops before committing the response; the old owner cannot save afterward.
    const stopped = selected.pending.catch(() => undefined);
    await core.close(); selected.release(); await stopped;
    core = await createCompanion({ dataDir: join(root, 'store') });
    const resumed = await core.resume(task.id);
    expect(resumed.interruptedRequestIds).toEqual(['interrupted-scoped']);
    expect(resumed.staleSourceIds).toEqual(['background']);
    const replay = await core.runRequest(selected.input, async () => { throw new Error('Interrupted request must not rerun.'); });
    expect(replay.status).toBe('interrupted');
    expect(replay.sourceRefs.map(ref => [ref.sourceId, ref.version])).toEqual([['brief', 2]]);
    expect((await core.getTask(task.id)).artifacts).toEqual([]);
  });
});
