import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it,vi} from 'vitest';
import { createCompanion } from '../../src/core/companion';
import { BrowserCoordinator } from '../../src/host/browser/coordinator';
import { BrowserReconciliation } from '../../src/host/browser/reconciliation';
import {installLoopbackTestEngine} from '../support/loopback-browser.fixture';
installLoopbackTestEngine();

it.each(['source','detach'] as const)('a %s context switch persists and late browser observations cannot restore old routing',async change=>{
 const server=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(req.url==='/next'?'<h1>Observed next page</h1>':'<h1>Owned page</h1><a href="/next">Next page</a>');});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('Missing port');
 const origin=`http://127.0.0.1:${address.port}`,dataDir=await mkdtemp(join(tmpdir(),'companion-context-switch-'));let core=await createCompanion({dataDir});
 try{
  const task=await core.createTask({title:'Context ownership'});let turn=0;
  const coordinator=new BrowserCoordinator(core,{endpointKey:'fixture',async plan(input){
   if(turn++===0){
    if(change==='source')await core.putSource(task.id,{kind:'text',role:'fact',label:'New explicit context',content:'Use this new context.'});else await core.clearBrowserContext(task.id);
    return {kind:'action',reason:'Finish the already authorized read',action:{kind:'click',targetId:input.observation.targets[0]!.id}};
   }
   return {kind:'answer',markdown:'The earlier browser result is retained.',modules:[]};
  }});
  expect((await coordinator.run({taskId:task.id,requestId:'old-browser',goal:'Read a page',origin,url:origin,transmissionApproved:true,approveAction:async()=>({approved:true})})).status).toBe('completed');
  expect((await core.getTask(task.id)).session?.browserContext).toBeUndefined();
  await core.close();core=await createCompanion({dataDir});const restored=await core.getTask(task.id);
  expect(restored.session?.browserContext).toBeUndefined();expect(restored.session?.runs[0]?.operations[0]?.status).toBe('observed');expect(restored.artifacts).toHaveLength(1);
 }finally{await core.close();await rm(dataDir,{recursive:true,force:true});await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

it('carries real browser observations and prior conversation through a host-owned run, then restores them', async () => {
  const server = createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(req.url === '/details' ? '<h1>Ridge filter</h1><p>Price $45. Weight 90 g.</p>' : '<h1>Filters</h1><a href="/details">Ridge details</a>'); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing site port');
  const origin = `http://127.0.0.1:${address.port}`, dataDir = await mkdtemp(join(tmpdir(), 'companion-run-proof-'));
  let core = await createCompanion({ dataDir });
  try {
    const task = await core.createTask({ title: 'Synthetic filter search' });
    await core.runRequest({ taskId: task.id, requestId: 'budget', kind: 'explain', prompt: 'Keep the price below $50.', sourceIds: [] }, async () => ({ title: 'Budget', content: 'Your limit is $50.' }));
    const seen: string[] = [];
    const coordinator = new BrowserCoordinator(core, { endpointKey: 'scripted-planner-fixture', async plan(input) {
      seen.push(input.context);
      const target = input.observation.targets.find(item => item.label === 'Ridge details');
      return target ? { kind: 'action', reason: 'Read the named filter details.', action: { kind: 'click', targetId: target.id } } : { kind: 'answer', markdown: 'Ridge costs $45 and is within your $50 budget.', modules: [{ kind: 'plan', schemaVersion: 1, title: 'Day hike kit', purpose: 'Prepare the selected kit', items: [{ id: 'filter', title: 'Pack the Ridge filter', detail: '90 g; $45' }] }] };
    } });
    const result = await coordinator.run({ taskId: task.id, requestId: 'browse', goal: 'Find the filter details.', origin, url: origin, transmissionApproved: true, approveAction: async () => ({ approved: true }) });
    expect(result.status).toBe('completed');
    expect(seen[0]).toContain('Keep the price below $50.');
    expect(seen[1]).toContain('Price $45. Weight 90 g.');
    const completed = await core.getTask(task.id);
    expect(completed.session?.runs[0]?.operations[0]?.status).toBe('observed');
    expect(completed.artifacts.at(-1)?.revisions[0]?.content).toContain('Day hike kit');
    await core.close(); core = await createCompanion({ dataDir });
    const restored = await core.getTask(task.id);
    expect(restored.requests.at(-1)?.status).toBe('completed');
    expect(restored.session?.runs[0]?.operations[0]?.result?.text).toContain('Weight 90 g.');
    expect(restored.artifacts.at(-1)?.revisions[0]?.content).toContain('Day hike kit');
  } finally { await core.close(); await rm(dataDir, { recursive: true, force: true }); await new Promise<void>(resolve => server.close(() => resolve())); }
});

it('cancels a real browser while approval is pending and ignores a late approval', async () => {
  const server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<h1>Test</h1><button>Submit</button>'); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing port');
  const origin = `http://127.0.0.1:${address.port}`, dataDir = await mkdtemp(join(tmpdir(), 'companion-cancel-proof-'));
  const core = await createCompanion({ dataDir });
  let approvalReady!: () => void, approveLate!: (value: { approved: true }) => void;
  const ready = new Promise<void>(resolve => { approvalReady = resolve; });
  try {
    const task = await core.createTask({ title: 'Approval cancellation' });
    const coordinator = new BrowserCoordinator(core, { endpointKey: 'fixture', async plan(input) { return { kind: 'action', reason: 'Synthetic approval test', action: { kind: 'click', targetId: input.observation.targets[0]!.id } }; } });
    const running = coordinator.run({ taskId: task.id, requestId: 'cancel-run', goal: 'Test cancellation', origin, url: origin, transmissionApproved: true, approveAction: async () => { approvalReady(); return new Promise(resolve => { approveLate = resolve; }); } });
    await ready;
    await core.cancelRequest(task.id, 'cancel-run');
    const result = await running;
    expect(result.status).toBe('cancelled');
    approveLate({ approved: true });
    expect((await core.getTask(task.id)).session?.runs[0]?.operations[0]?.status).toBe('retired');
  } finally { await core.close(); await rm(dataDir, { recursive: true, force: true }); await new Promise<void>(resolve => server.close(() => resolve())); }
});

