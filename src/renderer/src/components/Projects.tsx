import {useEffect,useRef,useState} from 'react';
import {Star} from 'lucide-react';
import type {SourceVersion,Task} from '../../../core/types';
import {PROJECT_INSTRUCTIONS_LIMIT,isProjectArchived,projectSourceMatches,projectSourceVersion,projectSourceSnapshot,projectSourceInTask,projectSourceCopyExists,type Project,type ProjectSource,type ProjectPins,type ProjectAssignment,type ProjectCommand,type ProjectReply} from '../../../shared/projects';
import {sourceRoleLabel} from '../../../shared/public-messages';
import {requestSourceAvailable} from '../../../shared/source-intake';
import {useGuardedAction,useNavigationDraft} from '../draft-navigation';
import {Button,Field,type Run} from '../ui';
import './projects.css';
import {ProjectMemory} from './ProjectMemory';
import {ProjectDirectory} from './ProjectDirectory';
import {ProjectCreate} from './ProjectCreate';
import type {ProjectDeleteCommand,ProjectDeletePreview} from '../../../shared/project-deletion';

type Change=<C extends ProjectCommand>(command:C)=>Promise<ProjectReply<C>|undefined>;
type SourceUpdateReview={command:Extract<ProjectCommand,{type:'projects.sources.update'}>;previous:SourceVersion;next:SourceVersion};
export function Projects({projects,pins,selected,onSelect,loadError,pinning,onTogglePin,onReload,tasks,currentTaskId,busy,run,onOpenTask}:{projects?:Project[];pins?:ProjectPins;selected:string;onSelect:(id:string)=>void;loadError:string;pinning:boolean;onTogglePin:(project:Project)=>void;onReload:()=>Promise<void>;tasks:Task[];currentTaskId?:string;busy:boolean;run:Run;onOpenTask:(task:Task)=>void}){
 const [error,setError]=useState(''),[working,setWorking]=useState(false);
 const [deletion,setDeletion]=useState<{review:ProjectDeletePreview;mode:ProjectDeleteCommand['mode'];command?:ProjectDeleteCommand}>();
 const deletionHeading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{if(deletion)deletionHeading.current?.focus();},[deletion?.review]);
 const alive=useRef(true),locked=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const guardNavigation=useGuardedAction();
 async function change<C extends ProjectCommand>(command:C):Promise<ProjectReply<C>|undefined>{
  if(locked.current||busy)return;locked.current=true;setWorking(true);setError('');
  try{const saved=await run<ProjectReply<C>>(command);if(alive.current){await onReload();if(!saved)setError('The change was not confirmed. Reload saved projects before trying again.');}return saved;}
  finally{locked.current=false;if(alive.current)setWorking(false);}
 }
 const project=projects?.find(project=>project.id===selected),held=busy||working;
 const reviewDeletion=(projectId:string)=>{void change({type:'projects.delete.preview',projectId}).then(review=>{if(review&&alive.current)setDeletion({review,mode:'keep-tasks'});});};
 return <section className="projects" aria-label="Projects">
  <p>Keep related tasks, instructions and attachments together.</p>
  {(error||loadError)&&<p role="alert">{error||loadError} <Button disabled={held||pinning} onClick={()=>{setError('');void onReload();}}>Reload projects</Button></p>}
  {!projects&&!error&&!loadError&&<p role="status">Loading projects…</p>}
  {projects&&<>
   <ProjectCreate projects={projects} tasks={tasks} currentTaskId={currentTaskId} busy={held} change={change} onSelect={onSelect}/>
   {!projects.length?<p>No projects yet. Create one, then add your tasks.</p>:<>
    <ProjectDirectory projects={projects} tasks={tasks} selected={selected} onSelect={id=>guardNavigation(()=>onSelect(id))} busy={held} loadError={loadError}/>
    {project&&<ProjectDetails key={project.id} project={project} projects={projects} tasks={tasks} currentTaskId={currentTaskId} busy={held} change={change} onOpenTask={onOpenTask} pinned={!!pins?.projectIds.includes(project.id)} pinDisabled={held||pinning||!pins||!!loadError} onTogglePin={onTogglePin} onReviewDelete={()=>reviewDeletion(project.id)}/>}
   </>}
  </>}
  {deletion&&<section className="project-details" aria-label="Review project deletion"><h3 ref={deletionHeading} tabIndex={-1}>Delete {deletion.review.name}?</h3><p>This removes the local project, its instructions, {deletion.review.sharedSources} shared source references and {deletion.review.memoryFacts} project facts. Account memory stays unchanged.</p><Field label="Member tasks"><select disabled={held||!!deletion.command} value={deletion.mode} onChange={event=>setDeletion({...deletion,mode:event.currentTarget.value as ProjectDeleteCommand['mode']})}><option value="keep-tasks">Keep member tasks</option><option value="delete-tasks">Delete project and member tasks</option></select></Field><p>{deletion.mode==='keep-tasks'?'Tasks go back to your task list with their attachments, saved work, history, unsent messages and browser routes. Replies still running in these tasks will stop.':'These tasks and their attachments, saved work, history and unsent messages will be deleted from this Mac.'}</p><ul>{deletion.review.members.map(member=><li key={member.taskId}><div><strong>{member.title}</strong>{deletion.mode==='delete-tasks'&&member.blocker&&<p role="status">{member.blocker}</p>}</div></li>)}</ul><p>Independent copies in other tasks stay. Original files, exported files, backups and existing recovery copies may remain. This does not delete anything in connected services.</p>{deletion.command&&<p role="status">If the result was not confirmed, check the same deletion. This will not delete a different set of tasks.</p>}<div className="row"><Button kind="danger" disabled={held||deletion.mode==='delete-tasks'&&deletion.review.members.some(member=>!!member.blocker)} onClick={()=>{const command=deletion.command??{type:'projects.delete',projectId:deletion.review.projectId,intentId:crypto.randomUUID(),expectedRevision:deletion.review.revision,expectedSnapshot:deletion.review.snapshot,mode:deletion.mode,members:deletion.review.members.map(({taskId,snapshot})=>({taskId,snapshot})),confirmed:'delete-local-project'};setDeletion({...deletion,command});void change(command).then(saved=>{if(saved&&alive.current){setDeletion(undefined);onSelect('');}});}}>{deletion.command?'Check same deletion':deletion.mode==='keep-tasks'?'Delete project, keep tasks':`Delete project and ${deletion.review.members.length} tasks`}</Button><Button disabled={held} onClick={()=>setDeletion(undefined)}>{deletion.command?'Close review':'Cancel deletion'}</Button></div></section>}
 </section>;
}

