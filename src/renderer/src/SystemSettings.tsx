import {useEffect,useRef,useState} from 'react';
import {readHardwareAccelerationRuntime,readSystemSettingsCommit,readSystemSettingsView,type HardwareAccelerationRuntime,type SystemSettingsSnapshot,type SystemSettingsView} from '../../shared/system-settings';
import {useNavigationDraft} from './draft-navigation';
import {Button} from './ui';

const onOff=(enabled:boolean)=>enabled?'On':'Off';
export function SystemSettings(){
 const [view,setView]=useState<SystemSettingsView>(),[base,setBase]=useState<SystemSettingsSnapshot>(),[value,setValue]=useState(true),[saving,setSaving]=useState(false),[blocked,setBlocked]=useState(false),[message,setMessage]=useState('');
 const alive=useRef(true),lock=useRef(false),runtime=useRef<HardwareAccelerationRuntime>({kind:'pending',sequence:0});
 const dirty=!!base&&value!==base.hardwareAcceleration,clearDraft=useNavigationDraft(dirty||saving);
 function acceptView(next:SystemSettingsView){
  if(next.runtime.sequence>=runtime.current.sequence)runtime.current=next.runtime;
  const current={...next,runtime:runtime.current};setView(current);return current;
 }
 function acceptSaved(next:SystemSettingsView){
  const current=acceptView(next);
  if(current.saved.kind==='available'){setBase(current.saved.current);setValue(current.saved.current.hardwareAcceleration);setBlocked(false);clearDraft();return true;}
  setBlocked(true);return false;
 }
 useEffect(()=>{
  alive.current=true;
  const unsubscribe=window.companion.subscribe(event=>{
   if(event.type!=='system.gpu-info')return;
   try{const next=readHardwareAccelerationRuntime(event.runtime);if(next.sequence<runtime.current.sequence)return;runtime.current=next;setView(previous=>previous?{...previous,runtime:next}:previous);}catch{/* Keep the last verified runtime status. */}
  });
  void window.companion.invoke({type:'system.settings.get'}).then(result=>{if(alive.current)acceptSaved(readSystemSettingsView(result));}).catch(()=>{if(alive.current){setBlocked(true);setMessage('System settings could not be opened. Your saved file has not been changed.');}});
  return()=>{alive.current=false;unsubscribe();};
 },[]);
 async function save(){
  if(lock.current||!base||!dirty||blocked)return;lock.current=true;setSaving(true);setMessage('');
  try{
   const result=readSystemSettingsCommit(await window.companion.invoke({type:'system.settings.update',expectedRevision:base.revision,hardwareAcceleration:value}));
   if(!alive.current)return;
   if(result.kind==='saved'&&acceptSaved(result.view))setMessage(result.view.restartRequired?'Setting saved for the next launch. Quit Glint normally, then reopen it to apply the change.':'Setting saved. The launch configuration already matches this choice.');
   else{acceptView(result.view);setBlocked(true);setMessage(result.kind==='conflict'?'The saved setting changed elsewhere. Your choice is still here. Load the saved setting before saving again.':'The saved setting is unavailable. Your choice is still here and the saved file has not been changed.');}
  }catch{if(alive.current){setBlocked(true);setMessage('The save could not be confirmed. Your choice is still here. Load the saved setting before saving again.');}}
  finally{lock.current=false;if(alive.current)setSaving(false);}
 }
 async function load(){
  if(lock.current)return;lock.current=true;setSaving(true);
  try{const next=readSystemSettingsView(await window.companion.invoke({type:'system.settings.get'}));if(alive.current){const loaded=acceptSaved(next);setMessage(loaded?'Saved setting loaded.':next.saved.kind==='unavailable'?next.saved.message:'The saved setting is unavailable.');}}
  catch{if(alive.current)setMessage('System settings could not be opened. Your choice is still here.');}
  finally{lock.current=false;if(alive.current)setSaving(false);}
 }
 return <form className="preference-area" aria-label="System settings" onSubmit={event=>{event.preventDefault();void save();}}>
  <h3>System</h3>
  <p>Hardware acceleration is on by default. Save a different choice, then quit and reopen Glint to apply it.</p>
  {!view&&!message&&<p role="status">Opening system settings…</p>}
  {view?.saved.kind==='unavailable'&&<p role="alert">{view.saved.message}</p>}
  <label className="row"><input type="checkbox" checked={value} disabled={!base||saving||blocked} aria-describedby="hardware-acceleration-status" onChange={event=>{setValue(event.target.checked);setMessage('');}}/>Use hardware acceleration</label>
  <div id="hardware-acceleration-status">
   <div className="preference-row"><div><h3>Saved for next launch</h3><p>{view?.saved.kind==='available'?onOff(view.saved.current.hardwareAcceleration)+(view.saved.source==='default'?' · default':'')+(dirty?' · unsaved change in editor':''):view?'Unavailable':'Checking…'}</p></div></div>
   <div className="preference-row"><div><h3>Requested for this session</h3><p>{view?.launch.kind==='requested'?onOff(view.launch.enabled):view?.launch.message??'Checking…'}</p></div></div>
   <div className="preference-row"><div><h3>Current Electron runtime</h3><p>{view?.runtime.kind==='observed'?onOff(view.runtime.enabled):view?.runtime.kind==='unavailable'?'Unavailable · Electron’s runtime status could not be read.':'Pending · waiting for Electron GPU information.'}</p></div></div>
  </div>
  {view?.restartRequired===true&&<p role="status">Restart required to apply the saved launch choice. Quit Glint normally, then reopen it.</p>}
  {view?.restartRequired===null&&<p role="status">Restart status is unavailable until the saved and startup choices can be verified.</p>}
  {view?.launch.kind==='requested'&&view.runtime.kind==='observed'&&view.launch.enabled!==view.runtime.enabled&&<p role="status">Electron’s runtime differs from the requested startup choice. Hardware or driver support may affect the result; restarting does not guarantee it will change.</p>}
  {message&&<p role={blocked?'alert':'status'}>{message}</p>}
  <div className="row"><Button type="submit" disabled={saving||!dirty||blocked}>{saving?'Saving…':'Save system setting'}</Button><Button disabled={saving||!dirty||blocked} onClick={()=>{if(base)setValue(base.hardwareAcceleration);setMessage('Unsaved changes discarded.');clearDraft();}}>Discard changes</Button>{(blocked||!base)&&<Button disabled={saving} onClick={()=>void load()}>Load saved setting and replace these edits</Button>}</div>
 </form>;
}
