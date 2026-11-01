import {afterEach,expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...((await import('./controlled-renderer.fixture')).hooks)}));
import {createElement} from 'react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {TaskMemorySettings} from '../src/renderer/src/components/TaskMemorySettings';
import {createControlledRenderer} from './controlled-renderer.fixture';
afterEach(()=>vi.unstubAllGlobals());

it('requires an explicit successful Reload after a committed save loses its acknowledgement',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'task-memory-unconfirmed-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Unconfirmed task choice'});let completion:Promise<unknown>|undefined,sets=0;
  vi.stubGlobal('window',{companion:{subscribe:()=>()=>{},invoke:(command:any)=>{if(command.type==='memory.task.set'){sets++;return completion=core.setTaskMemoryPolicy(command).then(()=>{throw Error('Acknowledgement lost');});}if(command.type==='tasks.get')return completion=core.getTask(command.taskId);throw Error('Unexpected command');}}});
  const r=createControlledRenderer(()=>createElement(TaskMemorySettings,{task,prompt:'Keep this message'})),button=(label:string)=>r.find(n=>n.type==='button'&&n.children.some(c=>c.props.text===label));async function settled(){await completion?.catch(()=>{});for(let i=0;i<12;i++)await Promise.resolve();r.render();}
  r.render();r.find(n=>n.type==='select').props.onChange({target:{value:'off'}});await settled();expect((await core.getTask(task.id)).session?.memoryPolicy).toEqual({revision:1,mode:'off'});expect(r.find(n=>n.type==='select').props.value).toBe('inherit');expect(r.find(n=>n.type==='select').props.disabled).toBe(true);expect(button('Reload task memory choice').props.disabled).toBe(false);
  r.find(n=>n.type==='select').props.onChange({target:{value:'inherit'}});await settled();expect(sets).toBe(1);button('Reload task memory choice').props.onClick();await settled();expect(r.find(n=>n.type==='select').props.value).toBe('off');expect(r.find(n=>n.type==='select').props.disabled).toBe(false);expect((await core.getUserMemory()).enabled).toBe(false);expect((await core.getTask(task.id)).requests).toEqual([]);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

it('saves and inspects one task Off through real core while global Memory stays OFF and retiring a changed prompt inspection',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'task-memory-ui-')),core=await createCompanion({dataDir:directory});
 try{
  let task=await core.createTask({title:'Owned memory control'}),prompt='Original question',completion:Promise<unknown>|undefined,changed=()=>{};const commands:string[]=[];
  vi.stubGlobal('window',{companion:{subscribe:(listener:(event:{type:string})=>void)=>{changed=()=>listener({type:'changed'});return()=>{};},invoke:(command:any)=>{commands.push(command.type);if(command.type==='memory.task.set')return completion=core.setTaskMemoryPolicy(command).then(value=>{changed();return value;});if(command.type==='memory.preview')return completion=core.previewUserMemory({taskId:command.taskId,prompt:command.prompt});if(command.type==='tasks.get')return completion=core.getTask(command.taskId);throw Error('Unexpected command');}}});
  const r=createControlledRenderer(()=>createElement(TaskMemorySettings,{task,prompt})),text=()=>r.nodes().filter(n=>n.type==='#text').map(n=>n.props.text).join(''),button=(label:string)=>r.find(n=>n.type==='button'&&n.children.some(c=>c.props.text===label));async function settled(){await completion;for(let i=0;i<12;i++)await Promise.resolve();r.render();}
  r.render();r.find(n=>n.type==='select').props.onChange({target:{value:'off'}});await settled();expect(r.find(n=>n.type==='select').props.disabled).toBe(false);expect(r.find(n=>n.type==='select').props.value).toBe('off');expect((await core.getUserMemory()).enabled).toBe(false);
  task=await core.getTask(task.id);r.render();button('Inspect memory for this question').props.onClick();await settled();expect(text()).toContain('Global Memory: Off');expect(text()).toContain('No saved account or project facts');expect(r.find(n=>n.type==='select').props.disabled).toBe(false);
  prompt='A different question';r.render();expect(r.nodes().some(n=>n.props['aria-label']==='Task memory inspection')).toBe(false);button('Reload task memory choice').props.onClick();await settled();expect(text()).toContain('Off');expect(commands.every(type=>['memory.task.set','memory.preview','tasks.get'].includes(type))).toBe(true);expect((await core.getTask(task.id)).requests).toEqual([]);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

it('keeps a newer same-task authoritative policy after an older save acknowledgement actually completes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'task-memory-race-')),core=await createCompanion({dataDir:directory});
 try{
  let task=await core.createTask({title:'Policy race'}),reply:(value:unknown)=>void=()=>{};
  vi.stubGlobal('window',{companion:{subscribe:()=>()=>{},invoke:()=>new Promise(resolve=>{reply=resolve;})}});
  const r=createControlledRenderer(()=>createElement(TaskMemorySettings,{task,prompt:'Question'}));r.render();r.find(n=>n.type==='select').props.onChange({target:{value:'off'}});
  task={...task,session:{revision:2,draft:'',runs:[],moduleStates:[],memoryPolicy:{revision:2,mode:'inherit'},contextRevision:2}};r.render();reply({taskId:task.id,revision:1,mode:'off'});for(let i=0;i<12;i++)await Promise.resolve();r.render();expect(r.find(n=>n.type==='button'&&n.children.some(c=>c.props.text==='Reload task memory choice')).props.disabled).toBe(false);expect(r.find(n=>n.type==='select').props.disabled).toBe(true);expect(r.find(n=>n.type==='select').props.value).toBe('inherit');expect(r.nodes().filter(n=>n.type==='#text').map(n=>n.props.text).join('')).toContain('not confirmed');
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
