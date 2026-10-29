import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {Task,ArtifactRevision} from '../../src/core/types';
import {emptyTaskSession} from '../../src/core/task-session';
import {parseModuleAnswer,initialModuleState,updateModuleState,type ModuleAction} from '../../src/core/interactive-modules';
import {ModuleAnswerView} from '../../src/renderer/src/components/ModuleAnswer';
import {ArtifactMotionProvider} from '../../src/renderer/src/components/ReadyArtifact';
import '../../src/renderer/src/style.css';
import '../../src/renderer/src/vendor/transitions/ui-generation.css';
import 'streamdown/styles.css';

const now='2026-10-25T06:00:00.000Z';
const base:Task={id:'motion-task',title:'Owned module motion fixture',goal:'',status:'active',createdAt:now,updatedAt:now,sources:[],artifacts:[],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false},session:emptyTaskSession()};
const comparison={id:'comparison',version:1,data:{kind:'comparison',schemaVersion:1,title:'Compare the local choices',question:'Select the option to keep in this task.',columns:['Price','Weight'],rows:Array.from({length:12},(_,i)=>({id:'option-'+i,label:'Option '+(i+1),values:['$'+(40+i),'90 g']}))},provenance:[]};
const plan={id:'plan',version:1,data:{kind:'plan',schemaVersion:1,title:'Prepare the selected option',purpose:'Track the confirmed preparation steps.',items:Array.from({length:24},(_,i)=>({id:'item-'+i,title:'Preparation step '+(i+1),detail:'Keep this step with the current task.'}))},provenance:[]};
const kind=new URLSearchParams(location.search).get('kind')==='plan'?'plan':'comparison';
const answer=parseModuleAnswer({schemaVersion:1,markdown:'Local component verification.',modules:[kind==='plan'?plan:comparison]});
const revision:ArtifactRevision={revision:1,title:'Synthetic module',content:JSON.stringify(answer),mimeType:'application/vnd.window-companion.modules+json',sourceRefs:[],digest:'fixture-ai-version-1',createdAt:now};
const artifact={id:'answer',revisions:[revision]},identity=[base.id,artifact.id,revision.revision,revision.digest].join(':');
function Preview(){
 const history=new URLSearchParams(location.search).has('history');
 const [inserted,setInserted]=useState(history),[arrivals,setArrivals]=useState<string[]>([]),[task,setTask]=useState<Task>(base),[rerenders,setRerenders]=useState(0);
 async function edit(moduleId:string,action:ModuleAction){
  const module=answer.modules.find(module=>module.id===moduleId)!;
  setTask(current=>{const session=current.session!,saved=session.moduleStates.find(state=>state.moduleId===moduleId),state=updateModuleState(module.data,saved?.state??initialModuleState(module.data),action);return {...current,session:{...session,revision:session.revision+1,moduleStates:[{artifactId:artifact.id,artifactRevision:1,moduleId,state}]}};});
 }
 return <ArtifactMotionProvider arrivals={arrivals}><aside className="fixture-controls"><button onClick={()=>{setInserted(true);setArrivals([identity]);}}>Insert new answer</button><button onClick={()=>setRerenders(count=>count+1)}>Rerender</button><button onClick={()=>setInserted(false)}>Remove answer</button><output>{rerenders}</output></aside><main className="fixture-scroll" data-runtime-scope="whole-surface" data-surface-reveal="settled">{inserted&&<ModuleAnswerView task={task} artifact={artifact} revision={revision} onEdit={edit}/>}</main></ArtifactMotionProvider>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
