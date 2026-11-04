import {afterEach,expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...((await import('../support/controlled-renderer.fixture')).hooks)}));
import {createElement} from 'react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import type {Task} from '../../src/core/types';
import type {Project,ProjectCommand} from '../../src/shared/projects';
import {ProjectCreate,type ProjectCreateProps} from '../../src/renderer/src/components/ProjectCreate';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';

afterEach(()=>vi.unstubAllGlobals());
const task=(id:string,title:string,projectId?:string)=>({id,title,projectId} as Task);
const project:Project={id:'existing-project',name:'Existing scope',instructions:'',revision:1,createdAt:'2026-10-31T00:00:00.000Z',updatedAt:'2026-10-31T00:00:00.000Z',sources:[]};
const content=(node:{type:string;props:Record<string,any>;children:any[]}):string=>node.type==='#text'?node.props.text:node.children.map(content).join('');
async function settle(){for(let i=0;i<16;i++)await Promise.resolve();}

it.each([undefined,'current-task'])('keeps creation empty by default with current task %s and cancellation sends no command',async currentTaskId=>{
 const commands:ProjectCommand[]=[],selected:string[]=[],props:ProjectCreateProps={projects:[],tasks:[task('current-task','Synthetic current task')],currentTaskId,busy:false,change:async command=>{commands.push(command);return undefined;},onSelect:id=>selected.push(id)};
 const view=createControlledRenderer(()=>createElement(ProjectCreate,props)),input=()=>view.find(node=>node.type==='input'&&node.props.maxLength===200),button=(name:string)=>view.find(node=>node.type==='button'&&content(node)===name);
 view.render();if(currentTaskId)expect(view.find(node=>node.type==='input'&&node.props.type==='checkbox').props.checked).toBe(false);
 else expect(view.nodes().filter(node=>node.type==='input'&&node.props.type==='checkbox')).toHaveLength(0);
 input().props.onChange({currentTarget:{value:'Cancel this scope'}});view.render();button('Cancel creation').props.onClick();view.render();expect(input().props.value).toBe('');expect(commands).toEqual([]);
 input().props.onChange({currentTarget:{value:'Empty scope'}});view.render();view.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await settle();view.render();
 expect(commands).toHaveLength(1);expect(commands[0]).toMatchObject({type:'projects.create',name:'Empty scope',intentId:expect.any(String)});expect(commands[0]).not.toHaveProperty('includeTask');expect(selected).toEqual([]);
});

it('names and captures the chosen task, blocks a stale choice, and cancels without a membership command',()=>{
 const original=task('current-task','Original chosen task',project.id),commands:ProjectCommand[]=[];let tasks=[original,task('other-task','New current task')],currentTaskId=original.id;
 const view=createControlledRenderer(()=>createElement(ProjectCreate,{projects:[project],tasks,currentTaskId,busy:false,change:async command=>{commands.push(command);return undefined;},onSelect:()=>{}})),checkbox=()=>view.find(node=>node.type==='input'&&node.props.type==='checkbox'),button=(name:string)=>view.find(node=>node.type==='button'&&content(node)===name),text=()=>view.nodes().filter(node=>node.type==='#text').map(content).join('');
 view.render();view.find(node=>node.type==='input'&&node.props.maxLength===200).props.onChange({currentTarget:{value:'Scoped project'}});checkbox().props.onChange({currentTarget:{checked:true}});view.render();
 expect(text()).toContain('Original chosen task');expect(text()).toContain('from “Existing scope”');expect(text()).toContain('sources, saved work, history, unsent message and browser route');
 currentTaskId='other-task';tasks=[{...original,title:'Renamed after selection'},tasks[1]];view.render();expect(text()).toContain('Original chosen task');expect(text()).not.toContain('Renamed after selection');expect(text()).toContain('The current task or its project changed.');expect(button('Create project').props.disabled).toBe(true);
 view.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});expect(commands).toEqual([]);
 checkbox().props.onChange({currentTarget:{checked:false}});view.render();checkbox().props.onChange({currentTarget:{checked:true}});view.render();expect(text()).toContain('New current task');expect(button('Create project').props.disabled).toBe(false);
 button('Cancel creation').props.onClick();view.render();expect(checkbox().props.checked).toBe(false);expect(commands).toEqual([]);
});

