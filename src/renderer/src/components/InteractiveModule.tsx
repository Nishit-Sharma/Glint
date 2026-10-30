import {RecordedTextReview} from './RecordedTextReview';
import type {LearningDraftOwner} from '../../../shared/learning-drafts';
import {LearningDraftScope} from '../learning-draft-context';
import { useId, type ReactNode } from 'react';
import { comparisonModule, planModule, joinModule, helperModule,groundedJoinModule,workflowModule, moduleRegistry, type ModuleAction, type ModuleDraft, type ModuleState } from '../../../core/interactive-modules';
import type {Task} from '../../../core/types';
import {groundedJoin,groundedJoinStatus} from '../../../learning/grounded-join';
import {workflowLab} from '../../../learning/workflow-lab';
import {WorkflowLab} from './WorkflowLab';
import {GroundedJoin} from './GroundedJoin';
import { joinLab } from '../../../learning/join-lab';
import { JoinLab } from './JoinLab';
import { HelperStudio } from './HelperStudio';
import { SemanticHelperStudio } from './SemanticHelperStudio';
import {PickingHelperStudio} from './PickingHelperStudio';
import {pickingHelper} from '../../../learning/picking-helper';
import { helperStudio } from '../../../learning/reusable-helper';
import {semanticHelper} from '../../../learning/semantic-helper';
import {DocumentRecipeStudio} from './DocumentRecipeStudio';
import {documentRecipe} from '../../../learning/document-recipe';
import {ReadyArtifact} from './ReadyArtifact';
import {DraftNavigationScope} from '../draft-navigation';
import './interactive-module.css';

