import {afterEach,expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...((await import('./controlled-renderer.fixture')).hooks)}));
import {createElement} from 'react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {TaskMemorySettings} from '../src/renderer/src/components/TaskMemorySettings';
import {createControlledRenderer} from './controlled-renderer.fixture';
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});

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

it('retires an idle explicit project memory inspection at expiry and keeps the question for deliberate reinspection',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'task-memory-expiry-'));let now=Date.parse('2026-11-03T12:00:00.000Z');const core=await createCompanion({dataDir:directory,now:()=>new Date(now)});
 try{
  const owner=await core.createTask({title:'Synthetic inspection'}),project=await core.projectCommand({type:'projects.create',name:'Synthetic project'}),task=await core.projectCommand({type:'projects.assign',taskId:owner.id,projectId:project.id,expectedProjectId:null});await core.changeUserMemory({expectedRevision:0,change:{kind:'save',text:'ACCOUNT_REMAINS',topics:[]}});await core.changeUserMemory({expectedRevision:1,change:{kind:'enabled',enabled:true}});await core.projectCommand({type:'projects.memory.change',projectId:project.id,expectedRevision:0,change:{kind:'save',text:'INSPECTED_PROJECT_FACT',topics:[],expiresAt:new Date(now+1000).toISOString()}});await core.projectCommand({type:'projects.memory.change',projectId:project.id,expectedRevision:1,change:{kind:'enabled',enabled:true}});
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});vi.spyOn(Date,'now').mockImplementation(()=>now);const prompts:string[]=[];let held:((value:unknown)=>void)|undefined,hold=false;
  vi.stubGlobal('window',{companion:{subscribe:()=>()=>{},invoke:(command:any)=>{prompts.push(command.prompt);return hold?new Promise(resolve=>held=resolve):core.previewUserMemory({taskId:command.taskId,prompt:command.prompt});}}});
  const r=createControlledRenderer(()=>createElement(TaskMemorySettings,{task,prompt:'UNSENT_QUESTION_STAYS'})),text=()=>r.nodes().filter(n=>n.type==='#text').map(n=>n.props.text).join(''),inspect=()=>r.find(n=>n.type==='button'&&n.children.some(c=>c.props.text==='Inspect memory for this question'));async function settle(){await core.getUserMemory();for(let i=0;i<12;i++)await Promise.resolve();r.render();}
  r.render();inspect().props.onClick();await settle();expect(text()).toContain('INSPECTED_PROJECT_FACT');const stale=await core.previewUserMemory({taskId:task.id,prompt:'UNSENT_QUESTION_STAYS'});now+=1000;await vi.advanceTimersByTimeAsync(1000);r.render();expect(text()).not.toContain('INSPECTED_PROJECT_FACT');expect(text()).toContain('inspection expired');expect(prompts).toHaveLength(1);
  hold=true;inspect().props.onClick();r.render();held!(stale);await settle();expect(text()).not.toContain('INSPECTED_PROJECT_FACT');expect(text()).toContain('Memory could not be inspected');hold=false;inspect().props.onClick();await settle();expect(text()).toContain('ACCOUNT_REMAINS');expect(text()).not.toContain('INSPECTED_PROJECT_FACT');expect(prompts.every(prompt=>prompt==='UNSENT_QUESTION_STAYS')).toBe(true);expect((await core.getTask(task.id)).requests).toEqual([]);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
