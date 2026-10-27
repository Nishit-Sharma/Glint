import {useEffect,useLayoutEffect,useRef,useSyncExternalStore,type ReactNode} from 'react';
import {revealSection} from '../generation';
import {usePresentationSession} from './ReadyArtifact';

type SurfaceOwner={target:HTMLElement;opacity:string;entrance:number;ready:boolean;frame?:number;generation?:ReturnType<typeof revealSection>};

/** Startup and explicit host openings renew entrance. Ordinary view changes
 * never authorize a new entrance. Content updates keep the same presentation
 * owner; explicit interaction, geometry and real removal may still cancel. */
export function GeneratedSurface({active,identity,ready=true,live=false,skipReason,className,label,children}:{active:boolean;identity:string;ready?:boolean;live?:boolean;skipReason?:string;className:string;label?:string;children:ReactNode}){
 const element=useRef<HTMLElement>(null),owner=useRef<SurfaceOwner|undefined>(undefined),session=usePresentationSession(),liveNow=useRef(live);liveNow.current=live;
 const entrance=useSyncExternalStore(session.subscribe,session.snapshot);
 useLayoutEffect(()=>{
  const target=element.current;if(!target||!active)return;
  target.dataset.presentationEntrance=String(entrance);
  if(skipReason){session.claimStartup(entrance);target.dataset.surfaceReveal='skipped';target.dataset.surfaceRevealReason=skipReason;return;}
  if(!session.startupAvailable){target.dataset.surfaceReveal='settled';target.dataset.surfaceRevealReason='entrance already used';return;}
  const opacity=target.style.opacity;target.style.opacity='0';target.dataset.surfaceReveal='pending';
  const prepared:SurfaceOwner={target,opacity,entrance,ready};owner.current=prepared;
  // Only this layout owner may restore opacity or cancel its generation.
  // An older passive cleanup must never release a replacement owner's hold.
  return()=>{
   if(owner.current===prepared)owner.current=undefined;
   if(prepared.frame!==undefined)cancelAnimationFrame(prepared.frame);
   prepared.generation?.cancel('surface changed or unmounted');if(!prepared.generation)target.style.opacity=opacity;
   if(ready&&target.hidden)session.claimStartup(entrance);
   // A real removal retires the claim; connected StrictMode replay does not.
   queueMicrotask(()=>{if(!target.isConnected)session.claimStartup(entrance);});
  };
 },[active,ready,session,entrance,skipReason]);
 useEffect(()=>{
  const prepared=owner.current;if(!prepared||!active||!ready||prepared.entrance!==entrance||prepared.ready!==ready)return;
  // A layout-scheduled frame can precede the initial passive StrictMode replay.
  // Schedule here so replay cancels the old frame before it can claim startup.
  const {target,opacity}=prepared;
  const frame=requestAnimationFrame(()=>{
   if(owner.current!==prepared)return;
   if(!session.claimStartup(entrance)){target.style.opacity=opacity;target.dataset.surfaceReveal='settled';return;}
   target.style.opacity=opacity;
   prepared.generation=revealSection(target,outcome=>{target.dataset.surfaceReveal=outcome.state;target.dataset.surfaceRevealReason=outcome.reason;},{scope:'surface',live:()=>liveNow.current});
  });
  prepared.frame=frame;
  // Capture this frame; never restore styles or cancel a newer layout owner.
  return()=>{cancelAnimationFrame(frame);};
 },[active,ready,session,entrance]);
 return <section ref={element} className={className} hidden={!active} aria-label={label} data-runtime-scope="whole-surface" data-surface-scene={identity}>{children}</section>;
}
