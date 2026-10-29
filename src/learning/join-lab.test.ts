import { describe, expect, test } from 'vitest';
import { joinLab, limits, type JoinLesson, type JoinState } from './join-lab';
import { exampleLesson } from './example';

describe('join learning through its public interface', () => {
  test('reveals every matching INNER pair with stable source row identities after prediction', () => {
    const data = joinLab.parse(exampleLesson);
    const initial = joinLab.initial(data);
    expect(joinLab.observe(data, initial).observation).toBeNull();
    const state = joinLab.update(data, initial, { kind: 'predict', count: 2, reasoning: 'x matches both invitations', expectedRevision: 0 });
    const view = joinLab.observe(data, state);
    expect(view.observation?.rows.map(row => row.provenance)).toEqual([
      { leftTableId: 'practice-members', leftRowId: 'practice-a', rightTableId: 'practice-invitations', rightRowId: 'practice-r1' },
      { leftTableId: 'practice-members', leftRowId: 'practice-a', rightTableId: 'practice-invitations', rightRowId: 'practice-r2' },
    ]);
    expect(view.assessment).toMatchObject({ predictedCount: 2, actualCount: 2, correct: true });
  });

  test('editing a row multiplies duplicate matches and gives a row-specific correction for a wrong count', () => {
    const data = joinLab.parse(exampleLesson);
    let state = joinLab.initial(data);
    state = joinLab.update(data, state, { kind: 'edit-row', side: 'left', rowId: 'practice-b', values: ['x', 'blue'], expectedRevision: 0 });
    expect(joinLab.observe(data, state).observation).toBeNull();
    state = joinLab.update(data, state, { kind: 'predict', count: 2, reasoning: 'Two members means two rows', expectedRevision: 1 });
    const view = joinLab.observe(data, state);
    expect(view.observation?.rows.map(row => row.id)).toEqual(['practice-a:practice-r1', 'practice-a:practice-r2', 'practice-b:practice-r1', 'practice-b:practice-r2']);
    expect(view.assessment).toMatchObject({ correct: false, actualCount: 4, difference: 2, reasoning: 'Two members means two rows' });
    expect(view.assessment?.correction).toContain('practice-b matches practice-r1, practice-r2 and contributes 2');
    expect(view.change).toMatchObject({ originalCount: 2, currentCount: 4, addedPairIds: ['practice-b:practice-r1', 'practice-b:practice-r2'], removedPairIds: [] });
    expect(joinLab.text(data, state)).toContain('Original count: 2; current count: 4.');
    expect(data.practice.left.rows[1].values).toEqual(['y', 'blue']);
  });

  test('checks a distinct held-out LEFT join against independently enumerated pairs without leaking its answer before submission', () => {
    const data = joinLab.parse(exampleLesson);
    let state = joinLab.initial(data);
    expect(() => joinLab.update(data, state, { kind: 'start-transfer', expectedRevision: 0 })).toThrow();
    state = joinLab.update(data, state, { kind: 'set-mode', mode: 'LEFT', expectedRevision: 0 });
    state = joinLab.update(data, state, { kind: 'predict', count: 3, reasoning: 'One per member', expectedRevision: 1 });
    expect(joinLab.observe(data, state).assessment).toMatchObject({ actualCount: 4, correct: false });
    state = joinLab.update(data, state, { kind: 'start-transfer', expectedRevision: 2 });
    const heldOut = joinLab.observe(data, state);
    expect(heldOut.problem.id).toBe('transfer');
    expect(heldOut.observation).toBeNull();
    expect(heldOut.assessment).toBeNull();
    expect(heldOut.change).toBeNull();
    expect(joinLab.text(data, state)).not.toContain('transfer-a:transfer-r1');
    expect(joinLab.text(data, state)).toContain('Practice correction: You predicted 3; the actual count is 4.');
    state = joinLab.update(data, state, { kind: 'predict', count: 6, reasoning: 'Four zero pairs and two preserved unmatched shipments', expectedRevision: 3 });
    const result = joinLab.observe(data, state);
    expect(result.observation?.rows.map(value => [value.provenance.leftRowId, value.provenance.rightRowId])).toEqual([
      ['transfer-a', 'transfer-r1'], ['transfer-a', 'transfer-r2'],
      ['transfer-b', 'transfer-r1'], ['transfer-b', 'transfer-r2'],
      ['transfer-unmatched', null], ['transfer-null', null],
    ]);
    expect(result.assessment).toMatchObject({ correct: true, actualCount: 6 });
    expect(result.observation?.rows.at(-1)).toMatchObject({ kind: 'left-unmatched', rightValues: [null] });
    expect(result.observation?.rows.some(value => value.provenance.rightRowId === 'transfer-rnull')).toBe(false);
    expect(result.observation?.rows.some(value => value.provenance.rightRowId === 'transfer-unused')).toBe(false);
  });

  test('LEFT keeps an unmatched non-NULL key and a NULL key exactly once each', () => {
    const data = joinLab.parse(exampleLesson);
    let state = joinLab.update(data, joinLab.initial(data), { kind: 'set-mode', mode: 'LEFT', expectedRevision: 0 });
    state = joinLab.update(data, state, { kind: 'predict', count: 3, reasoning: '', expectedRevision: 1 });
    const view = joinLab.observe(data, state);
    expect(view.observation?.rows.map(value => value.id)).toEqual(['practice-a:practice-r1', 'practice-a:practice-r2', 'practice-b:@unmatched', 'practice-null:@unmatched']);
    expect(view.observation?.contributions).toEqual([
      { leftRowId: 'practice-a', key: 'x', matchingRightRowIds: ['practice-r1', 'practice-r2'], outputCount: 2, reason: 'matches' },
      { leftRowId: 'practice-b', key: 'y', matchingRightRowIds: [], outputCount: 1, reason: 'no-match' },
      { leftRowId: 'practice-null', key: null, matchingRightRowIds: [], outputCount: 1, reason: 'null-key' },
    ]);
    expect(view.assessment?.correction).toContain('equality is unknown even against NULL');
    expect(view.observation?.rows.at(-1)?.rightValues).toEqual([null, null]);
    expect(joinLab.text(data, state)).toContain('practice-null:@unmatched');
  });

  test('changing key columns invalidates the previous prediction and distinguishes a matched NULL payload from an absent right row', () => {
    const data = joinLab.parse(exampleLesson);
    let state = joinLab.update(data, joinLab.initial(data), { kind: 'predict', count: 2, reasoning: '', expectedRevision: 0 });
    state = joinLab.update(data, state, { kind: 'set-keys', leftColumnId: 'p-alt', rightColumnId: 'p-ralt', expectedRevision: 1 });
    expect(joinLab.observe(data, state).assessment).toBeNull();
    state = joinLab.update(data, state, { kind: 'predict', count: 6, reasoning: 'Each color matches twice', expectedRevision: 2 });
    const view = joinLab.observe(data, state);
    expect(view.observation?.rowCount).toBe(6);
    expect(view.observation?.rows.find(value => value.id === 'practice-null:practice-rnull')).toMatchObject({ kind: 'matched', rightValues: [null, 'red'], provenance: { rightRowId: 'practice-rnull' } });
  });

  test('editing a right row uses exact case-sensitive strings and reports removed pairs', () => {
    const data = joinLab.parse(exampleLesson);
    let state = joinLab.update(data, joinLab.initial(data), { kind: 'edit-row', side: 'right', rowId: 'practice-r1', values: ['X', 'red'], expectedRevision: 0 });
    state = joinLab.update(data, state, { kind: 'predict', count: 1, reasoning: '', expectedRevision: 1 });
    expect(joinLab.observe(data, state).observation?.rows.map(value => value.id)).toEqual(['practice-a:practice-r2']);
    expect(joinLab.observe(data, state).change?.removedPairIds).toEqual(['practice-a:practice-r1']);
  });

  test.each([
    { name: 'INNER with no right rows', mode: 'INNER', leftEmpty: false, rightEmpty: true, count: 0 },
    { name: 'LEFT with no right rows', mode: 'LEFT', leftEmpty: false, rightEmpty: true, count: 3 },
    { name: 'LEFT with no left rows', mode: 'LEFT', leftEmpty: true, rightEmpty: false, count: 0 },
    { name: 'INNER with both empty', mode: 'INNER', leftEmpty: true, rightEmpty: true, count: 0 },
  ])('$name', ({ mode, leftEmpty, rightEmpty, count }) => {
    const data = joinLab.parse({ ...exampleLesson, practice: {
      ...exampleLesson.practice,
      left: { ...exampleLesson.practice.left, rows: leftEmpty ? [] : exampleLesson.practice.left.rows },
      right: { ...exampleLesson.practice.right, rows: rightEmpty ? [] : exampleLesson.practice.right.rows },
      join: { ...exampleLesson.practice.join, mode },
    } });
    const state = joinLab.update(data, joinLab.initial(data), { kind: 'predict', count, reasoning: '', expectedRevision: 0 });
    expect(joinLab.observe(data, state).observation?.rowCount).toBe(count);
  });

  test('supports the bounded worst-case duplicate expansion without dropping any pairs', () => {
    const data = joinLab.parse({ ...exampleLesson, practice: {
      ...exampleLesson.practice,
      left: { ...exampleLesson.practice.left, rows: Array.from({ length: 12 }, (_, index) => ({ id: `max-left-${index}`, values: ['x', 'red'] })) },
      right: { ...exampleLesson.practice.right, rows: Array.from({ length: 12 }, (_, index) => ({ id: `max-right-${index}`, values: ['x', 'red'] })) },
    } });
    const state = joinLab.update(data, joinLab.initial(data), { kind: 'predict', count: 144, reasoning: '', expectedRevision: 0 });
    const rows = joinLab.observe(data, state).observation?.rows ?? [];
    expect(rows).toHaveLength(144);
    expect(new Set(rows.map(value => value.id)).size).toBe(144);
    expect(rows.at(-1)?.id).toBe('max-left-11:max-right-11');
    expect(limits.outputRows).toBe(144);
  });

  test('rejects stale actions, no-op edits, nonexistent rows and wrong-side keys without mutating state', () => {
    const data = joinLab.parse(exampleLesson), initial = joinLab.initial(data);
    const state = joinLab.update(data, initial, { kind: 'set-mode', mode: 'LEFT', expectedRevision: 0 });
    expect(() => joinLab.update(data, state, { kind: 'predict', count: 4, reasoning: '', expectedRevision: 0 })).toThrow('changed');
    expect(() => joinLab.update(data, initial, { kind: 'set-mode', mode: 'INNER', expectedRevision: 0 })).toThrow('alters');
    expect(() => joinLab.update(data, initial, { kind: 'edit-row', side: 'right', rowId: 'practice-a', values: ['x', 'red'], expectedRevision: 0 })).toThrow('selected side');
    expect(() => joinLab.update(data, initial, { kind: 'set-keys', leftColumnId: 'p-rkey', rightColumnId: 'p-key', expectedRevision: 0 })).toThrow('correct side');
    expect(initial.revision).toBe(0);
    expect(initial.practice.join.mode).toBe('INNER');
  });

  test('restores edited state and its correction through JSON without trusting stored outcome fields', () => {
    const data = joinLab.parse(exampleLesson);
    let state = joinLab.update(data, joinLab.initial(data), { kind: 'edit-row', side: 'left', rowId: 'practice-b', values: ['x', 'blue'], expectedRevision: 0 });
    state = joinLab.update(data, state, { kind: 'predict', count: 2, reasoning: '原理 🧩', expectedRevision: 1 });
    const restored = joinLab.parseState(data, JSON.parse(JSON.stringify(state)));
    expect(joinLab.observe(data, restored)).toEqual(joinLab.observe(data, state));
    expect(() => joinLab.parseState(data, { ...state, actualCount: 2 })).toThrow();
    expect(() => joinLab.parseState(data, { ...state, lessonVersion: 2 })).toThrow('another lesson');
    expect(() => joinLab.parseState(data, { ...state, source: { ...state.source, digest: 'changed' } })).toThrow('another lesson');
    expect(() => joinLab.parseState(data, { ...state, practice: { ...state.practice, left: { ...state.practice.left, rows: state.practice.left.rows.slice(1) } } })).toThrow('identities');
  });

  test('retains the first transfer attempt and rejects editing or repeat submission after reveal', () => {
    const data = joinLab.parse(exampleLesson);
    let state = joinLab.update(data, joinLab.initial(data), { kind: 'set-mode', mode: 'LEFT', expectedRevision: 0 });
    state = joinLab.update(data, state, { kind: 'predict', count: 3, reasoning: '', expectedRevision: 1 });
    state = joinLab.update(data, state, { kind: 'start-transfer', expectedRevision: 2 });
    expect(() => joinLab.update(data, state, { kind: 'set-mode', mode: 'INNER', expectedRevision: 3 })).toThrow('cannot be edited');
    state = joinLab.update(data, state, { kind: 'predict', count: 4, reasoning: 'I forgot unmatched shipments', expectedRevision: 3 });
    const restored = joinLab.parseState(data, JSON.parse(JSON.stringify(state)));
    expect(joinLab.observe(data, restored).assessment).toMatchObject({ correct: false, actualCount: 6, predictedCount: 4 });
    expect(joinLab.observe(data, restored).practiceReview?.assessment).toMatchObject({ correct: false, predictedCount: 3, actualCount: 4 });
    expect(() => joinLab.update(data, restored, { kind: 'predict', count: 6, reasoning: '', expectedRevision: 4 })).toThrow('not available');
  });

  test('requires a changed practice example and rejects a renamed copy as transfer', () => {
    const data = joinLab.parse(exampleLesson);
    const state = joinLab.update(data, joinLab.initial(data), { kind: 'predict', count: 2, reasoning: '', expectedRevision: 0 });
    expect(() => joinLab.update(data, state, { kind: 'start-transfer', expectedRevision: 1 })).toThrow();
    const renamed: JoinLesson['transfer'] = {
      ...data.practice, id: 'renamed',
      left: { ...data.practice.left, id: 'renamed-left', columns: data.practice.left.columns.map(value => ({ ...value, id: `renamed-${value.id}` })), rows: data.practice.left.rows.map(value => ({ ...value, id: `renamed-${value.id}` })) },
      right: { ...data.practice.right, id: 'renamed-right', columns: data.practice.right.columns.map(value => ({ ...value, id: `renamed-${value.id}` })), rows: data.practice.right.rows.map(value => ({ ...value, id: `renamed-${value.id}` })) },
      join: { ...data.practice.join, leftColumnId: 'renamed-p-key', rightColumnId: 'renamed-p-rkey' },
    };
    expect(() => joinLab.parse({ ...data, transfer: renamed })).toThrow('matching structure');
  });

  test('rejects further actions when the bounded revision budget is exhausted', () => {
    const data = joinLab.parse(exampleLesson);
    const state: JoinState = { ...joinLab.initial(data), revision: 500 };
    expect(() => joinLab.update(data, state, { kind: 'set-mode', mode: 'LEFT', expectedRevision: 500 })).toThrow('revision limit');
  });

  test('distinguishes a real right row named null from a null-extended row across an edit', () => {
    const data = joinLab.parse({ ...exampleLesson, practice: {
      ...exampleLesson.practice,
      join: { ...exampleLesson.practice.join, mode: 'LEFT' },
      right: { ...exampleLesson.practice.right, rows: exampleLesson.practice.right.rows.map((value, index) => index === 0 ? { ...value, id: 'null' } : value) },
    } });
    let state = joinLab.update(data, joinLab.initial(data), { kind: 'edit-row', side: 'right', rowId: 'null', values: ['y', 'red'], expectedRevision: 0 });
    state = joinLab.update(data, state, { kind: 'predict', count: 3, reasoning: '', expectedRevision: 1 });
    const view = joinLab.observe(data, state);
    expect(view.change?.addedPairIds).toContain('practice-b:null');
    expect(view.change?.removedPairIds).toContain('practice-b:@unmatched');
  });

  test('restores source and column objects regardless of JSON property order', () => {
    const data = joinLab.parse(exampleLesson), state = joinLab.initial(data);
    expect(() => joinLab.parseState(data, {
      ...state,
      source: { digest: state.source.digest, version: state.source.version, sourceId: state.source.sourceId },
      practice: { ...state.practice, left: { ...state.practice.left, columns: state.practice.left.columns.map(value => ({ type: value.type, label: value.label, id: value.id })) } },
    })).not.toThrow();
  });

  test('false is a valid equality key and is not treated as missing', () => {
    const data = joinLab.parse({ ...exampleLesson, practice: {
      ...exampleLesson.practice,
      left: { ...exampleLesson.practice.left, columns: [{ id: 'p-key', label: 'Enabled', type: 'boolean' }], rows: [{ id: 'false-left', values: [false] }, { id: 'true-left', values: [true] }, { id: 'null-left', values: [null] }] },
      right: { ...exampleLesson.practice.right, columns: [{ id: 'p-rkey', label: 'Enabled', type: 'boolean' }], rows: [{ id: 'false-right-a', values: [false] }, { id: 'false-right-b', values: [false] }, { id: 'true-right', values: [true] }, { id: 'null-right', values: [null] }] },
    } });
    const state = joinLab.update(data, joinLab.initial(data), { kind: 'predict', count: 3, reasoning: '', expectedRevision: 0 });
    expect(joinLab.observe(data, state).observation?.rows.map(value => value.id)).toEqual(['false-left:false-right-a', 'false-left:false-right-b', 'true-left:true-right']);
  });

  test('rejects restored state whose changes or lesson stage contradict its revision', () => {
    const data = joinLab.parse(exampleLesson), state = joinLab.initial(data);
    expect(() => joinLab.parseState(data, { ...state, practice: { ...state.practice, join: { ...state.practice.join, mode: 'LEFT' } } })).toThrow('edit');
    expect(() => joinLab.parseState(data, { ...state, phase: { kind: 'practice-reviewed', prediction: { count: 2, reasoning: '' } } })).toThrow('revision');
  });
});

