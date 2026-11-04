import { expect, it } from 'vitest';
import { parseModule, initialModuleState, updateModuleState, moduleText } from '../../src/core/interactive-modules';
import { Schema } from 'effect';
import { createModuleRegistry, defineModule } from '../../src/core/module-registry';

it('validates an agent-selected comparison and keeps editable selection separate from its content version', () => {
  const module = parseModule({ kind: 'comparison', schemaVersion: 1, title: 'Day hike filters', question: 'Which fits a 50 dollar budget?', columns: ['Price', 'Weight'], rows: [{ id: 'a', label: 'Ridge', values: ['$45', '90 g'] }, { id: 'b', label: 'Creek', values: ['$65', '75 g'] }] });
  const state = updateModuleState(module, initialModuleState(module), { kind: 'select', rowId: 'a', expectedRevision: 0 });
  expect(state).toMatchObject({ kind: 'comparison', revision: 1, selectedRowId: 'a' });
  expect(moduleText(module)).toContain('Ridge');
  expect(moduleText(module)).toContain('$45');
  expect(() => updateModuleState(module, state, { kind: 'select', rowId: 'b', expectedRevision: 0 })).toThrow('changed');
  expect(() => updateModuleState(module, state, { kind: 'select', rowId: 'invented', expectedRevision: 1 })).toThrow('row');
});

it('registers an additional trusted kind without changing parser, reducer or fallback dispatch', () => {
  const Data = Schema.Struct({ kind: Schema.Literal('count'), schemaVersion: Schema.Literal(1), label: Schema.String });
  const State = Schema.Struct({ kind: Schema.Literal('count'), revision: Schema.Int, count: Schema.Int });
  const Action = Schema.Struct({ expectedRevision: Schema.Int, amount: Schema.Int });
  const counter = defineModule({ kind: 'count', schemaVersion: 1, description: 'Test-only installed extension', data: Data, state: State, action: Action, initial: (): typeof State.Type => ({ kind: 'count', revision: 0, count: 0 }), update: (_data, state, action) => ({ ...state, revision: state.revision + 1, count: state.count + action.amount }), text: (data, state) => `${data.label}: ${state.count}` });
  const registry = createModuleRegistry({ count: counter }), data = registry.parse({ kind: 'count', schemaVersion: 1, label: 'Confirmed items' });
  const state = registry.update(data, registry.initial(data), { expectedRevision: 0, amount: 3 });
  expect(registry.text(data, state)).toBe('Confirmed items: 3');
  expect(() => registry.parse({ kind: 'count', schemaVersion: 2, label: 'Future' })).toThrow();
});

it('rejects uninstalled kinds, executable fields, invalid versions and malformed tables', () => {
  expect(() => parseModule({ kind: 'browser', schemaVersion: 1, code: 'run it' })).toThrow();
  const plan = { kind: 'plan', schemaVersion: 1, title: 'Pack', purpose: 'Prepare for a day hike', items: [{ id: 'water', title: 'Pack water', detail: 'Carry the confirmed amount.' }] };
  expect(() => parseModule({ ...plan, onClick: 'fetch private files' })).toThrow();
  expect(() => parseModule({ ...plan, schemaVersion: 999 })).toThrow();
  expect(() => parseModule({ ...plan, items: [...plan.items, ...plan.items] })).toThrow('unique');
  const parsed = parseModule(plan), checked = updateModuleState(parsed, initialModuleState(parsed), { kind: 'check', itemId: 'water', checked: true, expectedRevision: 0 });
  expect(checked).toEqual({ kind: 'plan', revision: 1, checkedIds: ['water'] });
});
