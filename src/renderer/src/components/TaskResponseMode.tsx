import {useLayoutEffect,useRef,useState} from 'react';
import type {Task} from '../../../core/types';
import {taskResponseMode,type ResponseMode,type TaskResponseModeCommand} from '../../../shared/task-response-mode';

export function TaskResponseMode({task,pending=false,unconfirmed=false,disabled,isCurrent,invoke,onSaved}:{task:Task;pending?:boolean;unconfirmed?:boolean;disabled:boolean;isCurrent:()=>boolean;invoke:(command:TaskResponseModeCommand|{type:'tasks.get';taskId:string})=>Promise<Task>;onSaved:(task:Task)=>void}){
 const [working,setWorking]=useState(false),[error,setError]=useState('');const locked=useRef(false),generation=useRef(0),alive=useRef(true),latest=useRef(task);latest.current=task;
 useLayoutEffect(()=>{alive.current=true;generation.current++;locked.current=false;setWorking(false);setError('');return()=>{alive.current=false;generation.current++;};},[task.id]);
 const saved=taskResponseMode(task.session),checking=working||pending,needsRead=!!error||unconfirmed;
 async function save(mode:ResponseMode,read=false){
  if(disabled||pending||locked.current||!isCurrent()||!read&&(needsRead||mode===saved.mode))return;
  const owner=task.id,revision=saved.revision,epoch=++generation.current;locked.current=true;setWorking(true);setError('');
  const current=()=>alive.current&&epoch===generation.current&&latest.current.id===owner&&isCurrent();
  try{
   const updated=await invoke(read?{type:'tasks.get',taskId:owner}:{type:'response-mode.set',taskId:owner,expectedRevision:revision,mode});if(!current())return;
   const value=taskResponseMode(updated.session);if(updated.id!==owner||value.revision<taskResponseMode(latest.current.session).revision||!read&&(value.mode!==mode||value.revision<=revision))throw Error('Mode acknowledgement changed.');
   onSaved(updated);
  }catch{if(current())setError('The saved response mode could not be confirmed. Read the saved mode before choosing again.');}
  finally{if(epoch===generation.current){locked.current=false;if(alive.current)setWorking(false);}}
 }
 return <section className="request-context" aria-label="Task response mode"><div role="group" aria-label="Response mode"><button type="button" disabled={disabled||checking||needsRead} aria-pressed={!unconfirmed&&saved.mode==='ordinary'} onClick={()=>void save('ordinary')}>Ordinary</button><button type="button" disabled={disabled||checking||needsRead} aria-pressed={!unconfirmed&&saved.mode==='plan'} onClick={()=>void save('plan')}>Plan</button></div><p className="tiny">{unconfirmed?'Response mode needs confirmation.':saved.mode==='plan'?'Plan mode · ordinary planning-only replies.':'Ordinary responses.'} Saved for this task across task-list navigation and reopening. Existing requests and queued follow-ups keep their recorded mode. Browser actions and procedure generation keep their own routes.</p><p role="status" aria-live="polite">{checking?'Saving or reading response mode…':''}</p>{needsRead&&!checking&&<><p className="warning" role="alert">{error||'The saved response mode is unconfirmed. Read the saved mode before choosing again.'}</p><button type="button" disabled={checking||disabled} onClick={()=>void save(saved.mode,true)}>Read saved mode</button></>}</section>;
}