it('keeps a successful website write uncertain when the host stops before acknowledgement and never auto-replays it', async () => {
  let commits = 0, initialGets = 0, wrote!: () => void;
  const committed = new Promise<void>(resolve => { wrote = resolve; });
  const server = createServer((req, res) => {
    if (req.method === 'POST') { commits++; wrote(); return; }
    if (req.url === '/receipt') { res.setHeader('content-type', 'text/html'); res.end('<h1>Recorded trip #1</h1><p>The synthetic trip was recorded once.</p>'); return; }
    initialGets++;
    res.setHeader('content-type', 'text/html'); res.end('<h1>Test receipt</h1><form action="/commit" method="post"><button>Submit</button></form>');
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing port');
  const origin = `http://127.0.0.1:${address.port}`, dataDir = await mkdtemp(join(tmpdir(), 'companion-crash-proof-'));
  let core = await createCompanion({ dataDir });
  try {
    const task = await core.createTask({ title: 'Uncertain write' });
    const planner = { endpointKey: 'fixture', async plan(input: Parameters<import('../../src/host/browser/coordinator').BrowserPlanner['plan']>[0]) { return { kind: 'action' as const, reason: 'Synthetic exact write', action: { kind: 'click' as const, targetId: input.observation.targets[0]!.id, expectedFields: [] } }; } };
    const coordinator = new BrowserCoordinator(core, planner);
    const running = coordinator.run({ taskId: task.id, requestId: 'interrupted-write', goal: 'Submit a synthetic receipt', origin, url: origin, transmissionApproved: true, approveAction: async () => ({ approved: true, write: { method: 'POST', url: `${origin}/commit`, body: '' } }) });
    const settled = running.then(() => 'resolved', () => 'rejected');
    await committed; await core.close(); await settled;
    core = await createCompanion({ dataDir });
    const restored = await core.getTask(task.id);
    expect(restored.requests.at(-1)?.status).toBe('interrupted');
    expect(restored.session?.runs[0]?.operations[0]?.status).toBe('uncertain');
    expect(commits).toBe(1);
    const beforeRetryGets=initialGets;
    let retryApprovals = 0;
    const retry = await new BrowserCoordinator(core, planner).run({ taskId: task.id, requestId: 'new-write', goal: 'Submit again', origin, url: origin, transmissionApproved: true, approveAction: async () => { retryApprovals++; return { approved: true, write: { method: 'POST', url: `${origin}/commit`, body: '' } }; } });
    expect(retry.status).toBe('failed'); expect(retry.error).toContain('uncertain outcome');
    expect(retryApprovals).toBe(0); expect(initialGets).toBe(beforeRetryGets);
    expect(commits).toBe(1);
    const review = new BrowserReconciliation(core), operation = restored.session?.runs[0]?.operations[0];
    if (!operation) throw Error('Missing durable action');
    await expect(review.resolve('invented', async () => ({ outcome: 'completed', note: 'Forged' }))).rejects.toThrow('Inspect');
    const inspection = await review.inspect({ taskId: task.id, runId: 'interrupted-write', operationId: operation.id, url: `${origin}/receipt` });
    await review.resolve(inspection.id, async current => { expect(current.observation.text).toContain('Recorded trip #1'); return { outcome: 'completed', note: 'The fresh receipt page shows trip #1 recorded once. This is a scripted test review, not a real user confirmation.' }; });
    await core.close(); core = await createCompanion({ dataDir });
    const reconciled = await core.getTask(task.id);
    expect(reconciled.session?.runs[0]?.operations[0]?.reconciliation?.outcome).toBe('completed');
    expect(reconciled.session?.runs[0]?.operations[0]?.status).toBe('observed');
    expect(commits).toBe(1);
  } finally { await core.close(); await rm(dataDir, { recursive: true, force: true }); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
