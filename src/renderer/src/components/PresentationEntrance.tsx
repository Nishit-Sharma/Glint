import {useEffect} from 'react';
import {usePresentationSession} from './ReadyArtifact';

/** The host hides/resizes first. Show only after the correct held DOM commits;
 * no native frame can expose the old anchor at expanded panel dimensions. */
export function PresentationEntrance(){
 const session=usePresentationSession();
 useEffect(()=>{let current:{id:string;cancel:()=>void}|undefined;
  const unsubscribe=window.companion?.subscribe(event=>{
   if(event.type==='presentation.cancel'){if(event.exitId===current?.id){current.cancel();current=undefined;}return;}
   if(event.type!=='presentation.enter')return;current?.cancel();if(!session.beginEntrance())return;
   const root=document.getElementById('root')!,version=session.entranceVersion;let closed=false,showRequested=false,timer:ReturnType<typeof setTimeout>;
   root.dataset.presentationOwner=event.entranceId;root.style.visibility='hidden';window.dispatchEvent(new Event('companion:presentation-exit'));
   const restore=()=>{if(root.dataset.presentationOwner===event.entranceId)root.style.visibility='';};
   const finish=()=>{if(closed)return;closed=true;observer.disconnect();clearTimeout(timer);restore();};
   const cancel=()=>{finish();session.claimStartup(version);};current={id:event.entranceId,cancel};
   const check=()=>{if(closed||showRequested)return;const target=document.querySelector<HTMLElement>(`.${event.mode==='companion'?'compact-companion':'workspace'}:not([hidden])`);if(!target||target.dataset.presentationEntrance!==String(version))return;showRequested=true;
    const held=target.dataset.surfaceReveal==='pending'||target.dataset.surfaceReveal==='running';if(held)restore();
    observer.disconnect();clearTimeout(timer);void window.companion.invoke({type:'presentation.show',entranceId:event.entranceId}).then(finish,cancel);
   };
   const observer=new MutationObserver(check);observer.observe(root,{attributes:true,subtree:true,attributeFilter:['hidden','data-presentation-entrance','data-surface-reveal']});timer=setTimeout(cancel,2500);queueMicrotask(check);
  });return()=>{current?.cancel();unsubscribe?.();};
 },[session]);return null;
}