function ProjectDetails({project,projects,tasks,currentTaskId,busy,change,onOpenTask,pinned,pinDisabled,onTogglePin,onReviewDelete}:{project:Project;projects:Project[];tasks:Task[];currentTaskId?:string;busy:boolean;change:Change;onOpenTask:(task:Task)=>void;pinned:boolean;pinDisabled:boolean;onTogglePin:(project:Project)=>void;onReviewDelete:()=>void}){
 const [base,setBase]=useState(project),[name,setName]=useState(project.name),[instructions,setInstructions]=useState(project.instructions),[sourceChoice,setSourceChoice]=useState(''),[target,setTarget]=useState(currentTaskId??'');
 const [useAccountMemory,setUseAccountMemory]=useState(project.useAccountMemory??true);
 const [addSharedSourcesOnJoin,setAddSharedSourcesOnJoin]=useState(project.addSharedSourcesOnJoin??false);
 const [review,setReview]=useState<SourceUpdateReview>();
 const guardArchive=useGuardedAction();
 const reviewTrigger=useRef<HTMLButtonElement|null>(null);
 const closeReview=()=>{setReview(undefined);requestAnimationFrame(()=>reviewTrigger.current?.focus());};
 const dirty=name!==base.name||instructions!==base.instructions||useAccountMemory!==(base.useAccountMemory??true)||addSharedSourcesOnJoin!==(base.addSharedSourcesOnJoin??false),changed=base.revision!==project.revision||(base.addSharedSourcesOnJoin??false)!==(project.addSharedSourcesOnJoin??false);
 const reset=()=>{setBase(project);setName(project.name);setInstructions(project.instructions);setUseAccountMemory(project.useAccountMemory??true);setAddSharedSourcesOnJoin(project.addSharedSourcesOnJoin??false);};
 const navigation=useNavigationDraft(dirty,reset),latest=useRef({name,instructions,useAccountMemory,addSharedSourcesOnJoin});latest.current={name,instructions,useAccountMemory,addSharedSourcesOnJoin};
 useEffect(()=>{if(!dirty&&changed)reset();},[project.revision,project.addSharedSourcesOnJoin,dirty]);
 const members=tasks.filter(task=>task.projectId===project.id),destination=members.find(task=>task.id===target),held=busy||dirty;
 const candidates=members.flatMap(task=>task.sources.filter(source=>source.freshness==='fresh'&&source.versions.at(-1)?.kind!=='window').map(source=>{const version=source.versions.at(-1)!,reference={sourceId:source.id,version:source.currentVersion,digest:version.digest};return {key:task.id+':'+source.id,task,version,reference};})).filter(candidate=>!project.sources.some(source=>projectSourceMatches(source,candidate.task.id,candidate.reference)));
 const candidate=candidates.find(candidate=>candidate.key===sourceChoice);
 const archived=isProjectArchived(project);
 const archiveControl=<Button disabled={busy||dirty} onClick={()=>{if(busy||dirty)return;guardArchive(()=>{void change({type:'projects.archive',projectId:project.id,expectedRevision:project.archive?.revision??0,archived:!archived});});}}>{archived?'Restore project':'Archive project'}</Button>;
 if(archived)return <div className="project-details" aria-label="Archived project details">
  <div className="project-heading"><strong>{project.name} · Archived</strong>{archiveControl}</div>
  <p>This project is read-only here. Its tasks, saved knowledge and memory settings are kept. Existing chats keep their project context. Restore the project before changing or deleting it.</p>
  <section aria-label="Saved project instructions"><h3>Project instructions</h3>{project.instructions?<pre>{project.instructions}</pre>:<p>No saved project instructions.</p>}</section>
  <section aria-label="Saved project memory"><h3>Project memory</h3><p>{project.memory?.enabled?'Project memory on':'Project memory off'} · {project.useAccountMemory===false?'Account memory excluded':'Account memory allowed when globally enabled'}. These saved policies still apply to existing chats.</p>{project.memory?.facts.length?<ul>{project.memory.facts.map(fact=><li key={fact.id}><p>{fact.text}</p><small>{fact.topics.length?'Use for: '+fact.topics.join(', '):'Use for all text questions in this project'}</small></li>)}</ul>:<p>No project facts saved.</p>}</section>
  <section aria-label="Project tasks"><h3>Tasks</h3>{members.length?<ul>{members.map(task=><li key={task.id}><button type="button" className="project-task-link" onClick={()=>onOpenTask(task)}>{task.title}</button></li>)}</ul>:<p>No tasks in this project.</p>}</section>
  <section aria-label="Shared attachments"><h3>Shared attachments</h3>{project.sources.length?<ul>{project.sources.map(source=>{const version=projectSourceVersion(source,tasks);return <li key={source.id}><div><strong>{version?.label??'Pinned attachment unavailable'}</strong><p>Pinned version {source.reference.version}</p>{version&&<details><summary>View pinned content</summary><SourceUpdatePreview title="Pinned shared source" version={version}/></details>}</div></li>;})}</ul>:<p>No shared attachments yet.</p>}</section>
 </div>;
 return <div className="project-details">
  <div className="project-heading"><strong>{project.name}</strong><button type="button" className="project-star" aria-pressed={pinned} disabled={pinDisabled} onClick={()=>onTogglePin(project)}><Star size={15} fill={pinned?'currentColor':'none'} aria-hidden="true"/>{pinned?'Unstar project':'Star project'}</button></div>
  <p>Archive hides this project from active project lists. Tasks and their saved context stay available; nothing is paused or deleted.</p><div className="row">{archiveControl}</div>
  <form onSubmit={event=>{event.preventDefault();if(busy||!dirty||changed||!name.trim())return;const submitted={name,instructions,useAccountMemory,addSharedSourcesOnJoin};void change({type:'projects.update',projectId:project.id,expectedRevision:base.revision,name:name.trim(),instructions,useAccountMemory,addSharedSourcesOnJoin,expectedAddSharedSourcesOnJoin:base.addSharedSourcesOnJoin??false}).then(saved=>{if(saved){setBase(saved);if(latest.current.name===submitted.name&&latest.current.instructions===submitted.instructions&&latest.current.useAccountMemory===submitted.useAccountMemory&&latest.current.addSharedSourcesOnJoin===submitted.addSharedSourcesOnJoin){setName(saved.name);setInstructions(saved.instructions);setUseAccountMemory(saved.useAccountMemory??true);setAddSharedSourcesOnJoin(saved.addSharedSourcesOnJoin??false);navigation();}}});}}>
   <Field label="Project name"><input value={name} maxLength={200} disabled={busy} onChange={event=>setName(event.currentTarget.value)}/></Field>
   <Field label="Project instructions"><textarea value={instructions} rows={5} maxLength={PROJECT_INSTRUCTIONS_LIMIT} disabled={busy} onChange={event=>setInstructions(event.currentTarget.value)}/></Field>
   <p className="tiny">Used with AI response requests in this project and shown before sending. Instructions do not authorize actions. Browser tasks keep their own approved scope.</p>
   <Field label="Account memory"><select value={useAccountMemory?'account':'off'} disabled={busy} onChange={event=>setUseAccountMemory(event.currentTarget.value==='account')}><option value="account">Use account memory when enabled</option><option value="off">Do not use account memory</option></select></Field>
   <p className="tiny">Controls whether saved account facts can accompany new text questions and drafts in this project. Memory in Settings must also be on. Saved facts and other projects stay unchanged.</p>
   <Field label="Shared sources on join"><select value={addSharedSourcesOnJoin?'on':'off'} disabled={busy} onChange={event=>setAddSharedSourcesOnJoin(event.currentTarget.value==='on')}><option value="off">Don’t add shared attachments</option><option value="on">Add shared attachments when tasks join</option></select></Field>
   <p className="tiny">Only tasks that join from now on get their own copies of the pinned shared attachments. Tasks already in the project, their attachments and browser context stay as they are.</p>
   {changed&&dirty&&<p role="status">The saved project changed. Your edits are kept here. Reload saved details before editing again.</p>}
   <div className="row"><Button type="submit" disabled={busy||!dirty||changed||!name.trim()}>Save project</Button>{(dirty||changed)&&<Button disabled={busy} onClick={()=>navigation.guard(reset)}>Reload saved details</Button>}</div>
  </form>
  <ProjectMemory key={project.id} project={project} busy={held}/>
  <section aria-label="Project tasks"><h3>Tasks</h3>
   {members.length?<ul>{members.map(task=><li key={task.id}><div><button type="button" className="project-task-link" onClick={()=>onOpenTask(task)}>{task.title}</button><small>{task.archive?'Archived':task.status==='paused'?'Paused':'Active'}</small></div><Button disabled={held} title={`Remove ${task.title} from project`} onClick={()=>void change({type:'projects.assign',taskId:task.id,projectId:null,expectedProjectId:project.id})}>Remove</Button></li>)}</ul>:<p>No tasks in this project.</p>}
   <ProjectTaskJoin project={project} projects={projects} tasks={tasks} busy={held} change={change}/>
   <ProjectBulkMove project={project} projects={projects} tasks={tasks} busy={held} change={change}/>
  </section>
  <section aria-label="Shared attachments"><h3>Shared attachments</h3><p>Share saved text and images from a project task, then add a copy to another task. Copies keep the chosen version when the original changes.</p>
   {candidates.length>0&&<div className="project-add"><Field label="Source to share"><select value={sourceChoice} disabled={held} onChange={event=>setSourceChoice(event.currentTarget.value)}><option value="">Choose a saved attachment</option>{candidates.map(candidate=><option key={candidate.key} value={candidate.key}>{candidate.version.label} · {candidate.task.title} · version {candidate.version.version}</option>)}</select></Field><Button disabled={held||!candidate} onClick={()=>{if(candidate)void change({type:'projects.sources.add',projectId:project.id,expectedRevision:project.revision,taskId:candidate.task.id,reference:candidate.reference}).then(saved=>{if(saved)setSourceChoice('');});}}>Share source</Button></div>}
   {!candidates.length&&!project.sources.length&&<p>Add text or an image to a project task’s Attachments, then share it here. Window captures stay in their original task.</p>}
   {project.sources.length>0&&<><Field label="Add shared sources to task"><select value={destination?.id??''} disabled={held} onChange={event=>setTarget(event.currentTarget.value)}><option value="">Choose a project task</option>{members.map(task=><option key={task.id} value={task.id}>{task.title}</option>)}</select></Field><ul>{project.sources.map(source=>{
    const version=projectSourceVersion(source,tasks),owner=tasks.find(task=>task.id===source.taskId),original=owner?.sources.find(item=>item.id===source.reference.sourceId),next=original?.versions.at(-1),added=!!destination&&projectSourceInTask(destination,project.id,source);
    // A pinned version older than the original's current one cannot be copied, but it can still be reviewed locally for an update.
    const pinned=version??(original&&requestSourceAvailable(original,tasks)?projectSourceSnapshot(source,tasks):undefined);
    const canUpdate=!!pinned&&owner?.projectId===project.id&&original?.freshness==='fresh'&&!!next&&next.kind!=='window'&&next.version>source.reference.version;
    const activeReview=review?.command.sourceKey===source.id?review:undefined;
    const reviewCurrent=!!activeReview&&project.revision===activeReview.command.expectedRevision&&projectSourceMatches(source,activeReview.command.taskId,activeReview.command.expectedReference)&&owner?.projectId===project.id&&original?.freshness==='fresh'&&original.currentVersion===activeReview.command.reference.version&&next?.digest===activeReview.command.reference.digest;
    return <li key={source.id}><div><strong>{pinned?.label??'Original source unavailable'}</strong><small>{owner?.title??'Original task deleted'} · saved version {source.reference.version}</small>{!version&&pinned&&<p className="tiny">{canUpdate?'A newer version is saved. Review the update before adding it to tasks.':'A newer version is saved. This pinned version can’t be added to tasks.'}</p>}{version?.kind==='text'&&<details><summary>View saved text</summary><pre>{version.content}</pre></details>}
     {activeReview&&<section aria-label="Review shared source update"><h3>Update shared source?</h3><p>Replace saved version {activeReview.previous.version} with version {activeReview.next.version}. Existing task copies keep their saved versions.</p><SourceUpdatePreview title="Currently shared" version={activeReview.previous}/><SourceUpdatePreview title="New saved version" version={activeReview.next}/>{!reviewCurrent&&<p role="status">The project or original source changed. Cancel and review the saved versions again.</p>}<div className="row"><Button disabled={held||!reviewCurrent} onClick={()=>void change(activeReview.command).then(saved=>{if(saved)closeReview();})}>Update shared source</Button><Button disabled={busy} onClick={closeReview}>Cancel update</Button></div></section>}
    </div><div className="project-source-actions"><Button disabled={held||!version||!destination||added} title={version?`Add ${version.label} to task`:pinned?(canUpdate?`Review update before adding ${pinned.label}`:`Pinned ${pinned.label} is not the current version`):'Original source unavailable'} onClick={()=>{if(destination)void change({type:'projects.sources.use',projectId:project.id,expectedRevision:project.revision,sourceKey:source.id,taskId:destination.id});}}>{added?'In task':'Add to task'}</Button>{canUpdate&&<Button disabled={held||!!activeReview} title={`Review update to ${pinned.label}`} onClick={()=>{reviewTrigger.current=document.activeElement instanceof HTMLButtonElement?document.activeElement:null;setReview({command:{type:'projects.sources.update',projectId:project.id,expectedRevision:project.revision,sourceKey:source.id,taskId:source.taskId,expectedReference:{...source.reference},reference:{sourceId:source.reference.sourceId,version:next.version,digest:next.digest}},previous:pinned,next});}}>Review update</Button>}<Button disabled={held} title={`Stop sharing ${pinned?.label??'unavailable source'}`} onClick={()=>void change({type:'projects.sources.remove',projectId:project.id,expectedRevision:project.revision,sourceKey:source.id})}>Remove</Button></div></li>;
   })}</ul></>}
  </section>
  <section><h3>Delete project</h3><p>Review whether to keep this project’s tasks or delete them with the project.</p><Button kind="text danger" disabled={held} onClick={onReviewDelete}>Review project deletion</Button></section>
 </div>;
}

