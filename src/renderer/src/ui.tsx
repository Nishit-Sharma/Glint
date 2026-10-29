import {useId,cloneElement,isValidElement,type ReactNode} from 'react';
import type {ExportCommand,ExportReply,OtherCommand} from '../../shared/export-contract';
export type RunScope={isCurrent:()=>boolean};
export interface Run {
    <C extends ExportCommand>(cmd:C,success?:string,scope?:RunScope):Promise<ExportReply<C>|undefined>;
    <T=unknown>(cmd:OtherCommand,success?:string,scope?:RunScope):Promise<T|undefined>;
}
export type RequestKind = 'explain'|'create'|'experiment'|'procedure';
export function Button({ children, onClick, disabled = false, kind = '', title, type = 'button', 'data-presentation-exit-control':exitControl }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    kind?: string;
    title?: string;
    type?: 'button' | 'submit';
    'data-presentation-exit-control'?:boolean;
}) { return <button type={type} className={kind} onClick={onClick} disabled={disabled} aria-label={title} title={title} data-presentation-exit-control={exitControl||undefined}>{children}</button>; }
export function SectionTitle({ children, action }: {
    children: ReactNode;
    action?: ReactNode;
}) { return <div className="section-title"><h2>{children}</h2>{action}</div>; }
export function Empty({ title, children }: {
    title: string;
    children: ReactNode;
}) { return <div className="empty"><div className="empty-drawing" aria-hidden="true"><span /><span /><span /></div><h2>{title}</h2><p>{children}</p></div>; }
export function Field({ label, children }: {
    label: string;
    children: ReactNode;
}) { const generated=useId();const child=isValidElement<{id?:string}>(children)?children:undefined;const id=child?.props.id||generated;return <div className="field"><label htmlFor={id}>{label}</label>{child?cloneElement(child,{id}):children}</div>; }
