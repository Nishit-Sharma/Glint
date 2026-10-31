import {useEffect,useRef,useState} from 'react';
import {Star} from 'lucide-react';
import type {SourceVersion,Task} from '../../../core/types';
import {PROJECT_INSTRUCTIONS_LIMIT,projectSourceMatches,projectSourceVersion,projectSourceInTask,type Project,type ProjectPins,type ProjectCommand,type ProjectReply} from '../../../shared/projects';
import {useGuardedAction,useNavigationDraft} from '../draft-navigation';
import {Button,Field,type Run} from '../ui';
import './projects.css';

type Change=<C extends ProjectCommand>(command:C)=>Promise<ProjectReply<C>|undefined>;
type SourceUpdateReview={command:Extract<ProjectCommand,{type:'projects.sources.update'}>;previous:SourceVersion;next:SourceVersion};
export function Projects({projects,pins,selected,onSelect,loadError,pinning,onTogglePin,onReload,tasks,currentTaskId,busy,run,onOpenTask}:{projects?:Project[];pins?:ProjectPins;selected:string;onSelect:(id:string)=>void;loadError:string;pinning:boolean;onTogglePin:(project:Project)=>void;onReload:()=>Promise<void>;tasks:Task[];currentTaskId?:string;busy:boolean;run:Run;onOpenTask:(task:Task)=>void}){
 const [name,setName]=useState(''),[error,setError]=useState(''),[working,setWorking]=useState(false);
 const alive=useRef(true),locked=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const clearCreate=useNavigationDraft(name.length>0,()=>setName(''));
 const guardNavigation=useGuardedAction();
 async function change<C extends ProjectCommand>(command:C):Promise<ProjectReply<C>|undefined>{
  if(locked.current||busy)return;locked.current=true;setWorking(true);setError('');
  try{const saved=await run<ProjectReply<C>>(command);if(alive.current){await onReload();if(!saved)setError('The change was not confirmed. Reload saved projects before trying again.');}return saved;}
  finally{locked.current=false;if(alive.current)setWorking(false);}
 }
 const project=projects?.find(project=>project.id===selected),held=busy||working;
 return <section className="projects" aria-label="Projects">
  <p>Keep related tasks, instructions and saved sources together.</p>
  {(error||loadError)&&<p role="alert">{error||loadError} <Button disabled={held||pinning} onClick={()=>{setError('');void onReload();}}>Reload projects</Button></p>}
  {!projects&&!error&&!loadError&&<p role="status">Loading projects…</p>}
  {projects&&<>
   <form className="project-create" onSubmit={event=>{event.preventDefault();if(!name.trim()||held)return;const submitted=name;void change({type:'projects.create',name:name.trim()}).then(saved=>{if(saved&&alive.current){setName(current=>current===submitted?'':current);clearCreate();guardNavigation(()=>onSelect(saved.id));}});}}><Field label="New project name"><input value={name} maxLength={200} disabled={held} onChange={event=>setName(event.currentTarget.value)}/></Field><Button type="submit" disabled={held||!name.trim()}>Create project</Button></form>
   {!projects.length?<p>No projects yet. Create one, then add your tasks.</p>:<>
    <Field label="Project"><select value={selected} disabled={held} onChange={event=>{const id=event.currentTarget.value;guardNavigation(()=>onSelect(id));}}><option value="">Choose a project</option>{projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select></Field>
    {project&&<ProjectDetails key={project.id} project={project} projects={projects} tasks={tasks} currentTaskId={currentTaskId} busy={held} change={change} onOpenTask={onOpenTask} pinned={!!pins?.projectIds.includes(project.id)} pinDisabled={held||pinning||!pins||!!loadError} onTogglePin={onTogglePin}/>}
   </>}
  </>}
 </section>;
}

function ProjectDetails({project,projects,tasks,currentTaskId,busy,change,onOpenTask,pinned,pinDisabled,onTogglePin}:{project:Project;projects:Project[];tasks:Task[];currentTaskId?:string;busy:boolean;change:Change;onOpenTask:(task:Task)=>void;pinned:boolean;pinDisabled:boolean;onTogglePin:(project:Project)=>void}){
 const [base,setBase]=useState(project),[name,setName]=useState(project.name),[instructions,setInstructions]=useState(project.instructions),[taskChoice,setTaskChoice]=useState(''),[sourceChoice,setSourceChoice]=useState(''),[target,setTarget]=useState(currentTaskId??'');
 const [review,setReview]=useState<SourceUpdateReview>();
 const reviewTrigger=useRef<HTMLButtonElement|null>(null);
 const closeReview=()=>{setReview(undefined);requestAnimationFrame(()=>reviewTrigger.current?.focus());};
 const dirty=name!==base.name||instructions!==base.instructions,changed=base.revision!==project.revision;
 const reset=()=>{setBase(project);setName(project.name);setInstructions(project.instructions);};
 const navigation=useNavigationDraft(dirty,reset),latest=useRef({name,instructions});latest.current={name,instructions};
 useEffect(()=>{if(!dirty&&changed)reset();},[project.revision,dirty]);
 const members=tasks.filter(task=>task.projectId===project.id),others=tasks.filter(task=>task.projectId!==project.id),destination=members.find(task=>task.id===target),held=busy||dirty;
 const candidates=members.flatMap(task=>task.sources.filter(source=>source.freshness==='fresh'&&source.versions.at(-1)?.kind!=='window').map(source=>{const version=source.versions.at(-1)!,reference={sourceId:source.id,version:source.currentVersion,digest:version.digest};return {key:task.id+':'+source.id,task,version,reference};})).filter(candidate=>!project.sources.some(source=>projectSourceMatches(source,candidate.task.id,candidate.reference)));
 const candidate=candidates.find(candidate=>candidate.key===sourceChoice);
 return <div className="project-details">
  <div className="project-heading"><strong>{project.name}</strong><button type="button" className="project-star" aria-pressed={pinned} disabled={pinDisabled} onClick={()=>onTogglePin(project)}><Star size={15} fill={pinned?'currentColor':'none'} aria-hidden="true"/>{pinned?'Unstar project':'Star project'}</button></div>
  <form onSubmit={event=>{event.preventDefault();if(busy||!dirty||changed||!name.trim())return;const submitted={name,instructions};void change({type:'projects.update',projectId:project.id,expectedRevision:base.revision,name:name.trim(),instructions}).then(saved=>{if(saved){setBase(saved);if(latest.current.name===submitted.name&&latest.current.instructions===submitted.instructions){setName(saved.name);setInstructions(saved.instructions);navigation();}}});}}>
   <Field label="Project name"><input value={name} maxLength={200} disabled={busy} onChange={event=>setName(event.currentTarget.value)}/></Field>
   <Field label="Project instructions"><textarea value={instructions} rows={5} maxLength={PROJECT_INSTRUCTIONS_LIMIT} disabled={busy} onChange={event=>setInstructions(event.currentTarget.value)}/></Field>
   <p className="tiny">Used with AI response requests in this project and shown before sending. Instructions do not authorize actions. Browser tasks keep their own approved scope.</p>
   {changed&&dirty&&<p role="status">The saved project changed. Your edits are kept here. Reload saved details before editing again.</p>}
   <div className="row"><Button type="submit" disabled={busy||!dirty||changed||!name.trim()}>Save project</Button>{(dirty||changed)&&<Button disabled={busy} onClick={()=>navigation.guard(reset)}>Reload saved details</Button>}</div>
  </form>
  <section aria-label="Project tasks"><h3>Tasks</h3>
   {members.length?<ul>{members.map(task=><li key={task.id}><div><button type="button" className="project-task-link" onClick={()=>onOpenTask(task)}>{task.title}</button><small>{task.archive?'Archived':task.status==='paused'?'Paused':'Active'}</small></div><Button disabled={held} title={`Remove ${task.title} from project`} onClick={()=>void change({type:'projects.assign',taskId:task.id,projectId:null,expectedProjectId:project.id})}>Remove</Button></li>)}</ul>:<p>No tasks in this project.</p>}
   {others.length>0&&<div className="project-add"><Field label="Task to add"><select value={taskChoice} disabled={held} onChange={event=>setTaskChoice(event.currentTarget.value)}><option value="">Choose a task</option>{others.map(task=><option key={task.id} value={task.id}>{task.title}{task.projectId?' · '+(projects.find(project=>project.id===task.projectId)?.name??'Another project'):''}</option>)}</select></Field><Button disabled={held||!others.some(task=>task.id===taskChoice)} onClick={()=>{const task=others.find(task=>task.id===taskChoice);if(task)void change({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:task.projectId??null}).then(saved=>{if(saved)setTaskChoice('');});}}>Add task</Button></div>}
  </section>
  <section aria-label="Project sources"><h3>Shared sources</h3><p>Share saved text and images from a project task, then add a copy to another task. Copies keep the chosen version when the original changes.</p>
   {candidates.length>0&&<div className="project-add"><Field label="Source to share"><select value={sourceChoice} disabled={held} onChange={event=>setSourceChoice(event.currentTarget.value)}><option value="">Choose a saved source</option>{candidates.map(candidate=><option key={candidate.key} value={candidate.key}>{candidate.version.label} · {candidate.task.title} · version {candidate.version.version}</option>)}</select></Field><Button disabled={held||!candidate} onClick={()=>{if(candidate)void change({type:'projects.sources.add',projectId:project.id,expectedRevision:project.revision,taskId:candidate.task.id,reference:candidate.reference}).then(saved=>{if(saved)setSourceChoice('');});}}>Share source</Button></div>}
   {!candidates.length&&!project.sources.length&&<p>Add saved text or an image in a project task’s Context, then share it here. Window snapshots stay in their original task.</p>}
   {project.sources.length>0&&<><Field label="Add shared sources to task"><select value={destination?.id??''} disabled={held} onChange={event=>setTarget(event.currentTarget.value)}><option value="">Choose a project task</option>{members.map(task=><option key={task.id} value={task.id}>{task.title}</option>)}</select></Field><ul>{project.sources.map(source=>{
    const version=projectSourceVersion(source,tasks),owner=tasks.find(task=>task.id===source.taskId),original=owner?.sources.find(item=>item.id===source.reference.sourceId),next=original?.versions.at(-1),added=!!destination&&projectSourceInTask(destination,project.id,source);
    const canUpdate=!!version&&owner?.projectId===project.id&&original?.freshness==='fresh'&&!!next&&next.kind!=='window'&&next.version>source.reference.version;
    const activeReview=review?.command.sourceKey===source.id?review:undefined;
    const reviewCurrent=!!activeReview&&project.revision===activeReview.command.expectedRevision&&projectSourceMatches(source,activeReview.command.taskId,activeReview.command.expectedReference)&&owner?.projectId===project.id&&original?.freshness==='fresh'&&original.currentVersion===activeReview.command.reference.version&&next?.digest===activeReview.command.reference.digest;
    return <li key={source.id}><div><strong>{version?.label??'Original source unavailable'}</strong><small>{owner?.title??'Original task deleted'} · saved version {source.reference.version}</small>{version?.kind==='text'&&<details><summary>View saved text</summary><pre>{version.content}</pre></details>}
     {activeReview&&<section aria-label="Review shared source update"><h3>Update shared source?</h3><p>Replace saved version {activeReview.previous.version} with version {activeReview.next.version}. Existing task copies keep their saved versions.</p><SourceUpdatePreview title="Currently shared" version={activeReview.previous}/><SourceUpdatePreview title="New saved version" version={activeReview.next}/>{!reviewCurrent&&<p role="status">The project or original source changed. Cancel and review the saved versions again.</p>}<div className="row"><Button disabled={held||!reviewCurrent} onClick={()=>void change(activeReview.command).then(saved=>{if(saved)closeReview();})}>Update shared source</Button><Button disabled={busy} onClick={closeReview}>Cancel update</Button></div></section>}
    </div><div className="project-source-actions"><Button disabled={held||!version||!destination||added} title={version?`Add ${version.label} to task`:'Original source unavailable'} onClick={()=>{if(destination)void change({type:'projects.sources.use',projectId:project.id,expectedRevision:project.revision,sourceKey:source.id,taskId:destination.id});}}>{added?'In task':'Add to task'}</Button>{canUpdate&&<Button disabled={held||!!activeReview} title={`Review update to ${version.label}`} onClick={()=>{reviewTrigger.current=document.activeElement instanceof HTMLButtonElement?document.activeElement:null;setReview({command:{type:'projects.sources.update',projectId:project.id,expectedRevision:project.revision,sourceKey:source.id,taskId:source.taskId,expectedReference:{...source.reference},reference:{sourceId:source.reference.sourceId,version:next.version,digest:next.digest}},previous:version,next});}}>Review update</Button>}<Button disabled={held} title={`Stop sharing ${version?.label??'unavailable source'}`} onClick={()=>void change({type:'projects.sources.remove',projectId:project.id,expectedRevision:project.revision,sourceKey:source.id})}>Remove</Button></div></li>;
   })}</ul></>}
  </section>
 </div>;
}

function SourceUpdatePreview({title,version}:{title:string;version:SourceVersion}){
 return <div><strong>{title} · version {version.version}</strong><small>{version.label}</small>{version.kind==='text'?<pre>{version.content}</pre>:version.kind==='image'?<img className="source-image" src={version.content} alt={title+': '+version.label}/>:null}</div>;
}
