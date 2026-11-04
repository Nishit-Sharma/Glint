import {useId,useRef,useState} from 'react';
import type {Task} from '../../../core/types';
import {isProjectArchived,projectSourceSnapshot,type Project,type ProjectSource} from '../../../shared/projects';
import {sourceRoleLabel} from '../../../shared/public-messages';
import {Button,Field} from '../ui';
import './project-directory.css';

export type ProjectDirectoryProps={
 projects?:readonly Project[];
 tasks:readonly Task[];
 selected:string;
 /** The caller supplies its existing guarded project navigation. */
 onSelect:(id:string)=>void;
 busy:boolean;
 loadError:string;
};

export function ProjectDirectory({projects,tasks,selected,onSelect,busy,loadError}:ProjectDirectoryProps){
 const [query,setQuery]=useState(''),[archived,setArchived]=useState(false),hintId=useId(),needle=query.trim().toLocaleLowerCase();
 const scoped=projects?.filter(project=>isProjectArchived(project)===archived);
 const entries=scoped?.map(project=>({project,members:tasks.filter(task=>task.projectId===project.id).length,matches:needle?project.sources.flatMap(source=>{const version=projectSourceSnapshot(source,tasks);return version?.label.toLocaleLowerCase().includes(needle)?[version.label]:[];}):[]}));
 const visible=entries?.filter(({project,matches})=>!needle||project.name.toLocaleLowerCase().includes(needle)||matches.length>0);
 const current=projects?.find(project=>project.id===selected),selectedHidden=!!current&&!visible?.some(entry=>entry.project.id===selected);
 return <section className="project-directory" aria-label="Project directory" aria-busy={busy}>
  {!projects?<p role="status">{loadError?'Project list unavailable. Reload projects to try again.':'Loading projects…'}</p>:!projects.length?<p>No projects yet. Create one, then add your tasks.</p>:<>
   <Field label="Project view"><select value={archived?'archived':'active'} onChange={event=>setArchived(event.currentTarget.value==='archived')}><option value="active">Active projects</option><option value="archived">Archived projects</option></select></Field>
   <div className="project-directory-search">
    <Field label="Find projects or pinned sources"><input type="search" value={query} maxLength={200} aria-describedby={hintId} onChange={event=>setQuery(event.currentTarget.value)}/></Field>
    {query&&<Button title="Clear project search" onClick={()=>setQuery('')}>Clear</Button>}
   </div>
   <p id={hintId} className="tiny">Search saved project names and pinned source labels on this device.</p>
   {loadError&&<p className="tiny" role="status">Showing previously loaded projects. Reload projects to confirm the list.</p>}
   <p className="project-directory-status" role="status">{needle?`${visible?.length??0} of ${scoped!.length} projects`:`${scoped!.length} ${scoped!.length===1?'project':'projects'}`}{archived?' · Archived':''}{selectedHidden?` · Selected project: ${current.name} (outside search results)`:''}</p>
   {visible?.length?<ul className="project-directory-list" aria-label="Saved projects">{visible.map(({project,members,matches})=><li key={project.id} data-project-directory-entry={project.id}>
    <button type="button" className="project-directory-choice" aria-label={'Open project '+project.name} aria-pressed={selected===project.id} disabled={busy} onClick={()=>{if(!busy&&selected!==project.id)onSelect(project.id);}}>
     <span className="project-directory-name">{project.name}</span>
     <span className="project-directory-counts">{members} {members===1?'task':'tasks'} · {project.sources.length} pinned {project.sources.length===1?'source':'sources'}{selected===project.id?' · Selected':''}</span>
    </button>
    {needle&&matches.length>0&&!project.name.toLocaleLowerCase().includes(needle)&&<p className="project-directory-match">Matched pinned {matches.length===1?'source':'sources'}: {matches.slice(0,2).join(', ')}{matches.length>2?` and ${matches.length-2} more`:''}</p>}
    {project.sources.length?<details className="project-directory-sources"><summary>Pinned sources in {project.name}</summary><ul aria-label={'Pinned sources in '+project.name}>{project.sources.map(source=><PinnedSource key={source.id+':'+source.reference.version+':'+source.reference.digest} source={source} projectId={project.id} tasks={tasks}/>)}</ul></details>:<p className="project-directory-no-sources">No pinned sources.</p>}
   </li>)}</ul>:<p>{!scoped?.length?(archived?'No archived projects.':'No active projects. Archived projects remain available in the Archived projects view.'):'No matching projects. Try a project name or pinned source label.'}</p>}
  </>}
 </section>;
}

function PinnedSource({source,projectId,tasks}:{source:ProjectSource;projectId:string;tasks:readonly Task[]}){
 const [previewOpen,setPreviewOpen]=useState<number>(),version=projectSourceSnapshot(source,tasks),owner=tasks.find(task=>task.id===source.taskId),original=owner?.sources.find(item=>item.id===source.reference.sourceId);
 const previewIdentity=JSON.stringify([source.taskId,source.reference,!!version,original?.currentVersion,original?.versions.at(-1)?.digest,original?.freshness,original?.revoked,owner?.session?.contextRevision,owner?.session?.sourceSelection]),scope=useRef({identity:'',epoch:0});
 if(scope.current.identity!==previewIdentity)scope.current={identity:previewIdentity,epoch:scope.current.epoch+1};
 const epoch=scope.current.epoch,open=previewOpen===epoch;
 return <li className="project-directory-source" data-project-directory-source={source.id}>
  <strong>{version?.label??'Pinned source unavailable'}</strong>
  <p>Original task: {owner?.title??'Unavailable'} · Pinned version {source.reference.version} · {version?sourceRoleLabel(version.role):'Role unavailable'}</p>
  {!owner?<p className="tiny">Original task unavailable. Pinned content and metadata cannot be read.</p>:!original?<p className="tiny">Original source unavailable. Pinned content and metadata cannot be read.</p>:!version?<p className="tiny">The exact pinned version is unavailable. Newer source versions are not shown.</p>:<>
   {owner.projectId!==projectId&&<p className="tiny">Original task is outside this project.</p>}
   {original.currentVersion!==version.version&&<p className="tiny">A newer source version is saved. This is the pinned historical snapshot.</p>}
   {original.freshness==='refresh-required'&&<p className="tiny">Original needs refresh. This is the saved pinned snapshot.</p>}
   {original.revoked&&<p className="tiny">Removed from requests. This saved local snapshot is kept.</p>}
   {owner.session?.sourceSelection&&!owner.session.sourceSelection.sourceIds.includes(original.id)&&<p className="tiny">Excluded from the original task’s request selection.</p>}
   <p className="tiny">Local inspection does not include or reuse this source. Older versions are kept after redaction and may contain unredacted content.</p>
   {version.kind==='text'||version.kind==='image'?<details className="project-directory-preview" open={open} onToggle={event=>setPreviewOpen(event.currentTarget.open?epoch:undefined)}><summary>Preview pinned {version.kind}</summary>{open&&(version.kind==='text'?<pre>{version.content}</pre>:<img src={version.content} alt={'Pinned source: '+version.label}/>)}</details>:<p className="tiny">Preview unavailable for this source kind.</p>}
  </>}
 </li>;
}