function SourceUpdatePreview({title,version}:{title:string;version:SourceVersion}){
 return <div><strong>{title} · version {version.version}</strong><small>{version.label}</small>{version.kind==='text'?<pre>{version.content}</pre>:version.kind==='image'?<img className="source-image" src={version.content} alt={title+': '+version.label}/>:null}</div>;
}

type JoinSourceReview={shared:ProjectSource;version?:SourceVersion;ownerTitle:string;needsCopy:boolean};
function joinSourceReview(project:Project,tasks:Task[],joining:Task[]):JoinSourceReview[]{return project.sources.map(shared=>({shared:{...shared,reference:{...shared.reference}},version:projectSourceVersion(shared,tasks),ownerTitle:tasks.find(task=>task.id===shared.taskId)?.title??'Original task unavailable',needsCopy:joining.some(task=>!projectSourceCopyExists(task,project.id,shared))}));}
function joinSourcesAvailable(sources:JoinSourceReview[],tasks:Task[]):boolean{return sources.every(({shared,needsCopy})=>{if(!needsCopy)return true;const version=projectSourceVersion(shared,tasks),original=tasks.find(task=>task.id===shared.taskId)?.sources.find(source=>source.id===shared.reference.sourceId);return !!version&&version.kind!=='window'&&original?.freshness==='fresh';});}
function ProjectJoinSourcesPreview({sources}:{sources:JoinSourceReview[]}){
 return <div className="project-move-review" role="group" aria-label="Shared attachments for this task"><h4>Pinned shared attachments</h4><p>Missing attachments are copied into the task. Existing originals and project copies are kept, including edits and older versions. Source selections and browser context stay unchanged; review task Context before asking.</p>{sources.length?<ul>{sources.map(({shared,version,ownerTitle,needsCopy})=><li key={shared.id}><div><strong>{version?.label??'Original copy unavailable'}</strong><small>{ownerTitle} · shared saved version {shared.reference.version}{version?' · '+sourceRoleLabel(version.role):''}</small><p className="tiny">{needsCopy?'Add a copy only where this task has none.':'Existing task originals or copies will be kept.'}</p>{version&&version.kind!=='window'&&<details><summary>View pinned content</summary><SourceUpdatePreview title="Pinned shared source" version={version}/></details>}</div></li>)}</ul>:<p>No shared attachments yet, so nothing is copied.</p>}</div>;
}
type SingleJoinReview={command:Extract<ProjectCommand,{type:'projects.assign'}>;title:string;from:string;sources:JoinSourceReview[]};
function ProjectTaskJoin({project,projects,tasks,busy,change}:{project:Project;projects:Project[];tasks:Task[];busy:boolean;change:Change}){
 const [choice,setChoice]=useState(''),[review,setReview]=useState<SingleJoinReview>(),alive=useRef(true),selectionHeading=useRef<HTMLHeadingElement>(null),reviewHeading=useRef<HTMLHeadingElement>(null),returnFocus=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const navigation=useNavigationDraft(!!review,()=>setReview(undefined)),closeReview=()=>{returnFocus.current=true;setReview(undefined);navigation();};
 useEffect(()=>{if(review)reviewHeading.current?.focus();else if(returnFocus.current){returnFocus.current=false;selectionHeading.current?.focus();}},[review,choice]);
 const others=tasks.filter(task=>task.projectId!==project.id&&!projects.some(owner=>owner.id===task.projectId&&isProjectArchived(owner))),task=others.find(task=>task.id===choice),current=review?tasks.find(task=>task.id===review.command.taskId):undefined;
 const stale=!!review&&(!current||(current.projectId??null)!==review.command.expectedProjectId||project.revision!==review.command.expectedProjectRevision||(project.addSharedSourcesOnJoin??false)!==review.command.expectedAddSharedSourcesOnJoin||!joinSourcesAvailable(review.sources,tasks));
 const commit=(command:Extract<ProjectCommand,{type:'projects.assign'}>)=>{void change(command).then(saved=>{if(saved&&alive.current){setChoice('');closeReview();}});};
 return <div className="project-bulk-move"><h4 ref={selectionHeading} tabIndex={-1}>Add a task</h4>{review?<div className="project-move-review" role="region" aria-label="Review project join"><h4 ref={reviewHeading} tabIndex={-1}>Add {review.title} to {project.name}?</h4><p>{review.from} → {project.name}</p><ProjectJoinSourcesPreview sources={review.sources}/>{stale&&<p role="status">The task, project or shared sources changed. Cancel and review again.</p>}<div className="row"><Button disabled={busy||stale} onClick={()=>{if(!busy&&!stale)commit(review.command);}}>Add task with shared attachments</Button><Button disabled={busy} onClick={closeReview}>Cancel add</Button></div></div>:others.length?<div className="project-add"><Field label="Task to add"><select value={choice} disabled={busy} onChange={event=>setChoice(event.currentTarget.value)}><option value="">Choose a task</option>{others.map(task=><option key={task.id} value={task.id}>{task.title}{task.projectId?' · '+(projects.find(project=>project.id===task.projectId)?.name??'Another project'):''}</option>)}</select></Field><Button disabled={busy||!task} onClick={()=>{if(!task||busy)return;const command={type:'projects.assign' as const,taskId:task.id,projectId:project.id,expectedProjectId:task.projectId??null,expectedProjectRevision:project.revision,expectedAddSharedSourcesOnJoin:project.addSharedSourcesOnJoin??false};if(project.addSharedSourcesOnJoin)setReview({command,title:task.title,from:task.projectId?(projects.find(project=>project.id===task.projectId)?.name??'Another project'):'No project',sources:joinSourceReview(project,tasks,[task])});else commit(command);}}>{project.addSharedSourcesOnJoin?'Review add':'Add task'}</Button></div>:<p>No other tasks to add.</p>}</div>;
}