describe('strict JSON lesson and action validation', () => {
  test.each([
    { name: 'unknown executable field', make: () => ({ ...exampleLesson, sql: 'SELECT * FROM private_data' }) },
    { name: 'unknown nested executable field', make: () => ({ ...exampleLesson, practice: { ...exampleLesson.practice, run: 'eval(1)' } }) },
    { name: 'duplicate row ID', make: () => ({ ...exampleLesson, practice: { ...exampleLesson.practice, left: { ...exampleLesson.practice.left, rows: [exampleLesson.practice.left.rows[0], exampleLesson.practice.left.rows[0]] } } }) },
    { name: 'duplicate column ID', make: () => ({ ...exampleLesson, practice: { ...exampleLesson.practice, left: { ...exampleLesson.practice.left, columns: [exampleLesson.practice.left.columns[0], exampleLesson.practice.left.columns[0]] } } }) },
    { name: 'cross-table ID collision', make: () => ({ ...exampleLesson, practice: { ...exampleLesson.practice, right: { ...exampleLesson.practice.right, id: 'p-key' } } }) },
    { name: 'row arity mismatch', make: () => ({ ...exampleLesson, practice: { ...exampleLesson.practice, left: { ...exampleLesson.practice.left, rows: [{ id: 'short', values: ['x'] }] } } }) },
    { name: 'missing key', make: () => ({ ...exampleLesson, practice: { ...exampleLesson.practice, join: { ...exampleLesson.practice.join, leftColumnId: 'absent' } } }) },
    { name: 'thirteen rows', make: () => ({ ...exampleLesson, practice: { ...exampleLesson.practice, left: { ...exampleLesson.practice.left, rows: Array.from({ length: 13 }, (_, index) => ({ id: `oversize-${index}`, values: ['x', 'red'] })) } } }) },
    { name: 'five columns', make: () => ({ ...exampleLesson, practice: { ...exampleLesson.practice, left: { ...exampleLesson.practice.left, columns: Array.from({ length: 5 }, (_, index) => ({ id: `column-${index}`, label: 'Too many', type: 'string' })) } } }) },
    { name: 'oversize string', make: () => ({ ...exampleLesson, title: 'x'.repeat(161) }) },
    { name: 'coercion from numeric cell to string', make: () => ({ ...exampleLesson, practice: { ...exampleLesson.practice, left: { ...exampleLesson.practice.left, rows: [{ id: 'numeric', values: [1, 'red'] }] } } }) },
    { name: 'different declared key types', make: () => ({ ...exampleLesson, practice: { ...exampleLesson.practice, left: { ...exampleLesson.practice.left, columns: [{ ...exampleLesson.practice.left.columns[0], type: 'integer' }, exampleLesson.practice.left.columns[1]], rows: [{ id: 'number-key', values: [1, 'red'] }] } } }) },
    { name: 'nonfinite number', make: () => ({ ...exampleLesson, transfer: { ...exampleLesson.transfer, left: { ...exampleLesson.transfer.left, rows: [{ id: 'infinite', values: [Infinity] }] } } }) },
    { name: 'unsafe integer', make: () => ({ ...exampleLesson, transfer: { ...exampleLesson.transfer, left: { ...exampleLesson.transfer.left, rows: [{ id: 'unsafe', values: [Number.MAX_SAFE_INTEGER + 1] }] } } }) },
    { name: 'fractional number', make: () => ({ ...exampleLesson, transfer: { ...exampleLesson.transfer, left: { ...exampleLesson.transfer.left, rows: [{ id: 'fraction', values: [0.5] }] } } }) },
    { name: 'undefined cell', make: () => ({ ...exampleLesson, transfer: { ...exampleLesson.transfer, left: { ...exampleLesson.transfer.left, rows: [{ id: 'undefined-cell', values: [undefined] }] } } }) },
  ])('rejects $name', ({ make }) => expect(() => joinLab.parse(make())).toThrow());

  test.each([
    { kind: 'predict', count: -1, reasoning: '', expectedRevision: 0 },
    { kind: 'predict', count: 145, reasoning: '', expectedRevision: 0 },
    { kind: 'predict', count: 1.5, reasoning: '', expectedRevision: 0 },
    { kind: 'predict', count: '2', reasoning: '', expectedRevision: 0 },
    { kind: 'predict', count: 2, reasoning: 'x'.repeat(801), expectedRevision: 0 },
    { kind: 'predict', count: 2, reasoning: '', expectedRevision: 0, explanation: 'model supplied answer' },
    { kind: 'sql', code: 'DROP TABLE x', expectedRevision: 0 },
    { kind: 'set-mode', mode: 'FULL', expectedRevision: 0 },
  ])('rejects an invalid or extended action %#', action => expect(() => joinLab.parseAction(action)).toThrow());
});
