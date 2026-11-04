import { expect, it } from 'vitest';
import { CodexProvider, type CodexConnection } from '../../src/host/codex-provider';

it.each(['companion','browser-planner'] as const)('uses explicit Standard with distinct host-owned purpose (%s)', async purpose => {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const listeners = new Set<(value: { method: string; params: Record<string, any> }) => void>();
  const connection: CodexConnection = {
    async request(method, params) {
      calls.push({ method, params });
      if (method === 'initialize') return {};
      if (method === 'account/read') return { account: { type: 'chatgpt' } };
      if (method === 'model/list') return { data: [{ model: 'gpt-6-luna', defaultServiceTier: null, serviceTiers: [{ id: 'priority', name: 'Fast' }], supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] }] };
      if (method === 'thread/start') return { thread: { id: 'synthetic-standard' }, model: 'gpt-6-luna', serviceTier: params.serviceTier, reasoningEffort: 'medium', sandbox: { type: 'readOnly' } };
      if (method === 'turn/start') {
        queueMicrotask(() => {
          for (const listener of listeners) {
            listener({ method: 'item/completed', params: { item: { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: 'Synthetic standard answer' } } });
            listener({ method: 'turn/completed', params: { turn: { id: 'turn', status: 'completed' } } });
          }
        }); return { turn: { id: 'turn' } };
      }
      return {};
    },
    notify() {}, close() {}, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const provider = new CodexProvider({ serviceTier: 'default', purpose, connect: async () => connection });
  expect(await provider.run({ prompt: 'Synthetic standard request', sources: [], signal: new AbortController().signal })).toBe('Synthetic standard answer');
  expect(calls.find(call => call.method === 'thread/start')?.params.serviceTier).toBe('default');
  expect(calls.find(call => call.method === 'turn/start')?.params.serviceTierForTurn).toBe('default');
  const start=calls.find(call=>call.method==='thread/start')!.params;
  if(purpose==='browser-planner'){expect(start.baseInstructions).toContain('host-owned browser');expect(start.baseInstructions).toContain('JSON proposal');}else {expect(start.baseInstructions).toContain('raw JSON without Markdown fences for a structured JSON protocol');expect(start.baseInstructions).toContain('editable Markdown for ordinary text');}
  expect(start.dynamicTools).toEqual([]);expect(start.sandbox).toBe('read-only');
  expect(provider.lastRun?.acceptedTier).toBe('default');
  expect((await provider.status()).tier).toBe('Standard');
});
