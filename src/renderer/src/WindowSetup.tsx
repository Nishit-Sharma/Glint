import {useEffect,useState} from 'react';
import type {CaptureState} from '../../shared/capture-policy';
import {publicErrorMessage} from '../../shared/public-messages';
/** This view routes a live host gesture; it cannot approve setup or choose another target. */
export interface WindowSetupActions{
 configured:boolean;shortcut:string;targetLabel?:string;
 capture:()=>Promise<void>;connect:()=>void;skip:()=>void;
}
export function WindowSetup({configured,shortcut,targetLabel,capture,connect,skip}:WindowSetupActions){
 const [access,setAccess]=useState<CaptureState&{sessionPaused:boolean}>(),[pending,setPending]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let current=true;window.companion.invoke<CaptureState&{sessionPaused:boolean}>({type:'capture.settings.get'}).then(state=>{if(current)setAccess(state);}).catch(e=>{if(current)setError(publicErrorMessage(e));});return()=>{current=false;};},[]);
 async function useWindow(){if(pending)return;setPending(true);setError('');try{await capture();}catch(e){setError(publicErrorMessage(e));}finally{setPending(false);}}
 const unavailable=access?.kind==='unavailable';
 return <section className="window-setup" aria-label="Use my window"><h2>Bring a window into this conversation.</h2>
  <p>{targetLabel?`Your shortcut selected “${targetLabel}”.`:`Switch to the window you want help with, then press ${shortcut}. You can also choose a window here.`}</p>
  <p>{!access?'Checking capture setup…':access.kind==='unavailable'?access.message:access.sessionPaused?'Capture is paused. Use the shortcut for a new setup review.':access.current.policy.setupApproval==='approved'?'Your shortcut setup is saved on this Mac. Private apps and your Mac’s capture permissions still apply.':'The first shortcut snapshot asks for setup. Later shortcuts reuse your choice.'}</p>
  {!configured&&<p>You can attach context now and connect an AI service when you want an explanation. <button type="button" className="setup-connect" disabled={pending} onClick={connect}>Connect AI</button></p>}
  <div className="window-setup-actions"><button type="button" className="primary" disabled={pending||!access||unavailable} onClick={()=>void useWindow()}>{pending?'Opening context…':targetLabel?'Use this window':'Choose a window'}</button><button type="button" disabled={pending} onClick={skip}>Keep exploring</button></div>
  {error&&<p role="alert">{error}</p>}
 </section>;
}
