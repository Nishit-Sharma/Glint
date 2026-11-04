import {useEffect,useId,useRef,useState} from 'react';
import {getTaskStarters,type TaskStarter,type SuggestedTaskInput,type SuggestedTaskResult} from '../../../shared/task-starters';
import {Button,Field} from '../ui';
import './local-task-start.css';
type Props={originTaskId:string|null;disabled:boolean;isCurrent:()=>boolean;onCreate:(input:Readonly<SuggestedTaskInput>)=>Promise<SuggestedTaskResult|undefined>;onCreated:(result:SuggestedTaskResult,input:Readonly<SuggestedTaskInput>)=>void};
/** Review and local creation only. The ordinary composer owns any later Ask. */
export function TaskStarters(props:Props){
 const id=useId(),alive=useRef(true),latest=useRef(props);latest.current=props;
 const [selected,setSelected]=useState<TaskStarter>(),[phase,setPhase]=useState<'idle'|'saving'|'uncertain'>('idle');
 const attempt=useRef<{input:Readonly<SuggestedTaskInput>;working:boolean;completed:boolean}|undefined>(undefined);
 const heading=useRef<HTMLHeadingElement>(null),returnTo=useRef<string|undefined>(undefined),list=useRef<HTMLDivElement>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 // Keyboard and screen-reader users land on what they chose, and Cancel returns them to that starter.
 useEffect(()=>{if(selected){heading.current?.focus();return;}const id=returnTo.current;returnTo.current=undefined;if(id)list.current?.querySelector<HTMLButtonElement>(`[data-starter="${id}"]`)?.focus();},[selected?.reference.id]);
 function current(){return alive.current&&latest.current.isCurrent();}
 function review(starter:TaskStarter){if(props.disabled||attempt.current?.working||phase==='uncertain'||!current())return;attempt.current=undefined;setPhase('idle');setSelected(starter);}
 function cancel(){if(attempt.current?.working)return;attempt.current=undefined;returnTo.current=selected?.reference.id;setSelected(undefined);setPhase('idle');}
 async function create(){
  if(!selected||props.disabled||!current()||attempt.current?.working||attempt.current?.completed)return;
  const owned=attempt.current??{input:Object.freeze({originTaskId:props.originTaskId,starter:Object.freeze({...selected.reference})}),working:false,completed:false};attempt.current=owned;owned.working=true;setPhase('saving');
  try{const result=await latest.current.onCreate(owned.input);if(!current()||attempt.current!==owned)return;if(!result){setPhase('uncertain');return;}owned.completed=true;latest.current.onCreated(result,owned.input);}catch{if(current()&&attempt.current===owned)setPhase('uncertain');}finally{owned.working=false;}
 }
 return <section className="local-task-start" aria-labelledby={id+'-heading'} aria-busy={phase==='saving'||undefined}>
  <h3 id={id+'-heading'}>Start from a prompt</h3><p>Preview a prompt, then start it as a task you can edit. Nothing is sent until you ask.</p>
  {!selected?<div className="task-starter-list" ref={list}>{getTaskStarters().map(starter=><button type="button" className="task-starter" key={starter.reference.id} data-starter={starter.reference.id} disabled={props.disabled} aria-labelledby={id+'-'+starter.reference.id} aria-describedby={id+'-'+starter.reference.id+'-description'} onClick={()=>review(starter)}><strong id={id+'-'+starter.reference.id}>{starter.title}</strong><small id={id+'-'+starter.reference.id+'-description'}>{starter.description}</small></button>)}</div>:<section aria-label="Review suggested task">
   <h4 ref={heading} tabIndex={-1}>{selected.title}</h4><p>{selected.description}</p><Field label="Task goal"><textarea rows={2} readOnly value={selected.goal}/></Field><Field label="Unsent starter prompt"><textarea rows={7} readOnly value={selected.prompt}/></Field>
   <p>Nothing is sent to AI. Edit this prompt in the new task before choosing Ask. Your current task and its unsent message are kept.</p>
   <p>Choosing this exact starter again from this same starting task opens the task already started, including your later edits. It does not create a duplicate or reset that task.</p>
   {phase==='uncertain'&&<p role="alert">The save could not be confirmed. Check this same starter task. Closing keeps any task already saved; choosing this starter again here checks the same task.</p>}
   <div className="local-task-actions"><Button disabled={phase==='saving'} onClick={cancel}>{phase==='uncertain'?'Close review':'Cancel'}</Button><Button kind="primary" disabled={props.disabled||phase==='saving'} onClick={()=>void create()}>{phase==='saving'?'Starting…':phase==='uncertain'?'Check same starter task':'Start or open task'}</Button></div>
  </section>}
 </section>;
}
