import {useId,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {X} from 'lucide-react';
import {cycleArtifactRegion} from '../artifact-keyboard';
import '../artifact-keyboard.css';

export function Inspector({title,active=true,onClose,children,fallbackFocus,artifactKeyboard=false}:{title:string;active?:boolean;onClose:()=>void;children:ReactNode;fallbackFocus?:()=>HTMLElement|null;artifactKeyboard?:boolean}){
 const [region,setRegion]=useState('');
 const helpId=useId();
 const focusFallback=useRef(fallbackFocus);focusFallback.current=fallbackFocus;
 const ref=useRef<HTMLElement>(null),opener=useRef<HTMLElement|undefined>(undefined);
 const lifetime=useRef(0),closing=useRef<symbol|undefined>(undefined);
 const available=(target:HTMLElement|null|undefined)=>{
  if(!target?.isConnected||target===document.body||target.closest('[hidden],[inert]')||target.matches(':disabled')||getComputedStyle(target).visibility!=='visible'||!target.getClientRects().length)return false;
  // Closed details may retain layout rectangles for content the browser cannot focus.
  for(let ancestor=target.parentElement;ancestor;ancestor=ancestor.parentElement)if(ancestor.tagName==='DETAILS'&&!(ancestor as HTMLDetailsElement).open){
   const summary=[...ancestor.children].find(child=>child.tagName==='SUMMARY');if(!summary?.contains(target))return false;
  }
  return true;
 };
 function close(){const attempt=Symbol();closing.current=attempt;try{onClose();}finally{queueMicrotask(()=>{if(ref.current?.isConnected&&closing.current===attempt)closing.current=undefined;});}}
 useLayoutEffect(()=>{if(!active)return;if(document.activeElement instanceof HTMLElement&&!ref.current?.contains(document.activeElement))opener.current=document.activeElement;ref.current?.querySelector<HTMLElement>('.inspector-toolbar button')?.focus({preventScroll:true});},[active,title]);
 useLayoutEffect(()=>{const generation=++lifetime.current;return()=>{
  const panel=ref.current,focused=document.activeElement,target=opener.current,ownClose=!!closing.current,main=panel?.closest('.workspace')?.querySelector<HTMLElement>('#main');
  const owned=!!panel&&!panel.hidden&&!!focused&&panel.contains(focused);
  queueMicrotask(()=>{
   if(lifetime.current!==generation||panel?.isConnected||!owned||document.querySelector('dialog[open]'))return;
   const current=document.activeElement;
   // The app's own Back/Escape close may first focus its generic task main.
   // Other navigation, controls and replacement inspectors keep their focus.
   if(current!==document.body&&current!==focused&&!(ownClose&&current===main&&available(main)))return;
   const next=available(target)?target:focusFallback.current?.();if(available(next))next!.focus({preventScroll:true});
  });
 };},[]);
 return <section ref={ref} className="context-inspector" data-kind={title} role="dialog" aria-label={title} aria-describedby={artifactKeyboard?helpId:undefined} hidden={!active} onKeyDown={event=>{if(artifactKeyboard&&event.key==='F6'&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&!event.nativeEvent.isComposing&&!event.defaultPrevented&&ref.current){event.preventDefault();setRegion(cycleArtifactRegion(ref.current,event.shiftKey)??'');}if(event.key==='Escape'&&!event.nativeEvent.isComposing&&!event.defaultPrevented&&!(event.target as Element).closest('.task-menu[open],.composer-options[open]')){event.preventDefault();close();}}}><header className="inspector-toolbar" data-artifact-region={artifactKeyboard?'Result controls':undefined}><h2 tabIndex={-1}>{title}</h2><button type="button" className="icon" aria-label="Back to task" title="Back to task" onClick={close}><X size={17}/></button></header><div className="inspector-content" data-artifact-region={artifactKeyboard?'Result content':undefined} role={artifactKeyboard?'region':undefined} aria-label={artifactKeyboard?'Result content':undefined} tabIndex={artifactKeyboard?0:undefined}>{artifactKeyboard&&<p id={helpId} className={title==='Files'||title==='Reading view'?'tiny':'artifact-region-status'}>F6 moves between result areas. Shift F6 moves back. Escape returns to the task.</p>}{children}</div>{artifactKeyboard&&<span className="artifact-region-status" role="status">{region}</span>}</section>;
}
