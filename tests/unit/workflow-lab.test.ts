import { describe, expect, test } from 'vitest';
import { workflowLab } from '../../src/learning/workflow-lab';
import { workflowExample } from '../../src/learning/workflow-example';

describe('finite workflow experiment', () => {
  test('keeps computed trace hidden until the prediction and checks a literal worked answer', () => {
    const initial = workflowLab.initial(workflowExample);
    expect(workflowLab.observe(workflowExample, initial).result).toBeNull();
    const reviewed = workflowLab.update(workflowExample, initial, { kind: 'predict', finalStateId: 'draft', blockedCount: 1, reasoning: 'Edit returns to Draft; approval there is blocked.', expectedRevision: 0 });
    const view = workflowLab.observe(workflowExample, reviewed);
    expect(view.result?.steps.map(step => [step.toStateId, step.status])).toEqual([['review', 'applied'], ['ready', 'applied'], ['draft', 'applied'], ['draft', 'blocked']]);
    expect(view.assessment?.score).toBe(2);
    expect(view.canStartTransfer).toBe(false);
  });
});

function act(state: ReturnType<typeof workflowLab.initial>, action: object) {
  return workflowLab.update(workflowExample, state, { ...action, expectedRevision: state.revision });
}
function changedPractice() {
  let state = workflowLab.initial(workflowExample);
  state = act(state, { kind: 'set-rule', ruleId: 'ready-edit', toStateId: 'review', enabled: true, reason: 'An edit should be reviewed again.' });
  return state;
}
function transferStarted() {
  let state = changedPractice();
  state = act(state, { kind: 'predict', finalStateId: 'ready', blockedCount: 0, reasoning: 'Review permits the final approval.' });
  return act(state, { kind: 'start-transfer' });
}

test('a guided rule change recomputes the full trace and explains changed steps after a checkable prediction', () => {
  let state = changedPractice();
  expect(workflowLab.observe(workflowExample, state).result).toBeNull();
  state = act(state, { kind: 'predict', finalStateId: 'draft', blockedCount: 1, reasoning: 'My initial guess.' });
  const view = workflowLab.observe(workflowExample, state);
  expect(view.result?.steps.map(step => [step.toStateId, step.status])).toEqual([['review', 'applied'], ['ready', 'applied'], ['review', 'applied'], ['ready', 'applied']]);
  expect(view.result?.blockedCount).toBe(0);
  expect(view.assessment?.score).toBe(0);
  expect(view.assessment?.correction).toContain('Step 4: Approve moves In review → Ready.');
  expect(view.change?.changedSteps.map(step => step.index)).toEqual([3, 4]);
  expect(view.change?.summary).toContain('Draft → Ready');
  expect(view.canStartTransfer).toBe(true);
  expect(view.ruleOrigins.find(origin => origin.ruleId === 'ready-edit')?.reason).toContain('back to Draft');
  expect(view.editNotes[0].reason).toBe('An edit should be reviewed again.');
});

test('transfer is withheld until a behavior-changing edit has been predicted and reviewed', () => {
  let state = workflowLab.initial(workflowExample);
  expect(workflowLab.text(workflowExample, state)).not.toMatch(/equipment|Available|Reserved|Collect|Checked out/);
  expect(JSON.stringify(workflowLab.observe(workflowExample, state))).not.toMatch(/equipment-checkout|available-reserve|reserved-collect/);
  expect(() => act(state, { kind: 'start-transfer' })).toThrow(/Change what happens/);
  state = act(state, { kind: 'predict', finalStateId: 'draft', blockedCount: 1, reasoning: '' });
  expect(() => act(state, { kind: 'start-transfer' })).toThrow(/Change what happens/);
  state = act(state, { kind: 'set-rule', ruleId: 'review-changes', toStateId: 'ready', enabled: true, reason: 'An unused-rule experiment.' });
  state = act(state, { kind: 'predict', finalStateId: 'draft', blockedCount: 1, reasoning: '' });
  expect(() => act(state, { kind: 'start-transfer' })).toThrow(/Change what happens/);
});

