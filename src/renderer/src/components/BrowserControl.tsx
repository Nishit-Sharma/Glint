import {useEffect,useRef,useState} from 'react';
import {BROWSER_MANUAL_CONTROL_LIMITS} from '../../../shared/browser-control';
import type {BrowserControlReply} from '../../../shared/browser-control';

export function BrowserControl({taskId,requestId,active}:{taskId:string;requestId:string;active:boolean}){
 const [status,setStatus]=useState<BrowserControlReply>({mode:'unavailable'}),[pending,setPending]=useState(false),[error,setError]=useState('');
 const serial=useRef(0),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;serial.current++;};},[]);
 useEffect(()=>{
  if(!active)return;let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
  const check=async()=>{
   const attempt=++serial.current;
   try{const next=await window.companion.invoke<BrowserControlReply>({type:'browser.control.status',taskId,requestId});if(!stopped&&attempt===serial.current)setStatus(next);}
   catch{if(!stopped&&attempt===serial.current)setError('Browser control could not be checked. Stop remains available.');}
   if(!stopped)timer=setTimeout(()=>void check(),500);
  };
  void check();return()=>{stopped=true;if(timer)clearTimeout(timer);serial.current++;};
 },[taskId,requestId,active]);
 async function change(action:'take'|'return'){
  if(!('id' in status)||pending)return;serial.current++;setPending(true);setError('');
  try{const next=await window.companion.invoke<BrowserControlReply>({type:'browser.control',taskId,requestId,id:status.id,action});if(mounted.current)setStatus(next);}
  catch{if(mounted.current)setError('Browser control could not be changed. Check its current state or use Stop.');}
  finally{if(mounted.current)setPending(false);}
 }
 if(status.mode==='unavailable'||status.mode==='ended'||status.mode==='opening')return error?<p className="tiny" role="alert">{error}</p>:null;
 const user=status.mode==='user',pausing=status.mode==='pausing';
 return <section className="browser-control" aria-label="Browser control"><div className="browser-control-row"><p role="status">{pausing?'Pausing agent actions. Wait before using the page; a started interaction may still finish.':user?'You control the browser. Agent actions are paused; the page may keep running or loading.':'Glint controls the browser.'}</p><button type="button" disabled={pending||pausing} onClick={()=>void change(user?'return':'take')}>{pending?'Checking control…':pausing?'Pausing…':user?'Return browser control':'Pause and take control'}</button></div>{user&&<details><summary>What you can do</summary>{BROWSER_MANUAL_CONTROL_LIMITS.map(paragraph=><p key={paragraph}>{paragraph}</p>)}</details>}{error&&<p className="warning" role="alert">{error}</p>}</section>;
}
