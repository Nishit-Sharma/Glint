import {useLayoutEffect,useRef,type ReactNode} from 'react';
import {X} from 'lucide-react';

export function Inspector({title,active=true,onClose,children}:{title:string;active?:boolean;onClose:()=>void;children:ReactNode}){
 const ref=useRef<HTMLElement>(null),opener=useRef<HTMLElement|undefined>(undefined);
 useLayoutEffect(()=>{if(!active)return;if(document.activeElement instanceof HTMLElement&&!ref.current?.contains(document.activeElement))opener.current=document.activeElement;ref.current?.querySelector<HTMLElement>('.inspector-toolbar button')?.focus({preventScroll:true});},[active,title]);
 useLayoutEffect(()=>()=>{const target=opener.current;queueMicrotask(()=>{if(target?.isConnected&&!target.closest('[hidden],[inert]'))target.focus({preventScroll:true});});},[]);
 return <section ref={ref} className="context-inspector" data-kind={title} role="dialog" aria-label={title} hidden={!active} onKeyDown={event=>{if(event.key==='Escape'&&!event.nativeEvent.isComposing&&!event.defaultPrevented&&!(event.target as Element).closest('.task-menu[open],.composer-options[open]')){event.preventDefault();onClose();}}}><header className="inspector-toolbar"><h2>{title}</h2><button type="button" className="icon" aria-label="Back to task" title="Back to task" onClick={onClose}><X size={17}/></button></header><div className="inspector-content">{children}</div></section>;
}
