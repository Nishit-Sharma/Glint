import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...((await import('./controlled-renderer.fixture')).hooks)}));
import {createElement} from 'react';
import {ProjectDirectory} from '../src/renderer/src/components/ProjectDirectory';
import {projectDirectoryFixture} from './project-directory.fixture';
import {createControlledRenderer} from './controlled-renderer.fixture';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {projectSourceSnapshot,projectSourceVersion} from '../src/shared/projects';

test('local directory finds project names and exact pinned labels without searching source content or newer labels',()=>{
 const {projects,tasks}=projectDirectoryFixture(),select=vi.fn();
 const renderer=createControlledRenderer(()=>createElement(ProjectDirectory,{projects,tasks,selected:'survey',onSelect:select,busy:false,loadError:''}));
 const text=()=>renderer.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join('');
 const search=(value:string)=>{renderer.find(node=>node.type==='input'&&node.props.type==='search').props.onChange({currentTarget:{value}});renderer.render();};
 renderer.render();expect(text()).toContain('2 tasks');expect(text()).toContain('2 pinned sources');
 search('  ACCESS NOTES  ');expect(text()).toContain('Survey planning');expect(text()).not.toContain('Supply rota');expect(text()).not.toContain('Empty notebook');expect(select).not.toHaveBeenCalled();
 search('supply');expect(text()).toContain('Supply rota');expect(renderer.nodes().filter(node=>node.props['data-project-directory-entry']).map(node=>node.props['data-project-directory-entry'])).toEqual(['supply']);expect(text()).toContain('Selected project: Survey planning (outside search results)');
 for(const query of ['PRIVATE_PINNED_TEXT','Future field guide','PRIVATE_LATEST_TEXT']){search(query);expect(text()).toContain('No matching projects');}
 renderer.find(node=>node.type==='button'&&node.props['aria-label']==='Clear project search').props.onClick();renderer.render();expect(text()).toContain('Survey planning');expect(text()).toContain('Supply rota');expect(text()).toContain('Empty notebook');
 expect(renderer.find(node=>node.type==='button'&&node.props['aria-label']==='Open project Survey planning').props['aria-pressed']).toBe(true);
 renderer.find(node=>node.type==='button'&&node.props['aria-label']==='Open project Supply rota').props.onClick();expect(select).toHaveBeenCalledExactlyOnceWith('supply');
 expect(renderer.find(node=>node.type==='button'&&node.props['aria-label']==='Open project Survey planning').props['aria-pressed']).toBe(true);
});

test('pinned metadata distinguishes exact snapshots, unavailable originals and deliberate content previews',()=>{
 const {projects,tasks}=projectDirectoryFixture(),renderer=createControlledRenderer(()=>createElement(ProjectDirectory,{projects,tasks,selected:'survey',onSelect:()=>{},busy:false,loadError:''}));
 const text=()=>renderer.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join('');
 renderer.render();expect(text()).toContain('Access notes');expect(text()).toContain('Original task: Field visit · Pinned version 1 · Source material');expect(text()).not.toContain('Future field guide');expect(text()).not.toContain('PRIVATE_PINNED_TEXT');expect(renderer.nodes().some(node=>node.type==='img')).toBe(false);
 expect(text()).toContain('Original task: Portrait references · Pinned version 3 · Inspiration');expect(text()).toContain('Original task is outside this project.');expect(text()).toContain('Original needs refresh. This is the saved pinned snapshot.');expect(text()).toContain('Original task unavailable. Pinned content and metadata cannot be read.');expect(text()).toContain('Pinned version 4 · Role unavailable');
 const preview=()=>renderer.find(node=>node.type==='details'&&node.props.className==='project-directory-preview'&&node.children.some(child=>child.type==='summary'&&child.children.some(text=>text.props.text==='text')));
 preview().props.onToggle({currentTarget:{open:true}});renderer.render();expect(text()).toContain('PRIVATE_PINNED_TEXT');expect(text()).not.toContain('PRIVATE_LATEST_TEXT');
 preview().props.onToggle({currentTarget:{open:false}});renderer.render();expect(text()).not.toContain('PRIVATE_PINNED_TEXT');
 tasks[0].sources[0].versions=tasks[0].sources[0].versions.filter(version=>version.version!==1);renderer.render();expect(text()).not.toContain('Access notes');expect(text()).not.toContain('Future field guide');expect(text()).toContain('The exact pinned version is unavailable. Newer source versions are not shown.');
 tasks[0].sources=[];renderer.render();expect(text()).toContain('Original source unavailable. Pinned content and metadata cannot be read.');
});

