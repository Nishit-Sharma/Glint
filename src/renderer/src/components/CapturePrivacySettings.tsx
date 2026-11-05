import {useEffect,useState} from 'react';
import type {CaptureState} from '../../../shared/capture-policy';
import type {Command,WindowChoice} from '../../../shared/bridge';
import {publicErrorMessage} from '../../../shared/public-messages';
import {Button,Field,type Run} from '../ui';

type SettingsView=CaptureState&{sessionPaused:boolean};
export function CapturePrivacySettings({busy,run}:{busy:boolean;run:Run}){
 const [state,setState]=useState<SettingsView>(),[windows,setWindows]=useState<WindowChoice[]>([]),[selected,setSelected]=useState(''),[pending,setPending]=useState(false),[message,setMessage]=useState('');
 async function refresh(){const settings=await window.companion.invoke<SettingsView>({type:'capture.settings.get'});setState(settings);try{setWindows(await window.companion.invoke<WindowChoice[]>({type:'windows.list'}));}catch(error){setWindows([]);setMessage(publicErrorMessage(error));}}
 useEffect(()=>{let current=true;window.companion.invoke<SettingsView>({type:'capture.settings.get'}).then(result=>{if(current)setState(result);}).catch(error=>{if(current)setMessage(publicErrorMessage(error));});return()=>{current=false;};},[]);
 async function update(command:Extract<Command,{type:'capture.settings.revoke'|'capture.settings.private'}>){
  setPending(true);setMessage('');try{const result=await run<{kind:string}>(command);await refresh();if(result)setMessage(result.kind==='saved'?'Privacy settings saved. Existing screenshots were cleared.':result.kind==='conflict'?'Capture privacy changed. Review the current settings.':result.kind==='unconfirmed'?'The save is unconfirmed. Shortcut snapshots need a new review.':'Capture settings could not be opened. Your saved setup is kept.');}catch(error){setMessage(publicErrorMessage(error));}finally{setPending(false);}
 }
 const current=state?.kind==='available'?state.current:undefined,disabled=busy||pending;
 return <section aria-label="Capture privacy">
  <div className="preference-row"><div><h3>Shortcut screenshots</h3><p>{!state?'Checking setup…':state.kind==='unavailable'?state.message:state.sessionPaused?'Paused. Press the shortcut for a new setup review.':current?.policy.setupApproval==='approved'?'Set up on this Mac':'Press the screen context shortcut to set up.'}</p></div>{current&&current.policy.setupApproval==='approved'&&<Button disabled={disabled} onClick={()=>void update({type:'capture.settings.revoke',expectedRevision:current.revision})}>Turn off</Button>}</div>
  <p className="preference-explanation">Setup stays on after you reopen Glint and through compatible updates. It allows shortcut screenshots only. Changes to apps or files always need their own approval.</p>
  <div className="preference-row"><div><h3>Private apps</h3><p>Their windows cannot be captured or sent.</p></div><Button disabled={disabled||!current} onClick={()=>void refresh().catch(error=>setMessage(publicErrorMessage(error)))}>Choose app</Button></div>
  {current?.policy.privateApps.map((app,index)=><div className="preference-row" key={app.kind+app.value}><span>{app.value}</span><Button disabled={disabled} onClick={()=>void update({type:'capture.settings.private',expectedRevision:current.revision,keep:current.policy.privateApps.map((_,i)=>i).filter(i=>i!==index),windowIds:[]})}>Remove</Button></div>)}
  {!!windows.length&&current&&<><Field label="App with an open window"><select value={selected} disabled={disabled} onChange={event=>setSelected(event.target.value)}><option value="">Choose a window’s app</option>{windows.map(item=><option key={item.id} value={item.id}>{item.owner.name} · {item.title||'Untitled window'}</option>)}</select></Field><Button disabled={disabled||!selected} onClick={()=>void update({type:'capture.settings.private',expectedRevision:current.revision,keep:current.policy.privateApps.map((_,i)=>i),windowIds:[selected]})}>Keep app private</Button></>}
  {message&&<p role="status" className="preference-explanation">{message}</p>}
 </section>;
}
