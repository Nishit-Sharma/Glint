import { fork, type ChildProcess } from 'node:child_process';
import { on } from 'node:events';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Companion } from '../src/core/companion';

vi.mock('node:fs/promises', { spy: true });
const real = await vi.importActual<typeof fs>('node:fs/promises');
let root: string, harness: string, bundleRoot: string;
const children: { child: ChildProcess; exited: Promise<void> }[] = [];
const opened: Companion[] = [];
const deadOwner = JSON.stringify({ pid: 2_147_483_647, token: 'synthetic-dead-owner' });

beforeAll(async () => {
  bundleRoot = await real.mkdtemp(join(tmpdir(), 'companion-lock-harness-'));
  const entry = join(bundleRoot, 'core.cjs');
  await build({ entryPoints: [resolve('src/core/companion.ts')], outfile: entry, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  harness = join(bundleRoot, 'worker.cjs');
  await real.writeFile(harness, `
    const fs = require('node:fs/promises');
    const { join } = require('node:path');
    const lock = join(process.argv[2], 'store.lock');
    const originalRm = fs.rm;
    let core, releaseRemoval, paused = false;
    fs.rm = async (...args) => {
      if (process.argv[3] === 'pause' && args[0] === lock && !core && !paused) {
        paused = true;
        process.send({ type: 'before-remove' });
        await new Promise(resolve => { releaseRemoval = resolve; });
      }
      return originalRm(...args);
    };
    const { Companion } = require('./core.cjs');
    process.on('message', async message => {
      try {
        if (message.command === 'open') {
          try { core = await Companion.open({ dataDir: process.argv[2] }); process.send({ type: 'opened' }); }
          catch (error) { process.send({ type: 'rejected', code: error.code, message: error.message }); }
        } else if (message.command === 'release-removal') releaseRemoval?.();
        else if (message.command === 'create') {
          await core.createTask({ title: message.title }); process.send({ type: 'committed', title: message.title });
        } else if (message.command === 'close') {
          await core.close(); process.send({ type: 'closed' });
        }
      } catch (error) { process.send({ type: 'failed', message: error.stack }); }
    });
    process.send({ type: 'ready' });
  `);
});
beforeEach(async () => { root = await real.mkdtemp(join(tmpdir(), 'companion-lock-test-')); });
afterEach(async () => {
  vi.restoreAllMocks();
  for (const owner of opened.splice(0)) await owner.close().catch(() => undefined);
  for (const worker of children) worker.child.kill('SIGKILL');
  await Promise.all(children.splice(0).map(worker => worker.exited));
  await real.rm(root, { recursive: true, force: true });
});
afterAll(async () => { await real.rm(bundleRoot, { recursive: true, force: true }); });

function worker(pauseRemoval = false) {
  const child = fork(harness, [root, pauseRemoval ? 'pause' : 'normal'], { silent: true, env: {} });
  const messages = on(child, 'message');
  let stderr = '';
  child.stderr?.on('data', chunk => { stderr += chunk; });
  const exited = new Promise<void>(done => child.once('exit', () => done()));
  children.push({ child, exited });
  return {
    child,
    exited,
    send: (command: string, title?: string) => { child.send({ command, title }); },
    next: () => Promise.race([
      messages.next().then(event => event.value![0] as { type: string; code?: string; title?: string; message?: string }),
      exited.then((): never => { throw new Error(`Lock worker exited unexpectedly: ${stderr}`); }),
    ]),
  };
}
async function openHere() { const core = await Companion.open({ dataDir: root }); opened.push(core); return core; }
async function durableTitles() {
  const state = JSON.parse(await real.readFile(join(root, 'tasks.json'), 'utf8'));
  return state.tasks.map((task: { title: string }) => task.title);
}

it('admits one process during simultaneous stale recovery and preserves every acknowledged task', async () => {
  await real.writeFile(join(root, 'store.lock'), deadOwner);
  const contenders = [worker(true), worker(true)];
  await Promise.all(contenders.map(async contender => { expect(await contender.next()).toMatchObject({ type: 'ready' }); }));
  // Both opens start together; hold the first unlink so the other sees the stale lock.
  contenders.forEach(contender => contender.send('open'));
  const boundaries = await Promise.all(contenders.map(contender => contender.next()));
  expect(boundaries.map(event => event.type)).toContain('before-remove');
  const owners: ReturnType<typeof worker>[] = [];
  for (let index = 0; index < contenders.length; index++) {
    const event = boundaries[index]!;
    if (event.type === 'before-remove') {
      // Resume the second unlink only after the first process owns the replacement lock.
      contenders[index]!.send('release-removal');
      expect(await contenders[index]!.next()).toMatchObject({ type: 'opened' });
      owners.push(contenders[index]!);
    } else expect(event).toMatchObject({ type: 'rejected', code: 'busy' });
  }
  const committed = [];
  for (let index = 0; index < owners.length; index++) {
    const title = `Acknowledged task ${index + 1}`;
    owners[index]!.send('create', title);
    expect(await owners[index]!.next()).toMatchObject({ type: 'committed', title });
    committed.push(title);
  }
  expect(await durableTitles()).toEqual(committed);
  expect(owners).toHaveLength(1);
  owners[0]!.send('close'); expect(await owners[0]!.next()).toMatchObject({ type: 'closed' });
  const successor = contenders.find(contender => contender !== owners[0])!;
  successor.send('open'); expect(await successor.next()).toMatchObject({ type: 'opened' });
  successor.send('create', 'Acknowledged after handoff'); expect(await successor.next()).toMatchObject({ type: 'committed' });
  successor.send('close'); expect(await successor.next()).toMatchObject({ type: 'closed' });
  expect(await durableTitles()).toEqual([...committed, 'Acknowledged after handoff']);
  expect((await (await openHere()).listTasks()).map(task => task.title)).toEqual([...committed, 'Acknowledged after handoff']);
});

it('does not unlink a normal claimant that wins the stale-recovery gap', async () => {
  const lock = join(root, 'store.lock');
  await real.writeFile(lock, deadOwner);
  let removed!: () => void, resume!: () => void;
  const gap = new Promise<void>(done => { removed = done; });
  const proceed = new Promise<void>(done => { resume = done; });
  const spy = vi.spyOn(fs, 'rm').mockImplementation(async (...args) => {
    await real.rm(...args);
    if (args[0] === lock) { removed(); await proceed; }
  });
  const recovering = Companion.open({ dataDir: root }).then(core => { opened.push(core); return core; });
  // Observe rejection immediately, before deliberately suspending its final claim.
  const outcome = recovering.then(() => 'opened', error => error.code as string);
  await gap;
  const normal = await openHere();
  const ownerBytes = await real.readFile(lock, 'utf8');
  resume();
  expect(await outcome).toBe('busy');
  spy.mockRestore();
  expect(await real.readFile(lock, 'utf8')).toBe(ownerBytes);
  await normal.createTask({ title: 'Normal claimant commit' });
  await expect(Companion.open({ dataDir: root })).rejects.toMatchObject({ code: 'busy' });
  await normal.close();
  expect((await (await openHere()).listTasks()).map(task => task.title)).toEqual(['Normal claimant commit']);
});

it('recovers after an actual owner process exits and retains its committed ledger', async () => {
  const crashed = worker();
  expect(await crashed.next()).toMatchObject({ type: 'ready' });
  crashed.send('open'); expect(await crashed.next()).toMatchObject({ type: 'opened' });
  crashed.send('create', 'Committed before crash'); expect(await crashed.next()).toMatchObject({ type: 'committed' });
  crashed.child.kill('SIGKILL'); await crashed.exited;
  const recovered = await openHere();
  expect((await recovered.listTasks()).map(task => task.title)).toEqual(['Committed before crash']);
  await recovered.createTask({ title: 'Committed after recovery' });
  await recovered.close();
  expect((await (await openHere()).listTasks()).map(task => task.title)).toEqual(['Committed before crash', 'Committed after recovery']);
});

it('preserves an abandoned recovery guard after its owning process crashes', async () => {
  await real.writeFile(join(root, 'store.lock'), deadOwner);
  const recovering = worker(true);
  expect(await recovering.next()).toMatchObject({ type: 'ready' });
  recovering.send('open'); expect(await recovering.next()).toMatchObject({ type: 'before-remove' });
  const guardPath = join(root, 'store.lock.recovery');
  const guard = await real.readFile(guardPath, 'utf8');
  expect(JSON.parse(guard)).toMatchObject({ pid: recovering.child.pid, token: expect.any(String) });
  recovering.child.kill('SIGKILL'); await recovering.exited;
  await expect(Companion.open({ dataDir: root })).rejects.toMatchObject({ code: 'busy' });
  expect(await real.readFile(join(root, 'store.lock'), 'utf8')).toBe(deadOwner);
  expect(await real.readFile(guardPath, 'utf8')).toBe(guard);
});

it.each(['unreadable guard', 'dead guard', 'live guard'])('fails closed on an existing %s without recursively reclaiming it', async label => {
  const guard = label === 'unreadable guard' ? '' : JSON.stringify({ pid: label === 'live guard' ? process.pid : 2_147_483_647, token: 'synthetic-guard' });
  await real.writeFile(join(root, 'store.lock'), deadOwner);
  await real.writeFile(join(root, 'store.lock.recovery'), guard);
  await expect(Companion.open({ dataDir: root })).rejects.toMatchObject({ code: 'busy' });
  expect(await real.readFile(join(root, 'store.lock'), 'utf8')).toBe(deadOwner);
  expect(await real.readFile(join(root, 'store.lock.recovery'), 'utf8')).toBe(guard);
});
