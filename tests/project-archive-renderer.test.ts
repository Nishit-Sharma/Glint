import {afterEach,expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...((await import('./controlled-renderer.fixture')).hooks)}));
vi.mock('lucide-react',()=>({Star:()=>null,ChevronDown:()=>null,ChevronRight:()=>null,Clock:()=>null,Folder:()=>null,Pin:()=>null,Plus:()=>null,Search:()=>null,Settings:()=>null}));
import {createElement} from 'react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {Projects} from '../src/renderer/src/components/Projects';
import {ProjectDirectory} from '../src/renderer/src/components/ProjectDirectory';
import {TaskSidebar} from '../src/renderer/src/components/TaskSidebar';
import {projectDirectoryFixture} from './project-directory.fixture';
import {createControlledRenderer} from './controlled-renderer.fixture';
import {DraftNavigationProvider,useDraftNavigation} from '../src/renderer/src/draft-navigation';
import {readProjectCommand} from '../src/shared/projects';
import type {Command} from '../src/shared/bridge';
import type {Run} from '../src/renderer/src/ui';

afterEach(()=>vi.unstubAllGlobals());
test('active discovery hides archived projects, while Archived view retains exact project and source access and all chats remain listed',()=>{
 const {projects,tasks}=projectDirectoryFixture();projects[0].archive={revision:1,archived:true,updatedAt:'2026-11-01T09:00:00.000Z'};
 const selected=vi.fn(),directory=createControlledRenderer(()=>createElement(ProjectDirectory,{projects,tasks,selected:'survey',onSelect:selected,busy:false,loadError:''}));
 directory.render();expect(directory.nodes().filter(node=>node.props['data-project-directory-entry']).map(node=>node.props['data-project-directory-entry'])).toEqual(['supply','empty']);
 directory.find(node=>node.type==='select').props.onChange({currentTarget:{value:'archived'}});directory.render();
 expect(directory.nodes().filter(node=>node.props['data-project-directory-entry']).map(node=>node.props['data-project-directory-entry'])).toEqual(['survey']);
 expect(directory.nodes().some(node=>node.type==='#text'&&node.props.text==='Access notes')).toBe(true);
 const preview=directory.find(node=>node.type==='details'&&node.props.className==='project-directory-preview');expect(preview.props.open).toBe(false);expect(directory.nodes().some(node=>node.type==='#text'&&node.props.text==='PRIVATE_PINNED_TEXT')).toBe(false);preview.props.onToggle({currentTarget:{open:true}});directory.render();expect(directory.nodes().some(node=>node.type==='#text'&&node.props.text==='PRIVATE_PINNED_TEXT')).toBe(true);expect(directory.nodes().some(node=>node.type==='#text'&&node.props.text==='PRIVATE_LATEST_TEXT')).toBe(false);expect(selected).not.toHaveBeenCalled();
 const sidebar=createControlledRenderer(()=>createElement(TaskSidebar,{character:null,projects,tasks:tasks.filter(task=>!task.archive),onSelectTask:()=>{},onCreateTask:()=>{},onSettings:()=>{},onProjects:()=>{}}));sidebar.render();
 expect(sidebar.nodes().filter(node=>node.props.className==='task-sidebar-project').map(node=>node.props['aria-label'])).toEqual(['Supply rota','Empty notebook']);
 expect(sidebar.nodes().some(node=>node.props['aria-label']==='Field visit')).toBe(true);
});

test('real Archive and Restore calls preserve dirty project forms and expose read-only knowledge with working member links',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-project-archive-ui-')),core=await createCompanion({dataDir:directory});
 try{
  const project=await core.projectCommand({type:'projects.create',name:'Owned UI QA'}),task=await core.createTask({title:'Owned member chat'});
  await core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});
  await core.projectCommand({type:'projects.update',projectId:project.id,expectedRevision:1,name:project.name,instructions:'READABLE_QA_INSTRUCTIONS'});
  let projects=await core.projectCommand({type:'projects.list'}),pending:Promise<unknown>|undefined;const tasks=await core.listTasks(),opened=vi.fn(),commands:string[]=[];
  vi.stubGlobal('window',{companion:{invoke:async(command:{type:string})=>{if(command.type==='memory.get')return core.getUserMemory();throw Error('Unexpected command');},subscribe:()=>()=>{}}});
  const run:Run=async<T,>(input:Command):Promise<T>=>{commands.push(input.type);const operation=core.projectCommand(readProjectCommand(input));pending=operation;return await operation as T;};
  function Harness(){const navigation=useDraftNavigation();return createElement(DraftNavigationProvider,{value:navigation.api,children:createElement('div',null,createElement(Projects,{projects,selected:project.id,onSelect:()=>{},loadError:'',pinning:false,onTogglePin:()=>{},onReload:async()=>{projects=await core.projectCommand({type:'projects.list'});},tasks,currentTaskId:task.id,busy:false,run,onOpenTask:opened}),navigation.review)});}
  const renderer=createControlledRenderer(()=>createElement(Harness)),text=(node:ReturnType<typeof renderer.find>):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
  renderer.render();const instructions=()=>renderer.find(node=>node.type==='textarea'&&node.props.maxLength===8000),button=(label:string)=>renderer.find(node=>node.type==='button'&&text(node)===label);
  instructions().props.onChange({currentTarget:{value:'UNSAVED_OWNED_EDIT'}});renderer.render();expect(button('Archive project').props.disabled).toBe(true);button('Archive project').props.onClick();expect(commands).toEqual([]);expect(instructions().props.value).toBe('UNSAVED_OWNED_EDIT');
  button('Reload saved details').props.onClick();renderer.render();expect(instructions().props.value).toBe('UNSAVED_OWNED_EDIT');button('Leave and discard edits').props.onClick();renderer.render();button('Archive project').props.onClick();await pending;await core.projectCommand({type:'projects.list'});for(let i=0;i<8;i++)await Promise.resolve();renderer.render();
  expect(commands).toEqual(['projects.archive']);expect(renderer.nodes().some(node=>node.props['aria-label']==='Archived project details')).toBe(true);expect(renderer.nodes().some(node=>node.type==='#text'&&node.props.text==='READABLE_QA_INSTRUCTIONS')).toBe(true);expect(renderer.nodes().some(node=>node.type==='textarea')).toBe(false);expect(renderer.nodes().some(node=>node.type==='button'&&text(node)==='Delete project')).toBe(false);
  button('Owned member chat').props.onClick();expect(opened).toHaveBeenCalledExactlyOnceWith(tasks.find(item=>item.id===task.id));
  button('Restore project').props.onClick();await pending;await core.projectCommand({type:'projects.list'});for(let i=0;i<8;i++)await Promise.resolve();renderer.render();expect(commands).toEqual(['projects.archive','projects.archive']);expect(instructions().props.value).toBe('READABLE_QA_INSTRUCTIONS');expect((await core.getTask(task.id)).requests).toEqual([]);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
