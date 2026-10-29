import {useEffect,useRef,useState} from 'react';
import {readResponsePreferencesState,readResponsePreferencesCommit,RESPONSE_PREFERENCES_LIMIT,type ResponsePreferencesSnapshot} from '../../shared/response-preferences';
import {Button,Field} from './ui';
import {useNavigationDraft} from './draft-navigation';

export function ResponsePreferencesEditor(){
 const [state,setState]=useState<ReturnType<typeof readResponsePreferencesState>>(),[opening,setOpening]=useState(false);
 useEffect(()=>{let current=true;void window.companion.invoke({type:'response-preferences.get'}).then(value=>{if(current)setState(readResponsePreferencesState(value));}).catch(()=>{if(current)setState({kind:'unavailable',message:'Response preferences could not be opened. Your saved preferences have not been changed.'});});return()=>{current=false;};},[opening]);
 if(!state)return <p role="status">Opening response preferences…</p>;
 if(state.kind==='unavailable')return <section className="preference-area"><h3>Response preferences</h3><p role="alert">{state.message}</p><Button onClick={()=>setOpening(value=>!value)}>Try opening again</Button></section>;
 return <ResponsePreferencesForm initial={state.current}/>;
}
function ResponsePreferencesForm({initial}:{initial:ResponsePreferencesSnapshot}){
 const [base,setBase]=useState(initial),[value,setValue]=useState(initial),[saving,setSaving]=useState(false),[message,setMessage]=useState(''),[blocked,setBlocked]=useState(false),lock=useRef(false),alive=useRef(true);
 const dirty=base.enabled!==value.enabled||base.text!==value.text,clearDraft=useNavigationDraft(dirty||saving);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function save(){
  if(lock.current||blocked||!dirty)return;lock.current=true;setSaving(true);setMessage('');
  try{
   const result=readResponsePreferencesCommit(await window.companion.invoke({type:'response-preferences.update',expectedRevision:base.revision,enabled:value.enabled,text:value.text}));
   if(!alive.current)return;
   if(result.kind==='saved'){setBase(result.current);setValue(result.current);setBlocked(false);clearDraft();setMessage(result.current.enabled?'Preferences saved and enabled for new text questions and drafts.':'Preferences saved and off. Saved text stays on this Mac.');}
   else{setBlocked(true);setMessage('message' in result?result.message:'The saved preferences changed elsewhere. Your edits have not been saved. Load the saved preferences before editing again.');}
  }catch{if(alive.current){setBlocked(true);setMessage('The save could not be confirmed. Your edits are still here. Load the saved preferences before saving again.');}}
  finally{lock.current=false;if(alive.current)setSaving(false);}
 }
 async function load(){
  if(lock.current)return;lock.current=true;setSaving(true);
  try{const result=readResponsePreferencesState(await window.companion.invoke({type:'response-preferences.get'}));if(!alive.current)return;if(result.kind==='available'){setBase(result.current);setValue(result.current);setBlocked(false);clearDraft();setMessage('Saved preferences loaded.');}else setMessage(result.message);}
  catch{if(alive.current)setMessage('The saved preferences could not be opened. Your edits are still here.');}
  finally{lock.current=false;if(alive.current)setSaving(false);}
 }
 return <form className="preference-area response-preferences" aria-label="Response preferences" onSubmit={event=>{event.preventDefault();void save();}}>
  <h3>Response preferences</h3>
  <p>Save tone and formatting guidance for new text questions and drafts. These preferences apply across tasks only when enabled and saved.</p>
  <p id="response-preferences-scope" className="preference-explanation">Enabled text is shown in each request’s approval and sent to your selected AI service with that request. It does not apply to revisions, screen actions or browser work. Saving a change retires earlier approval; a request already sent may still complete or incur charges.</p>
  <label className="row"><input type="checkbox" checked={value.enabled} disabled={saving} aria-describedby="response-preferences-scope" onChange={event=>{setValue(previous=>({...previous,enabled:event.target.checked}));setMessage('');}}/>Enable saved response preferences</label>
  <Field label="Tone and formatting guidance"><textarea rows={7} maxLength={RESPONSE_PREFERENCES_LIMIT} value={value.text} disabled={saving} aria-describedby="response-preferences-help" onChange={event=>{setValue(previous=>({...previous,text:event.target.value}));setMessage('');}}/></Field>
  <p className="tiny" id="response-preferences-help">{value.text.length} / {RESPONSE_PREFERENCES_LIMIT} characters. Keep passwords and secrets out. Off text stays local. Changes take effect after Save.</p>
  {message&&<p role={blocked?'alert':'status'}>{message}</p>}
  {blocked&&<Button disabled={saving} onClick={()=>void load()}>Load saved preferences and replace these edits</Button>}
  <div className="row"><Button type="submit" disabled={saving||!dirty||blocked}>{saving?'Saving…':'Save response preferences'}</Button><Button disabled={saving||!dirty} onClick={()=>{setValue(base);setBlocked(false);setMessage('Unsaved changes discarded.');clearDraft();}}>Discard changes</Button></div>
 </form>;
}
