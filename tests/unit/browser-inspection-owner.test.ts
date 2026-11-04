import { it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCompanion } from '../../src/core/companion';
import { emptyTaskSession } from '../../src/core/task-session';
import { BrowserService } from '../../src/host/browser/service';
import { BrowserReconciliation } from '../../src/host/browser/reconciliation';
import { BrowserInspectionAttempts } from '../../src/host/browser/inspection-attempts';
import {LOOPBACK_FIXTURE_ARGS,LOOPBACK_FIXTURE_EXECUTABLE,installLoopbackTestEngine} from '../support/loopback-browser.fixture';
installLoopbackTestEngine();

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
  return new BrowserService(core, { panel: () => ({}) as never, route: () => ({ key: 'fixture', provider: { accountScope:async()=> 'synthetic-account', status: vi.fn(), run: vi.fn() } }), changed: () => {}, progress: () => {}, onWindowOwner: owner });
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
    expect(external.launch).toHaveBeenCalledWith({ executablePath: LOOPBACK_FIXTURE_EXECUTABLE, headless: true, chromiumSandbox: true, args: LOOPBACK_FIXTURE_ARGS });
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
  try { const pending = s.inspect(f.input); await launchStarted; s.close(); finish(b.browser); await expect(pending).rejects.toThrow('Browser inspection stopped.'); await expect.poll(()=>b.browser.close.mock.calls.length).toBe(1); expect(b.owner).not.toHaveBeenCalled(); expect(b.browser.newContext).not.toHaveBeenCalled(); }
  finally { s.close(); await f.cleanup(); }
});

it('a stopped inspection ignores a late outcome decision and leaves the action uncertain', async () => {
  const f = await fixture(), b = browserFixture(), abort = new AbortController();
  let decide!: (value: {response:number}) => void, reviewing!: () => void;
  const reviewStarted = new Promise<void>(resolve => { reviewing = resolve; });
  external.dialog.mockReset().mockResolvedValueOnce({response:1}).mockImplementationOnce(() => { reviewing(); return new Promise(resolve => { decide = resolve; }); });
  external.launch.mockReset().mockResolvedValue(b.browser);
  const s = service(f.core, b.owner), pending = s.inspect(f.input, {signal:abort.signal,beginCommit:()=>{if(abort.signal.aborted)throw Error('Browser inspection stopped.');}});
  try {
    await reviewStarted; abort.abort();
    await expect(pending).rejects.toThrow('Browser inspection stopped.'); decide({response:1});
    const operation=(await f.core.getTask(f.taskId)).session?.runs[0].operations[0];
    expect(operation?.status).toBe('uncertain');expect(operation?.reconciliation).toBeUndefined();
  } finally { s.close(); await f.cleanup(); }
});


it('stops while consent is pending and ignores a late approval',async()=>{
 const f=await fixture(),abort=new AbortController();let approve!:(value:{response:number})=>void,entered!:()=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;});
 external.dialog.mockReset().mockImplementationOnce(()=>{entered();return new Promise(resolve=>{approve=resolve;});});external.launch.mockReset();
 const s=service(f.core),pending=s.inspect(f.input,{signal:abort.signal,beginCommit:()=>{throw Error('unexpected commit');}});
 try{await started;abort.abort();await expect(pending).rejects.toThrow('Browser inspection stopped.');approve({response:1});await Promise.resolve();expect(external.launch).not.toHaveBeenCalled();expect((await f.core.getTask(f.taskId)).session?.runs[0].operations[0].status).toBe('uncertain');}
 finally{s.close();await f.cleanup();}
});

it('stops while a browser launch is pending and closes its late owned handle',async()=>{
 const f=await fixture(),b=browserFixture(),abort=new AbortController();let finish!:(browser:unknown)=>void,entered!:()=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;});external.dialog.mockReset().mockResolvedValue({response:1});external.launch.mockReset().mockImplementation(()=>{entered();return new Promise(resolve=>{finish=resolve;});});
 const s=service(f.core,b.owner),pending=s.inspect(f.input,{signal:abort.signal,beginCommit:()=>{throw Error('unexpected commit');}});
 try{await started;abort.abort();await expect(pending).rejects.toThrow('Browser inspection stopped.');finish(b.browser);await expect.poll(()=>b.browser.close.mock.calls.length).toBe(1);expect(b.owner).not.toHaveBeenCalled();expect(b.browser.newContext).not.toHaveBeenCalled();expect((await f.core.getTask(f.taskId)).session?.runs[0].operations[0].status).toBe('uncertain');}
 finally{s.close();await f.cleanup();}
});

