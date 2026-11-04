import {StrictMode,useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Inspector} from '../../src/renderer/src/components/Inspector';
function Harness(){
 const [open,setOpen]=useState(false),[instance,setInstance]=useState(0),[active,setActive]=useState(true),[blocked,setBlocked]=useState(false),[review,setReview]=useState(false),main=useRef<HTMLElement>(null),dialog=useRef<HTMLDialogElement>(null),fallback=useRef('fallback');
 useLayoutEffect(()=>{if(review)dialog.current?.showModal();else dialog.current?.close();},[review]);
 const close=()=>{if(blocked){setReview(true);return;}flushSync(()=>setOpen(false));if(location.search.includes('main'))main.current?.focus();};
 Reflect.set(window,'inspectorFixture',{
  openFrom(id:string,fallbackId='fallback'){fallback.current=fallbackId;document.getElementById(id)?.focus();flushSync(()=>setOpen(true));},
  leave(){flushSync(()=>setOpen(false));main.current?.focus();},
  closeToControl(){flushSync(()=>setOpen(false));document.getElementById('destination')?.focus();},
  replace(){flushSync(()=>setInstance(value=>value+1));},
  reopen(){flushSync(()=>setOpen(false));flushSync(()=>setOpen(true));},
  dialog(){flushSync(()=>setOpen(false));dialog.current?.showModal();},
  blocked(){setBlocked(true);},
  hide(){flushSync(()=>setActive(false));},
  unmount(){flushSync(()=>setOpen(false));},
 });
 return <div className="workspace"><button id="opener" onClick={()=>setOpen(true)}>Open Inspector</button><button id="navigate" onClick={()=>{flushSync(()=>setOpen(false));main.current?.focus();}}>New destination</button><button id="fallback">Fallback</button><input id="destination" aria-label="New destination input"/><main ref={main} id="main" tabIndex={-1}>Current task destination</main>{open&&<Inspector key={instance} title={'Inspector '+instance} active={active} artifactKeyboard onClose={close} fallbackFocus={()=>document.getElementById(fallback.current)}><button id="content">Content control</button><details className="task-menu"><summary>Nested menu</summary><button>Nested action</button></details></Inspector>}<dialog ref={dialog}><button autoFocus onClick={()=>{setBlocked(false);setReview(false);dialog.current?.close();}}>Keep editing</button></dialog></div>;
}
createRoot(document.getElementById('root')!).render(location.search.includes('strict')?<StrictMode><Harness/></StrictMode>:<Harness/>);