test('empty, loading, cached error and busy states keep selection controlled by the caller',()=>{
 const fixture=projectDirectoryFixture(),select=vi.fn();let projects:typeof fixture.projects|undefined,busy=false,loadError='';
 const renderer=createControlledRenderer(()=>createElement(ProjectDirectory,{projects,tasks:fixture.tasks,selected:'survey',onSelect:select,busy,loadError}));
 const text=()=>renderer.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join('');
 renderer.render();expect(text()).toContain('Loading projects…');loadError='Read failed';renderer.render();expect(text()).toContain('Project list unavailable.');
 projects=[];loadError='';renderer.render();expect(text()).toContain('No projects yet.');projects=fixture.projects;busy=true;renderer.render();
 const choice=()=>renderer.find(node=>node.type==='button'&&node.props['aria-label']==='Open project Supply rota');expect(choice().props.disabled).toBe(true);choice().props.onClick();expect(select).not.toHaveBeenCalled();
 busy=false;loadError='Read failed';renderer.render();expect(text()).toContain('Showing previously loaded projects.');choice().props.onClick();expect(select).toHaveBeenCalledExactlyOnceWith('supply');expect(renderer.find(node=>node.type==='button'&&node.props['aria-label']==='Open project Survey planning').props['aria-pressed']).toBe(true);
});

