import { useId, type ReactNode } from 'react';
import { comparisonModule, planModule, moduleRegistry, type ModuleAction, type ModuleDraft, type ModuleState } from '../../../core/interactive-modules';
import {ReadyArtifact} from './ReadyArtifact';
import './interactive-module.css';

type ModuleMotion = {identity:string;arrivalIdentity:string};
type Interaction = { pending: boolean; onAction: (action: ModuleAction) => void; motion?:ModuleMotion };
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
  comparison: { definition: comparisonModule, render(data, state, interaction) { return <Comparison data={comparisonModule.parse(data)} state={comparisonModule.parseState(state)} {...interaction}/>; } },
  plan: { definition: planModule, render(data, state, interaction) { return <Plan data={planModule.parse(data)} state={planModule.parseState(state)} {...interaction}/>; } },
} satisfies { [K in keyof typeof moduleRegistry]: RenderDefinition & { definition: typeof moduleRegistry[K] } };

export function ModuleView({ data, state, pending = false, onAction,motion }: { data: ModuleDraft; state: ModuleState; pending?: boolean; onAction: (action: ModuleAction) => void;motion?:ModuleMotion }) {
  if (data.kind !== state.kind) return <p role="alert">This answer changed. Reload it to keep editing.</p>;
  return <section className="interactive-answer" aria-label={data.title}>{moduleViews[data.kind].render(data, state, { pending, onAction,motion })}</section>;
}
