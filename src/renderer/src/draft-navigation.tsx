import {createContext,useContext,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';

interface DraftNavigation {
 register(token:symbol,dirty:boolean):void;
 forget(token:symbol):void;
 hasDirty():boolean;
 guard(action:()=>void,owner?:symbol):boolean;
 subscribe(listener:()=>void):()=>void;
 snapshot():number;
}
const Context=createContext<DraftNavigation|null>(null);

/** The app owns route changes; editors own whether their current data is saved. */
export function useDraftNavigation(){
 const drafts=useRef(new Set<symbol>()),listeners=useRef(new Set<()=>void>()),[pending,setPending]=useState<{action:()=>void;owner?:symbol}|null>(null);
 const changed=(before:number)=>{if(before!==drafts.current.size)for(const listener of listeners.current)listener();};
 const api=useMemo<DraftNavigation>(()=>({
  register(token,dirty){const before=drafts.current.size;if(dirty)drafts.current.add(token);else drafts.current.delete(token);changed(before);},
  forget(token){const before=drafts.current.size;drafts.current.delete(token);changed(before);},
  hasDirty:()=>drafts.current.size>0,
  guard(action,owner){if(owner?drafts.current.has(owner):drafts.current.size){setPending({action,owner});return false;}action();return true;},
  subscribe(listener){listeners.current.add(listener);return()=>{listeners.current.delete(listener);};},
  snapshot:()=>drafts.current.size,
 }),[]);
 const keep=()=>setPending(null),leave=()=>{const request=pending,before=drafts.current.size;if(request?.owner)drafts.current.delete(request.owner);else drafts.current.clear();changed(before);setPending(null);request?.action();};
 return {api,review:pending?<NavigationReview onKeep={keep} onLeave={leave}/>:null};
}
export function DraftNavigationProvider({value,children}:{value:DraftNavigation;children:ReactNode}){return <Context.Provider value={value}>{children}</Context.Provider>;}
export function useGuardedAction(){const context=useContext(Context);return context?.guard??((action:()=>void)=>{action();return true;});}

/** clear() is only for successful persistence of the exact submitted snapshot.
 * It takes effect synchronously, before an editor's automatic back() call.
 * A later clean→dirty transition registers again; unmount removes only this owner. */
export function useNavigationDraft(dirty:boolean){
 const context=useContext(Context),token=useRef(Symbol('editor'));
 useLayoutEffect(()=>{context?.register(token.current,dirty);return()=>context?.forget(token.current);},[context,dirty]);
 return Object.assign(()=>context?.forget(token.current),{guard:(action:()=>void)=>context?context.guard(action,token.current):(action(),true)});
}
function NavigationReview({onKeep,onLeave}:{onKeep:()=>void;onLeave:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useLayoutEffect(()=>{const node=dialog.current;if(!node)return;node.showModal();return()=>{if(node.open)node.close();};},[]);
 return <dialog ref={dialog} className="draft-navigation-review" aria-labelledby="draft-navigation-title" onCancel={event=>{event.preventDefault();onKeep();}}><h2 id="draft-navigation-title">Keep your unsaved edits?</h2><p>Continuing will discard edits that haven’t been saved.</p><div><button type="button" autoFocus onClick={onKeep}>Keep editing</button><button type="button" onClick={onLeave}>Leave and discard edits</button></div></dialog>;
}
