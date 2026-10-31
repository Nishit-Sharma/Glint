import {useEffect,useRef} from 'react';
import type {Task} from '../../core/types';
import {taskActivityBasis} from '../../shared/task-attention';

/** Seeing the latest saved turn is a navigation cursor, not evidence of reading or understanding. */
export function useConversationSeen(task:Task,active:boolean,onSeen?:((taskId:string,basis:string)=>void)){
 const root=useRef<HTMLDivElement>(null),callback=useRef(onSeen);callback.current=onSeen;
 const basis=taskActivityBasis(task);
 useEffect(()=>{
  const node=root.current,target=node?.querySelector<HTMLElement>('.conversation-turn:last-child');if(!active||!node||!target||!callback.current)return;
  let reported=false,intersects=false,frame=0;
  const report=()=>{if(reported||!intersects||document.visibilityState!=='visible'||!document.hasFocus()||node.closest('[hidden],[inert]')||!target.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return;reported=true;callback.current?.(task.id,basis);};
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(report);};
  const observer=new IntersectionObserver(entries=>{intersects=entries.some(entry=>entry.isIntersecting);schedule();},{threshold:0.01});observer.observe(target);
  const reveal=new MutationObserver(schedule),surface=node.closest('.workspace');if(surface)reveal.observe(surface,{attributes:true,attributeFilter:['hidden','inert','style','data-surface-reveal']});
  window.addEventListener('focus',schedule);document.addEventListener('visibilitychange',schedule);
  return()=>{cancelAnimationFrame(frame);observer.disconnect();reveal.disconnect();window.removeEventListener('focus',schedule);document.removeEventListener('visibilitychange',schedule);};
 },[task.id,basis,active]);
 return root;
}
