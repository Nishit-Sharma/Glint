import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { CodexProvider } from '../src/host/codex-provider';
import type { SourceVersion } from '../src/core/types';

// Explicit opt-in only. These requests contain synthetic values, never user windows or files.
describe.skipIf(process.env.RUN_CODEX_LIVE !== '1')('Codex existing connection — live synthetic proof', () => {
  it('generates, revises and stops a streamed synthetic answer using Luna Fast', async () => {
    const adapter = new CodexProvider({ allowUserInstructionFile: true });
    const evidence: Record<string, unknown> = { checkedAt: new Date().toISOString(), evidenceClass: 'live-synthetic-existing-codex-connection', authenticationFilesRead: false, credentialsCopied: false, permissionsChanged: false, probes: [] };
    const probes = evidence.probes as Record<string, unknown>[];
    try {
      const status = await adapter.status();
      evidence.connection = { configured: status.configured, model: status.model, tier: status.tier, reasoning: status.reasoning, detail: status.detail };
      expect(status.configured, status.detail).toBe(true);
      const source: SourceVersion = { id: 'synthetic-counts', version: 1, digest: 'synthetic-probe', capturedAt: new Date().toISOString(), kind: 'text', role: 'fact', label: 'Synthetic inventory', content: 'Red cubes: 17. Blue cubes: 25. All values are synthetic.' };
      const chunks: string[] = [];
      const answer = await adapter.run({ prompt: 'Create a one-sentence inventory summary stating the total cube count. Cite the source ID and version.', sources: [source], signal: new AbortController().signal, onChunk: text => chunks.push(text) });
      probes.push({ kind: 'generation-and-stream', response: answer, streamedChunks: chunks.length, execution: adapter.lastRun });
      expect(answer).toContain('42');
      expect(chunks.length).toBeGreaterThan(0);
      expect(adapter.lastRun?.resolvedModel).toBe('gpt-6-luna');
      expect(adapter.lastRun?.acceptedTier).toBe('priority');
      expect(adapter.lastRun?.toolsObserved).toBe(0);
      const revision = await adapter.run({ prompt: 'Revise the summary to use the updated blue count. State the new total and preserve the red count. One sentence only.', sources: [{ ...source, version: 2, digest: 'synthetic-probe-v2', content: 'Red cubes: 17. Blue cubes: 30. All values are synthetic.' }, { ...source, id: 'synthetic-draft', kind: 'text', label: 'Prior draft', content: answer }], signal: new AbortController().signal });
      probes.push({ kind: 'revision', response: revision, execution: adapter.lastRun });
      expect(revision).toContain('47');
      const controller = new AbortController();
      let partial = '';
      await expect(adapter.run({ prompt: 'Write a numbered list of 600 short synthetic classroom inventory examples, one per line. Continue to all 600.', sources: [], signal: controller.signal, onChunk: text => { partial += text; if (partial.length > 100) controller.abort(); } })).rejects.toMatchObject({ code: 'CANCELLED' });
      probes.push({ kind: 'mid-stream-stop', partialCharacters: partial.length, execution: adapter.lastRun, remoteBillingOrCompletionVerified: false });
      expect(partial.length).toBeGreaterThan(100);
      expect(adapter.lastRun?.status).toBe('cancelled');
      evidence.outcome = 'passed';
    } catch (error) {
      evidence.outcome = 'failed'; evidence.error = error instanceof Error ? error.message : 'Unknown probe failure';
      throw error;
    } finally {
      adapter.close();
      await mkdir('evidence', { recursive: true });
      await writeFile('evidence/provider-codex-live.json', JSON.stringify(evidence, null, 2));
    }
  }, 180_000);
});
