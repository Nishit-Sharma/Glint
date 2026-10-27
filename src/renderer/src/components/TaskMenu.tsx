import {useEffect,useRef,type ReactNode} from 'react';
import {MoreHorizontal} from 'lucide-react';

/** Secondary task tools have one contextual entry point. No authority is
 * granted by opening or choosing this menu. */
export function TaskMenu({children,label='Task options'}:{children:ReactNode;label?:string}){
 const ref=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{const outside=(event:PointerEvent)=>{if(ref.current?.open&&event.target instanceof Node&&!ref.current.contains(event.target))ref.current.open=false;};const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&ref.current?.open){ref.current.open=false;ref.current.querySelector<HTMLElement>('summary')?.focus();}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);};},[]);
 return <details className="task-menu" ref={ref}><summary role="button" aria-label={label} title={label}><MoreHorizontal size={18}/></summary><div className="task-menu-items" onClick={event=>{if((event.target as Element).closest('button')&&ref.current)ref.current.open=false;}}>{children}</div></details>;
}
