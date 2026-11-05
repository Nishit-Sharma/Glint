import {useEffect,useRef,useState} from 'react';
import {readCliPreferences,readCliPreferencesCommit,readCliPreview,searchCliSettings,type CliPreferences,type CliPreview} from '../../shared/cli-preferences';
import {Button,Field} from './ui';
import {useNavigationDraft} from './draft-navigation';

export function CliPreferencesEditor({taskId}:{taskId?:string}){
 const [initial,setInitial]=useState<CliPreferences>(),[error,setError]=useState(''),[opening,setOpening]=useState(0);
 useEffect(()=>{let current=true;void window.companion.invoke({type:'cli.preferences.get'}).then(value=>{if(current){setInitial(readCliPreferences(value));setError('');}}).catch(()=>{if(current)setError('CLI preferences could not be opened. Saved work was preserved.');});return()=>{current=false;};},[opening]);
 if(error)return <section className="preference-area"><p role="alert">{error}</p><Button onClick={()=>setOpening(value=>value+1)}>Try opening again</Button></section>;
 if(!initial)return <p role="status">Opening CLI preferences…</p>;
 return <CliPreferencesForm initial={initial} taskId={taskId}/>;
}
function CliPreferencesForm({initial,taskId}:{initial:CliPreferences;taskId?:string}){
 const [base,setBase]=useState(initial),[value,setValue]=useState(initial),[search,setSearch]=useState(''),[saving,setSaving]=useState(false),[blocked,setBlocked]=useState(false),[message,setMessage]=useState(''),[preview,setPreview]=useState<CliPreview>(),[previewing,setPreviewing]=useState(false);
 const lock=useRef(false),alive=useRef(true),previewEpoch=useRef(0),dirty=base.format!==value.format||base.includeSourceLabels!==value.includeSourceLabels||base.excerptChars!==value.excerptChars,clearDraft=useNavigationDraft(dirty||saving);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{previewEpoch.current++;setPreview(undefined);},[taskId]);
 const settings=searchCliSettings(search);
 function change(next:CliPreferences){setValue(next);setMessage('');setPreview(undefined);}
 async function save(){
  if(lock.current||blocked||!dirty)return;lock.current=true;setSaving(true);setMessage('');
  try{const result=readCliPreferencesCommit(await window.companion.invoke({type:'cli.preferences.update',expectedRevision:base.revision,format:value.format,includeSourceLabels:value.includeSourceLabels,excerptChars:value.excerptChars}));if(!alive.current)return;
   if(result.kind==='saved'){setBase(result.current);setValue(result.current);setBlocked(false);clearDraft();setMessage('CLI defaults saved. The next invocation reads them. No restart is needed.');}
   else{setBlocked(true);setMessage('CLI preferences changed elsewhere. Load saved preferences before saving again. Your edits are kept.');}
  }catch{if(alive.current){setBlocked(true);setMessage('The save could not be confirmed. Your edits are kept. Load saved preferences before saving again.');}}
  finally{lock.current=false;if(alive.current)setSaving(false);}
 }
 async function load(){
  if(lock.current)return;lock.current=true;setSaving(true);
  try{const saved=readCliPreferences(await window.companion.invoke({type:'cli.preferences.get'}));if(alive.current){setBase(saved);setValue(saved);setBlocked(false);setPreview(undefined);clearDraft();setMessage('Saved CLI preferences loaded.');}}
  catch{if(alive.current)setMessage('Saved preferences could not be opened. Your edits are kept.');}
  finally{lock.current=false;if(alive.current)setSaving(false);}
 }
 async function runPreview(){
  if(!taskId||dirty||saving||blocked||previewing)return;setPreviewing(true);const epoch=++previewEpoch.current;
  try{const result=readCliPreview(await window.companion.invoke({type:'cli.preview',taskId}));if(alive.current&&epoch===previewEpoch.current)setPreview(result);}
  catch{if(alive.current&&epoch===previewEpoch.current)setPreview({kind:'unavailable',message:'The bundled CLI preview could not be opened. Saved work was preserved.'});}
  finally{if(alive.current)setPreviewing(false);}
 }
 return <section className="preference-area cli-preferences" aria-label="CLI preferences">
  <h3>CLI</h3><p>Inspect saved tasks from your terminal with <code>glint tasks</code>, <code>glint task &lt;task-id&gt;</code> or <code>glint settings --search format</code>.</p>
  <p className="preference-explanation">The bundled CLI reads saved tasks on this Mac. Each invocation reads these defaults; no restart is needed. Command options can override them for one invocation.</p>
  <Field label="Search CLI preferences"><input type="search" value={search} maxLength={200} placeholder="Format, source labels, excerpts…" onChange={event=>setSearch(event.target.value)}/></Field>
  <form onSubmit={event=>{event.preventDefault();void save();}}>
   {settings.some(item=>item.key==='format')&&<Field label="Output format"><select value={value.format} disabled={saving||previewing} onChange={event=>change({...value,format:event.target.value==='json'?'json':'text'})}><option value="text">Text</option><option value="json">JSON</option></select></Field>}
   {settings.some(item=>item.key==='includeSourceLabels')&&<label className="row"><input type="checkbox" checked={value.includeSourceLabels} disabled={saving||previewing} onChange={event=>change({...value,includeSourceLabels:event.target.checked})}/>Include file and window names when viewing a task</label>}
   {settings.some(item=>item.key==='excerptChars')&&<><Field label="Text excerpt length"><input type="number" min={0} max={256} step={1} required value={value.excerptChars} disabled={saving||previewing} aria-describedby="cli-excerpt-help" onChange={event=>{const next=Number(event.target.value);if(Number.isInteger(next)&&next>=0&&next<=256)change({...value,excerptChars:next});}}/></Field><p id="cli-excerpt-help" className="tiny">0 turns text previews off. Up to 256 characters from each shared text can appear in Terminal. Images and window screenshots have no previews.</p></>}
   {!settings.length&&<p role="status">No supported CLI preferences match this search.</p>}
   {message&&<p role={blocked?'alert':'status'}>{message}</p>}
   {blocked&&<Button disabled={saving} onClick={()=>void load()}>Load saved CLI preferences and replace these edits</Button>}
   <div className="row"><Button type="submit" disabled={saving||previewing||!dirty||blocked}>{saving?'Saving…':'Save CLI defaults'}</Button><Button disabled={saving||previewing||!dirty} onClick={()=>{setValue(base);setBlocked(false);setMessage('Unsaved CLI changes discarded.');clearDraft();}}>Discard changes</Button></div>
  </form>
  <div className="cli-preview"><h3>Preview selected task</h3><p>{taskId?'Run the bundled CLI against this task using your saved defaults.':'Select a saved task, then return here to preview its CLI output.'}</p><Button disabled={!taskId||dirty||saving||previewing||blocked} onClick={()=>void runPreview()}>{previewing?'Running CLI…':'Run CLI preview'}</Button>{dirty&&<p className="tiny">Save or discard your changes before previewing.</p>}
   {preview?.kind==='unavailable'&&<p role="alert">{preview.message}</p>}
   {preview?.kind==='ready'&&<><pre className="cli-output" aria-label="Actual bundled CLI output">{preview.output}</pre><p className="tiny">Bundled launcher (quote this path in your terminal):</p><code className="cli-launcher">{preview.launcher}</code></>}
  </div>
 </section>;
}
