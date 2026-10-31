import {useEffect,useId,useRef,useState,type ReactNode,type MouseEvent} from 'react';
import {CODE_BLOCK_COPY_LIMIT} from '../../../shared/code-block-copy';

export function CodeBlock({children,text,enabled=true}:{children:ReactNode;text?:string;enabled?:boolean}){
 const [status,setStatus]=useState<'idle'|'copying'|'copied'|'error'>('idle'),attempt=useRef(0),pending=useRef(false),statusId=useId();
 const available=enabled&&text!==undefined&&text.length<=CODE_BLOCK_COPY_LIMIT;
 useEffect(()=>{attempt.current++;pending.current=false;setStatus('idle');return()=>{attempt.current++;};},[text,enabled]);
 async function copy(event:MouseEvent<HTMLButtonElement>){
  if(!event.isTrusted||!available||pending.current)return;
  const current=++attempt.current;
  pending.current=true;setStatus('copying');
  try{
   const result=await window.companion.invoke<null>({type:'code-block.copy',text});
   if(result!==null)throw Error('Copy was not confirmed.');
   if(attempt.current===current)setStatus('copied');
  }catch{if(attempt.current===current)setStatus('error');}
  finally{if(attempt.current===current)pending.current=false;}
 }
 const message=status==='copied'?'Code copied.':status==='error'?'Could not copy code. Select the code and use Copy.':status==='copying'?'Copying code…':!enabled?'Copy is available when the answer is complete.':!available?'Select the code and use Copy.':'';
 return <div className="markdown-code-block">
  <div className="markdown-code-actions"><span id={statusId} role="status" aria-live="polite" className="markdown-code-status">{message}</span><button type="button" aria-label="Copy code block" aria-describedby={statusId} disabled={!available} aria-disabled={status==='copying'||undefined} onClick={copy}>{status==='copied'?'Copied':'Copy'}</button></div>
  <pre tabIndex={0} role="region" aria-label="Code block">{children}</pre>
 </div>;
}