test('a distinct held-out workflow shows inputs before submission and retains its first answer across practice edits and restart', () => {
  let state = transferStarted();
  const pending = workflowLab.observe(workflowExample, state);
  expect(pending.origin).toBe('synthetic-transfer');
  expect(pending.problem.id).toBe('equipment-checkout');
  expect(pending.result).toBeNull();
  expect(workflowLab.text(workflowExample, state)).not.toContain('Final state: Available');
  expect(() => act(state, { kind: 'set-rule', ruleId: 'reserved-collect', toStateId: 'available', enabled: true, reason: 'Cannot change transfer.' })).toThrow(/cannot be edited/);
  state = act(state, { kind: 'predict', finalStateId: 'available', blockedCount: 1, reasoning: 'I missed one blocked collection.' });
  const submitted = workflowLab.observe(workflowExample, state);
  expect(submitted.result?.steps.map(step => [step.toStateId, step.status])).toEqual([['reserved', 'applied'], ['out', 'applied'], ['out', 'blocked'], ['available', 'applied'], ['available', 'blocked']]);
  expect(submitted.result?.blockedCount).toBe(2);
  expect(submitted.assessment?.score).toBe(1);
  expect(() => act(state, { kind: 'predict', finalStateId: 'available', blockedCount: 2, reasoning: 'Attempt overwrite.' })).toThrow(/not available/);
  state = act(state, { kind: 'return-practice' });
  state = act(state, { kind: 'set-rule', ruleId: 'ready-edit', toStateId: 'draft', enabled: true, reason: 'Return to the original rule.' });
  expect(workflowLab.observe(workflowExample, state).result).toBeNull();
  state = workflowLab.parseState(workflowExample, JSON.parse(JSON.stringify(state)));
  state = act(state, { kind: 'start-transfer' });
  const resumed = workflowLab.observe(workflowExample, state);
  expect(resumed.assessment?.score).toBe(1);
  expect(resumed.assessment?.predictedBlockedCount).toBe(1);
  expect(resumed.assessment?.reasoning).toBe('I missed one blocked collection.');
});

test('restored source-bound definitions cannot claim citations outside their exact reviewed refs', () => {
  const sourceRef = { sourceId: 'review-source', version: 1, digest: 'source-digest' };
  const cited = { ...workflowExample, basis: { kind: 'reviewed-source' as const, contextDigest: 'reviewed-v1', taskId: 'review-task', artifact: { artifactId: 'basis-artifact', revision: 1, digest: 'basis-digest' }, sourceRefs: [sourceRef] }, citations: [{ id: 'rule-citation', sourceRef: { ...sourceRef, version: 2 }, location: { kind: 'text-range' as const, start: 0, end: 4, quote: 'rule' } }], ruleOrigins: workflowExample.ruleOrigins.map(value => ({ ...value, citationId: 'rule-citation' })) };
  expect(() => workflowLab.parse(cited)).toThrow(/exact reviewed source/);
});

test('missing and disabled rules block an event without jumping to another state', () => {
  let state = workflowLab.initial(workflowExample);
  state = act(state, { kind: 'set-rule', ruleId: 'draft-submit', toStateId: 'review', enabled: false, reason: 'Try a disabled submission rule.' });
  state = act(state, { kind: 'predict', finalStateId: 'draft', blockedCount: 3, reasoning: '' });
  const view = workflowLab.observe(workflowExample, state);
  expect(view.result?.steps.map(step => [step.toStateId, step.status])).toEqual([['draft', 'blocked'], ['draft', 'blocked'], ['draft', 'applied'], ['draft', 'blocked']]);
  expect(view.assessment?.score).toBe(2);
});

