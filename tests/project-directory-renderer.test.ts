import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...((await import('./controlled-renderer.fixture')).hooks)}));
import {createElement} from 'react';
import {ProjectDirectory} from '../src/renderer/src/components/ProjectDirectory';
import {projectDirectoryFixture} from './project-directory.fixture';
import {createControlledRenderer} from './controlled-renderer.fixture';

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
