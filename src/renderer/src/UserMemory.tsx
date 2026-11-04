import {readMemoryExportResult,MEMORY_EXPORT_CHANGED} from '../../shared/memory-export';
import {useEffect,useRef,useState} from 'react';
import {readUserMemory,readMemoryCommit,memoryUndoReason,MEMORY_FACT_LIMIT,MEMORY_FACT_COUNT,MEMORY_HISTORY_LIMIT,type UserMemory,type MemoryFact,type MemoryChange,type MemoryUse,type MemoryHistoryEvent} from '../../shared/user-memory';
import {Button,Field,type RequestKind} from './ui';
import {useNavigationDraft} from './draft-navigation';
import {publicErrorMessage} from '../../shared/public-messages';
import {readMemoryPreview,projectMemoryFactActive,type TaskMemorySelection} from '../../shared/project-memory';

export function useUserMemory(enabled=true){
 const [memory,setMemory]=useState<UserMemory>(),[error,setError]=useState('');
 useEffect(()=>{if(!enabled)return;let alive=true,generation=0;
  const load=async()=>{const request=++generation;try{const value=readUserMemory(await window.companion.invoke({type:'memory.get'}));if(alive&&request===generation){setMemory(value);setError('');}}catch{if(alive&&request===generation){setMemory(undefined);setError('Memory could not be opened. Check Memory in Settings before sending.');}}};
  void load();const unsubscribe=window.companion.subscribe(event=>{if(event.type==='changed'&&!event.taskId)void load();});
  return()=>{alive=false;unsubscribe();};
 },[enabled]);
 return {memory,error};
}