test('editable start and event sequence change inputs and invalidate the previous result', () => {
  let state = workflowLab.initial(workflowExample);
  state = act(state, { kind: 'predict', finalStateId: 'draft', blockedCount: 1, reasoning: '' });
  state = act(state, { kind: 'set-initial', initialStateId: 'review', reason: 'Try a document already under review.' });
  expect(workflowLab.observe(workflowExample, state).result).toBeNull();
  state = act(state, { kind: 'set-sequence', eventIds: ['approve', 'edit', 'submit'], reason: 'Try approval followed by a new submission.' });
  state = act(state, { kind: 'predict', finalStateId: 'review', blockedCount: 0, reasoning: '' });
  expect(workflowLab.observe(workflowExample, state).result?.steps.map(step => step.toStateId)).toEqual(['ready', 'draft', 'review']);
  expect(workflowLab.observe(workflowExample, state).assessment?.score).toBe(2);
  expect(state.editNotes.map(note => note.kind)).toEqual(['set-initial', 'set-sequence']);
});

test('quick, deep and visual selection persists without revealing computed results or the unseen task', () => {
  let state = workflowLab.initial(workflowExample);
  state = act(state, { kind: 'set-mode', mode: 'deep' });
  state = act(state, { kind: 'set-mode', mode: 'visual' });
  const restored = workflowLab.parseState(workflowExample, JSON.parse(JSON.stringify(state)));
  expect(workflowLab.observe(workflowExample, restored).mode).toBe('visual');
  expect(workflowLab.observe(workflowExample, restored).result).toBeNull();
  expect(workflowLab.text(workflowExample, restored)).not.toMatch(/equipment-checkout|Collect|Final state:/);
});

test.each([
  ['duplicate state identities', { ...workflowExample.practice, states: [workflowExample.practice.states[0], workflowExample.practice.states[0]] }],
  ['ambiguous state/event rule pairs including disabled rules', { ...workflowExample.practice, rules: [...workflowExample.practice.rules, { ...workflowExample.practice.rules[0], id: 'duplicate-rule', enabled: false }] }],
  ['unknown target states', { ...workflowExample.practice, rules: workflowExample.practice.rules.map(value => value.id === 'ready-edit' ? { ...value, toStateId: 'not-a-state' } : value) }],
  ['unknown sequence events', { ...workflowExample.practice, eventIds: ['not-an-event'] }],
  ['unknown initial state', { ...workflowExample.practice, initialStateId: 'not-a-state' }],
  ['more than twelve sequence events', { ...workflowExample.practice, eventIds: Array.from({ length: 13 }, () => 'submit') }],
])('rejects %s at the public parse seam', (_name, practice) => {
  expect(() => workflowLab.parse({ ...workflowExample, practice })).toThrow();
});

test('transfer exercises a different path rather than a renamed copy of practice', () => {
  expect(() => workflowLab.parse({ ...workflowExample, transfer: { ...workflowExample.practice, id: 'renamed-practice', title: 'A renamed copy' } })).toThrow(/distinct/);
});

test.each([
  { kind: 'set-rule', ruleId: 'ready-edit', toStateId: 'missing', enabled: true, reason: 'Invalid target.' },
  { kind: 'set-rule', ruleId: 'missing', toStateId: 'draft', enabled: true, reason: 'Invalid rule.' },
  { kind: 'set-rule', ruleId: 'ready-edit', toStateId: 'draft', enabled: true, reason: 'No input change.' },
  { kind: 'set-initial', initialStateId: 'missing', reason: 'Invalid start.' },
  { kind: 'set-sequence', eventIds: ['missing'], reason: 'Invalid event.' },
  { kind: 'predict', finalStateId: 'missing', blockedCount: 1, reasoning: '' },
  { kind: 'predict', finalStateId: 'draft', blockedCount: 5, reasoning: '' },
  { kind: 'set-rule', ruleId: 'ready-edit', toStateId: 'review', enabled: true, reason: '' },
  { kind: 'execute-code', code: 'process.exit()' },
])('rejects invalid finite action $kind', action => {
  const initial = workflowLab.initial(workflowExample);
  expect(() => act(initial, action)).toThrow();
  expect(workflowLab.observe(workflowExample, initial).revision).toBe(0);
});

