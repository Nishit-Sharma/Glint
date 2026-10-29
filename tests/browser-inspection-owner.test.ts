import { it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCompanion } from '../src/core/companion';
import { emptyTaskSession } from '../src/core/task-session';
import { BrowserService } from '../src/host/browser/service';
import { BrowserReconciliation } from '../src/host/browser/reconciliation';

const external = vi.hoisted(() => ({ launch: vi.fn(), dialog: vi.fn() }));
vi.mock('playwright-core', () => ({ chromium: { launch: external.launch } }));
vi.mock('electron', () => ({ dialog: { showMessageBox: external.dialog } }));

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'inspection-owner-'));
  const core = await createCompanion({ dataDir: dir });
  const task = await core.createTask({ title: 'Uncertain effect' });
  await core.runRequest({ taskId: task.id, requestId: 'old', kind: 'browser', prompt: 'Save once' }, async () => { throw Error('Uncertain'); });
  await core.replaceSession(task.id, 0, { ...emptyTaskSession(), runs: [{ id: 'old', endpointKey: 'fixture', origin: 'https://example.invalid', browserId: 'old-browser', initialObservation: { id: 'before', taskId: task.id, browserId: 'old-browser', documentId: 'old-document', url: 'https://example.invalid/form', title: 'Form', text: 'Form', digest: 'digest', targets: [] }, operations: [{ id: 'action', intent: { kind: 'click', snapshotId: 'before', targetId: 'submit' }, reason: 'Save once', status: 'uncertain' }] }] });
  return { core, taskId: task.id, input: { taskId: task.id, runId: 'old', operationId: 'action', url: 'https://example.invalid/receipt' }, cleanup: async () => { await core.close(); await rm(dir, { recursive: true, force: true }); } };
}

function browserFixture(options: { missingOwner?: boolean; failClose?: boolean } = {}) {
  const order: string[] = [], release = vi.fn(() => { order.push('release'); });
  const owner = vi.fn((pid: number) => { expect(pid).toBe(12345); order.push('register'); return release; });
  const page = { on: vi.fn(), goto: vi.fn(async () => { order.push('navigate'); }), isClosed: () => false,
    evaluate: vi.fn(async () => ({ text: 'Receipt', title: 'Receipt', url: 'https://example.invalid/receipt' })),
    locator: () => ({ count: async () => 0 }) };
  const context = { on: vi.fn(), newPage: vi.fn(async () => page), route: vi.fn(), routeWebSocket: vi.fn(), addInitScript: vi.fn(), close: vi.fn(async () => {}) };
  const browser = { newBrowserCDPSession: vi.fn(async () => ({ send: async () => ({ processInfo: options.missingOwner ? [] : [{ type: 'browser', id: 12345 }] }), detach: async () => {} })),
    newContext: vi.fn(async () => { order.push('context'); return context; }), close: vi.fn(async () => { order.push('close'); if (options.failClose) throw Error('Close failed'); }) };
  return { order, release, owner, browser, context, page };
}

function service(core: Awaited<ReturnType<typeof createCompanion>>, owner?: ReturnType<typeof browserFixture>['owner']) {
  return new BrowserService(core, { panel: () => ({}) as never, route: () => ({ key: 'fixture', provider: { status: vi.fn(), run: vi.fn() } }), changed: () => {}, progress: () => {}, onWindowOwner: owner });
}

it('registers the inspection owner before context and navigation, then releases after close', async () => {
  const f = await fixture(), b = browserFixture();
  external.dialog.mockReset().mockResolvedValueOnce({ response: 1 }).mockResolvedValueOnce({ response: 0 });
  external.launch.mockReset().mockResolvedValue(b.browser);
  const s = service(f.core, b.owner);
  try {
    await s.inspect(f.input);
    expect(b.order).toEqual(['register', 'context', 'navigate', 'close', 'release']);
    expect(b.owner).toHaveBeenCalledOnce(); expect(b.release).toHaveBeenCalledOnce();
    expect(external.launch).toHaveBeenCalledWith({ headless: true, chromiumSandbox: true });
  } finally { s.close(); await f.cleanup(); }
});

it('retains the inspection owner when closing the browser fails', async () => {
  const f = await fixture(), b = browserFixture({ failClose: true });
  external.dialog.mockReset().mockResolvedValue({ response: 1 }); external.launch.mockReset().mockResolvedValue(b.browser);
  const s = service(f.core, b.owner);
  try { await expect(s.inspect(f.input)).rejects.toThrow('Close failed'); expect(b.owner).toHaveBeenCalledOnce(); expect(b.release).not.toHaveBeenCalled(); expect((await f.core.getTask(f.taskId)).session?.runs[0].operations[0].status).toBe('uncertain'); }
  finally { s.close(); await f.cleanup(); }
});

it('fails before creating a page when inspection browser identity is unavailable', async () => {
  const f = await fixture(), b = browserFixture({ missingOwner: true });
  external.dialog.mockReset().mockResolvedValue({ response: 1 }); external.launch.mockReset().mockResolvedValue(b.browser);
  const s = service(f.core, b.owner);
  try { await expect(s.inspect(f.input)).rejects.toThrow('browser process identity'); expect(b.owner).not.toHaveBeenCalled(); expect(b.browser.newContext).not.toHaveBeenCalled(); expect(b.browser.close).toHaveBeenCalledOnce(); }
  finally { s.close(); await f.cleanup(); }
});

it('keeps direct reconciliation callers compatible without an owner callback', async () => {
  const f = await fixture(), b = browserFixture(); external.launch.mockReset().mockResolvedValue(b.browser);
  try { const result = await new BrowserReconciliation(f.core).inspect(f.input); expect(result.observation.text).toBe('Receipt'); expect(b.browser.newBrowserCDPSession).not.toHaveBeenCalled(); expect(b.browser.close).toHaveBeenCalledOnce(); }
  finally { await f.cleanup(); }
});

it('closes a late inspection launch after service stop before registering or opening a page', async () => {
  const f = await fixture(), b = browserFixture(); let finish!: (browser: unknown) => void, started!: () => void;
  const launchStarted = new Promise<void>(resolve => { started = resolve; });
  external.dialog.mockReset().mockResolvedValue({ response: 1 });
  external.launch.mockReset().mockImplementation(() => { started(); return new Promise(resolve => { finish = resolve; }); });
  const s = service(f.core, b.owner);
  try { const pending = s.inspect(f.input); await launchStarted; s.close(); finish(b.browser); await expect(pending).rejects.toThrow('stopped before opening a page'); expect(b.browser.close).toHaveBeenCalledOnce(); expect(b.owner).not.toHaveBeenCalled(); expect(b.browser.newContext).not.toHaveBeenCalled(); }
  finally { s.close(); await f.cleanup(); }
});
