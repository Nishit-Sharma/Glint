import {useId,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {X} from 'lucide-react';
import {cycleArtifactRegion} from '../artifact-keyboard';
import '../artifact-keyboard.css';

export function Inspector({title,active=true,onClose,children,fallbackFocus,artifactKeyboard=false}:{title:string;active?:boolean;onClose:()=>void;children:ReactNode;fallbackFocus?:()=>HTMLElement|null;artifactKeyboard?:boolean}){
 const [region,setRegion]=useState('');
 const helpId=useId();
 const focusFallback=useRef(fallbackFocus);focusFallback.current=fallbackFocus;
 const ref=useRef<HTMLElement>(null),opener=useRef<HTMLElement|undefined>(undefined);
 useLayoutEffect(()=>{if(!active)return;if(document.activeElement instanceof HTMLElement&&!ref.current?.contains(document.activeElement))opener.current=document.activeElement;ref.current?.querySelector<HTMLElement>('.inspector-toolbar button')?.focus({preventScroll:true});},[active,title]);
 useLayoutEffect(()=>()=>{const target=opener.current;queueMicrotask(()=>{const available=target?.isConnected&&target!==document.body&&!target.closest('[hidden],[inert]')&&!!target.getClientRects().length;const next=available?target:focusFallback.current?.();next?.focus({preventScroll:true});});},[]);
 return <section ref={ref} className="context-inspector" data-kind={title} role="dialog" aria-label={title} aria-describedby={artifactKeyboard?helpId:undefined} hidden={!active} onKeyDown={event=>{if(artifactKeyboard&&event.key==='F6'&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&!event.nativeEvent.isComposing&&!event.defaultPrevented&&ref.current){event.preventDefault();setRegion(cycleArtifactRegion(ref.current,event.shiftKey)??'');}if(event.key==='Escape'&&!event.nativeEvent.isComposing&&!event.defaultPrevented&&!(event.target as Element).closest('.task-menu[open],.composer-options[open]')){event.preventDefault();onClose();}}}><header className="inspector-toolbar" data-artifact-region={artifactKeyboard?'Result controls':undefined}><h2 tabIndex={-1}>{title}</h2><button type="button" className="icon" aria-label="Back to task" title="Back to task" onClick={onClose}><X size={17}/></button></header><div className="inspector-content" data-artifact-region={artifactKeyboard?'Result content':undefined} role={artifactKeyboard?'region':undefined} aria-label={artifactKeyboard?'Result content':undefined} tabIndex={artifactKeyboard?0:undefined}>{artifactKeyboard&&<p id={helpId} className={title==='Files'||title==='Reading view'?'tiny':'artifact-region-status'}>F6 moves between result areas. Shift F6 moves back. Escape returns to the task.</p>}{children}</div>{artifactKeyboard&&<span className="artifact-region-status" role="status">{region}</span>}</section>;
}