test('stale local actions preserve the current user state', () => {
  const state = changedPractice();
  expect(() => workflowLab.update(workflowExample, state, { kind: 'predict', finalStateId: 'ready', blockedCount: 0, reasoning: '', expectedRevision: 0 })).toThrow(/changed/);
  expect(workflowLab.observe(workflowExample, state).editNotes).toHaveLength(1);
});

test.each([
  ['another lesson', (state: ReturnType<typeof workflowLab.initial>) => ({ ...state, lessonId: 'other' })],
  ['another version', (state: ReturnType<typeof workflowLab.initial>) => ({ ...state, lessonVersion: 2 })],
  ['another source basis', (state: ReturnType<typeof workflowLab.initial>) => ({ ...state, basis: { kind: 'local-sample', contextDigest: 'changed' } })],
  ['unrecorded input changes', (state: ReturnType<typeof workflowLab.initial>) => ({ ...state, practice: { ...state.practice, initialStateId: 'review' } })],
  ['changed immutable rule identity', (state: ReturnType<typeof workflowLab.initial>) => ({ ...state, practice: { ...state.practice, rules: state.practice.rules.map(value => value.id === 'ready-edit' ? { ...value, eventId: 'submit' } : value) } })],
  ['unstarted transfer marked active', (state: ReturnType<typeof workflowLab.initial>) => ({ ...state, active: 'transfer' })],
  ['prediction at revision zero', (state: ReturnType<typeof workflowLab.initial>) => ({ ...state, practicePrediction: { finalStateId: 'draft', blockedCount: 1, reasoning: '' } })],
  ['stored computed answers', (state: ReturnType<typeof workflowLab.initial>) => ({ ...state, result: { finalStateId: 'ready', blockedCount: 0 } })],
])('refuses unsafe restored state: %s', (_name, corrupt) => {
  expect(() => workflowLab.parseState(workflowExample, corrupt(workflowLab.initial(workflowExample)))).toThrow();
});

test('an edited practice cannot turn the held-out challenge into the same workflow under different labels', () => {
  const data = { ...workflowExample, transfer: { ...workflowExample.practice, id: 'different-case-id', rules: workflowExample.practice.rules.map(value => value.id === 'ready-edit' ? { ...value, toStateId: 'review' } : value) } };
  let state = workflowLab.initial(data);
  state = workflowLab.update(data, state, { kind: 'set-rule', ruleId: 'ready-edit', toStateId: 'review', enabled: true, reason: 'This would copy the challenge relationship.', expectedRevision: state.revision });
  state = workflowLab.update(data, state, { kind: 'predict', finalStateId: 'ready', blockedCount: 0, reasoning: '', expectedRevision: state.revision });
  expect(workflowLab.observe(data, state).canStartTransfer).toBe(false);
  expect(() => workflowLab.update(data, state, { kind: 'start-transfer', expectedRevision: state.revision })).toThrow(/distinct/);
});

test.each([
  ['reversed rules', false],
  ['reversed rules and state/event declarations', true],
])('rejects a renamed identical transfer with %s without mutating either case', (_name, reverseDeclarations) => {
  const transfer = { ...workflowExample.practice, id: 'reordered-practice', title: 'A rearranged copy', rules: [...workflowExample.practice.rules].reverse(), states: reverseDeclarations ? [...workflowExample.practice.states].reverse() : workflowExample.practice.states, events: reverseDeclarations ? [...workflowExample.practice.events].reverse() : workflowExample.practice.events };
  const before = JSON.stringify(transfer);
  expect(() => workflowLab.parse({ ...workflowExample, transfer })).toThrow(/distinct/);
  expect(JSON.stringify(transfer)).toBe(before);
});

