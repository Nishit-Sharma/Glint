import {createContext,useContext,useLayoutEffect,useRef,type ReactNode} from 'react';
import {revealSection} from '../generation';
import {PresentationSession} from '../motion-session';

const Ledger=createContext<{seen:Set<string>;arrivals:ReadonlySet<string>;presentation:PresentationSession}|null>(null);
const fallbackSession=new PresentationSession();
export function usePresentationSession(){return useContext(Ledger)?.presentation??fallbackSession;}
export function ArtifactMotionProvider({children,arrivals=[]}:{children:ReactNode;arrivals?:readonly string[]}){const seen=useRef(new Set<string>()),presentation=useRef(new PresentationSession());return <Ledger.Provider value={{seen:seen.current,arrivals:new Set(arrivals),presentation:presentation.current}}>{children}</Ledger.Provider>;}

/** Ready typed artifacts only. Text tokens stay in Streamdown. No parsing, IPC,
 * provider, capture or action authority is introduced by this cosmetic wrapper. */
export function ReadyArtifact({identity,arrivalIdentity=identity,variant='ui',enabled=true,children}:{identity:string;arrivalIdentity?:string;variant?:'ui'|'image';enabled?:boolean;children:ReactNode}){
 const root=useRef<HTMLDivElement>(null),context=useContext(Ledger),fallback=useRef(new Set<string>()),ledger=context?.seen??fallback.current,arrival=!!context?.arrivals.has(arrivalIdentity);
 useLayoutEffect(()=>{
  const target=root.current;if(!target)return;if(!enabled||!arrival||ledger.has(identity)||context?.presentation.exiting||target.closest('[hidden]')){target.dataset.artifactReveal='not a new visible arrival';return;}
  const parent=target.closest<HTMLElement>('[data-runtime-scope="whole-surface"]');let run:ReturnType<typeof revealSection>|undefined,closed=false;
  const consume=()=>{ledger.add(identity);if(ledger.size>2048)ledger.delete(ledger.values().next().value!);};
  const covered=()=>{if(variant==='ui'&&!closed){consume();target.dataset.artifactReveal='covered by whole surface';}};
  const start=()=>{
   if(closed||run||context?.presentation.exiting||ledger.has(identity))return;
   const state=parent?.dataset.surfaceReveal;
   if(state==='pending'||state==='running'){
    // The parent will acknowledge coverage only after its actual deferred
    // measurement, never merely because an older parent run is active.
    return;
   }
   if(!fullyVisible(target)){target.dataset.artifactReveal='waiting for visible area';return;}
   target.dataset.artifactReveal='pending';
   run=revealSection(target,outcome=>{target.dataset.artifactReveal=outcome.state;target.dataset.artifactRevealReason=outcome.reason;if(outcome.state==='running')consume();},{scope:'artifact',variant});
  };
  const observer=new MutationObserver(()=>{const state=parent?.dataset.surfaceReveal;if((state==='pending'||state==='running')&&run){run.cancel('whole surface owns this scene');run=undefined;}else start();});
  if(parent)observer.observe(parent,{attributes:true,attributeFilter:['data-surface-reveal']});
  const visibility=new IntersectionObserver(()=>start(),{threshold:[0,1]});visibility.observe(target);window.addEventListener('scroll',start,true);window.addEventListener('resize',start);
  target.addEventListener('companion:artifact-covered',covered);
  start();return()=>{closed=true;observer.disconnect();visibility.disconnect();window.removeEventListener('scroll',start,true);window.removeEventListener('resize',start);target.removeEventListener('companion:artifact-covered',covered);run?.cancel('artifact changed or removed');};
 },[identity,variant,enabled,ledger,arrival]);
 return <div ref={root} data-artifact-motion={identity} data-artifact-variant={variant}>{children}</div>;
}

function fullyVisible(target:HTMLElement){const r=target.getBoundingClientRect();if(r.width<=0||r.height<=0||r.left<-.5||r.top<-.5||r.right>innerWidth+.5||r.bottom>innerHeight+.5)return false;for(let parent=target.parentElement;parent;parent=parent.parentElement){const s=getComputedStyle(parent),p=parent.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(s.overflowY)&&(r.top<p.top+parent.clientTop-.5||r.bottom>p.top+parent.clientTop+parent.clientHeight+.5))return false;if(/auto|scroll|hidden|clip/.test(s.overflowX)&&(r.left<p.left+parent.clientLeft-.5||r.right>p.left+parent.clientLeft+parent.clientWidth+.5))return false;}return true;}
