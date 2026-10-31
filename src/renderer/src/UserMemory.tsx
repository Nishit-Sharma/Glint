import {useEffect,useRef,useState} from 'react';
import {emptyUserMemory,readUserMemory,readMemoryCommit,selectUserMemory,MEMORY_FACT_LIMIT,MEMORY_FACT_COUNT,type UserMemory,type MemoryFact,type MemoryChange,type MemoryUse} from '../../shared/user-memory';
import {Button,Field,type RequestKind} from './ui';
import {useNavigationDraft} from './draft-navigation';
import {publicErrorMessage} from '../../shared/public-messages';
import type {Project} from '../../shared/projects';

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
   setMemory(result.current);
   if(change.kind==='save'||change.kind==='forget'&&editing?.id===change.id)reset();
   setMessage(change.kind==='enabled'?(result.current.enabled?'Memory enabled for new text questions and drafts.':'Memory is off. Saved facts stay on this Mac.'):(change.kind==='forget'?'Fact forgotten. Earlier messages and sent requests are unchanged.':editing?'Memory fact updated.':'Memory fact saved.'));
  }catch(error){if(alive.current){setBlocked(true);setMessage(publicErrorMessage(error)+' Load saved memory to confirm the current state. Your edits are still here.');}}
  finally{lock.current=false;if(alive.current)setSaving(false);}
 }
 async function load(){
  if(lock.current)return;lock.current=true;setSaving(true);
  try{const current=readUserMemory(await window.companion.invoke({type:'memory.get'}));if(alive.current){setMemory(current);setBlocked(false);reset();setMessage('Saved memory loaded.');}}
  catch{if(alive.current)setMessage('Saved memory could not be opened. Your edits are still here.');}
  finally{lock.current=false;if(alive.current)setSaving(false);}
 }
 return <section className="preference-area user-memory" aria-label="Memory across tasks">
  <div className="preference-row"><div><h3>Memory across tasks</h3><p>{memory.enabled?'On for text questions and drafts':'Off. Saved facts are not included in new requests.'}</p></div><Button disabled={saving||blocked||dirty} onClick={()=>void change({kind:'enabled',enabled:!memory.enabled})}>{memory.enabled?'Turn off memory':'Enable memory'}</Button></div>
  <p className="preference-explanation">Write the facts you want Glint to carry between tasks. Only what you save here becomes memory. There is no automatic collection or sync.</p>
  <p className="preference-explanation">Relevant facts are shown beside your question. After the initial provider approval, each Ask sends them to your selected AI service as guidance, with no permission to act. Memory does not apply to browser work, screen actions, revisions or experiments. Turning it off or forgetting a fact stops future inclusion; earlier messages and requests remain.</p>
  <div className="memory-saved-heading"><h3>Saved facts</h3><span className="tiny">{memory.facts.length} / {MEMORY_FACT_COUNT}</span></div>
  {!memory.facts.length?<p className="memory-empty">No facts saved. Add something useful, such as your level of experience or how you prefer examples.</p>:<ul className="memory-facts">{memory.facts.map(fact=><li key={fact.id}><p>{fact.text}</p><small>{fact.topics.length?'Use for: '+fact.topics.join(', '):'Use for all text questions'}</small><div className="row"><Button kind="text" disabled={saving||blocked||dirty} onClick={()=>{setEditing(fact);setText(fact.text);setTopics(fact.topics.join(', '));setMessage('');}}>Edit</Button><Button kind="text danger" disabled={saving||blocked||dirty} onClick={()=>void change({kind:'forget',id:fact.id})}>Forget</Button></div></li>)}</ul>}
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

export function MemoryStatus({task,project,prompt,kind,browser=false,onManage}:{task?:{title:string;goal:string;projectId?:string};project?:Pick<Project,'id'|'useAccountMemory'>;prompt:string;kind:RequestKind;browser?:boolean;onManage:()=>void}){
 const {memory,error}=useUserMemory();
 if(browser||!['explain','create'].includes(kind))return null;
 const projectUnavailable=!!task?.projectId&&project?.id!==task.projectId;
 const selected=selectUserMemory(memory??emptyUserMemory(),{title:task?.title??'',goal:task?.goal??'',prompt},projectUnavailable?{useAccountMemory:false}:project);
 return <div className="memory-question-context" aria-label="Memory for this question">{projectUnavailable?<span role="status">Project memory preview unavailable</span>:project?.useAccountMemory===false?<span>Account memory off for this project</span>:error?<span role="status">Memory preview unavailable</span>:!memory?<span>Checking memory…</span>:selected.facts.length?<details><summary>Memory · {selected.facts.length} {selected.facts.length===1?'fact':'facts'} for this question</summary><ul>{selected.facts.map(fact=><li key={fact.id}>{fact.text}</li>)}</ul>{selected.receipt.omitted>0&&<p>{selected.receipt.omitted} matching facts omitted by the memory limit.</p>}<p>Shared as guidance if you send this question.</p></details>:<span>{memory.enabled?'Memory on · no matching facts':'Memory off'}</span>}<button type="button" className="text" onClick={onManage}>Manage memory</button></div>;
}

export function MemoryReceipt({receipt,status,memory}:{receipt?:MemoryUse;status:string;memory?:UserMemory}){
 if(!receipt)return null;
 if(receipt.status!=='included')return <p className="memory-receipt">{receipt.status==='off'?'Memory was off for this request.':'No matching memory facts were included.'}</p>;
 const completed=status==='completed';
 return <details className="memory-receipt"><summary>{completed?'Shared':'Selected'} {receipt.facts.length} memory {receipt.facts.length===1?'fact':'facts'}</summary><p>{completed?'Shared with the AI service as guidance for this response.':'The request did not complete. Transmission of these facts is unverified.'}</p><ul>{receipt.facts.map(ref=>{const current=memory?.facts.find(fact=>fact.id===ref.id&&fact.revision===ref.revision);return <li key={ref.id}>{current?.text??'This fact was edited or forgotten, or saved memory is unavailable.'}</li>;})}</ul>{receipt.omitted>0&&<p>{receipt.omitted} matching facts were omitted by the memory limit.</p>}</details>;
}
