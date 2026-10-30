import {useEffect,useRef,useState} from 'react';
import type {Task} from '../../../core/types';
import {Button} from '../ui';
import {publicErrorMessage} from '../../../shared/public-messages';

export function DocumentRecipeCreateButton({taskId,disabled,onCreated}:{taskId:string;disabled:boolean;onCreated:(task:Task,artifactId:string)=>void}){
 const intent=useRef<{taskId:string;requestId:string}|undefined>(undefined),lock=useRef(false),alive=useRef(true),[working,setWorking]=useState(false),[error,setError]=useState('');
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 return <><Button disabled={disabled||working} onClick={()=>void(async()=>{
  if(lock.current||disabled)return;lock.current=true;setWorking(true);setError('');
  const input=intent.current?.taskId===taskId?intent.current:{taskId,requestId:crypto.randomUUID()},complete=onCreated;intent.current=input;
  try{const saved=await window.companion.invoke<{task:Task;artifactId:string;revision:number}>({type:'helper.document.create',...input});if(alive.current){intent.current=undefined;complete(saved.task,saved.artifactId);}}
  catch(cause){if(alive.current)setError(publicErrorMessage(cause)+' Reopen Files to check for the recipe; retry uses the same creation identity.');}
  finally{lock.current=false;if(alive.current)setWorking(false);}
 })()}>{working?'Creating local recipe…':error?'Check / retry document recipe':'Document recipe'}</Button>{error&&<p role="alert">{error}</p>}</>;
}
