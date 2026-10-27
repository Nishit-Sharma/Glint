import {useEffect} from 'react';
import {exitPresentation} from '../exit-presentation';
import {usePresentationSession} from './ReadyArtifact';
import type {CompanionEvent} from '../../../shared/bridge';

export function PresentationExit(){
 const session=usePresentationSession();
 useEffect(()=>{let current:{id:string;controller:AbortController;done:Promise<void>}|undefined;
  const unsubscribe=window.companion?.subscribe(event=>{
   if(event.type==='presentation.cancel'){if(event.exitId===current?.id)current.controller.abort();return;}
   if(event.type!=='presentation.exit'||current&&!current.controller.signal.aborted)return;
   const previous=current,item={id:event.exitId,controller:new AbortController(),done:Promise.resolve()};current=item;
   item.done=(async()=>{await previous?.done;if(item.controller.signal.aborted)return;await transition(event,item.controller);if(current===item)current=undefined;})();
  });
  async function transition(event:Extract<CompanionEvent,{type:'presentation.exit'}>,controller:AbortController){
   const terminal=event.purpose!=='collapse';session.beginExit(terminal);const root=document.getElementById('root');if(root)root.dataset.presentationOwner=event.exitId;const cleanup=await exitPresentation(event.dataUrl,controller.signal);let restored=false;
   try{
    if(controller.signal.aborted)return;
    await window.companion.invoke({type:'presentation.finish',exitId:event.exitId});
    if(!terminal&&!controller.signal.aborted){await anchorCommitted(controller.signal);if(controller.signal.aborted)return;cleanup(true);restored=true;session.endPresentationExit();await window.companion.invoke({type:'presentation.reveal',exitId:event.exitId});}
   }catch{}finally{if(!restored)cleanup(!terminal);if(!terminal)session.endPresentationExit();}
  }
  return()=>{current?.controller.abort();unsubscribe?.();};
 },[session]);return null;
}

/** Native window is hidden while the new size/mode commits. RAF can be paused
 * in hidden windows, so observe the actual anchor DOM instead of waiting frames. */
function anchorCommitted(signal:AbortSignal){return new Promise<void>((resolve,reject)=>{
 const ready=()=>!!document.querySelector('.anchor-wrap:not([hidden])');if(ready()){resolve();return;}
 const finish=(ok:boolean)=>{observer.disconnect();clearTimeout(timer);signal.removeEventListener('abort',abort);ok?resolve():reject(Error('Presentation changed before the anchor was ready.'));};
 const abort=()=>finish(false),observer=new MutationObserver(()=>{if(ready())finish(true);}),timer=setTimeout(()=>finish(false),1000);
 observer.observe(document.getElementById('root')!,{subtree:true,attributes:true,attributeFilter:['hidden']});signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
});}
