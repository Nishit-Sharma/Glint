import {navigationFormBasis,type NavigationFormIdentity} from './learning-draft-basis';
import {createContext,useContext,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {LearningDraftValidationError,learningDraftJsonPolicy,serializeLearningDraftJson,type LearningDraftJson,type LearningDraftValidationReason} from '../../shared/learning-drafts';
import {useLearningDraft} from './learning-draft-context';

export type FormSubmission={state:unknown;confirmed:Promise<boolean>};
export const formSubmission=(state:unknown,result:void|Promise<boolean>)=>({state,confirmed:Promise.resolve(result).then(saved=>saved===true)});

type DraftGroup=symbol|string;
type DraftSurface='workspace'|'companion';
type DraftOwner=symbol|{group?:DraftGroup;surface?:DraftSurface;slot?:string;except?:symbol};
interface DraftNavigation {
 register(token:symbol,dirty:boolean,onDiscard?:()=>void,group?:DraftGroup,surface?:DraftSurface,slot?:string):void;
 forget(token:symbol):void;
 hasDirty(owner?:DraftOwner):boolean;
 guard(action:()=>void,owner?:DraftOwner):boolean;
 subscribe(listener:()=>void):()=>void;
 snapshot():number;
}
const Context=createContext<DraftNavigation|null>(null);
const Group=createContext<DraftGroup|undefined>(undefined);
const Surface=createContext<DraftSurface>('workspace');
export function DraftNavigationSurface({surface,children}:{surface:DraftSurface;children:ReactNode}){return <Surface.Provider value={surface}>{children}</Surface.Provider>;}
/** A phase change replaces only this mounted lesson; app routes remain global. */
export function DraftNavigationScope({identity,children}:{identity?:string;children:ReactNode}){const fallback=useRef(Symbol('lesson'));return <Group.Provider value={identity??fallback.current}>{children}</Group.Provider>;}

/** The app owns route changes; editors own whether their current data is saved. */
export function useDraftNavigation(){
 const drafts=useRef(new Map<symbol,{discard?:()=>void;group?:DraftGroup;surface?:DraftSurface;slot?:string}>()),listeners=useRef(new Set<()=>void>()),pending=useRef<{action:()=>void;owner?:DraftOwner}|null>(null),[reviewing,setReviewing]=useState(false);
 const affected=(owner?:DraftOwner)=>[...drafts.current].filter(([token,draft])=>!owner||(typeof owner==='symbol'?token===owner:(owner.group===undefined||draft.group===owner.group)&&(owner.surface===undefined||draft.surface===owner.surface)&&(owner.slot===undefined||draft.slot===owner.slot)&&token!==owner.except));
 const changed=(before:number)=>{if(before!==drafts.current.size)for(const listener of listeners.current)listener();};
 const api=useMemo<DraftNavigation>(()=>({
  register(token,dirty,onDiscard,group,surface,slot){const before=drafts.current.size;if(dirty)drafts.current.set(token,{discard:onDiscard,group,surface,slot});else drafts.current.delete(token);changed(before);},
  forget(token){const before=drafts.current.size;drafts.current.delete(token);changed(before);},
  hasDirty:owner=>affected(owner).length>0,
  guard(action,owner){if(pending.current)return false;if(affected(owner).length){pending.current={action,owner};setReviewing(true);return false;}action();return true;},
  subscribe(listener){listeners.current.add(listener);return()=>{listeners.current.delete(listener);};},
  snapshot:()=>drafts.current.size,
 }),[]);
 const keep=()=>{pending.current=null;setReviewing(false);},leave=()=>{const request=pending.current;if(!request)return;pending.current=null;const before=drafts.current.size,owned=affected(request.owner);for(const [token] of owned)drafts.current.delete(token);changed(before);setReviewing(false);for(const [,draft] of owned)draft.discard?.();request.action();};
 return {api,review:reviewing?<NavigationReview onKeep={keep} onLeave={leave}/>:null};
}
export function DraftNavigationProvider({value,children}:{value:DraftNavigation;children:ReactNode}){return <Context.Provider value={value}>{children}</Context.Provider>;}
export function useGuardedAction(){const context=useContext(Context),group=useContext(Group);return (action:()=>void)=>context?context.guard(action,group?{group}:undefined):(action(),true);}

/** clear() is only for successful persistence of the exact submitted snapshot.
 * It takes effect synchronously, before an editor's automatic back() call.
 * A later clean→dirty transition registers again; unmount removes only this owner. */
export function useNavigationDraft(dirty:boolean,onDiscard?:()=>void,slot?:string){
 const context=useContext(Context),group=useContext(Group),surface=useContext(Surface),token=useRef(Symbol('editor')),discard=useRef(onDiscard);discard.current=onDiscard;
 useLayoutEffect(()=>{context?.register(token.current,dirty,()=>discard.current?.(),group,surface,slot);return()=>context?.forget(token.current);},[context,group,surface,slot,dirty]);
 return Object.assign(()=>context?.forget(token.current),{guard:(action:()=>void)=>context?context.guard(action,token.current):(action(),true),guardOthers:(action:()=>void)=>context&&group!==undefined&&slot!==undefined?context.guard(action,{group,slot,except:token.current}):(action(),true)});
}

/** Scoped learning forms share durable raw drafts; standalone examples retain the
 * memory guard. Only an acknowledged exact submitted generation is cleared. */
export function useNavigationForm<T extends LearningDraftJson>(initial:T,committedState:unknown,onDiscard?:()=>void,replacedSlot?:string,identity?:NavigationFormIdentity){
 const [draft,setDraft]=useState(initial),initialSignature=JSON.stringify(initial),snapshot=JSON.stringify(draft),stateSignature=JSON.stringify(committedState);
 let basis='';try{basis=navigationFormBasis(initial,identity);}catch(error){if(!(error instanceof LearningDraftValidationError))throw error;}
 const saved=useLearningDraft(initial,identity?.slot??'',basis,identity?.variableArrays);
 const ownerKey=saved?JSON.stringify([saved.owner,saved.slot]):'';
 const [notice,setNotice]=useState<{ownerKey:string;message:string}|null>(null);
 const dispatchFence=identity?.dispatchFence;
 const latest=useRef({saved,initial,basis,stateSignature,dispatchFence,variableArrays:identity?.variableArrays});
 const mounted=useRef(true);
 latest.current={saved,initial,basis,stateSignature,dispatchFence,variableArrays:identity?.variableArrays};
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useLayoutEffect(()=>{setNotice(null);},[ownerKey,basis]);
 const previousInitial=useRef(initialSignature),submission=useRef<{state:string;snapshot:string}|null>(null);
 useLayoutEffect(()=>{
  if(saved)return;
  const sent=submission.current;
  if(sent?.state===stateSignature){submission.current=null;setDraft(current=>JSON.stringify(current)===sent.snapshot?initial:current);}
  else if(previousInitial.current!==initialSignature&&snapshot===previousInitial.current)setDraft(initial);
  previousInitial.current=initialSignature;
 },[initialSignature,stateSignature]);
 const dirty=snapshot!==initialSignature;
 const navigation=useNavigationDraft(!saved&&dirty,()=>{submission.current=null;setDraft(initial);onDiscard?.();},replacedSlot);
 return {draft:saved?.form.value??draft,rejectEdit(reason:LearningDraftValidationReason){return saved?saved.cache.rejectEdit(saved.owner,saved.slot,initial,basis,reason,identity?.variableArrays):{kind:'held' as const,reason:'unavailable' as const};},setDraft(next:T|((current:T)=>T)){if(saved){const result=saved.cache.tryEdit(saved.owner,saved.slot,initial,basis,current=>typeof next==='function'?next(current):next,identity?.variableArrays);if(result.kind==='accepted')setNotice(null);return result;}setNotice(null);setDraft(next);return {kind:'accepted' as const};},dirty:saved?saved.form.status==='ready'&&serializeLearningDraftJson(saved.form.value,learningDraftJsonPolicy(saved.owner,saved.slot))!==serializeLearningDraftJson(initial,learningDraftJsonPolicy(saved.owner,saved.slot)):dirty,rejected:!!saved?.rejection,held:!!saved&&(saved.frozen||saved.maintenance||saved.form.status!=='ready'||!!saved.form.error),feedback:<>{saved?.feedback}{saved?.frozen?<p role="status">Editing is paused while the app finishes saving before closing. Your edits are kept; editing resumes if closing is cancelled.</p>:saved?.maintenance&&!saved.form.error&&<p role="status">Practice draft maintenance is in progress. Your edits are kept; editing will resume when it finishes.</p>}{notice?.ownerKey===ownerKey&&saved?.form.status==='ready'&&!saved.form.error&&!saved.maintenance&&!saved.frozen&&<p role="status">{notice.message}</p>}</>,submit(send:()=>FormSubmission|undefined){
  if(saved?.cache.getEditRejection(saved.owner,saved.slot))return false;
  setNotice(null);
  if(saved){
   if(saved.cache.getSnapshot().frozen||saved.cache.getSnapshot().maintenance||saved.form.status!=='ready'||saved.form.error)return false;
   const token=saved.cache.capture(saved.owner,saved.slot);
   void (async()=>{await saved.cache.flushForm(saved.owner,saved.slot);
    const current=latest.current,active=current.saved;
    if(!mounted.current||!active||active.cache!==saved.cache||active.slot!==saved.slot||JSON.stringify(active.owner)!==JSON.stringify(saved.owner))return;
    const form=active.cache.readForm(active.owner,active.slot,current.initial,current.basis,current.variableArrays);
    if(current.basis!==basis||current.stateSignature!==stateSignature||current.dispatchFence!==dispatchFence){
     if(current.basis===basis&&form.status==='ready'&&!form.error)setNotice({ownerKey,message:'The example changed while saving. Review and apply your edits again.'});
     return;
    }
    if(active.cache.getSnapshot().frozen||active.cache.getSnapshot().maintenance||active.cache.getEditRejection(active.owner,active.slot)||form.status!=='ready'||form.error)return;
    await saved.cache.runSubmission(async()=>{const result=send();if(result&&await result.confirmed&&token)saved.cache.acknowledge(token);});
   })().catch(()=>{});return true;
  }
  const dispatch=()=>{submission.current=null;const expected=send()?.state;if(expected!==undefined)submission.current={state:JSON.stringify(expected),snapshot};};if(replacedSlot)return navigation.guardOthers(dispatch);dispatch();return true;
 }};
}
function NavigationReview({onKeep,onLeave}:{onKeep:()=>void;onLeave:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useLayoutEffect(()=>{const node=dialog.current;if(!node)return;node.showModal();return()=>{if(node.open)node.close();};},[]);
 return <dialog ref={dialog} className="draft-navigation-review" aria-labelledby="draft-navigation-title" onCancel={event=>{event.preventDefault();onKeep();}}><h2 id="draft-navigation-title">Keep your unsaved edits?</h2><p>Continuing will discard edits that haven’t been saved.</p><div><button type="button" autoFocus onClick={onKeep}>Keep editing</button><button type="button" onClick={onLeave}>Leave and discard edits</button></div></dialog>;
}