export function MemorySettings(){
 const [initial,setInitial]=useState<UserMemory>(),[error,setError]=useState(''),[opening,setOpening]=useState(0);
 useEffect(()=>{let alive=true;void window.companion.invoke({type:'memory.get'}).then(value=>{if(alive){setInitial(readUserMemory(value));setError('');}}).catch(()=>{if(alive)setError('Saved memory could not be opened. Nothing has been changed.');});return()=>{alive=false;};},[opening]);
 if(!initial)return <section className="preference-area"><h3>Memory across tasks</h3><p role={error?'alert':'status'}>{error||'Opening saved memory…'}</p>{error&&<Button onClick={()=>setOpening(value=>value+1)}>Open memory again</Button>}</section>;
 return <MemoryForm initial={initial}/>;
}
function MemoryForm({initial}:{initial:UserMemory}){
 const [exporting,setExporting]=useState(false),[selectedFactIds,setSelectedFactIds]=useState<string[]>([]);
 const [memory,setMemory]=useState(initial),[editing,setEditing]=useState<MemoryFact>(),[text,setText]=useState(''),[topics,setTopics]=useState(''),[saving,setSaving]=useState(false),[blocked,setBlocked]=useState(false),[message,setMessage]=useState('');
 const alive=useRef(true),lock=useRef(false),textInput=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{if(editing){textInput.current?.focus();textInput.current?.scrollIntoView({block:'nearest'});}},[editing?.id]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const dirty=text!==(editing?.text??'')||topics!==(editing?.topics.join(', ')??'');
 const clearDraft=useNavigationDraft(dirty||saving);
 const terms=topics.split(',').map(value=>value.trim()).filter(Boolean),topicIssue=terms.length>8?'Use at most eight topics.':terms.some(value=>value.length>60)?'Keep each topic under 61 characters.':'';
 function reset(){setEditing(undefined);setText('');setTopics('');clearDraft();}
 async function change(change:MemoryChange['change']){
  if(lock.current||blocked)return;lock.current=true;setSaving(true);setMessage('');
  try{
   const result=readMemoryCommit(await window.companion.invoke({type:'memory.change',expectedRevision:memory.revision,change}));
   if(!alive.current)return;
   if(result.kind==='conflict'){setBlocked(true);setMessage('Memory changed elsewhere. Your edits are still here. Load saved memory before saving again.');return;}
   setMemory(result.current);setSelectedFactIds(previous=>previous.filter(id=>result.current.facts.some(fact=>fact.id===id)));
   if(change.kind==='save'||change.kind==='forget'&&editing?.id===change.id)reset();
   setMessage(change.kind==='enabled'?(result.current.enabled?'Memory enabled for new text questions and drafts.':'Memory is off. Saved facts stay on this Mac.'):(change.kind==='forget'?'Fact forgotten. Earlier messages and sent requests are unchanged.':change.kind==='undo'?'Previous values restored in a new memory revision. Undo this new history entry to reverse that change when eligible.':editing?'Memory fact updated.':'Memory fact saved.'));
  }catch(error){if(alive.current){setBlocked(true);setMessage(publicErrorMessage(error)+' Load saved memory to confirm the current state. Your edits are still here.');}}
  finally{lock.current=false;if(alive.current)setSaving(false);}
 }
 function undo(event:MemoryHistoryEvent){if(dirty||editing||saving||exporting||blocked||memoryUndoReason(memory,event)||!event.undo)return;void change({kind:'undo',id:event.factId,historyRevision:event.revision,expectedFactRevision:event.factRevision,expectedAfterHash:event.undo.afterHash});}
 async function load(){
  if(lock.current)return;lock.current=true;setSaving(true);
  try{const current=readUserMemory(await window.companion.invoke({type:'memory.get'}));if(alive.current){setMemory(current);setSelectedFactIds([]);setBlocked(false);reset();setMessage('Saved memory loaded.');}}
  catch{if(alive.current)setMessage('Saved memory could not be opened. Your edits are still here.');}
  finally{lock.current=false;if(alive.current)setSaving(false);}
 }
 async function exportFacts(){
  if(lock.current||exporting||blocked)return;lock.current=true;setExporting(true);setMessage('');
  try{const facts=memory.facts.filter(fact=>selectedFactIds.includes(fact.id)).map(({id,revision})=>({id,revision}));if(!facts.length)return;const result=readMemoryExportResult(await window.companion.invoke({type:'memory.export',expectedRevision:memory.revision,facts}));if(alive.current)setMessage(result.kind==='cancelled'?'Memory export cancelled. No file was saved.':`Exported ${result.count} saved ${result.count===1?'fact':'facts'} to ${result.path}. Memory is unchanged.`);}
  catch(error){if(alive.current){const message=publicErrorMessage(error);setMessage(message);if(message===MEMORY_EXPORT_CHANGED)setBlocked(true);}}
  finally{lock.current=false;if(alive.current)setExporting(false);}
 }
 return <section className="preference-area user-memory" aria-label="Memory across tasks">
  <div className="preference-row"><div><h3>Memory across tasks</h3><p>{memory.enabled?'On for text questions and drafts':'Off. Saved facts are not included in new requests.'}</p></div><Button disabled={saving||blocked||dirty} onClick={()=>void change({kind:'enabled',enabled:!memory.enabled})}>{memory.enabled?'Turn off memory':'Enable memory'}</Button></div>
  <p className="preference-explanation">Write the facts you want Glint to carry between tasks. Only what you save here becomes memory. There is no automatic collection or sync.</p>
  <p className="preference-explanation">Relevant facts are shown beside your question. After the initial provider approval, each Ask sends them to your selected AI service as guidance, with no permission to act. Memory does not apply to browser work, screen actions, revisions or experiments. Turning it off or forgetting a fact stops future inclusion; earlier messages and requests remain.</p>
  <div className="memory-saved-heading"><h3>Saved facts</h3><span className="tiny">{memory.facts.length} / {MEMORY_FACT_COUNT}</span></div>
  {!memory.facts.length?<p className="memory-empty">No facts saved. Add something useful, such as your level of experience or how you prefer examples.</p>:<ul className="memory-facts">{memory.facts.map(fact=><li key={fact.id}><p>{fact.text}</p><small>{fact.topics.length?'Use for: '+fact.topics.join(', '):'Use for all text questions'}</small><div className="row"><label className="dependency-option"><input type="checkbox" aria-label={'Include saved fact in export: '+fact.text} checked={selectedFactIds.includes(fact.id)} disabled={saving||exporting||blocked} onChange={event=>{const checked=event.target.checked;setSelectedFactIds(previous=>checked?[...previous.filter(id=>id!==fact.id),fact.id]:previous.filter(id=>id!==fact.id));}}/>Include in export</label><Button kind="text" disabled={saving||blocked||dirty} onClick={()=>{setEditing(fact);setText(fact.text);setTopics(fact.topics.join(', '));setMessage('');}}>Edit</Button><Button kind="text danger" disabled={saving||blocked||dirty} onClick={()=>void change({kind:'forget',id:fact.id})}>Forget</Button></div></li>)}</ul>}
  <div className="row"><Button disabled={saving||exporting||blocked||!memory.facts.length} onClick={()=>setSelectedFactIds(memory.facts.map(fact=>fact.id))}>Select all saved facts</Button><Button disabled={saving||exporting||!selectedFactIds.length} onClick={()=>setSelectedFactIds([])}>Clear export selection</Button><Button disabled={saving||exporting||blocked||!selectedFactIds.length} onClick={()=>void exportFacts()}>{exporting?'Exporting…':'Export selected facts…'}</Button></div>
  <p className="tiny">{selectedFactIds.length} saved {selectedFactIds.length===1?'fact':'facts'} selected. Export creates a Glint JSON file for backup or migration. It excludes unsaved edits and does not enable memory.</p>
  <details className="memory-history"><summary>Memory history</summary><p className="tiny">The latest {MEMORY_HISTORY_LIMIT.toLocaleString()} recorded additions and modifications, ordered by committed memory revision. Earlier changes are unavailable. Future eligible edits retain bounded previous values locally for Undo until history pruning or permanent Forget. Selected-fact exports and request previews exclude these values; full workspace backups include this private history. Earlier values are unavailable. Memory can stay off.</p>
   {!memory.history?.length?<p>No recorded changes. Earlier changes are unavailable.</p>:<ol>{[...memory.history].reverse().map(event=>{const current=memory.facts.find(fact=>fact.id===event.factId),reason=memoryUndoReason(memory,event);return <li key={event.revision}><p><strong>{event.undoOfRevision?'Undid recorded edit':event.kind==='added'?'Added':'Modified'}</strong> · Memory revision {event.revision} · Fact revision {event.factRevision}</p><p><time dateTime={event.at}>{event.at}</time> UTC · Changed: {event.fields.map(field=>field==='text'?'fact text':'topics').join(', ')}</p>{reason?<p className="tiny">Undo unavailable: {reason}</p>:<Button type="button" disabled={saving||exporting||blocked||dirty||!!editing} onClick={()=>undo(event)}>Undo edit at memory revision {event.revision}</Button>}{event.undoOfRevision&&<p className="tiny">Undid memory revision {event.undoOfRevision}; this is a new change, not a reused fact revision.</p>}{current&&<details><summary>Current saved fact · revision {current.revision}</summary><p>{current.text}</p><p className="tiny">Current topics: {current.topics.join(', ')||'All text questions'}</p></details>}</li>;})}</ol>}
   <p className="tiny">Undo covers eligible saved-fact edits, never additions or Forget. Previous values over 2,048 UTF-8 bytes or containing obvious credential-like markers are not retained. This conservative local guard is not comprehensive secret detection. Finish or discard form edits before Undo.</p>
  </details>
  <form className="memory-fact-form" onSubmit={event=>{event.preventDefault();if(text.trim()&&!topicIssue)void change({kind:'save',...(editing?{id:editing.id}:{}),text,topics:terms});}}>
   <h3>{editing?'Edit fact':'Add a fact'}</h3>
   <Field label="Fact to remember"><textarea ref={textInput} rows={3} maxLength={MEMORY_FACT_LIMIT} value={text} disabled={saving||blocked} required onChange={event=>setText(event.target.value)} aria-describedby="memory-fact-help"/></Field>
   <p className="tiny" id="memory-fact-help">{text.length} / {MEMORY_FACT_LIMIT} characters. Keep passwords and secrets out.</p>
   <Field label="Use for topics (optional)"><input value={topics} maxLength={488} disabled={saving||blocked} placeholder="For example: rust, programming" onChange={event=>setTopics(event.target.value)} aria-describedby="memory-topics-help" aria-invalid={!!topicIssue}/></Field>
   <p className="tiny" id="memory-topics-help">Leave blank for all text questions. Otherwise, use up to eight comma-separated words or phrases. They match your question or its task title and goal.</p>
   {topicIssue&&<p className="warning" role="alert">{topicIssue}</p>}
   <div className="row"><Button type="submit" disabled={saving||blocked||!dirty||!text.trim()||!!topicIssue||!editing&&memory.facts.length>=MEMORY_FACT_COUNT}>{saving?'Saving…':editing?'Save fact':'Add fact'}</Button>{(editing||dirty)&&<Button disabled={saving} onClick={reset}>Discard edits</Button>}</div>
  </form>
  <p className="tiny memory-limit">Each question includes up to eight matching facts and 4,000 characters. Topic matches come first. The preview shows the exact selection.</p>
  {message&&<p role={blocked?'alert':'status'}>{message}</p>}
  {blocked&&<Button disabled={saving} onClick={()=>void load()}>Load saved memory and replace these edits</Button>}
 </section>;
}