test('deliberate local history closes on real inclusion, redaction, revocation and freshness changes without widening source reuse',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'project-pin-history-')),core=await createCompanion({dataDir:directory});
 try{
  const owner=await core.createTask({title:'Original source owner'}),task=await core.putSource(owner.id,{kind:'text',role:'fact',label:'Pinned original',content:'HISTORICAL_PRIVATE_BODY secret'}),source=task.sources[0],version=source.versions[0],reference={sourceId:source.id,version:1,digest:version.digest};
  const project=await core.projectCommand({type:'projects.create',name:'Pinned project'});await core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});await core.projectCommand({type:'projects.sources.add',projectId:project.id,expectedRevision:1,taskId:task.id,reference});
  const projects=await core.projectCommand({type:'projects.list'});let tasks=await core.listTasks();const pin=projects[0].sources[0],renderer=createControlledRenderer(()=>createElement(ProjectDirectory,{projects,tasks,selected:project.id,onSelect:()=>{},busy:false,loadError:''}));
  const text=()=>renderer.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join(''),preview=()=>renderer.find(node=>node.type==='details'&&node.props.className==='project-directory-preview'),closed=()=>{expect(preview().props.open).toBe(false);expect(text()).not.toContain(version.content);},open=()=>{preview().props.onToggle({currentTarget:{open:true}});renderer.render();expect(preview().props.open).toBe(true);expect(text()).toContain(version.content);},refresh=async()=>{tasks=await core.listTasks();renderer.render();};
  renderer.render();closed();expect(projectSourceVersion(pin,tasks)).toEqual(version);const staleOpen=preview().props.onToggle;open();
  await core.setSourceSelection({type:'source-selection.set',taskId:task.id,expectedRevision:0,sourceIds:[]});await refresh();closed();expect(text()).toContain('Excluded from the original task');expect(projectSourceVersion(pin,tasks)).toEqual(version);staleOpen({currentTarget:{open:true}});renderer.render();closed();open();
  await core.setSourceSelection({type:'source-selection.set',taskId:task.id,expectedRevision:1,sourceIds:[source.id]});await refresh();closed();open();
  await core.redactSource(task.id,reference,[{start:version.content.indexOf('secret'),end:version.content.length}]);await refresh();closed();expect(text()).toContain('pinned historical snapshot');expect(text()).toContain('may contain unredacted content');expect(text()).not.toContain('[redacted]');expect(projectSourceSnapshot(pin,tasks)).toEqual(version);expect(projectSourceVersion(pin,tasks)).toBeUndefined();open();
  await core.revokeSource(task.id,source.id);await refresh();closed();expect(text()).toContain('Removed from requests');expect(projectSourceVersion(pin,tasks)).toBeUndefined();
  await core.restoreSource(task.id,source.id);await refresh();closed();open();
  await core.invalidateSource(task.id,source.id,'A new review is required.');await refresh();closed();expect(text()).toContain('Original needs refresh');expect(projectSourceVersion(pin,tasks)).toBeUndefined();open();
  const snapshots=tasks[0].sources[0].versions;tasks[0].sources[0].versions=snapshots.filter(saved=>saved.version!==1);renderer.render();expect(renderer.nodes().some(node=>node.type==='details'&&node.props.className==='project-directory-preview')).toBe(false);tasks[0].sources[0].versions=snapshots;renderer.render();closed();
  expect((await core.getTask(task.id)).sources[0].versions[0]).toEqual(version);expect((await core.getTask(task.id)).requests).toEqual([]);expect((await core.listTasks()).flatMap(task=>task.sources).map(source=>source.id)).toEqual([source.id]);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('missing or mutated pins never substitute newer bytes, and images require their own explicit local preview',()=>{
 const fixture=projectDirectoryFixture(),project=fixture.projects[0],pin=structuredClone(project.sources[0]);let projects=fixture.projects;
 const renderer=createControlledRenderer(()=>createElement(ProjectDirectory,{projects,tasks:fixture.tasks,selected:'survey',onSelect:()=>{},busy:false,loadError:''})),text=()=>renderer.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join('');
 renderer.render();expect(renderer.nodes().some(node=>node.type==='img')).toBe(false);const imagePreview=()=>renderer.find(node=>node.type==='details'&&node.props.className==='project-directory-preview'&&node.children.some(child=>child.type==='summary'&&child.children.some(text=>text.props.text==='image')));
 imagePreview().props.onToggle({currentTarget:{open:true}});renderer.render();expect(renderer.find(node=>node.type==='img').props.src).toBe('data:image/png;base64,PRIVATE_IMAGE');expect(projectSourceVersion(fixture.projects[1].sources[0],fixture.tasks)).toBeUndefined();
 projects=[project];for(const mutation of [{taskId:'missing-owner'},{reference:{...pin.reference,sourceId:'missing-source'}},{reference:{...pin.reference,version:99}},{reference:{...pin.reference,digest:'wrong-digest'}}]){project.sources[0]={...pin,...mutation};renderer.render();expect(projectSourceSnapshot(project.sources[0],fixture.tasks)).toBeUndefined();expect(text()).not.toContain('PRIVATE_PINNED_TEXT');expect(text()).not.toContain('PRIVATE_LATEST_TEXT');expect(renderer.nodes().some(node=>node.type==='details'&&node.props.className==='project-directory-preview')).toBe(false);}
 project.sources[0]=pin;fixture.tasks[0].sources[0].versions[0]={...fixture.tasks[0].sources[0].versions[0],id:'wrong-version-owner'};renderer.render();expect(projectSourceSnapshot(pin,fixture.tasks)).toBeUndefined();expect(text()).not.toContain('PRIVATE_PINNED_TEXT');expect(text()).not.toContain('PRIVATE_LATEST_TEXT');
});