test('reordering a challenge cannot bypass distinctness after a practice edit', () => {
  const changedRules = workflowExample.practice.rules.map(value => value.id === 'ready-edit' ? { ...value, toStateId: 'review' } : value);
  const data = { ...workflowExample, transfer: { ...workflowExample.practice, id: 'reordered-challenge', title: 'A rearranged challenge', rules: [...changedRules].reverse(), states: [...workflowExample.practice.states].reverse(), events: [...workflowExample.practice.events].reverse() } };
  let state = workflowLab.initial(data);
  state = workflowLab.update(data, state, { kind: 'set-rule', ruleId: 'ready-edit', toStateId: 'review', enabled: true, reason: 'This matches the reordered challenge.', expectedRevision: state.revision });
  state = workflowLab.update(data, state, { kind: 'predict', finalStateId: 'ready', blockedCount: 0, reasoning: '', expectedRevision: state.revision });
  expect(workflowLab.observe(data, state).canStartTransfer).toBe(false);
  expect(() => workflowLab.update(data, state, { kind: 'start-transfer', expectedRevision: state.revision })).toThrow(/distinct/);
});

function renamedPractice(input = workflowExample.practice) {
  const stateIds: Record<string, string> = { draft: 'a', review: 'b', ready: 'c' };
  const eventIds: Record<string, string> = { submit: 'e0', approve: 'e1', edit: 'e2', 'request-changes': 'e3' };
  return { ...input, id: 'renamed-reordered-copy', title: 'Same path with new labels', states: input.states.map(value => ({ id: stateIds[value.id], label: `State ${stateIds[value.id]}` })).reverse(), events: input.events.map(value => ({ id: eventIds[value.id], label: `Event ${eventIds[value.id]}` })).reverse(), rules: input.rules.map((value, index) => ({ ...value, id: `rule-${index}`, fromStateId: stateIds[value.fromStateId], eventId: eventIds[value.eventId], toStateId: stateIds[value.toStateId] })).reverse(), initialStateId: stateIds[input.initialStateId], eventIds: input.eventIds.map(value => eventIds[value]) };
}

test('renamed and reordered definitions cannot disguise the same normalized execution path', () => {
  expect(() => workflowLab.parse({ ...workflowExample, transfer: renamedPractice() })).toThrow(/distinct/);
});

test('practice edits cannot match a renamed and reordered held-out path', () => {
  const changed = { ...workflowExample.practice, rules: workflowExample.practice.rules.map(value => value.id === 'ready-edit' ? { ...value, toStateId: 'review' } : value) };
  const data = { ...workflowExample, transfer: renamedPractice(changed) };
  let state = workflowLab.initial(data);
  state = workflowLab.update(data, state, { kind: 'set-rule', ruleId: 'ready-edit', toStateId: 'review', enabled: true, reason: 'This follows the challenge path under other labels.', expectedRevision: state.revision });
  state = workflowLab.update(data, state, { kind: 'predict', finalStateId: 'ready', blockedCount: 0, reasoning: '', expectedRevision: state.revision });
  expect(workflowLab.observe(data, state).canStartTransfer).toBe(false);
  expect(() => workflowLab.update(data, state, { kind: 'start-transfer', expectedRevision: state.revision })).toThrow(/distinct/);
});

test('unused state, event and rule padding cannot make an identical execution path unseen', () => {
  const transfer = { ...workflowExample.practice, id: 'padded-practice', states: [...workflowExample.practice.states, { id: 'unused-state', label: 'Unused state' }], events: [...workflowExample.practice.events, { id: 'unused-event', label: 'Unused event' }], rules: [...workflowExample.practice.rules, { id: 'unused-rule', fromStateId: 'unused-state', eventId: 'unused-event', toStateId: 'unused-state', enabled: true }] };
  expect(() => workflowLab.parse({ ...workflowExample, transfer })).toThrow(/distinct/);
});