export function MemoryStatus({task,project,prompt,kind,browser=false,onManage,onChip}:{task?:{id?:string;title:string;goal:string;projectId?:string};project?:{id:string;useAccountMemory?:boolean;name?:string;instructions?:string;revision?:number};prompt:string;kind:RequestKind;browser?:boolean;onManage:()=>void;
 /** Reports a short always-visible label while memory facts would be included (or cannot be checked). */
 onChip?:(chip:string|undefined)=>void}){
 const supported=!browser&&['explain','create'].includes(kind),key=JSON.stringify([task?.id,task?.projectId,task?.title,task?.goal,project?.id,project?.useAccountMemory,prompt,kind,browser]);
 const generation=useRef(0),[preview,setPreview]=useState<{key:string;generation:number;selected?:TaskMemorySelection;error?:boolean}>();
 useEffect(()=>{
  if(!supported)return;let alive=true,timer:ReturnType<typeof setTimeout>|undefined;
  const load=async()=>{if(timer)clearTimeout(timer);const token=++generation.current;setPreview(undefined);try{const selected=readMemoryPreview(await window.companion.invoke({type:'memory.preview',...(task?.id?{taskId:task.id}:{}),prompt}));if(!alive||token!==generation.current)return;if(selected.projectFacts.some(fact=>!projectMemoryFactActive(fact,Date.now())))throw Error('The memory inspection expired.');setPreview({key,generation:token,selected});const deadline=Math.min(...selected.projectFacts.flatMap(fact=>fact.expiresAt?[Date.parse(fact.expiresAt)]:[]));const refresh=()=>{if(!alive||token!==generation.current)return;const remaining=deadline-Date.now();if(remaining<=0){void load();return;}timer=setTimeout(refresh,Math.min(remaining,2_147_483_647));};if(Number.isFinite(deadline))refresh();}catch{if(alive&&token===generation.current)setPreview({key,generation:token,error:true});}};
  void load();const unsubscribe=window.companion.subscribe(event=>{if(event.type==='changed')void load();});
  return()=>{alive=false;generation.current++;if(timer)clearTimeout(timer);unsubscribe();};
 },[key,supported]);
 const current=preview?.key===key&&preview.generation===generation.current?preview:undefined,selected=current?.selected;
 const scoped=selected&&selected.projectFacts.every(fact=>projectMemoryFactActive(fact,Date.now()))&&(!task?.id||(selected.receipt.project?.projectId??null)===(task.projectId??null))?selected:undefined,total=scoped?scoped.facts.length+scoped.projectFacts.length:0;
 // Shown whenever memory CAN be sent: a count when known, 'checking' while the preview runs, 'on' when it
 // cannot be read. Hidden only when memory is off or definitely contributes nothing to this question.
 const chip=!supported?undefined:current?.error?'Memory · on':!scoped?'Memory · checking':!scoped.globalEnabled||scoped.taskPolicy?.mode==='off'||!total?undefined:`Memory · ${total}`;
 const chipReport=useRef(onChip);chipReport.current=onChip;
 useEffect(()=>{chipReport.current?.(chip);},[chip]);
 useEffect(()=>()=>chipReport.current?.(undefined),[]);
 return <>{supported&&<div className="memory-question-context" aria-label="Memory for this question">
  {current?.error?<span role="status">Memory preview unavailable</span>:!scoped?<span role="status">Checking memory…</span>:!scoped.globalEnabled?<span>Memory off</span>:scoped.taskPolicy?.mode==='off'?<span>Memory off for this task</span>:<>
   {scoped.project?.useAccountMemory===false&&<span>Account memory off for this project</span>}
   {total?<details><summary>Memory · {total} {total===1?'fact':'facts'} for this question</summary>{scoped.projectFacts.length>0&&<><p>Project memory: {scoped.project?.name}</p><ul>{scoped.projectFacts.map(fact=><li key={fact.id}>{fact.text}</li>)}</ul></>}{scoped.facts.length>0&&<><p>Account memory</p><ul>{scoped.facts.map(fact=><li key={fact.id}>{fact.text}</li>)}</ul></>}{scoped.receipt.omitted>0&&<p>{scoped.receipt.omitted} matching account facts omitted by the shared memory limit.</p>}{(scoped.receipt.project?.omitted??0)>0&&<p>{scoped.receipt.project!.omitted} matching project facts omitted by the shared memory limit.</p>}<p>Shared as guidance only if you send this question.</p></details>:<span>{scoped.project&&!scoped.project.enabled?'Project memory off':'Memory on · no matching facts'}</span>}
  </>}
  <button type="button" className="text" onClick={onManage}>{scoped?.project?'Manage account memory':'Manage memory'}</button>
 </div>}
 {task?.projectId&&<div className="memory-question-context" aria-label="Project instructions for this message">
  {project?.id!==task.projectId||project.name===undefined||project.instructions===undefined||project.revision===undefined?<span role="status">Project instructions unavailable</span>:browser&&['explain','create'].includes(kind)?<span>Project instructions are not used for browser work.</span>:!project.instructions?<span>No saved project instructions</span>:<details key={task.id+':'+project.id+':'+project.revision}><summary>Project instructions · <span className="break">{project.name}</span></summary><p>Saved version {project.revision}</p><ul><li>{project.instructions}</li></ul><p>Shared as guidance only if you send this message. Instructions do not authorize actions.</p></details>}
 </div>}
 </>;
}

