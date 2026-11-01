import {useEffect,useRef,useState} from 'react';
import type {Task} from '../../../core/types';
import {isProjectArchived,type Project,type ProjectCommand,type ProjectReply} from '../../../shared/projects';
import {useGuardedAction,useNavigationDraft} from '../draft-navigation';
import {Button,Field} from '../ui';

type CreateCommand=Extract<ProjectCommand,{type:'projects.create'}>;
type Inclusion={taskId:string;title:string;expectedProjectId:string|null;projectName:string};
type Creation={phase:'idle'}|{phase:'saving'|'uncertain';command:CreateCommand;taskTitle?:string};
export type ProjectCreateProps={
 projects:Project[];tasks:Task[];currentTaskId?:string;busy:boolean;
 change:<C extends ProjectCommand>(command:C)=>Promise<ProjectReply<C>|undefined>;
 onSelect:(id:string)=>void;
};

export function ProjectCreate({projects,tasks,currentTaskId,busy,change,onSelect}:ProjectCreateProps){
 const [name,setName]=useState(''),[inclusion,setInclusion]=useState<Inclusion>(),[creation,setCreation]=useState<Creation>({phase:'idle'});
 const alive=useRef(true),locked=useRef(false),guardNavigation=useGuardedAction();
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const reset=()=>{setName('');setInclusion(undefined);setCreation({phase:'idle'});};
 const clearCreate=useNavigationDraft(name.length>0||!!inclusion,reset);
 const currentTask=tasks.find(task=>task.id===currentTaskId),includedTask=inclusion?tasks.find(task=>task.id===inclusion.taskId):undefined;
 const currentArchived=projects.some(project=>project.id===currentTask?.projectId&&isProjectArchived(project));
 const stale=!!inclusion&&(!includedTask||currentTaskId!==inclusion.taskId||(includedTask.projectId??null)!==inclusion.expectedProjectId||projects.some(project=>project.id===includedTask.projectId&&isProjectArchived(project)));
 const collision=creation.phase==='idle'&&!!name.trim()&&projects.some(project=>project.name.toLocaleLowerCase()===name.trim().toLocaleLowerCase());
 const pending=creation.phase==='saving',held=busy||pending,frozen=creation.phase!=='idle';
 async function save(command:CreateCommand,taskTitle?:string){
  if(locked.current||busy)return;locked.current=true;setCreation({phase:'saving',command,taskTitle});
  try{
   const saved=await change(command);
   if(!alive.current)return;
   if(!saved){setCreation({phase:'uncertain',command,taskTitle});return;}
   reset();clearCreate();guardNavigation(()=>onSelect(saved.id));
  }catch{if(alive.current)setCreation({phase:'uncertain',command,taskTitle});}
  finally{locked.current=false;}
 }
 return <div className="project-details">
  <form className="project-details" aria-label="Create a project" onSubmit={event=>{
   event.preventDefault();if(creation.phase!=='idle'||held||!name.trim()||stale||collision)return;
   const command:CreateCommand={type:'projects.create',intentId:crypto.randomUUID(),name:name.trim(),...(inclusion?{includeTask:{taskId:inclusion.taskId,expectedProjectId:inclusion.expectedProjectId}}:{})};
   void save(command,inclusion?.title);
  }}>
   <div className="project-create">
    <Field label="New project name"><input value={name} maxLength={200} disabled={held||frozen} onChange={event=>setName(event.currentTarget.value)}/></Field>
    {creation.phase==='idle'&&<Button type="submit" disabled={held||!name.trim()||stale||collision}>Create project</Button>}
   </div>
   {(currentTask||inclusion)&&<fieldset className="project-bulk-select" disabled={held||frozen}>
    <legend>Starting tasks</legend>
    <label className="project-move-option"><input type="checkbox" checked={!!inclusion} disabled={currentArchived&&!inclusion} onChange={event=>{
     if(!event.currentTarget.checked){setInclusion(undefined);return;}
     if(currentTask&&!currentArchived)setInclusion({taskId:currentTask.id,title:currentTask.title,expectedProjectId:currentTask.projectId??null,projectName:projects.find(project=>project.id===currentTask.projectId)?.name??'another project'});
    }}/><span>Include current task<strong style={{display:'block'}}>{inclusion?.title??currentTask?.title}</strong></span></label>
    {inclusion?<p className="tiny">{inclusion.expectedProjectId?`This moves “${inclusion.title}” from “${inclusion.projectName}” into the new project.`:`“${inclusion.title}” will join the new project.`} It keeps its sources, saved work, history, unsent message and browser route. A running response in this task will stop.</p>:<p className="tiny">Leave this unchecked to create an empty project.</p>}
    {currentArchived&&<p className="tiny">The current task belongs to an archived project. Restore that project before moving the task.</p>}
   </fieldset>}
   {stale&&creation.phase==='idle'&&<p role="status">The current task or its project changed. Clear task inclusion and choose it again before creating.</p>}
   {collision&&<p role="status">A project already uses this name. Choose a different name for the new project.</p>}
   {creation.phase==='uncertain'&&<>
    <p role="status">The creation result was not confirmed. Check the same creation for “{creation.command.name}”{creation.taskTitle?` with “${creation.taskTitle}”`:''}. This keeps the original name and task choice.</p>
    <Button disabled={held} onClick={()=>{if(creation.phase==='uncertain')void save(creation.command,creation.taskTitle);}}>Check same creation</Button>
   </>}
   {pending&&<p role="status">Creating project…</p>}
   {(name.length>0||inclusion||frozen)&&<Button disabled={held} onClick={()=>{reset();clearCreate();}}>{frozen?'Close creation':'Cancel creation'}</Button>}
   {creation.phase==='uncertain'&&<p className="tiny">Closing this form does not undo a project or task move that was already saved. Inspect your projects before starting another creation.</p>}
  </form>
 </div>;
}