type BulkMoveTask=ProjectAssignment&{title:string};
type BulkMove={phase:'choose';tasks:BulkMoveTask[]}|{phase:'review';tasks:BulkMoveTask[];revision:number;addSharedSourcesOnJoin:boolean;sources:JoinSourceReview[]};
function ProjectBulkMove({project,projects,tasks,busy,change}:{project:Project;projects:Project[];tasks:Task[];busy:boolean;change:Change}){
 const [move,setMove]=useState<BulkMove>({phase:'choose',tasks:[]}),alive=useRef(true);
 const selectionHeading=useRef<HTMLHeadingElement>(null),reviewHeading=useRef<HTMLHeadingElement>(null),returnFocus=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const reset=()=>setMove({phase:'choose',tasks:[]}),navigation=useNavigationDraft(move.tasks.length>0,reset);
 const clear=()=>{returnFocus.current=true;reset();navigation();};
 useEffect(()=>{if(move.phase==='review')reviewHeading.current?.focus();else if(returnFocus.current){returnFocus.current=false;selectionHeading.current?.focus();}},[move.phase,move.tasks.length]);
 const others=tasks.filter(task=>task.projectId!==project.id&&!projects.some(owner=>owner.id===task.projectId&&isProjectArchived(owner))),stale=move.tasks.some(entry=>{const task=tasks.find(task=>task.id===entry.taskId);return !task||(task.projectId??null)!==entry.expectedProjectId;})||move.phase==='review'&&(project.revision!==move.revision||(project.addSharedSourcesOnJoin??false)!==move.addSharedSourcesOnJoin||!joinSourcesAvailable(move.sources,tasks));
 const sourceName=(id:string|null)=>id?(projects.find(project=>project.id===id)?.name??'Unavailable project'):'No project';
 return <div className="project-bulk-move">
  <h4 ref={selectionHeading} tabIndex={-1}>Move several tasks</h4>
  {!others.length&&!move.tasks.length?<p>No other tasks to move.</p>:<>
  {stale&&<p role="alert">A selected task, destination setting or shared source changed. Cancel or clear the selection and review again.</p>}
  {move.phase==='choose'?<>
   <fieldset className="project-bulk-select" disabled={busy}><legend>Select tasks</legend><p>Destination: <strong>{project.name}</strong></p>
    {others.map(task=><label key={task.id} className="project-move-option"><input type="checkbox" aria-label={'Select '+task.title+' for project move'} checked={move.tasks.some(entry=>entry.taskId===task.id)} onChange={event=>{const checked=event.currentTarget.checked;setMove(current=>{const selected=current.tasks.filter(entry=>entry.taskId!==task.id);return {phase:'choose',tasks:checked?[...selected,{taskId:task.id,expectedProjectId:task.projectId??null,title:task.title}]:selected};});}}/><span><strong>{task.title}</strong><small>{sourceName(task.projectId??null)}</small></span></label>)}
   </fieldset>
   <p className="tiny" role="status">{move.tasks.length} selected</p>
   <div className="row"><Button disabled={busy||stale||!move.tasks.length} onClick={()=>{if(busy||stale||!move.tasks.length)return;setMove({phase:'review',tasks:move.tasks,revision:project.revision,addSharedSourcesOnJoin:project.addSharedSourcesOnJoin??false,sources:project.addSharedSourcesOnJoin?joinSourceReview(project,tasks,move.tasks.map(entry=>tasks.find(task=>task.id===entry.taskId)!)):[]});}}>Review move</Button>{move.tasks.length>0&&<Button disabled={busy} onClick={clear}>Clear selection</Button>}</div>
  </>:<div className="project-move-review" role="region" aria-label="Review task move">
   <h4 ref={reviewHeading} tabIndex={-1}>Move {move.tasks.length} {move.tasks.length===1?'task':'tasks'} to {project.name}?</h4>
   <ul>{move.tasks.map(entry=><li key={entry.taskId}><div><strong>{entry.title}</strong><small>{sourceName(entry.expectedProjectId)} → {project.name}</small></div></li>)}</ul>
   <p>Tasks keep their saved work and unsent messages. Running responses in moved tasks will stop.</p>
   {move.addSharedSourcesOnJoin?<ProjectJoinSourcesPreview sources={move.sources}/>:<p>Shared attachments aren’t added this time.</p>}
   <div className="row"><Button disabled={busy||stale} onClick={()=>{if(busy||stale||move.phase!=='review')return;void change({type:'projects.assign.bulk',projectId:project.id,tasks:move.tasks.map(({taskId,expectedProjectId})=>({taskId,expectedProjectId})),expectedProjectRevision:move.revision,expectedAddSharedSourcesOnJoin:move.addSharedSourcesOnJoin}).then(saved=>{if(saved&&alive.current)clear();});}}>Move {move.tasks.length} {move.tasks.length===1?'task':'tasks'}</Button><Button disabled={busy} onClick={clear}>Cancel move</Button></div>
  </div>}
  </>}
 </div>;
}