function AccountMemoryReceipt({receipt,status,memory}:{receipt?:MemoryUse;status:string;memory?:UserMemory}){
 if(!receipt)return null;
 if(receipt.status!=='included')return <p className="memory-receipt">{receipt.status==='off'?(receipt.project?'Account memory was off for this request.':'Memory was off for this request.'):'No matching account memory facts were included.'}</p>;
 const completed=status==='completed';
 return <details className="memory-receipt"><summary>{completed?'Shared':'Selected'} {receipt.facts.length} memory {receipt.facts.length===1?'fact':'facts'}</summary><p>{completed?'Shared with the AI service as guidance for this response.':'The request did not complete. Transmission of these facts is unverified.'}</p><ul>{receipt.facts.map(ref=>{const current=memory?.facts.find(fact=>fact.id===ref.id&&fact.revision===ref.revision);return <li key={ref.id}>{current?.text??'This fact was edited or forgotten, or saved memory is unavailable.'}</li>;})}</ul>{receipt.omitted>0&&<p>{receipt.omitted} matching facts were omitted by the memory limit.</p>}</details>;
}
export function MemoryReceipt({receipt,status,memory}:{receipt?:MemoryUse;status:string;memory?:UserMemory}){
 const project=receipt?.project;
 return <><AccountMemoryReceipt receipt={receipt} status={status} memory={memory}/>{project&&(project.status==='included'?<details className="memory-receipt"><summary>{status==='completed'?'Shared':'Selected'} {project.facts.length} project memory {project.facts.length===1?'fact':'facts'} · {project.projectName}</summary><p>These facts belonged to this project when the request was prepared. Current saved project facts may have changed since then.</p>{project.omitted>0&&<p>{project.omitted} matching project facts were omitted by the shared limit.</p>}</details>:<p className="memory-receipt">{project.status==='off'?'Project memory was off for this request.':'No matching project memory facts were included.'}</p>)}</>;
}
