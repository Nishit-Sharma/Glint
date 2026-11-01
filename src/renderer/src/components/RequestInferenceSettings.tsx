import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {Task} from '../../../core/types';
import {requestInferenceSaved,readRequestInferenceState,sameRequestInference,assertAdvertisedInference,type RequestInferenceSelection,type RequestInferenceSaved,type RequestInferenceCatalog} from '../../../shared/request-inference';
import './request-inference.css';

type Preview={taskId:string;revision:number;selection:RequestInferenceSelection;wire:{thread:{model:string;serviceTier:string;config:{model_reasoning_effort:string}};turn:{model:string;effort:string;serviceTierForTurn:string}}};
export function RequestInferenceSettings({task,connectionKey='connection-default'}:{task:Task;connectionKey?:string}){
 const [saved,setSaved]=useState<RequestInferenceSaved>(()=>requestInferenceSaved(task.session)),[catalog,setCatalog]=useState<RequestInferenceCatalog>(),[working,setWorking]=useState(false),[message,setMessage]=useState(''),[preview,setPreview]=useState<Preview>();
 const alive=useRef(true),locked=useRef(false),generation=useRef(0),current=useRef(saved);current.current=saved;
 useLayoutEffect(()=>{alive.current=true;generation.current++;locked.current=false;setWorking(false);setCatalog(undefined);setPreview(undefined);setMessage('');return()=>{alive.current=false;generation.current++;};},[task.id,connectionKey]);
 useEffect(()=>{const next=requestInferenceSaved(task.session);if(next.revision>current.current.revision&&!locked.current){current.current=next;setSaved(next);setPreview(undefined);}},[task.session?.requestInference?.revision,working]);
 async function load(){
  if(locked.current)return;locked.current=true;setWorking(true);setMessage('');setPreview(undefined);const epoch=++generation.current;
  try{const next=await window.companion.invoke<RequestInferenceCatalog>({type:'inference.catalog',taskId:task.id});if(alive.current&&epoch===generation.current)setCatalog(next);}
  catch{if(alive.current&&epoch===generation.current)setMessage('Model options could not be read. Your saved choice is kept.');}
  finally{if(epoch===generation.current){locked.current=false;if(alive.current)setWorking(false);}}
 }
 async function save(selection:RequestInferenceSelection|null){
  if(locked.current||task.status!=='active')return;if(selection){if(catalog?.kind!=='available')return;try{assertAdvertisedInference(selection,catalog.models);}catch{return;}}
  locked.current=true;setWorking(true);setMessage('Saving task model choice…');setPreview(undefined);const epoch=++generation.current,revision=current.current.revision;
  try{const reply=readRequestInferenceState(await window.companion.invoke({type:'inference.select',taskId:task.id,expectedRevision:revision,selection}));if(!alive.current||epoch!==generation.current)return;if(reply.taskId!==task.id||reply.revision<revision||!sameRequestInference(reply.selection,selection))throw Error();current.current={revision:reply.revision,selection:reply.selection};setSaved(current.current);setMessage('Saved for this task and its follow-ups. No request was sent.');}
  catch{if(alive.current&&epoch===generation.current)setMessage('The choice save was not confirmed. Reopen the task to inspect its saved choice before changing it again.');}
  finally{if(epoch===generation.current){locked.current=false;if(alive.current)setWorking(false);}}
 }
 async function inspect(){
  if(locked.current)return;locked.current=true;setWorking(true);setMessage('');const epoch=++generation.current;
  try{const result=await window.companion.invoke<Preview|{kind:'unavailable';message:string}>({type:'inference.preview',taskId:task.id});if(!alive.current||epoch!==generation.current)return;if('kind'in result){setMessage(result.message);return;}if(result.taskId!==task.id||result.revision!==current.current.revision)throw Error();setPreview(result);}
  catch{if(alive.current&&epoch===generation.current)setMessage('The next request settings could not be checked. Your saved choice is kept.');}
  finally{if(epoch===generation.current){locked.current=false;if(alive.current)setWorking(false);}}
 }
 const effective=saved.selection??(catalog?.kind==='available'?catalog.defaultSelection:undefined),model=catalog?.kind==='available'?catalog.models.find(model=>model.id===effective?.model):undefined;
 const unavailable=!!effective&&catalog?.kind==='available'&&(!model||!model.efforts.includes(effective.effort)||!model.tiers.some(tier=>tier.id===effective.tier));
 return <details className="request-inference" onToggle={event=>{if(event.currentTarget.open&&!catalog&&!locked.current)void load();}}><summary>Model · {saved.selection?saved.selection.model:'Connection default'}</summary><div className="request-inference-fields">
  <p>Applies to ordinary questions and drafts in this task, including later follow-ups. Each queued follow-up keeps its original choice.</p>
  {catalog?.kind==='available'?<><label>Model<select aria-label="Request model" disabled={working||task.status!=='active'} value={effective?.model??''} onChange={event=>{const chosen=catalog.models.find(model=>model.id===event.target.value);if(chosen)void save({provider:'codex',model:chosen.id,effort:chosen.efforts.includes(effective?.effort??'')?effective!.effort:chosen.initialEffort,tier:chosen.tiers.some(tier=>tier.id===effective?.tier)?effective!.tier:chosen.initialTier});}}>{!model&&<option value={effective?.model??''} disabled>{effective?.model??'No supported models'} · unavailable</option>}{catalog.models.map(model=><option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
  <label>Reasoning effort<select aria-label="Request reasoning effort" disabled={working||!model||task.status!=='active'} value={effective?.effort??''} onChange={event=>{if(effective)void save({...effective,effort:event.target.value});}}>{effective&&!model?.efforts.includes(effective.effort)&&<option value={effective.effort} disabled>{effective.effort} · unavailable</option>}{model?.efforts.map(effort=><option key={effort} value={effort}>{effort}</option>)}</select></label>
  <label>Response speed<select aria-label="Request response speed" disabled={working||!model||task.status!=='active'} value={effective?.tier??''} onChange={event=>{const tier=event.target.value;if(effective&&(tier==='default'||tier==='priority'))void save({...effective,tier});}}>{effective&&!model?.tiers.some(tier=>tier.id===effective.tier)&&<option value={effective.tier} disabled>{effective.tier} · unavailable</option>}{model?.tiers.map(tier=><option key={tier.id} value={tier.id}>{tier.label}</option>)}</select></label>
  <p>Only combinations advertised by your connected Codex account are offered. Availability may change; no model or tier fallback is used.</p></>:<p role="status">{catalog?.kind==='unavailable'?catalog.message:working?'Reading model options…':'Open this panel to read current model options.'}</p>}
  {unavailable&&<p role="alert">The saved combination is unavailable in the current catalog. It is kept until you choose a supported combination or the connection default.</p>}
  <div className="row"><button type="button" disabled={working} onClick={()=>void load()}>Reload options</button><button type="button" disabled={working||task.status!=='active'||!saved.selection} onClick={()=>void save(null)}>Use connection default</button><button type="button" disabled={working||unavailable||catalog?.kind!=='available'} onClick={()=>void inspect()}>Inspect next request settings</button></div>
  {preview&&preview.revision===saved.revision&&<details><summary>Outgoing settings · nothing sent</summary><pre>{JSON.stringify(preview.wire,null,2)}</pre></details>}
  {message&&<p role="status">{message}</p>}
 </div></details>;
}
