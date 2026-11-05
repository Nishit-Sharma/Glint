import {useEffect,useRef,useState} from 'react';
import type {HostStatus} from '../../shared/bridge';
import {Button} from './ui';
import {changeWarning,collectWarnings,createWarningStore,dismissReviewed,hostWarningDiagnostics,isWarningKeepKey,queueWarningWork,WarningCapacityError,type WarningDiagnostic,type WarningSnapshot} from './warning-retention';
import './warning-viewer.css';

export function WarningViewer({host}:{host?:HostStatus}){
 const [snapshot,setSnapshot]=useState<WarningSnapshot>(),[error,setError]=useState(''),[open,setOpen]=useState(false),[selected,setSelected]=useState<string>(),[busy,setBusy]=useState(false),[collectionBlocked,setCollectionBlocked]=useState(false),[,setReviewTick]=useState(0);
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),reviewed=useRef(new Set<string>()),current=useRef<WarningSnapshot|undefined>(undefined),alive=useRef(true);
 const pending=useRef(0),view=useRef<{open:boolean;selected?:string;error:string;collectionBlocked:boolean}>({open:false,error:'',collectionBlocked:false});
 const diagnostics=JSON.stringify(hostWarningDiagnostics(host)),observed=host?JSON.parse(diagnostics) as WarningDiagnostic[]:undefined,latestObserved=useRef(observed);latestObserved.current=observed;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 function problem(message:string,capacity=false){view.current.error=message;view.current.collectionBlocked=capacity;if(alive.current){setError(message);setCollectionBlocked(capacity);}}
 function publish(next:WarningSnapshot){current.current=next;if(alive.current)setSnapshot(next);}
 function store(){
  if(!navigator.locks)throw Error('Warnings can’t be kept or dismissed in this window right now.');
  return createWarningStore(localStorage,async work=>await navigator.locks.request('glint.warning-review.v1',()=>work()));
 }
 function enqueue<T,>(work:()=>Promise<T>):Promise<T>{
  pending.current++;if(alive.current)setBusy(true);
  const result=queueWarningWork(work);
  return result.finally(()=>{pending.current--;if(alive.current)setBusy(pending.current>0);});
 }
 async function update(change:(value:WarningSnapshot)=>WarningSnapshot,capacityRecovery?:'dismiss'|'release'){
  if(pending.current||!alive.current||view.current.error&&!(capacityRecovery&&view.current.collectionBlocked))return false;
  const expected=current.current?.revision,preserveProblem=capacityRecovery==='release'?view.current.error:'';
  return enqueue(async()=>{
   try{
    if(!alive.current||expected===undefined)throw Error('Reload the warning list before continuing.');
    publish(await store().update(expected,change));problem(preserveProblem,!!preserveProblem);return true;
   }catch{problem('Warnings could not be saved, or changed in another window. Your review is still open. Reload the list before continuing.');return false;}
  });
 }
 async function reconcile(observed:WarningDiagnostic[]|undefined,resetReview=false){
  return enqueue(async()=>{
   let loaded:WarningSnapshot|undefined;
   try{
    const storage=store();loaded=storage.read();
    const next=observed?await storage.update(loaded.revision,value=>collectWarnings(value,observed,()=>crypto.randomUUID(),new Date().toISOString())):loaded;
    publish(next);if(resetReview){reviewed.current.clear();if(alive.current)setReviewTick(value=>value+1);}problem('');
   }catch(cause){if(cause instanceof WarningCapacityError&&loaded)publish(loaded);problem(cause instanceof Error?cause.message:'The warning list could not be opened.',cause instanceof WarningCapacityError);}
  });
 }
 useEffect(()=>{void reconcile(host?JSON.parse(diagnostics):undefined);},[diagnostics,!!host]);
 useEffect(()=>{
  const changed=(event:StorageEvent)=>{if(event.key===null||event.key==='glint.warning-review.v1')problem('Warnings changed in another window. Reload before continuing.');};
  window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);
 },[]);
 const warnings=snapshot?.warnings.filter(warning=>warning.state!=='dismissed')??[];
 const warning=warnings.find(item=>item.id===selected);
 useEffect(()=>{
  const element=dialog.current;
  if(open&&element&&!element.open)element.showModal();
  if(!open&&element?.open)element.close();
 },[open]);
 function focused(){return alive.current&&view.current.open&&!!dialog.current?.open&&document.visibilityState==='visible'&&document.hasFocus()&&dialog.current.contains(document.activeElement);}
 function markReviewed(){
  const id=view.current.selected;
  if(id&&focused()&&current.current?.warnings.some(item=>item.id===id&&item.state!=='dismissed')&&!reviewed.current.has(id)){reviewed.current.add(id);setReviewTick(value=>value+1);}
 }
 useEffect(()=>{if(open)markReviewed();},[open,selected,snapshot]);
 function hide(){view.current.open=false;if(alive.current){setOpen(false);trigger.current?.focus();}}
 async function close(){
  if(pending.current||!alive.current||!view.current.open)return;
  if(view.current.error&&!view.current.collectionBlocked){hide();return;}
  const retryCollection=view.current.collectionBlocked,ids=new Set(reviewed.current);
  if(await update(value=>dismissReviewed(value,ids),retryCollection?'dismiss':undefined)){reviewed.current.clear();hide();if(retryCollection)void reconcile(latestObserved.current);}
 }
 function keep(kept=true){
  const releaseCapacity=!kept&&view.current.collectionBlocked;
  if(!warning||pending.current||view.current.error&&!releaseCapacity||!focused()||view.current.selected!==warning.id)return;
  const actual=current.current?.warnings.find(item=>item.id===warning.id);
  if(!actual||actual.state==='dismissed'||actual.state!==warning.state)return;
  void update(value=>changeWarning(value,warning.id,kept),releaseCapacity?'release':undefined);
 }
 return <section className="warning-review-entry" aria-label="Shortcut warning review">
  <button ref={trigger} type="button" onClick={()=>{if(!alive.current||view.current.open)return;reviewed.current.clear();const id=warnings[0]?.id;view.current.open=true;view.current.selected=id;setSelected(id);setOpen(true);}} className="warning-review-trigger" title="Warnings" data-count={warnings.length}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg><span className="sr-only">Warnings{warnings.length?' · ':''}</span>{warnings.length?<span className="warning-review-count">{warnings.length}</span>:null}</button>
  {error&&!open&&<span role="status">Warnings need attention</span>}
  <dialog ref={dialog} className="warning-viewer" aria-labelledby="warning-viewer-title" aria-describedby="warning-viewer-help" onCancel={event=>{event.preventDefault();void close();}} onFocusCapture={markReviewed} onKeyDown={event=>{
   const target=event.target as HTMLElement;
   if(isWarningKeepKey({...event,isComposing:event.nativeEvent.isComposing},!!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'),focused())&&warning&&!pending.current&&!view.current.error&&view.current.selected===warning.id){event.preventDefault();keep();}
  }}>
   <header className="warning-viewer-heading"><h2 id="warning-viewer-title">Shortcut warnings</h2><Button disabled={busy} onClick={()=>void close()}>{error&&!collectionBlocked?'Close without dismissing':'Close'}</Button></header>
   <p id="warning-viewer-help" className="tiny">Closing dismisses warnings you viewed unless you keep them. Select a warning and choose Keep for later, or press <kbd>k</kbd>.</p>
   <p className="tiny">This list shows problems with your shortcut. Check Preferences for its current status and setup.</p>
   {error&&<div role="alert"><p>{error}</p>{collectionBlocked&&<p>Stop keeping a warning if needed. Closing dismisses viewed warnings, then checks for new warnings.</p>}<Button disabled={busy} onClick={()=>{if(alive.current&&!pending.current)void reconcile(latestObserved.current,true);}}>Reload warning list</Button></div>}
   {!snapshot?<p role="status">{error?'The warning list is unavailable. Reload to try again.':'Opening warning list…'}</p>:!warnings.length&&<p>No warnings to review.</p>}
   {!!warnings.length&&<div className="warning-viewer-content"><nav aria-label="Warnings">{warnings.map(item=><button type="button" key={item.id} aria-current={item.id===selected?'true':undefined} onClick={()=>{if(!alive.current||!view.current.open)return;view.current.selected=item.id;setSelected(item.id);}}>{item.title}<small>{item.state==='kept'?'Kept for later':reviewed.current.has(item.id)?'Viewed':'Not viewed'}</small></button>)}</nav>
    {warning?<article aria-label="Selected warning"><h3>{warning.title}</h3><p className="warning">{warning.message}</p><p className="tiny">Recorded <time dateTime={warning.observedAt}>{new Date(warning.observedAt).toLocaleString()}</time></p><button type="button" disabled={busy||!!error&&!(collectionBlocked&&warning.state==='kept')} aria-pressed={warning.state==='kept'} aria-keyshortcuts="k" onClick={()=>keep(warning.state!=='kept')}>{warning.state==='kept'?'Stop keeping':'Keep for later'}</button><p role="status" className="tiny">{error?'Saved status may have changed. Reload to confirm.':warning.state==='kept'?'Kept on this device for your next visit.':reviewed.current.has(warning.id)?'Viewed. Closing will dismiss this warning.':'Focus this warning to review it.'}</p></article>:<p>Select a warning to review it.</p>}
   </div>}
  </dialog>
 </section>;
}