it('retains the submitted intent and explicit task choice after an unconfirmed committed result, then checks it once',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-project-create-renderer-')),core=await createCompanion({dataDir:directory});
 try{
  const first=await core.createTask({title:'First chosen task'}),other=await core.createTask({title:'Different current task'});await core.putSource(first.id,{kind:'text',label:'Saved source',content:'Keep the original source.',role:'fact'});await core.saveComposerDraft(first.id,0,{text:'SYNTHETIC_UNSENT_CREATION',kind:'create'});
  const before=await core.getTask(first.id),commands:ProjectCommand[]=[],selected:string[]=[];let tasks=await core.listTasks(),currentTaskId=first.id,projects:Project[]=[],release!:()=>void;const gate=new Promise<void>(done=>release=done);
  const change:ProjectCreateProps['change']=async command=>{commands.push(structuredClone(command));const saved=await core.projectCommand(command);if(commands.length===1){await gate;return undefined;}return saved;};
  const view=createControlledRenderer(()=>createElement(ProjectCreate,{projects,tasks,currentTaskId,busy:false,change,onSelect:id=>selected.push(id)})),input=()=>view.find(node=>node.type==='input'&&node.props.maxLength===200),button=(name:string)=>view.find(node=>node.type==='button'&&content(node)===name),form=()=>view.find(node=>node.type==='form');
  view.render();input().props.onChange({currentTarget:{value:'  Scoped current task  '}});view.find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({currentTarget:{checked:true}});view.render();form().props.onSubmit({preventDefault(){}});form().props.onSubmit({preventDefault(){}});
  projects=await core.projectCommand({type:'projects.list'});tasks=await core.listTasks();currentTaskId=other.id;view.render();expect(commands).toHaveLength(1);expect(input().props.disabled).toBe(true);expect(view.find(node=>node.type==='fieldset').props.disabled).toBe(true);
  release();await settle();view.render();expect(button('Check same creation').props.disabled).toBe(false);expect(view.nodes().filter(node=>node.type==='#text').map(content).join('')).toContain('with “First chosen task”');
  button('Check same creation').props.onClick();await core.contentSnapshot();await settle();view.render();
  expect(commands).toHaveLength(2);expect(commands[1]).toEqual(commands[0]);expect(commands[0]).toMatchObject({type:'projects.create',name:'Scoped current task',includeTask:{taskId:first.id,expectedProjectId:null}});
  const saved=(await core.projectCommand({type:'projects.list'}))[0];expect(await core.projectCommand({type:'projects.list'})).toEqual([saved]);expect(selected).toEqual([saved.id]);
  const included=await core.getTask(first.id);expect(included).toEqual({...before,projectId:saved.id,updatedAt:included.updatedAt});expect(await core.getTask(other.id)).toEqual(other);expect(input().props.value).toBe('');
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

it('requires a fresh name instead of treating a name collision as a destination project',()=>{
 const commands:ProjectCommand[]=[],view=createControlledRenderer(()=>createElement(ProjectCreate,{projects:[project],tasks:[task('current','Current member')],currentTaskId:'current',busy:false,change:async command=>{commands.push(command);return undefined;},onSelect:()=>{}}));
 view.render();view.find(node=>node.type==='input'&&node.props.maxLength===200).props.onChange({currentTarget:{value:'EXISTING SCOPE'}});view.find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({currentTarget:{checked:true}});view.render();
 expect(view.find(node=>node.type==='button'&&content(node)==='Create project').props.disabled).toBe(true);expect(content(view.find(node=>node.props.role==='status'))).toContain('Choose a different name');view.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});expect(commands).toEqual([]);
});
