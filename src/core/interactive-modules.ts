import { Schema } from 'effect';
import { createModuleRegistry, defineModule } from './module-registry';

const shortText = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(500));
const detail = Schema.String.pipe(Schema.maxLength(5_000));
const id = Schema.String.pipe(Schema.pattern(/^[a-zA-Z0-9_-]{1,80}$/));
const revision = Schema.Int.pipe(Schema.nonNegative());
const Comparison = Schema.Struct({ kind: Schema.Literal('comparison'), schemaVersion: Schema.Literal(1), title: shortText, question: shortText, columns: Schema.Array(shortText).pipe(Schema.minItems(1), Schema.maxItems(5)), rows: Schema.Array(Schema.Struct({ id, label: shortText, values: Schema.Array(detail).pipe(Schema.minItems(1), Schema.maxItems(5)) })).pipe(Schema.minItems(1), Schema.maxItems(12)) });
const Plan = Schema.Struct({ kind: Schema.Literal('plan'), schemaVersion: Schema.Literal(1), title: shortText, purpose: shortText, items: Schema.Array(Schema.Struct({ id, title: shortText, detail })).pipe(Schema.minItems(1), Schema.maxItems(24)) });
const ComparisonState = Schema.Struct({ kind: Schema.Literal('comparison'), revision, selectedRowId: Schema.optional(id) });
const PlanState = Schema.Struct({ kind: Schema.Literal('plan'), revision, checkedIds: Schema.Array(id).pipe(Schema.maxItems(24)) });
const Select = Schema.Struct({ kind: Schema.Literal('select'), rowId: id, expectedRevision: revision });
const Check = Schema.Struct({ kind: Schema.Literal('check'), itemId: id, checked: Schema.Boolean, expectedRevision: revision });
function unique(ids: readonly string[]) { if (new Set(ids).size !== ids.length) throw Error('Module items need unique identities.'); }

export const comparisonModule = defineModule({ kind: 'comparison', schemaVersion: 1, description: 'Compare grounded alternatives and select one.', data: Comparison, state: ComparisonState, action: Select,
  validate(data) { unique(data.rows.map(row => row.id)); if (data.rows.some(row => row.values.length !== data.columns.length)) throw Error('Every comparison row must match its columns.'); },
  initial: (): typeof ComparisonState.Type => ({ kind: 'comparison', revision: 0 }),
  update(data, state, action) { if (!data.rows.some(row => row.id === action.rowId)) throw Error('The selected row is not in this module.'); return { ...state, revision: state.revision + 1, selectedRowId: action.rowId }; },
  text(data, state) { return `# ${data.title}\n\n${data.question}\n\n${state.selectedRowId ? `Your choice: ${data.rows.find(row => row.id === state.selectedRowId)?.label ?? 'Unavailable option'}\n\n` : ''}${data.rows.map(row => `${row.label}\n${row.values.map((value, index) => `${data.columns[index]}: ${value}`).join('\n')}`).join('\n\n')}`; },
});
export const planModule = defineModule({ kind: 'plan', schemaVersion: 1, description: 'Track completion of a concrete plan.', data: Plan, state: PlanState, action: Check,
  validate(data) { unique(data.items.map(item => item.id)); }, initial: (): typeof PlanState.Type => ({ kind: 'plan', revision: 0, checkedIds: [] }),
  update(data, state, action) { if (!data.items.some(item => item.id === action.itemId)) throw Error('The selected item is not in this plan.'); const checked = new Set(state.checkedIds); if (action.checked) checked.add(action.itemId); else checked.delete(action.itemId); return { ...state, revision: state.revision + 1, checkedIds: [...checked] }; },
  text(data, state) { return `# ${data.title}\n\n${data.purpose}\n\n${data.items.map(item => `- [${state.checkedIds.includes(item.id) ? 'x' : ' '}] ${item.title}${item.detail ? ` — ${item.detail}` : ''}`).join('\n')}`; },
});
export const installedModules = createModuleRegistry({ comparison: comparisonModule, plan: planModule });
export const moduleRegistry = installedModules.entries;
export type ModuleDraft = ReturnType<typeof installedModules.parse>;
export type ModuleState = ReturnType<typeof installedModules.initial>;
export type ModuleAction = ReturnType<typeof installedModules.action>;
export const parseModuleAction = (value: unknown, module: ModuleDraft): ModuleAction => installedModules.action(module, value);
export const parseModule = installedModules.parse;
export const initialModuleState = installedModules.initial;
export const updateModuleState = installedModules.update;
export const moduleText = installedModules.text;

const Provenance = Schema.Struct({ observationId: shortText, browserId: shortText, documentId: shortText, url: detail, digest: shortText });
const Answer = Schema.Struct({ schemaVersion: Schema.Literal(1), markdown: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(50_000)), modules: Schema.Array(Schema.Struct({ id, version: Schema.Int.pipe(Schema.positive()), data: Schema.Unknown, provenance: Schema.Array(Provenance).pipe(Schema.maxItems(65)) })).pipe(Schema.maxItems(3)) });
type RawAnswer = typeof Answer.Type;
export type ModuleAnswer = Omit<RawAnswer, 'modules'> & { readonly modules: readonly (Omit<RawAnswer['modules'][number], 'data'> & { readonly data: ModuleDraft })[] };
export function parseModuleAnswer(value: unknown): ModuleAnswer {
  const answer = Schema.decodeUnknownSync(Answer, { onExcessProperty: 'error' })(value);
  unique(answer.modules.map(module => module.id));
  return { ...answer, modules: answer.modules.map(module => ({ ...module, data: parseModule(module.data) })) };
}