it('reports a review as finishing once its store commit has started',async()=>{
 const f=await fixture(),b=browserFixture(),attempts=new BrowserInspectionAttempts(),scope={taskId:f.taskId,runId:'old',operationId:'action',attemptId:'commit'},attempt=attempts.begin(scope);
 let release!:()=>void,entered!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
 const replace=f.core.replaceSession.bind(f.core),spy=vi.spyOn(f.core,'replaceSession').mockImplementation(async(...args)=>{entered();await waiting;return replace(...args);});
 external.dialog.mockReset().mockResolvedValueOnce({response:1}).mockResolvedValueOnce({response:1});external.launch.mockReset().mockResolvedValue(b.browser);
 const s=service(f.core,b.owner),pending=s.inspect(f.input,attempt);
 try{await started;expect(attempts.stop(scope)).toEqual({kind:'finishing'});expect(attempt.signal.aborted).toBe(false);release();await pending;expect((await f.core.getTask(f.taskId)).session?.runs[0].operations[0].status).toBe('observed');}
 finally{release();spy.mockRestore();attempt.finish();s.close();await f.cleanup();}
});

it.each(['declined-consent','after-review'] as const)('Stop settles while the %s task-store read is held',async phase=>{
 const f=await fixture(),b=browserFixture(),attempts=new BrowserInspectionAttempts(),scope={taskId:f.taskId,runId:'old',operationId:'action',attemptId:'held-read'},attempt=attempts.begin(scope);
 let release!:()=>void,entered!:()=>void,finished!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;}),readFinished=new Promise<void>(resolve=>{finished=resolve;});
 const get=f.core.getTask.bind(f.core),replace=vi.spyOn(f.core,'replaceSession');let reads=0;
 const spy=vi.spyOn(f.core,'getTask').mockImplementation(async taskId=>{reads++;if(reads===(phase==='declined-consent'?1:4)){entered();await waiting;const result=await get(taskId);finished();return result;}return get(taskId);});
 external.dialog.mockReset();if(phase==='declined-consent')external.dialog.mockResolvedValueOnce({response:0});else external.dialog.mockResolvedValueOnce({response:1}).mockResolvedValueOnce({response:1});external.launch.mockReset().mockResolvedValue(b.browser);
 const s=service(f.core,b.owner),pending=s.inspect(f.input,attempt),outcome=pending.then(()=> 'resolved',error=>error instanceof Error?error.message:String(error));
 try{
  await started;expect(attempts.stop(scope)).toEqual({kind:'stopped'});
  const prompt=await Promise.race([outcome,new Promise<string>(resolve=>setTimeout(()=>resolve('still pending'),100))]);
  expect(prompt).toBe('Browser inspection stopped.');
  release();await readFinished;await Promise.resolve();await outcome;expect(replace).not.toHaveBeenCalled();
  const action=(await get(f.taskId)).session?.runs[0].operations[0];expect(action?.status).toBe('uncertain');expect(action?.reconciliation).toBeUndefined();
 }finally{release();await outcome;spy.mockRestore();replace.mockRestore();attempt.finish();s.close();await f.cleanup();}
});


it('reports finishing while the post-commit task read is still pending',async()=>{
 const f=await fixture(),b=browserFixture(),attempts=new BrowserInspectionAttempts(),scope={taskId:f.taskId,runId:'old',operationId:'action',attemptId:'after-commit'},attempt=attempts.begin(scope);
 let release!:()=>void,entered!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});const get=f.core.getTask.bind(f.core);let reads=0;
 const spy=vi.spyOn(f.core,'getTask').mockImplementation(async taskId=>{reads++;if(reads===5){entered();await waiting;}return get(taskId);});
 external.dialog.mockReset().mockResolvedValueOnce({response:1}).mockResolvedValueOnce({response:1});external.launch.mockReset().mockResolvedValue(b.browser);
 const s=service(f.core,b.owner),pending=s.inspect(f.input,attempt);
 try{await started;expect(attempts.stop(scope)).toEqual({kind:'finishing'});expect(attempt.signal.aborted).toBe(false);release();const result=await pending;expect(result.session?.runs[0].operations[0].status).toBe('observed');}
 finally{release();await pending.catch(()=>{});spy.mockRestore();attempt.finish();s.close();await f.cleanup();}
});
