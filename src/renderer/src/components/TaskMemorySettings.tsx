import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {Task} from '../../../core/types';
import {taskMemoryPolicy,readTaskMemoryPolicyState,type TaskMemoryPolicy} from '../../../shared/task-memory-policy';
import {readMemoryPreview,projectMemoryFactActive,type TaskMemorySelection} from '../../../shared/project-memory';
import {Button,Field} from '../ui';

export function TaskMemorySettings({task,prompt}:{task:Task;prompt:string}){
 const [saved,setSaved]=useState(()=>taskMemoryPolicy(task.session)),[working,setWorking]=useState(false),[blocked,setBlocked]=useState(false),[message,setMessage]=useState(''),[preview,setPreview]=useState<{key:string;value:TaskMemorySelection}>();
 const current=useRef(saved),alive=useRef(true),locked=useRef(false),generation=useRef(0),inspection=useRef(0);current.current=saved;
 const key=JSON.stringify([task.id,task.updatedAt,task.projectId,task.session?.contextRevision,saved,prompt]),liveKey=useRef(key);liveKey.current=key;
 useLayoutEffect(()=>{alive.current=true;generation.current++;const next=taskMemoryPolicy(task.session);current.current=next;setSaved(next);setPreview(undefined);setMessage('');setBlocked(false);locked.current=false;setWorking(false);return()=>{alive.current=false;generation.current++;};},[task.id]);
 useEffect(()=>{const next=taskMemoryPolicy(task.session);if(next.revision>current.current.revision){current.current=next;setSaved(next);setPreview(undefined);}},[task.session?.memoryPolicy?.revision]);
 useEffect(()=>window.companion.subscribe(event=>{if(event.type==='changed'){inspection.current++;setPreview(undefined);}}),[task.id]);
 async function save(mode:TaskMemoryPolicy['mode']){
  if(locked.current||blocked||task.status!=='active')return;locked.current=true;setWorking(true);setPreview(undefined);setMessage('');const epoch=generation.current,expectedRevision=current.current.revision;
  try{const reply=readTaskMemoryPolicyState(await window.companion.invoke({type:'memory.task.set',taskId:task.id,expectedRevision,mode}));if(!alive.current||epoch!==generation.current)return;if(reply.taskId!==task.id||reply.revision<current.current.revision||reply.revision<expectedRevision||reply.mode!==mode)throw Error();const next={revision:reply.revision,mode:reply.mode};current.current=next;setSaved(next);setMessage('Memory choice saved for this task. Queued follow-ups need review. Nothing was sent.');}
  catch{if(alive.current&&epoch===generation.current){setBlocked(true);setMessage('The choice save was not confirmed. Reload this task’s choice before changing it again.');}}
  finally{if(epoch===generation.current){locked.current=false;if(alive.current)setWorking(false);}}
 }
 async function reload(){
  if(locked.current)return;locked.current=true;setWorking(true);setPreview(undefined);const epoch=generation.current;
  try{const owner=await window.companion.invoke<Task>({type:'tasks.get',taskId:task.id});if(!alive.current||epoch!==generation.current)return;const next=readTaskMemoryPolicyState({taskId:owner.id,...taskMemoryPolicy(owner.session)});if(next.taskId!==task.id||next.revision<current.current.revision)throw Error();current.current={revision:next.revision,mode:next.mode};setSaved(current.current);setBlocked(false);setMessage('Saved task memory choice loaded.');}
  catch{if(alive.current&&epoch===generation.current)setMessage('The saved task memory choice could not be loaded.');}
  finally{if(epoch===generation.current){locked.current=false;if(alive.current)setWorking(false);}}
 }
 async function inspect(){
  if(locked.current||blocked)return;locked.current=true;setWorking(true);setPreview(undefined);setMessage('');const captured=key,epoch=generation.current,token=++inspection.current;
  try{const value=readMemoryPreview(await window.companion.invoke({type:'memory.preview',taskId:task.id,prompt}));if(!alive.current||epoch!==generation.current||captured!==liveKey.current||token!==inspection.current)return;if(value.taskPolicy?.revision!==current.current.revision||value.taskPolicy.mode!==current.current.mode||value.projectFacts.some(fact=>!projectMemoryFactActive(fact,Date.now())))throw Error();setPreview({key:captured,value});}
  catch{if(alive.current&&epoch===generation.current)setMessage('Memory could not be inspected. Reload the saved task choice and inspect again.');}
  finally{if(epoch===generation.current){locked.current=false;if(alive.current)setWorking(false);}}
 }
 useEffect(()=>{if(!preview||preview.key!==key)return;const token=inspection.current,deadline=Math.min(...preview.value.projectFacts.flatMap(fact=>fact.expiresAt?[Date.parse(fact.expiresAt)]:[]));if(!Number.isFinite(deadline))return;let timer:ReturnType<typeof setTimeout>|undefined;const expire=()=>{if(token!==inspection.current)return;const remaining=deadline-Date.now();if(remaining<=0){inspection.current++;setPreview(undefined);setMessage('The project memory inspection expired. Inspect memory again for the current selection.');return;}timer=setTimeout(expire,Math.min(remaining,2_147_483_647));};expire();return()=>{if(timer)clearTimeout(timer);};},[preview,key]);
 const shown=preview?.key===key&&preview.value.projectFacts.every(fact=>projectMemoryFactActive(fact,Date.now()))?preview.value:undefined;
 return <details className="request-inference"><summary>Task memory · {saved.mode==='off'?'Off':'Inherit settings'}</summary>
  <p>Choose whether saved account and project facts may enter ordinary questions and drafts in this task. Inherit obeys global and project settings; it never turns global Memory on.</p>
  <Field label="Saved memory for this task"><select disabled={working||blocked||task.status!=='active'} value={saved.mode} onChange={event=>{const mode=event.target.value;if(mode==='inherit'||mode==='off')void save(mode);}}><option value="inherit">Inherit global and project settings</option><option value="off">Off for this task</option></select></Field>
  <p className="tiny">Changing this choice holds queued follow-ups for review. It does not erase earlier conversation, source copies or facts already sent. Earlier requests may already have reached the service. This controls saved-fact use, not capture or other personalization.</p>
  <div className="row"><Button disabled={working} onClick={()=>void reload()}>Reload task memory choice</Button><Button disabled={working||blocked} onClick={()=>void inspect()}>Inspect memory for this question</Button></div>
  {shown&&<section aria-label="Task memory inspection"><p>Task choice: {shown.taskPolicy?.mode==='off'?'Off':'Inherit settings'} · revision {shown.taskPolicy?.revision}. Global Memory: {shown.globalEnabled?'On':'Off'}.</p><p>{shown.taskPolicy?.mode==='off'?'No saved account or project facts are included for this task.':!shown.globalEnabled?'Global Memory is off. No saved facts are included.':`${shown.facts.length} account and ${shown.projectFacts.length} project facts match this question.`}</p>{[...shown.projectFacts,...shown.facts].map(fact=><p key={fact.id}>{fact.text}</p>)}<p className="tiny">Inspected snapshot for this message. Nothing was sent.</p></section>}
  {message&&<p role="status">{message}</p>}
 </details>;
}
