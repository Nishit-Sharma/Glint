import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {Task} from '../../core/types';
import {initialModuleState,moduleRegistry,parseModuleAnswer,type ModuleAction} from '../../core/interactive-modules';
import {ModuleView} from './components/InteractiveModule';
import './learning-demo.css';
type Snapshot={task:Task;artifactId:string;notes?:string};
async function call(path:string,input?:unknown):Promise<Snapshot>{
 const response=await fetch('/__workflow'+path,input===undefined?undefined:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
 const body=await response.json();if(!response.ok)throw Error(body.error??'The owned workflow host is unavailable.');return body;
}
function App(){
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false);
 useEffect(()=>{let active=true;const query=new URLSearchParams(location.search),taskId=query.get('task');void (taskId?call('/state?task='+encodeURIComponent(taskId)):call('/new',{source:query.get('source')==='true'})).then(value=>{if(active){setSnapshot(value);history.replaceState(null,'','?task='+encodeURIComponent(value.task.id));}}).catch(cause=>{if(active)setError(cause.message);});return()=>{active=false;};},[]);
 const task=snapshot?.task,artifact=task?.artifacts.find(a=>a.id===snapshot?.artifactId),revision=artifact?.revisions.at(-1),module=revision?parseModuleAnswer(JSON.parse(revision.content)).modules[0]:null;
 const saved=task&&artifact&&revision&&module?task.session?.moduleStates.find(s=>s.artifactId===artifact.id&&s.artifactRevision===revision.revision&&s.moduleId===module.id):null;
 const state=module?(saved?moduleRegistry[module.data.kind].parseState(saved.state):initialModuleState(module.data)):null;
 const perform=async(path:string,input:unknown)=>{setPending(true);setError('');try{setSnapshot(await call(path,input));}catch(cause){setError(cause instanceof Error?cause.message:'Could not apply workflow change.');}finally{setPending(false);}};
 return <main><header className="demo-header"><h1>Finite workflow experiment</h1><p>Actual local task store with clearly labeled synthetic rules. No provider, screen capture, native app or real procedure executes.</p></header>{task&&artifact&&revision&&module&&state?<><ModuleView task={task} data={module.data} state={state} pending={pending} onAction={(action:ModuleAction)=>void perform('/edit',{taskId:task.id,artifactId:artifact.id,artifactRevision:revision.revision,moduleId:module.id,action})}/><section className="workflow-lab"><h4>Owned test host controls</h4><p>These controls exercise only this disposable synthetic store.</p><div className="workflow-modes"><button disabled={pending} onClick={()=>void perform('/restart',{taskId:task.id,artifactId:artifact.id})}>Reload local store</button><button disabled={pending} onClick={()=>void perform('/notes',{taskId:task.id,artifactId:artifact.id})}>Save current notes</button>{module.data.kind==='workflow-lab'&&module.data.basis.kind==='reviewed-source'&&<><button disabled={pending} onClick={()=>void perform('/change-source',{taskId:task.id,artifactId:artifact.id})}>Change synthetic source</button><button disabled={pending} onClick={()=>void perform('/change-basis',{taskId:task.id,artifactId:artifact.id})}>Revise cited artifact</button></>}</div>{snapshot?.notes&&<pre aria-label="Saved workflow notes" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{snapshot.notes}</pre>}</section></>:<p role="status">Preparing owned workflow fixture…</p>}{error&&<p role="alert">{error}</p>}</main>;
}
const root=document.getElementById('root');if(!root)throw Error('Workflow demo root unavailable.');createRoot(root).render(<App/>);
