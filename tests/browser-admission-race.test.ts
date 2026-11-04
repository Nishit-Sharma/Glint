import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createCompanion } from '../src/core/companion';
import { BrowserCoordinator, type BrowserPlanner } from '../src/host/browser/coordinator';
import {installLoopbackTestEngine} from './loopback-browser.fixture';
installLoopbackTestEngine();

async function bounded(promise: Promise<void>, label: string): Promise<void> {
 let timer: ReturnType<typeof setTimeout> | undefined;
 try { await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(`Timed out closing ${label}`)), 5_000); })]); }
 finally { if (timer) clearTimeout(timer); }
}

it('rejects a same-task write at session commit and a fresh attempt after its first write becomes uncertain', async () => {
 let commits = 0;
 let dataDir: string | undefined, core: Awaited<ReturnType<typeof createCompanion>> | undefined;
 const server = createServer((request, response) => {
  response.setHeader('content-type', 'text/html');
  if (request.method === 'POST') {
   commits++;
   if (commits === 1) { request.socket.destroy(); return; }
   response.end('<h1>Saved twice</h1>'); return;
  }
  response.end('<form method="post" action="/save"><button>Save</button></form>');
 });
 try {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing owned site address');
  const origin = `http://127.0.0.1:${address.port}`;
  dataDir = await mkdtemp(join(tmpdir(), 'browser-admission-race-'));
  const ownedCore = await createCompanion({dataDir}); core = ownedCore;
  const task = await ownedCore.createTask({title:'Concurrent owned writes'});
  const planner: BrowserPlanner = {endpointKey:'fixture',async plan(input){
   const target = input.observation.targets.find(item => item.label === 'Save');
   return target ? {kind:'action',reason:'Save the owned item',action:{kind:'click',targetId:target.id,expectedFields:[]}} : {kind:'answer',markdown:'The owned receipt was observed.',modules:[]};
  }};
  const run = (requestId:string) => new BrowserCoordinator(ownedCore,planner).run({taskId:task.id,requestId,goal:'Save once',origin,url:origin,transmissionApproved:true,approveAction:async current=>({approved:true,write:current.review.write})});
  const replace = ownedCore.replaceSession.bind(ownedCore);
  let barrierUsed = false;
  const spy = vi.spyOn(ownedCore,'replaceSession').mockImplementation(async (taskId, revision, next, guard) => {
   const first = next.runs.find(run => run.id === 'first');
   if (!barrierUsed && first?.operations.some(operation => operation.status === 'executing')) {
    barrierUsed = true;
    await expect(run('second')).rejects.toThrow('Wait for the current task response to finish or stop.');
    const current = await ownedCore.getTask(task.id);
    expect(current.requests.some(request => request.id === 'second')).toBe(false);
    expect(current.session?.runs.some(run => run.id === 'second')).toBe(false);
    expect(commits).toBe(0);
   }
   return replace(taskId, revision, next, guard);
  });
  const first = await run('first');
  spy.mockRestore();
  expect(barrierUsed).toBe(true);
  expect(commits).toBe(1);
  expect(first.status).toBe('failed');
  expect(first.error).toContain('uncertain outcome');
  const before = await ownedCore.getTask(task.id), third = await run('third');
  expect(before.session?.runs[0].operations[0].status).toBe('uncertain');
  expect(third.status).toBe('failed');
  expect(third.error).toContain('uncertain outcome');
  expect((await ownedCore.getTask(task.id)).session?.runs).toEqual(before.session?.runs);
  expect(commits).toBe(1);
 } finally {
  vi.restoreAllMocks();
  let coreClosed = !core;
  try { if (core) { await bounded(core.close(), 'the task store'); coreClosed = true; } }
  finally {
   try { if (server.listening) { server.closeAllConnections(); await bounded(new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())), 'the owned site'); } }
   finally { if (dataDir && coreClosed) await rm(dataDir,{recursive:true,force:true}); }
  }
 }
}, 30_000);
