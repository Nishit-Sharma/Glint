import {useEffect,useLayoutEffect,useRef,type RefObject} from 'react';
import {createUpwardScrollDetector} from './vendor/t3code/timelineScrollTarget';

/** View position belongs to task + page, independently of native presentation. */
export function useWorkspaceNavigation(main:RefObject<HTMLElement|null>,key:string,visible:boolean,contentVersion:string,windowSetup=false){
 const records=useRef(new Map<string,{top:number;atEnd:boolean;bottom:number;focus?:string}>()),lastContent=useRef({key,contentVersion}),lastView=useRef({key,visible,windowSetup});
 useLayoutEffect(()=>{
  const previous=lastView.current;lastView.current={key,visible,windowSetup};
  const node=main.current;if(!node||!visible)return;
  const record=records.current.get(key)??{top:0,atEnd:true,bottom:Math.max(0,node.scrollHeight-node.clientHeight)};records.current.set(key,record);
  node.scrollTop=record.top;
  record.bottom=Math.max(0,node.scrollHeight-node.clientHeight);
  const target=record.focus?[...node.querySelectorAll<HTMLElement>('[data-view-focus]')].find(el=>el.dataset.viewFocus===record.focus):undefined;
  const setupOnly=previous.key===key&&previous.visible===visible&&previous.windowSetup!==windowSetup;
  // A delayed setup transition must yield to a connected control the user chose.
  if(!setupOnly||document.activeElement===document.body||document.activeElement===node)(target??node).focus({preventScroll:true});
  const upward=createUpwardScrollDetector({top:node.scrollTop,height:node.scrollHeight});
  const scroll=()=>{record.top=node.scrollTop;if(upward({top:node.scrollTop,height:node.scrollHeight}))record.atEnd=false;else if(node.scrollHeight-node.clientHeight-node.scrollTop<1)record.atEnd=true;};
  const focus=(event:FocusEvent)=>{const item=event.target instanceof Element?event.target.closest<HTMLElement>('[data-view-focus]'):undefined;if(item)record.focus=item.dataset.viewFocus;};
  node.addEventListener('scroll',scroll,{passive:true});node.addEventListener('focusin',focus);
  return()=>{node.removeEventListener('scroll',scroll);node.removeEventListener('focusin',focus);};
 },[main,key,visible,windowSetup]);
 useLayoutEffect(()=>{
  const previous=lastContent.current;lastContent.current={key,contentVersion};if(previous.key!==key||previous.contentVersion===contentVersion||!visible)return;
  const node=main.current,record=records.current.get(key);if(!node||!record)return;
  // A return-to-end scroll event can arrive after the next streamed render.
  // Compare against the preceding content boundary before replacing it.
  const returnedToEnd=node.scrollTop>=record.bottom-1;
  record.bottom=Math.max(0,node.scrollHeight-node.clientHeight);
  if(!record.atEnd&&!returnedToEnd)return;
  record.atEnd=true;
  const frame=requestAnimationFrame(()=>{node.scrollTop=node.scrollHeight;record.top=node.scrollTop;});return()=>cancelAnimationFrame(frame);
 },[main,key,visible,contentVersion]);
 useEffect(()=>{
  const escape=(event:KeyboardEvent)=>{
   if(event.key!=='Escape'||document.querySelector('dialog[open]'))return;
   const focused=document.activeElement;
   const candidates=[...document.querySelectorAll<HTMLDetailsElement>('details.composer-options[open],details.request-sources[open]')].filter(node=>node.getClientRects().length>0);
   const node=[...candidates].reverse().find(node=>!!focused&&node.contains(focused))??candidates.at(-1);if(!node)return;
   event.preventDefault();event.stopPropagation();node.open=false;node.querySelector<HTMLElement>('summary')?.focus({preventScroll:true});
  };document.addEventListener('keydown',escape,true);return()=>document.removeEventListener('keydown',escape,true);
 },[]);
}
