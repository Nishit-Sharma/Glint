import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { JoinLab } from './components/JoinLab';
import { joinLab } from '../../learning/join-lab';
import { exampleLesson } from '../../learning/example';
import {mixedTypeLesson} from '../../learning/mixed-example';
const lesson=new URLSearchParams(location.search).get('fixture')==='mixed'?mixedTypeLesson:exampleLesson;
const lessonKey='companion-join-demo-v1-'+lesson.id;
import { helperExample } from '../../learning/helper-example';
import { helperStudio } from '../../learning/reusable-helper';
import { HelperStudio } from './components/HelperStudio';
import './learning-demo.css';
function Demo(){
 const [error,setError]=useState('');
 const [tab,setTab]=useState('join');
 const [helper,setHelper]=useState(()=>{try{const saved=localStorage.getItem('companion-helper-demo-v1');return saved?helperStudio.parseState(helperExample,JSON.parse(saved)):helperStudio.initial(helperExample);}catch{return helperStudio.initial(helperExample);}});
 const [state,setState]=useState(()=>{try{const saved=localStorage.getItem(lessonKey)??(lesson.id===exampleLesson.id?localStorage.getItem('companion-join-demo-v1'):null);return saved?joinLab.parseState(lesson,JSON.parse(saved)):joinLab.initial(lesson);}catch{return joinLab.initial(lesson);}});
 return <main><header className="demo-header"><h1>Companion learning lab</h1><p>Deterministic local examples. No screen capture or model connection.</p><nav className="learning-actions"><button onClick={()=>{setTab('join');setError('');}}>SQL join</button><button onClick={()=>{setTab('helper');setError('');}}>Reusable helper</button></nav></header>{tab==='join'?<JoinLab data={lesson} state={state} onAction={action=>{try{const next=joinLab.update(lesson,state,action);localStorage.setItem(lessonKey,JSON.stringify(next));setState(next);setError('');}catch(cause){setError(cause instanceof Error?cause.message:'Could not apply change.');}}}/>:<HelperStudio data={helperExample} state={helper} onAction={action=>{try{const next=helperStudio.update(helperExample,helper,action);localStorage.setItem('companion-helper-demo-v1',JSON.stringify(next));setHelper(next);setError('');}catch(cause){setError(cause instanceof Error?cause.message:'Could not apply helper change.');}}}/ >}{error&&<p role="alert">{error}</p>}<p className="demo-footer">The standalone lab saves only this example in this browser. Integration uses the existing task session store.</p></main>;
}
const root=document.getElementById('root');
if(!root)throw Error('The learning demo root is missing.');
createRoot(root).render(<Demo/>);
