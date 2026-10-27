import {useId,cloneElement,isValidElement,type ReactNode} from 'react';
import type {ExportCommand,ExportReply,OtherCommand} from '../../shared/export-contract';
export interface Run {
    <C extends ExportCommand>(cmd:C,success?:string):Promise<ExportReply<C>|undefined>;
    <T=unknown>(cmd:OtherCommand,success?:string):Promise<T|undefined>;
}
export type RequestKind = 'explain'|'create'|'experiment'|'procedure';
/** Original paired-window mark. Filled shapes remain legible at 23px. */
export function CompanionMark({ active = false }: { active?: boolean }) {
    return <svg viewBox="0 0 48 48" className={'character companion-mark' + (active ? ' working' : '')} aria-hidden="true" focusable="false">
        <path d="M27 6H17C10.925 6 6 10.925 6 17v10a4 4 0 0 0 8 0v-9a4 4 0 0 1 4-4h9a4 4 0 0 0 0-8Z"/>
        <path d="M21 42h10c6.075 0 11-4.925 11-11V21a4 4 0 0 0-8 0v9a4 4 0 0 1-4 4h-9a4 4 0 0 0 0 8Z"/>
    </svg>;
}
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
