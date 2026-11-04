import {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {TaskMenu} from '../../src/renderer/src/components/TaskMenu';
import {WindowSetup} from '../../src/renderer/src/WindowSetup';
import {useWorkspaceNavigation} from '../../src/renderer/src/workspace-navigation';
import {Inspector} from '../../src/renderer/src/components/Inspector';

const calls:unknown[]=[];Reflect.set(window,'__calls',calls);
let resolveAccess=()=>{};
Object.defineProperty(window,'companion',{value:{invoke:async(command:{type:string})=>{calls.push(command);if(command.type!=='capture.settings.get')throw Error('Unexpected host command');return new Promise(resolve=>{resolveAccess=()=>resolve({kind:'available',sessionPaused:false,current:{policy:{setupApproval:'approved'}}});if(!location.search.includes('held'))resolveAccess();});}}});
Reflect.set(window,'__releaseAccess',()=>resolveAccess());
function MenuHarness(){
 const [unread,setUnread]=useState(true),[inspector,setInspector]=useState(false),[mounted,setMounted]=useState(true),[page,setPage]=useState('task'),dialog=useRef<HTMLDialogElement>(null),main=useRef<HTMLElement|null>(null);
 useWorkspaceNavigation(main,'owner:'+page,true,'');
 return <><button id="before">Before task menu</button>{mounted&&<TaskMenu readState={{unread,disabled:false,onChange:()=>{calls.push({type:'mark-read'});setUnread(!unread);}}}><button onClick={()=>setPage(value=>value==='task'?'other':'task')}>Open task page</button><button onClick={()=>setInspector(true)}>Open inspector</button><button onClick={()=>dialog.current?.showModal()}>Open dialog</button><button onClick={()=>document.getElementById('after')?.focus()}>Move focus</button><button onClick={event=>{const button=event.currentTarget,menu=button.closest('details');queueMicrotask(()=>{if(menu){menu.open=true;button.focus();}});}}>Reopen menu</button><button onClick={()=>setMounted(false)}>Remove menu</button></TaskMenu>}<button id="after">After task menu</button><main ref={main} id="route-main" tabIndex={-1}>Task page {page}</main>{inspector&&<Inspector title="Destination" onClose={()=>setInspector(false)}><button>Destination action</button></Inspector>}<dialog ref={dialog}><button autoFocus onClick={()=>dialog.current?.close()}>Close dialog</button></dialog></>;
}
function SetupHarness(){
 const [windowSetup,setWindowSetup]=useState(false),[task,setTask]=useState('owner'),[visible,setVisible]=useState(true),main=useRef<HTMLElement|null>(null);
 useWorkspaceNavigation(main,task+':work:',visible,JSON.stringify([undefined,undefined,'2026-11-03']),windowSetup);
 Reflect.set(window,'__toggleSetup',(value:boolean)=>setWindowSetup(value));Reflect.set(window,'__switchTask',()=>{setTask('other');setWindowSetup(false);});Reflect.set(window,'__hideWorkspace',()=>setVisible(false));
 return <><button id="header">Header navigation</button><main ref={main} id="main" tabIndex={-1} hidden={!visible}>{windowSetup?<WindowSetup configured={false} shortcut="Both Option keys" capture={async()=>{calls.push({type:'capture-callback'});}} connect={()=>{calls.push({type:'connect-callback'});}} skip={()=>{calls.push({type:'skip-callback'});setWindowSetup(false);}}/>:<section><h2>Local example {task}</h2><button data-view-focus="window-setup" onClick={()=>setWindowSetup(true)}>Use my window</button></section>}</main>{visible&&!windowSetup&&<button>Composer control</button>}</>;
}
createRoot(document.getElementById('root')!).render(location.pathname==='/menu'?<MenuHarness/>:<SetupHarness/>);
