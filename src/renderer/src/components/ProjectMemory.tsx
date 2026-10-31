import {useEffect,useRef,useState} from 'react';
import type {Project} from '../../../shared/projects';
import {emptyUserMemory,readUserMemory,readMemoryCommit,MEMORY_FACT_LIMIT,MEMORY_FACT_COUNT,type MemoryFact,type MemoryChange} from '../../../shared/user-memory';
import {useUserMemory} from '../UserMemory';
import {useNavigationDraft} from '../draft-navigation';
import {publicErrorMessage} from '../../../shared/public-messages';
import {Button,Field} from '../ui';

type ProjectMemoryEdit=Exclude<MemoryChange['change'],{kind:'forget'}>;
export function ProjectMemory({project,busy}:{project:Project;busy:boolean}){
 const [memory,setMemory]=useState(project.memory??emptyUserMemory()),[editing,setEditing]=useState<MemoryFact>(),[text,setText]=useState(''),[topics,setTopics]=useState(''),[saving,setSaving]=useState(false),[blocked,setBlocked]=useState(false),[message,setMessage]=useState('');
 const {memory:account}=useUserMemory(),alive=useRef(true),lock=useRef(false),textInput=useRef<HTMLTextAreaElement>(null),formHeading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(editing)textInput.current?.focus();},[editing?.id]);
 const dirty=text!==(editing?.text??'')||topics!==(editing?.topics.join(', ')??''),clearDraft=useNavigationDraft(dirty||saving);
 const terms=topics.split(',').map(value=>value.trim()).filter(Boolean),topicIssue=terms.length>8?'Use at most eight topics.':terms.some(value=>value.length>60)?'Keep each topic under 61 characters.':'';
 function reset(){setEditing(undefined);setText('');setTopics('');clearDraft();formHeading.current?.focus();}
 async function change(change:ProjectMemoryEdit){
  if(lock.current||blocked||busy)return;lock.current=true;setSaving(true);setMessage('');
  try{const result=readMemoryCommit(await window.companion.invoke({type:'projects.memory.change',projectId:project.id,expectedRevision:memory.revision,change}));if(!alive.current)return;
   if(result.kind==='conflict'){setBlocked(true);setMessage('Project memory changed elsewhere. Your edits are kept. Load saved project memory before saving again.');return;}
   setMemory(result.current);if(change.kind==='save')reset();setMessage(change.kind==='enabled'?(result.current.enabled?'Project memory enabled. Global Memory must also be on.':'Project memory is off. Saved facts are kept.'):'Project fact saved.');
  }catch(error){if(alive.current){setBlocked(true);setMessage(publicErrorMessage(error)+' Load saved project memory to confirm the current state. Your edits are kept.');}}
  finally{lock.current=false;if(alive.current)setSaving(false);}
 }
 async function load(){
  if(lock.current||busy)return;lock.current=true;setSaving(true);
  try{const saved=readUserMemory(await window.companion.invoke({type:'projects.memory.get',projectId:project.id}));if(alive.current){setMemory(saved);setBlocked(false);reset();setMessage('Saved project memory loaded.');}}
  catch{if(alive.current)setMessage('Project memory could not be opened. Your edits are kept.');}
  finally{lock.current=false;if(alive.current)setSaving(false);}
 }
 const held=busy||saving;
 return <section className="project-memory" aria-label="Project memory">
  <div className="project-heading"><h3>Project memory</h3><Button disabled={held||blocked||dirty} onClick={()=>void change({kind:'enabled',enabled:!memory.enabled})}>{memory.enabled?'Turn off project memory':'Enable project memory'}</Button></div>
  <p>Save facts for tasks in {project.name}. They are separate from account facts and every other project. Glint does not collect them automatically.</p>
  {account&&!account.enabled&&<p className="tiny">Global Memory is off. These project facts stay saved but are not used.</p>}
  <p className="tiny">{memory.enabled?'Project memory on':'Project memory off'} · {memory.facts.length} / {MEMORY_FACT_COUNT} saved facts. Matching facts appear in a task’s local memory preview before you send.</p>
  {memory.facts.length?<ul className="memory-facts">{memory.facts.map(fact=><li key={fact.id}><div><p>{fact.text}</p><small>{fact.topics.length?'Use for: '+fact.topics.join(', '):'Use for all text questions in this project'}</small></div><Button disabled={held||blocked||dirty} onClick={()=>{setEditing(fact);setText(fact.text);setTopics(fact.topics.join(', '));setMessage('');}}>Edit project fact</Button></li>)}</ul>:<p>No project facts saved.</p>}
  <form className="memory-fact-form" onSubmit={event=>{event.preventDefault();if(text.trim()&&!topicIssue)void change({kind:'save',...(editing?{id:editing.id}:{}),text,topics:terms});}}>
   <h4 ref={formHeading} tabIndex={-1}>{editing?'Edit project fact':'Add a project fact'}</h4>
   <Field label="Project fact to remember"><textarea ref={textInput} rows={3} maxLength={MEMORY_FACT_LIMIT} value={text} disabled={held||blocked} onChange={event=>setText(event.currentTarget.value)}/></Field>
   <Field label="Project fact topics (optional)"><input value={topics} maxLength={488} disabled={held||blocked} onChange={event=>setTopics(event.currentTarget.value)} aria-invalid={!!topicIssue}/></Field>
   <p className="tiny">Leave topics blank for all text questions in this project, or enter up to eight comma-separated words or phrases. Each request uses at most eight total account/project facts and 4,000 characters.</p>
   {topicIssue&&<p role="alert">{topicIssue}</p>}
   <div className="row"><Button type="submit" disabled={held||blocked||!dirty||!text.trim()||!!topicIssue||!editing&&memory.facts.length>=MEMORY_FACT_COUNT}>{saving?'Saving…':editing?'Save project fact':'Add project fact'}</Button>{(editing||dirty)&&<Button disabled={held} onClick={reset}>Discard project fact edits</Button>}</div>
  </form>
  {message&&<p role={blocked?'alert':'status'}>{message}</p>}
  {blocked&&<Button disabled={held} onClick={()=>void load()}>Load saved project memory and replace these edits</Button>}
 </section>;
}
