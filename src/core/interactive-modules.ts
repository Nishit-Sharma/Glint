import {readTruthBinding,TRUTH_INTRO,TRUTH_MODULE_PREFIX} from '../learning/truth-table';
import { Schema } from 'effect';
import { createModuleRegistry, defineModule } from './module-registry';
import { joinLab, JoinLessonSchema, JoinStateSchema, JoinActionSchema, validateLesson } from '../learning/join-lab';
import { helperStudio, HelperDataSchema, HelperStateSchema, HelperActionSchema } from '../learning/reusable-helper';
import {semanticHelper,SemanticHelperStateSchema,SemanticHelperActionSchema,semanticHelperText} from '../learning/semantic-helper';
import {pickingHelper,PickingStateSchema,PickingActionSchema} from '../learning/picking-helper';
import {groundedJoin,GroundedJoinDataSchema,GroundedJoinStateSchema,GroundedJoinActionSchema} from '../learning/grounded-join';
import {workflowLab,WorkflowDataSchema,WorkflowStateSchema,WorkflowActionSchema} from '../learning/workflow-lab';

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
export const joinModule = defineModule({ kind: 'join-lab', schemaVersion: 1, description: 'Predict and change a bounded equality join; inspect exact pairs and try a distinct transfer.', data: JoinLessonSchema, state: JoinStateSchema, action: JoinActionSchema, validate: validateLesson, initial: joinLab.initial, update: joinLab.update, text: joinLab.text });
const BeginTable=Schema.Struct({kind:Schema.Literal('begin-table-helper'),expectedRevision:Schema.Int.pipe(Schema.between(0,500))});
const BeginSemantic=Schema.Struct({kind:Schema.Literal('begin-semantic-helper'),expectedRevision:Schema.Int.pipe(Schema.between(0,500))});
export const helperModule = defineModule({kind:'helper-studio',schemaVersion:1,description:'Teach, test, version and activate a local helper.',data:HelperDataSchema,state:Schema.Union(HelperStateSchema,SemanticHelperStateSchema,PickingStateSchema),action:Schema.Union(HelperActionSchema,SemanticHelperActionSchema,PickingActionSchema,BeginSemantic,BeginTable),initial:helperStudio.initial,
 update(data,state,action){
  if(action.kind==='begin-table-helper'){
   if('format' in state||state.revision!==0)throw Error('Start a table helper only from a new, unchanged helper.');
   return pickingHelper.parseState(data.id,{...pickingHelper.initial(data.id),revision:1});
  }
  if(action.kind==='begin-semantic-helper'){
   if('format' in state||state.revision!==0)throw Error('Start a record helper only from a new, unchanged helper.');
   return semanticHelper.parseState(data.id,{...semanticHelper.initial(data.id),revision:1});
  }
  if('format' in state&&state.format==='semantic-table-v2')return pickingHelper.update(data.id,state,action);
  if(action.kind.startsWith('picking-'))throw Error('Choose table helper mode first.');
  if('format' in state){
   if(!action.kind.includes('semantic'))throw Error('This helper uses local record actions.');
   return semanticHelper.update(data.id,state,action);
  }
  if(action.kind.includes('semantic'))throw Error('Choose local record mode first.');
  return helperStudio.update(data,state,action);
 },
 text(data,state){return 'format' in state?state.format==='semantic-table-v2'?pickingHelper.text(data.id,state):semanticHelperText(data.id,state):helperStudio.text(data,state);},
});
export const groundedJoinModule=defineModule({kind:'grounded-join',schemaVersion:1,description:'Review cited table extraction, correct ambiguities and run the installed join experiment.',data:GroundedJoinDataSchema,state:GroundedJoinStateSchema,action:GroundedJoinActionSchema,validate:groundedJoin.parse,initial:groundedJoin.initial,update:groundedJoin.update,text:groundedJoin.text});
export const workflowModule=defineModule({kind:'workflow-lab',schemaVersion:1,description:'Predict and edit a bounded finite workflow; inspect the computed trace and try a distinct transfer.',data:WorkflowDataSchema,state:WorkflowStateSchema,action:WorkflowActionSchema,validate:workflowLab.parse,initial:workflowLab.initial,update:workflowLab.update,text:workflowLab.text});
export const installedModules = createModuleRegistry({ comparison: comparisonModule, plan: planModule, 'join-lab': joinModule, 'helper-studio':helperModule,'grounded-join':groundedJoinModule,'workflow-lab':workflowModule });
/** Model output is a smaller contract than installed host/storage capability. */
const modelModules=createModuleRegistry({comparison:comparisonModule,plan:planModule});
export type ModelModuleDraft=ReturnType<typeof modelModules.parse>;
export function parseModelModule(value:unknown):ModelModuleDraft{
  const header=Schema.decodeUnknownSync(Schema.Struct({kind:Schema.String}))(value);
  if(!Object.hasOwn(modelModules.entries,header.kind))throw Error('The browser planner may only supply comparison or plan modules. Source-bound modules require host admission.');
  return modelModules.parse(value);
}
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
/** Keep the host-created artifact immutable while describing its chosen helper mode. */
export function readableModuleIntro(answer:ModuleAnswer,stateFor?:(moduleId:string)=>unknown):string{
  if(answer.modules.some(module=>module.id.startsWith(TRUTH_MODULE_PREFIX))){try{return readTruthBinding(answer.markdown,answer.modules[0].id)?TRUTH_INTRO:'This truth table needs review.';}catch{return 'This truth table needs review.';}}
  if(answer.markdown!=='Local text helper. Teach only the listed text operations on text you paste here.'||answer.modules.length!==1)return answer.markdown;
  const module=answer.modules[0];if(module.data.kind!=='helper-studio')return answer.markdown;
  const state=stateFor?.(module.id);
  if(state&&typeof state==='object'&&'format' in state&&state.format==='semantic-table-v2'){try{pickingHelper.parseState(module.data.id,state);return 'Local picking helper. Review owned table actions and local manifest drafts here.';}catch{return answer.markdown;}}
  if(!state||typeof state!=='object'||!('format' in state)||state.format!=='semantic-record-v1')return answer.markdown;
  try{semanticHelper.parseState(module.data.id,state);return 'Local record helper. Choose fields and check local computations here.';}catch{return answer.markdown;}
}
/** Historical/model context must never expose raw module JSON or an unstarted challenge. */
export function moduleHistoryText(content:string,stateFor?:(moduleId:string)=>unknown):string{
  try{const answer=parseModuleAnswer(JSON.parse(content));return [readableModuleIntro(answer,stateFor),...answer.modules.map(module=>moduleText(module.data,stateFor?.(module.id)))].join('\n\n');}
  catch{return 'An interactive answer is saved, but its current stage needs review. No raw module data is included.';}
}
