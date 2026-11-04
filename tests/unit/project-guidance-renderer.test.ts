import {afterEach,expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...((await import('../support/controlled-renderer.fixture')).hooks)}));
vi.mock('lucide-react',()=>({Star:()=>null}));
import {createElement} from 'react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {MemoryStatus} from '../../src/renderer/src/UserMemory';
import {Projects} from '../../src/renderer/src/components/Projects';
import type {Project} from '../../src/shared/projects';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';

afterEach(()=>vi.unstubAllGlobals());

test('the active project shows exact saved response instructions independently of memory, without sending a request',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-project-guidance-')),core=await createCompanion({dataDir:directory});
 try{
  const created=await core.projectCommand({type:'projects.create',name:'Observatory notes'}),project=await core.projectCommand({type:'projects.update',projectId:created.id,expectedRevision:1,name:created.name,instructions:'  Use metric units.\nKeep <uncertainty> explicit.  '}),task=await core.createTask({title:'Plan a night visit'});
  const assigned=await core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null}),commands:string[]=[];
  vi.stubGlobal('window',{companion:{invoke:async(command:any)=>{commands.push(command.type);if(command.type==='memory.preview')return core.previewUserMemory({taskId:command.taskId,prompt:command.prompt});throw Error('Unexpected command');},subscribe:()=>()=>{}}});
  const renderer=createControlledRenderer(()=>createElement(MemoryStatus,{task:assigned,project,prompt:'Explain the visit plan',kind:'explain',onManage:()=>{}})),text=()=>renderer.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join('');
  renderer.render();await core.getUserMemory();for(let i=0;i<8;i++)await Promise.resolve();renderer.render();
  expect(text()).toContain('Memory off');expect(text()).toContain('Project instructions · Observatory notes');expect(text()).toContain('Saved version 2');
  expect(renderer.find(node=>node.type==='li').children).toEqual([{type:'#text',props:{text:'  Use metric units.\nKeep <uncertainty> explicit.  '},children:[]}]);
  expect(text()).toContain('Shared as guidance only if you send this message.');expect(text()).toContain('Instructions do not authorize actions.');
  expect((await core.getTask(task.id)).requests).toEqual([]);expect(commands.every(type=>type==='memory.preview')).toBe(true);expect((await core.getUserMemory()).enabled).toBe(false);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('saving and discarding through Projects changes only the saved active guidance, which survives reopen',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-project-guidance-edit-'));let core=await createCompanion({dataDir:directory});
 try{
  const created=await core.projectCommand({type:'projects.create',name:'Night visits'}),other=await core.projectCommand({type:'projects.create',name:'Other work'}),owned=await core.createTask({title:'Visit plan'}),foreign=await core.createTask({title:'Other task'}),plain=await core.createTask({title:'Ungrouped task'}),commands:string[]=[];
  await core.projectCommand({type:'projects.assign',taskId:owned.id,projectId:created.id,expectedProjectId:null});await core.projectCommand({type:'projects.assign',taskId:foreign.id,projectId:other.id,expectedProjectId:null});
  await core.projectCommand({type:'projects.update',projectId:other.id,expectedRevision:1,name:other.name,instructions:'Keep other work separate.'});
  let projects=await core.projectCommand({type:'projects.list'}),tasks=await core.listTasks(),task=tasks.find(item=>item.id===owned.id)!;
  vi.stubGlobal('window',{companion:{invoke:async(command:any)=>{commands.push(command.type);if(command.type==='memory.get')return core.getUserMemory();if(command.type==='memory.preview')return core.previewUserMemory({taskId:command.taskId,prompt:command.prompt});throw Error('Unexpected command');},subscribe:()=>()=>{}}});
  const preview=createControlledRenderer(()=>createElement(MemoryStatus,{task,project:projects.find(item=>item.id===task.projectId),prompt:'Prepare a visit plan',kind:'create',onManage:()=>{}})),text=()=>preview.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join('');
  const editor=createControlledRenderer(()=>createElement(Projects,{projects,selected:created.id,onSelect:()=>{},loadError:'',pinning:false,onTogglePin:()=>{},onReload:async()=>{projects=await core.projectCommand({type:'projects.list'});},tasks,currentTaskId:owned.id,busy:false,run:async<T,>(command:any)=>{commands.push(command.type);return await core.projectCommand(command) as T;},onOpenTask:()=>{}}));
  const content=(node:ReturnType<typeof editor.find>):string=>node.type==='#text'?node.props.text:node.children.map(content).join('');
  const instructions=()=>editor.find(node=>node.type==='textarea'&&node.props.maxLength===8000),form=()=>editor.find(node=>node.type==='form'&&content(node).includes('Project instructions'));
  async function settle(){await core.getUserMemory();for(let i=0;i<12;i++)await Promise.resolve();editor.render();preview.render();}
  editor.render();preview.render();await settle();expect(text()).toContain('No saved project instructions');
  instructions().props.onChange({currentTarget:{value:'Use UTC.\nExplain uncertainty.'}});editor.render();preview.render();expect(text()).not.toContain('Use UTC.');
  form().props.onSubmit({preventDefault(){}});await settle();expect(text()).toContain('Use UTC.\nExplain uncertainty.');expect(text()).toContain('Saved version 2');
  instructions().props.onChange({currentTarget:{value:'DISCARDED_PROJECT_GUIDANCE'}});editor.render();preview.render();expect(text()).not.toContain('DISCARDED_PROJECT_GUIDANCE');
  editor.find(node=>node.type==='button'&&content(node)==='Reload saved details').props.onClick();editor.render();expect(instructions().props.value).toBe('Use UTC.\nExplain uncertainty.');
  instructions().props.onChange({currentTarget:{value:'Use UTC and metric units.'}});editor.render();form().props.onSubmit({preventDefault(){}});await settle();expect(text()).toContain('Use UTC and metric units.');expect(text()).toContain('Saved version 3');expect(text()).not.toContain('Explain uncertainty.');
  task=tasks.find(item=>item.id===foreign.id)!;preview.render();expect(text()).toContain('Project instructions · Other work');expect(text()).toContain('Keep other work separate.');expect(text()).not.toContain('Use UTC');
  task=plain;preview.render();expect(text()).not.toContain('Project instructions');expect(text()).not.toContain('Use UTC');
  await core.close();core=await createCompanion({dataDir:directory});projects=await core.projectCommand({type:'projects.list'});tasks=await core.listTasks();task=tasks.find(item=>item.id===owned.id)!;
  preview.render();await settle();expect(text()).toContain('Project instructions · Night visits');expect(text()).toContain('Saved version 3');expect(text()).toContain('Use UTC and metric units.');
  expect(tasks.every(item=>item.requests.length===0)).toBe(true);expect(commands.every(type=>['memory.get','memory.preview','projects.update'].includes(type))).toBe(true);expect((await core.getUserMemory()).enabled).toBe(false);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('unavailable or mismatched project data never exposes another project instructions, while memory failure keeps saved own guidance visible',async()=>{
 const task={id:'own-task',title:'Night visit',goal:'',projectId:'own-project'},saved={id:'own-project',name:'Night visits',revision:4,instructions:'OWN_SAVED_GUIDANCE'};let project:Partial<Project>&{id:string}|undefined=saved;
 vi.stubGlobal('window',{companion:{invoke:async()=>{throw Error('Memory unavailable');},subscribe:()=>()=>{}}});
 const renderer=createControlledRenderer(()=>createElement(MemoryStatus,{task,project,prompt:'Explain the visit',kind:'explain',onManage:()=>{}})),text=()=>renderer.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join('');
 renderer.render();for(let i=0;i<8;i++)await Promise.resolve();renderer.render();expect(text()).toContain('Memory preview unavailable');expect(text()).toContain('OWN_SAVED_GUIDANCE');
 for(const unavailable of [undefined,{id:'own-project'},{...saved,id:'other-project',instructions:'FOREIGN_GUIDANCE'}]){
  project=unavailable;renderer.render();expect(text()).toContain('Project instructions unavailable');expect(text()).not.toContain('OWN_SAVED_GUIDANCE');expect(text()).not.toContain('FOREIGN_GUIDANCE');
 }
 project=saved;renderer.render();expect(text()).toContain('OWN_SAVED_GUIDANCE');
});

test.each(['explain','create','experiment','procedure'] as const)('%s guidance matches the actual local or browser composer route',async kind=>{
 const task={id:'own-task',title:'Night visit',goal:'',projectId:'own-project'},project={id:'own-project',name:'Night visits',revision:2,instructions:'SAVED_PROJECT_GUIDANCE'};let browser=false;
 const commands:string[]=[];vi.stubGlobal('window',{companion:{invoke:async(command:any)=>{commands.push(command.type);throw Error('Memory unavailable');},subscribe:()=>()=>{}}});
 const renderer=createControlledRenderer(()=>createElement(MemoryStatus,{task,project,prompt:'Prepare a visit plan',kind,browser,onManage:()=>{}})),text=()=>renderer.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join('');
 renderer.render();expect(text()).toContain('SAVED_PROJECT_GUIDANCE');
 browser=true;renderer.render();if(kind==='explain'||kind==='create'){expect(text()).toContain('Project instructions are not used for browser work.');expect(text()).not.toContain('SAVED_PROJECT_GUIDANCE');expect(text()).not.toContain('Shared as guidance');}else expect(text()).toContain('SAVED_PROJECT_GUIDANCE');
 browser=false;renderer.render();expect(text()).toContain('SAVED_PROJECT_GUIDANCE');expect(commands.every(type=>type==='memory.preview')).toBe(true);
});
