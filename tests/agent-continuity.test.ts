import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createCompanion } from '../src/core/companion';
import { emptyTaskSession } from '../src/core/task-session';

it('preserves conversation, user draft and uncertain tool work in the same store across restart', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'companion-continuity-proof-'));
  let core = await createCompanion({ dataDir });
  try {
    const task = await core.createTask({ title: 'Synthetic hike' });
    await core.runRequest({ taskId: task.id, requestId: 'first-turn', kind: 'explain', prompt: 'Our budget is 50 dollars.', sourceIds: [] }, async () => ({ title: 'Budget', content: 'The budget is $50.' }));
    const observation = { id: 'snapshot', taskId: task.id, browserId: 'isolated-browser', documentId: 'document', url: 'http://127.0.0.1:1234', title: 'Trip', text: 'Synthetic trip', digest: 'digest', targets: [] };
    await core.replaceSession(task.id, 0, { ...emptyTaskSession(), draft: 'Compare the lighter option', runs: [{ id: 'browser-run', endpointKey: 'codex-luna-standard-v1', browserId: 'isolated-browser', origin: 'http://127.0.0.1:1234', initialObservation: observation, operations: [{ id: 'submit', intent: { kind: 'click', snapshotId: 'snapshot', targetId: 'button' }, reason: 'Submit the exact reviewed trip', status: 'executing' }, { id: 'unused', intent: { kind: 'click', snapshotId: 'snapshot', targetId: 'link' }, reason: 'Read details', status: 'proposed' }] }] });
    await core.close(); core = await createCompanion({ dataDir });
    const restored = await core.getTask(task.id);
    expect(restored.requests[0]?.prompt).toBe('Our budget is 50 dollars.');
    expect(restored.session?.draft).toBe('Compare the lighter option');
    expect(restored.session?.runs[0]?.operations.map(operation => operation.status)).toEqual(['uncertain', 'retired']);
    await expect(core.replaceSession(task.id, 0, emptyTaskSession())).rejects.toThrow('changed');
    expect(JSON.parse(await readFile(join(dataDir, 'tasks.json'), 'utf8')).schemaVersion).toBe(2);
  } finally { await core.close(); await rm(dataDir, { recursive: true, force: true }); }
});

it('migrates a known v1 store and preserves an unfamiliar store byte for byte', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'companion-migration-proof-'));
  try {
    await writeFile(join(dataDir, 'tasks.json'), JSON.stringify({ schemaVersion: 1, tasks: [], usedRequestIds: [] }));
    const core = await createCompanion({ dataDir }); await core.close();
    expect(JSON.parse(await readFile(join(dataDir, 'tasks.json'), 'utf8')).schemaVersion).toBe(2);
    const unknown = JSON.stringify({ schemaVersion: 900, tasks: [], importantFutureData: 'preserve' });
    await writeFile(join(dataDir, 'tasks.json'), unknown);
    await expect(createCompanion({ dataDir })).rejects.toThrow('incompatible');
    expect(await readFile(join(dataDir, 'tasks.json'), 'utf8')).toBe(unknown);
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});
