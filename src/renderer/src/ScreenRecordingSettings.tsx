import {useEffect,useRef,useState} from 'react';
import {readScreenRecordingState,screenRecordingExposed,type ScreenRecordingState} from '../../shared/screen-recording';
import {Button} from './ui';
import './screen-recording.css';

const UNREAD='Screen recording status could not be read. Glint windows may be visible to screen recording.';
const UNCONFIRMED='The screen recording change could not be confirmed. Glint windows may be visible to screen recording.';
const UNPROTECTED='Glint windows could not all be protected. They may be visible to screen recording.';
/** What the host-confirmed state means for capture, in plain words. */
export const screenRecordingLabel=(state:ScreenRecordingState)=>!state.confirmed?UNPROTECTED:state.allowed?'Visible to screen recording':'Protected from screen recording';
/** Explain a rejected change from the re-read host state and the action the person asked for. */
function rejected(attempted:boolean,state:ScreenRecordingState){
 if(!state.confirmed)return UNPROTECTED;
 if(state.allowed===attempted)return '';
 return attempted?'Screen recording could not be allowed. Glint windows stay protected.':'Protection could not be restored. Glint windows are still visible to screen recording.';
}
/** Host-owned session state; the renderer shows only host-confirmed replies and change events, never an assumed value. */
function useScreenRecording(){
 const [state,setState]=useState<ScreenRecordingState>(),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const alive=useRef(true),lock=useRef(false);
 const read=async()=>readScreenRecordingState(await window.companion.invoke({type:'screen-recording.get'}));
 useEffect(()=>{
  alive.current=true;
  const unsubscribe=window.companion.subscribe(event=>{
   if(event.type!=='screen-recording.changed')return;
   // A confirmed host event supersedes any earlier error or uncertainty.
   try{const next=readScreenRecordingState(event.state);if(alive.current){setState(next);setMessage('');}}catch{/* Keep the last confirmed state. */}
  });
  void read().then(next=>{if(alive.current)setState(next);}).catch(()=>{if(alive.current)setMessage(UNREAD);});
  return()=>{alive.current=false;unsubscribe();};
 },[]);
 /** Resolves to the confirmed state after a successful change, otherwise undefined. */
 async function change(allowed:boolean):Promise<ScreenRecordingState|undefined>{
  if(lock.current)return undefined;lock.current=true;setBusy(true);setMessage('');
  try{const next=readScreenRecordingState(await window.companion.invoke({type:'screen-recording.set',allowed}));if(alive.current)setState(next);return next;}
  catch{
   // Re-read the host; if that fails too, keep the last confirmed state and say the outcome is unknown.
   try{const next=await read();if(alive.current){setState(next);setMessage(rejected(allowed,next));}return next.confirmed&&next.allowed===allowed?next:undefined;}
   catch{if(alive.current)setMessage(UNCONFIRMED);return undefined;}
  }
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 return {state,busy,message,change};
}

export function ScreenRecordingSettings(){
 const {state,busy,message,change}=useScreenRecording();
 return <div className="screen-recording-setting" role="group" aria-label="Screen recording" aria-busy={busy||undefined}>
  <label className="row"><input type="checkbox" checked={state?.allowed===true} disabled={!state} aria-describedby="screen-recording-help" onChange={event=>void change(event.target.checked)}/>Allow screen recording</label>
  <p id="screen-recording-help" className="preference-explanation">Glint windows become visible to screen recording and screenshots. The Muse key window stays hidden. This resets to protected each time Glint opens.</p>
  {!state&&!message&&<p role="status">Checking screen recording…</p>}
  {busy&&<p role="status">Applying your screen recording choice…</p>}
  {state&&!state.confirmed&&!message&&<p role="alert">{UNPROTECTED}</p>}
  {message&&<p role="alert">{message}</p>}
 </div>;
}

/** Small, persistent cue in the main window while Glint may be capturable; its result stays announced after it hides. */
export function ScreenRecordingIndicator(){
 const {state,busy,message,change}=useScreenRecording();
 const [announcement,setAnnouncement]=useState('');
 const exposed=!!state&&screenRecordingExposed(state);
 async function hide(){
  setAnnouncement('');
  const next=await change(false);
  if(next&&!screenRecordingExposed(next)){
   setAnnouncement('Glint windows are protected from screen recording.');
   // The strip unmounts, so return focus to the task instead of the document body.
   if(typeof document!=='undefined')document.getElementById('main')?.focus();
  }
 }
 return <>
  {(exposed||message)&&<section className="screen-recording-indicator" aria-label="Screen recording status" aria-busy={busy||undefined}>
   {state&&exposed&&<><span className={'screen-recording-dot'+(state.confirmed?'':' uncertain')} aria-hidden="true"/><span role="status">{screenRecordingLabel(state)}</span></>}
   {message&&<span role="alert">{message}</span>}
   {exposed&&<Button kind="text" disabled={busy} onClick={()=>void hide()}>{busy?'Hiding…':'Hide from recording'}</Button>}
  </section>}
  <div className="sr-only" aria-live="polite">{announcement}</div>
 </>;
}

/** Plain-words status for controls that carry the cue, such as the minimized anchor. Empty while protected. */
export function useScreenRecordingStatus(){
 const {state,message}=useScreenRecording();
 return message||(state&&screenRecordingExposed(state)?screenRecordingLabel(state):'');
}

/** Dot-only cue for the compact companion chrome and the minimized anchor. */
export function ScreenRecordingCue({place}:{place:'compact'|'anchor'}){
 const {state,message}=useScreenRecording();
 if(!(state&&screenRecordingExposed(state))&&!message)return null;
 const label=message||screenRecordingLabel(state!),certain=!message&&!!state?.confirmed;
 return <span className={'screen-recording-cue screen-recording-cue--'+place} role="img" aria-label={label} title={label}><span className={'screen-recording-dot'+(certain?'':' uncertain')}/></span>;
}