test('exact local lookup rejects wrong identities and a duplicate version with a different digest, while withdrawn origins remain ineligible for reuse',()=>{
 const f=projectDirectoryFixture(),pin=f.projects[0].sources[0],original=f.tasks[0].sources[0],saved=original.versions[0];
 original.versions.unshift({...saved,digest:'wrong-digest',content:'WRONG_DUPLICATE_BODY'});expect(projectSourceSnapshot(pin,f.tasks)).toEqual(saved);
 for(const bad of [{...pin,taskId:'not-owner'},{...pin,reference:{...pin.reference,sourceId:'not-source'}},{...pin,reference:{...pin.reference,digest:'not-digest'}}])expect(projectSourceSnapshot(bad,f.tasks)).toBeUndefined();
 original.projectOrigin={projectId:'outside',sourceKey:'withdrawn-original',taskId:'missing-original-owner',reference:{sourceId:'original',version:1,digest:'old'},copiedVersion:original.currentVersion,copiedDigest:original.versions.at(-1)!.digest};expect(projectSourceVersion(pin,f.tasks)).toBeUndefined();expect(projectSourceSnapshot(pin,f.tasks)).toEqual(saved);
});

test.each(['revocation','inclusion'] as const)('coalesced real %s changes cannot reopen earlier preview authority after flags return to their original state',async change=>{
 const directory=await mkdtemp(join(tmpdir(),'project-pin-privacy-aba-')),core=await createCompanion({dataDir:directory});
 try{
  let owner=await core.createTask({title:'Owned privacy boundary'});owner=await core.putSource(owner.id,{kind:'text',role:'fact',label:'Owned pin',content:'LOCAL_HISTORICAL_PRIVATE_BODY'});
  const source=owner.sources[0],version=source.versions[0],reference={sourceId:source.id,version:version.version,digest:version.digest},project=await core.projectCommand({type:'projects.create',name:'Owned pin project'});
  await core.projectCommand({type:'projects.assign',taskId:owner.id,projectId:project.id,expectedProjectId:null});await core.projectCommand({type:'projects.sources.add',projectId:project.id,expectedRevision:1,taskId:owner.id,reference});
  await core.setSourceSelection({type:'source-selection.set',taskId:owner.id,expectedRevision:0,sourceIds:[source.id]});
  const projects=await core.projectCommand({type:'projects.list'});let tasks=await core.listTasks();const renderer=createControlledRenderer(()=>createElement(ProjectDirectory,{projects,tasks,selected:project.id,onSelect:()=>{},busy:false,loadError:''})),preview=()=>renderer.find(node=>node.type==='details'&&node.props.className==='project-directory-preview'),privateBody=()=>renderer.nodes().some(node=>node.type==='#text'&&node.props.text===version.content);
  renderer.render();expect(preview().props.open).toBe(false);preview().props.onToggle({currentTarget:{open:true}});renderer.render();expect(preview().props.open).toBe(true);expect(privateBody()).toBe(true);const staleOpen=preview().props.onToggle,before=tasks[0].session!.contextRevision!;
  if(change==='revocation'){await core.revokeSource(owner.id,source.id);await core.restoreSource(owner.id,source.id);}
  else{await core.setSourceSelection({type:'source-selection.set',taskId:owner.id,expectedRevision:1,sourceIds:[]});await core.setSourceSelection({type:'source-selection.set',taskId:owner.id,expectedRevision:2,sourceIds:[source.id]});}
  tasks=await core.listTasks();expect(tasks[0].session!.contextRevision).toBeGreaterThan(before);expect(tasks[0].sources[0].revoked).toBeUndefined();expect(tasks[0].sources[0].freshness).toBe('fresh');expect(tasks[0].sources[0].currentVersion).toBe(1);expect(tasks[0].session!.sourceSelection!.sourceIds).toEqual([source.id]);
  renderer.render();expect(preview().props.open).toBe(false);expect(privateBody()).toBe(false);staleOpen({currentTarget:{open:true}});renderer.render();expect(preview().props.open).toBe(false);expect(privateBody()).toBe(false);
  preview().props.onToggle({currentTarget:{open:true}});renderer.render();expect(preview().props.open).toBe(true);expect(privateBody()).toBe(true);expect((await core.getTask(owner.id)).requests).toEqual([]);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