type ModuleMotion = {identity:string;arrivalIdentity:string};
type Interaction = { pending: boolean; onAction: (action: ModuleAction) => void|Promise<boolean>; motion?:ModuleMotion;task?:Task;draftOwner?:LearningDraftOwner;onOpenSourceDocument?:()=>void };
function Part({motion,id,children}:{motion?:ModuleMotion;id:string;children:ReactNode}){
 return motion?<ReadyArtifact identity={motion.identity+':'+id} arrivalIdentity={motion.arrivalIdentity}>{children}</ReadyArtifact>:children;
}
function Comparison({ data, state, pending, onAction,motion }: Interaction & { data: ReturnType<typeof comparisonModule.parse>; state: ReturnType<typeof comparisonModule.parseState> }) {
  const group = useId();
  return <><Part motion={motion} id="heading"><header><h3>{data.title}</h3><p>{data.question}</p></header></Part><fieldset className="module-options"><legend className="module-sr-only">Choose an option</legend>{data.rows.map(row => <Part motion={motion} id={'option:'+row.id} key={row.id}><article className={'module-option' + (state.selectedRowId === row.id ? ' selected' : '')}>
    <label className="module-choice"><input type="radio" name={group} checked={state.selectedRowId === row.id} aria-disabled={pending || undefined} onClick={event => { if (pending) event.preventDefault(); }} onKeyDown={event => { if (pending && [' ', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) event.preventDefault(); }} onChange={() => { if (!pending) onAction({ kind: 'select', rowId: row.id, expectedRevision: state.revision }); }}/><span>{row.label}</span></label>
    <dl>{row.values.map((value, index) => <div key={index}><dt>{data.columns[index]}</dt><dd>{value}</dd></div>)}</dl>
  </article></Part>)}</fieldset></>;
}
function Plan({ data, state, pending, onAction,motion }: Interaction & { data: ReturnType<typeof planModule.parse>; state: ReturnType<typeof planModule.parseState> }) {
  return <><Part motion={motion} id="heading"><header><h3>{data.title}</h3><p>{data.purpose}</p></header></Part><ul className="module-plan">{data.items.map(item => <li key={item.id}><Part motion={motion} id={'item:'+item.id}><label><input type="checkbox" checked={state.checkedIds.includes(item.id)} aria-disabled={pending || undefined} onClick={event => { if (pending) event.preventDefault(); }} onKeyDown={event => { if (pending && [' ', 'Enter'].includes(event.key)) event.preventDefault(); }} onChange={event => { if (!pending) onAction({ kind: 'check', itemId: item.id, checked: event.target.checked, expectedRevision: state.revision }); }}/><span><strong>{item.title}</strong>{item.detail && <small>{item.detail}</small>}</span></label></Part></li>)}</ul></>;
}
type RenderDefinition = { render(data: unknown, state: unknown, interaction: Interaction): ReactNode };
/** Each renderer binds to its complete core definition; adding a kind requires a renderer binding. */
export const moduleViews = {
  'document-recipe':{definition:moduleRegistry['document-recipe'],render(_data,state,interaction){return <DocumentRecipeStudio state={documentRecipe.parseState(state)} {...interaction}/>;}},
  comparison: { definition: comparisonModule, render(data, state, interaction) { return <Comparison data={comparisonModule.parse(data)} state={comparisonModule.parseState(state)} {...interaction}/>; } },
  plan: { definition: planModule, render(data, state, interaction) { return <Plan data={planModule.parse(data)} state={planModule.parseState(state)} {...interaction}/>; } },
  'join-lab': { definition: joinModule, render(data, state, interaction) { return <JoinLab data={joinModule.parse(data)} state={joinLab.parseState(data,state)} {...interaction}/>; } },
  'helper-studio': { definition: helperModule, render(data,state,interaction) { const parsed=helperModule.parse(data);if(state&&typeof state==='object'&&'format' in state&&state.format==='semantic-table-v2')return <PickingHelperStudio data={parsed} state={pickingHelper.parseState(parsed.id,state)} {...interaction}/>;if(state&&typeof state==='object'&&'format' in state&&state.format==='semantic-record-v1')return <SemanticHelperStudio data={parsed} state={semanticHelper.parseState(parsed.id,state)} {...interaction}/>;const old=helperStudio.parseState(data,state);return <><HelperStudio data={parsed} state={old} {...interaction} onBeginRecord={()=>interaction.onAction({kind:'begin-semantic-helper',expectedRevision:old.revision})} onBeginPicking={()=>interaction.onAction({kind:'begin-table-helper',expectedRevision:old.revision})}/><RecordedTextReview data={parsed} state={old} pending={interaction.pending} owner={interaction.draftOwner}/></>; } },
  'grounded-join':{definition:groundedJoinModule,render(value,state,interaction){const data=groundedJoin.parse(value);return <GroundedJoin data={data} state={groundedJoin.parseState(data,state)} status={interaction.task?groundedJoinStatus(data,interaction.task):data.basis.kind==='local-demo'?{kind:'current'}:{kind:'unverified',reason:'Live source status is unavailable.'}} {...interaction}/>;}},
  'workflow-lab':{definition:workflowModule,render(value,state,interaction){const data=workflowLab.parse(value);return <WorkflowLab data={data} state={workflowLab.parseState(data,state)} {...interaction}/>;}},
} satisfies { [K in keyof typeof moduleRegistry]: RenderDefinition & { definition: typeof moduleRegistry[K] } };

export function ModuleView({ data, state, pending = false, onAction,motion,task,draftOwner,onOpenSourceDocument }: { data: ModuleDraft; state: ModuleState; pending?: boolean; onAction: (action: ModuleAction) => void|Promise<boolean>;motion?:ModuleMotion;task?:Task;draftOwner?:LearningDraftOwner;onOpenSourceDocument?:()=>void }) {
  if (data.kind !== state.kind) return <p role="alert">This answer changed. Reload it to keep editing.</p>;
  let content:ReactNode;
  try { content=moduleViews[data.kind].render(data, state, { pending, onAction,motion,task,draftOwner,onOpenSourceDocument }); }
  catch { return <section className="interactive-answer" aria-label={data.title}><p role="alert">This saved example needs review before editing. Your saved work is kept.</p></section>; }
  return <section className="interactive-answer" aria-label={data.title}>{data.kind==='document-recipe'||data.kind==='join-lab'||data.kind==='grounded-join'||data.kind==='workflow-lab'||data.kind==='helper-studio'?<DraftNavigationScope identity={motion?.identity}><LearningDraftScope owner={draftOwner}>{content}</LearningDraftScope></DraftNavigationScope>:content}</section>;
}
