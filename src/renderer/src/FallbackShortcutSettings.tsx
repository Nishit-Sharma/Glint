import {useEffect,useRef,useState} from 'react';
import type {HostStatus} from '../../shared/bridge';
import {readFallbackAccelerator,type FallbackShortcutCommand} from '../../shared/fallback-shortcut';
import {publicErrorMessage} from '../../shared/public-messages';
import {useNavigationDraft} from './draft-navigation';
import {Button,Field} from './ui';

function readStatus(input:unknown):HostStatus{
 if(!input||typeof input!=='object')throw Error('The current fallback binding could not be read.');
 const value=input as HostStatus;readFallbackAccelerator(value.fallbackShortcut);
 if(value.fallbackShortcutDefault!==undefined)readFallbackAccelerator(value.fallbackShortcutDefault);
 if(value.fallbackShortcutStatus!=='registered'&&value.fallbackShortcutStatus!=='unavailable')throw Error('The current fallback registration could not be read.');
 return value;
}
export function FallbackShortcutSettings({host,disabled=false,onRefresh}:{host?:HostStatus;disabled?:boolean;onRefresh():void|Promise<void>}){
 const [reported,setReported]=useState(host),[editing,setEditing]=useState(false),[draft,setDraft]=useState(''),[expected,setExpected]=useState(''),[pending,setPending]=useState(false),[blocked,setBlocked]=useState(false),[message,setMessage]=useState('');
 const lock=useRef(false),alive=useRef(true),clearDraft=useNavigationDraft(pending||editing&&draft!==expected);
 useEffect(()=>{if(host)setReported(host);},[host?.fallbackShortcut,host?.fallbackShortcutStatus,host?.fallbackShortcutDefault]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const current=reported?.fallbackShortcut,defaultShortcut=reported?.fallbackShortcutDefault,registered=reported?.fallbackShortcutStatus==='registered';
 const refresh=()=>{void Promise.resolve(onRefresh()).catch(()=>{});};
 function accept(status:HostStatus){setReported(status);setDraft(status.fallbackShortcut!);setExpected(status.fallbackShortcut!);setEditing(false);setBlocked(false);clearDraft();refresh();}
 async function change(command:FallbackShortcutCommand){
  if(lock.current||disabled)return;lock.current=true;setPending(true);setMessage('');
  try{const status=readStatus(await window.companion.invoke(command));if(!alive.current)return;accept(status);setMessage(status.fallbackShortcutStatus==='registered'?'Fallback shortcut saved and registered.':'Fallback shortcut saved. Its current registration is unavailable.');}
  catch(error){if(alive.current){setBlocked(true);setMessage(publicErrorMessage(error));}}
  finally{lock.current=false;if(alive.current)setPending(false);}
 }
 async function load(){
  if(lock.current||disabled)return;lock.current=true;setPending(true);
  try{const status=readStatus(await window.companion.invoke({type:'shortcut.get'}));if(alive.current){accept(status);setMessage('Current fallback binding loaded.');}}
  catch{if(alive.current)setMessage('The current fallback binding could not be opened. Your edits are still here.');}
  finally{lock.current=false;if(alive.current)setPending(false);}
 }
 return <section className="preference-area" aria-label="Fallback shortcut settings">
  <div className="preference-row"><div><h3>Screen context fallback</h3><p>{current??'Checking…'}{current?' · '+(registered?'Registered':'Unavailable'):''}</p></div>{!editing&&<Button disabled={disabled||pending||!current||blocked} onClick={()=>{setDraft(current!);setExpected(current!);setEditing(true);setMessage('');}}>Change fallback shortcut</Button>}</div>
  <p className="preference-explanation" id="fallback-shortcut-help">This global shortcut opens the existing screen context flow. Capture still uses your current setup and permission review. The physical modifier shortcut and app menu bindings stay separate.</p>
  <p className="tiny">Default fallback: {defaultShortcut??'Checking…'}</p>
  {message&&<p role={blocked?'alert':'status'}>{message}</p>}
  {editing&&<form onSubmit={event=>{event.preventDefault();if(!blocked&&draft.trim())void change({type:'shortcut.set',accelerator:draft.trim(),expectedShortcut:expected});}}>
   <Field label="Fallback shortcut"><input value={draft} maxLength={80} disabled={disabled||pending||blocked} aria-describedby="fallback-shortcut-help" onChange={event=>{setDraft(event.target.value);setMessage('');}}/></Field>
   <div className="row"><Button type="submit" disabled={disabled||pending||blocked||!draft.trim()||draft===expected&&registered}>Save fallback shortcut</Button><Button disabled={disabled||pending||blocked} onClick={()=>{setDraft(current??'');setExpected(current??'');setEditing(false);setMessage('Unsaved shortcut changes discarded.');clearDraft();}}>Discard shortcut changes</Button></div>
  </form>}
  {!editing&&<Button disabled={disabled||pending||blocked||!current||!defaultShortcut||current===defaultShortcut&&registered} onClick={()=>{if(current&&defaultShortcut)void change({type:'shortcut.reset',expectedShortcut:current});}}>Reset fallback to default</Button>}
  {blocked&&<Button disabled={disabled||pending} onClick={()=>void load()}>Load current binding and replace these edits</Button>}
 </section>;
}
