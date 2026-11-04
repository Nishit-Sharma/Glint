import {useEffect,useRef,type ReactNode} from 'react';
import {MoreHorizontal} from 'lucide-react';

/** Secondary task tools have one contextual entry point. No authority is
 * granted by opening or choosing this menu. */
export function TaskMenu({children,label='Task options',readState}:{children:ReactNode;label?:string;readState?:{unread:boolean;disabled:boolean;onChange:()=>void;error?:string}}){
 const ref=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{const outside=(event:PointerEvent)=>{if(ref.current?.open&&event.target instanceof Node&&!ref.current.contains(event.target))ref.current.open=false;};const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&ref.current?.open){ref.current.open=false;ref.current.querySelector<HTMLElement>('summary')?.focus();}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);};},[]);
 return <details className="task-menu" ref={ref}><summary role="button" aria-label={label} title={label}><MoreHorizontal size={18}/></summary><div className="task-menu-items" onClick={event=>{
  const button=(event.target as Element).closest('button'),menu=ref.current;if(!button||!menu)return;
  menu.open=false;if(event.detail!==0)return;
  // Navigation layout effects and native dialogs get first ownership of focus.
  queueMicrotask(()=>{
   const focused=document.activeElement;
   if(ref.current===menu&&!menu.open&&menu.isConnected&&menu.getClientRects().length&&!menu.closest('[hidden],[inert]')&&!document.querySelector('dialog[open]')&&(focused===document.body||focused===button))menu.querySelector<HTMLElement>('summary')?.focus({preventScroll:true});
  });
 }}>{readState&&<><button type="button" disabled={readState.disabled} onClick={readState.onChange}>{readState.unread?'Mark as read':'Mark as unread'}</button>{readState.error&&<p className="tiny" role="status">{readState.error}</p>}</>}{children}</div></details>;
}
