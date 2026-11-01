import {afterEach,expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...((await import('./controlled-renderer.fixture')).hooks)}));
const navigation=vi.hoisted(()=>({dirty:false,clear:vi.fn()}));
vi.mock('../src/renderer/src/draft-navigation',()=>({useNavigationDraft:(dirty:boolean)=>{navigation.dirty=dirty;return navigation.clear;}}));
import {createElement} from 'react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {MemorySettings,MemoryStatus} from '../src/renderer/src/UserMemory';
import {createControlledRenderer} from './controlled-renderer.fixture';
afterEach(()=>vi.unstubAllGlobals());

test('authoritative memory preview never renders an older task or prompt reply and refreshes on changed events',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-memory-preview-')),core=await createCompanion({dataDir:directory});
 try{
  const pa=await core.projectCommand({type:'projects.create',name:'A'}),pb=await core.projectCommand({type:'projects.create',name:'B'}),a=await core.createTask({title:'Optics A'}),b=await core.createTask({title:'Optics B'});
  await core.changeUserMemory({expectedRevision:0,change:{kind:'enabled',enabled:true}});
  for(const [task,project,text] of [[a,pa,'PROJECT_A_FACT'],[b,pb,'PROJECT_B_FACT']] as const){await core.projectCommand({type:'projects.assign',taskId:task.id,projectId:project.id,expectedProjectId:null});await core.projectCommand({type:'projects.memory.change',projectId:project.id,expectedRevision:0,change:{kind:'save',text,topics:[]}});await core.projectCommand({type:'projects.memory.change',projectId:project.id,expectedRevision:1,change:{kind:'enabled',enabled:true}});}
  let task=await core.getTask(a.id),prompt='Explain optics',changed=()=>{};
  const pending:Array<{input:{taskId?:string;prompt:string};resolve:(value:unknown)=>void}>=[];
  vi.stubGlobal('window',{companion:{invoke:(command:any)=>{const {type,...input}=command;if(type!=='memory.preview')throw Error('Unexpected command');return new Promise(resolve=>pending.push({input,resolve}));},subscribe:(listener:(event:unknown)=>void)=>{changed=()=>listener({type:'changed'});return()=>{};}}});
  const r=createControlledRenderer(()=>createElement(MemoryStatus,{task,prompt,kind:'explain',onManage:()=>{}})),text=()=>r.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join('');
  r.render();const first=pending.shift()!,oldA=await core.previewUserMemory(first.input);
  task=await core.getTask(b.id);prompt='A newer optics question';r.render();const second=pending.shift()!;first.resolve(oldA);for(let i=0;i<8;i++)await Promise.resolve();r.render();expect(text()).not.toContain('PROJECT_A_FACT');expect(text()).toContain('Checking memory');
  second.resolve(await core.previewUserMemory(second.input));for(let i=0;i<8;i++)await Promise.resolve();r.render();expect(text()).toContain('PROJECT_B_FACT');expect(text()).not.toContain('PROJECT_A_FACT');
  prompt='Another new optics prompt';r.render();const superseded=pending.shift()!,oldB=await core.previewUserMemory(superseded.input);expect(text()).not.toContain('PROJECT_B_FACT');
  await core.projectCommand({type:'projects.memory.change',projectId:pb.id,expectedRevision:2,change:{kind:'enabled',enabled:false}});changed();r.render();const latest=pending.shift()!;superseded.resolve(oldB);for(let i=0;i<8;i++)await Promise.resolve();r.render();expect(text()).not.toContain('PROJECT_B_FACT');
  latest.resolve(await core.previewUserMemory(latest.input));for(let i=0;i<8;i++)await Promise.resolve();r.render();expect(text()).toContain('Project memory off');expect(text()).not.toContain('PROJECT_B_FACT');
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('Memory settings explicitly enable saved facts, edit and forget through the real core, and show matching facts by the composer',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-memory-ui-')),core=await createCompanion({dataDir:directory}),commands:string[]=[];
 vi.stubGlobal('window',{companion:{invoke:async(command:any)=>{commands.push(command.type);if(command.type==='memory.get')return core.getUserMemory();if(command.type==='memory.preview'){const {type,...input}=command;return core.previewUserMemory(input);}if(command.type==='memory.change'){const {type,...input}=command;return core.changeUserMemory(input);}throw Error('Unexpected command');},subscribe:()=>()=>{}}});
 const r=createControlledRenderer(()=>createElement(MemorySettings));
 const content=(node:ReturnType<typeof r.find>):string=>node.type==='#text'?node.props.text:node.children.map(content).join('');
 const button=(label:string)=>r.find(node=>node.type==='button'&&content(node)===label);
 async function settle(){await core.getUserMemory();for(let i=0;i<8;i++)await Promise.resolve();r.render();}
 try{
  r.render();await settle();expect(content(button('Enable memory'))).toBe('Enable memory');
  r.find(node=>node.type==='textarea').props.onChange({target:{value:'I am new to Rust.'}});r.find(node=>node.type==='input').props.onChange({target:{value:'rust'}});r.render();expect(navigation.dirty).toBe(true);
  r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await settle();expect(await core.getUserMemory()).toMatchObject({enabled:false,facts:[{text:'I am new to Rust.',topics:['rust']}]});expect(navigation.dirty).toBe(false);
  button('Enable memory').props.onClick();await settle();expect((await core.getUserMemory()).enabled).toBe(true);
  const task=await core.createTask({title:'Rust'}),preview=createControlledRenderer(()=>createElement(MemoryStatus,{task,prompt:'Explain borrowing',kind:'explain',onManage:()=>{}}));preview.render();await core.getUserMemory();for(let i=0;i<8;i++)await Promise.resolve();preview.render();expect(content(preview.find(node=>node.type==='summary'))).toBe('Memory · 1 fact for this question');expect(content(preview.find(node=>node.type==='li'))).toBe('I am new to Rust.');
  button('Edit').props.onClick();r.render();expect(r.find(node=>node.type==='textarea').props.value).toBe('I am new to Rust.');r.find(node=>node.type==='textarea').props.onChange({target:{value:'I understand Rust ownership.'}});r.render();r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await settle();expect((await core.getUserMemory()).facts[0].text).toBe('I understand Rust ownership.');
  button('Turn off memory').props.onClick();await settle();expect((await core.getUserMemory()).enabled).toBe(false);
  button('Forget').props.onClick();await settle();expect((await core.getUserMemory()).facts).toEqual([]);expect(commands.every(type=>type==='memory.get'||type==='memory.change'||type==='memory.preview')).toBe(true);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('the composer hides account facts when authoritative project preview is unavailable, opted out or outside the current task scope',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-memory-policy-preview-')),core=await createCompanion({dataDir:directory});
 try{
  const owned=await core.projectCommand({type:'projects.create',name:'Owned project'}),other=await core.projectCommand({type:'projects.create',name:'Other project'}),created=await core.createTask({title:'Synthetic task'}),foreign=await core.createTask({title:'Other task'});
  await core.projectCommand({type:'projects.assign',taskId:created.id,projectId:owned.id,expectedProjectId:null});await core.projectCommand({type:'projects.assign',taskId:foreign.id,projectId:other.id,expectedProjectId:null});
  await core.changeUserMemory({expectedRevision:0,change:{kind:'save',text:'SYNTHETIC_ACCOUNT_FACT',topics:[]}});await core.changeUserMemory({expectedRevision:1,change:{kind:'enabled',enabled:true}});
  const task=await core.getTask(created.id);let project:{id:string;useAccountMemory?:boolean}|undefined,mode:'unavailable'|'current'|'foreign'='unavailable',changed=()=>{};const calls:Array<{taskId?:string;prompt:string}>=[];
  vi.stubGlobal('window',{companion:{invoke:async(command:any)=>{const {type,...input}=command;expect(type).toBe('memory.preview');expect(input.taskId).toBe(task.id);calls.push(input);if(mode==='unavailable')throw Error('Preview unavailable');return core.previewUserMemory({...input,...(mode==='foreign'?{taskId:foreign.id}:{})});},subscribe:(listener:(event:unknown)=>void)=>{changed=()=>listener({type:'changed'});return()=>{};}}});
  const preview=createControlledRenderer(()=>createElement(MemoryStatus,{task,project,prompt:'Explain the plan',kind:'explain',onManage:()=>{}})),text=()=>preview.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join('');
  async function settle(){await core.getUserMemory();for(let index=0;index<8;index++)await Promise.resolve();preview.render();}
  preview.render();await settle();expect(text()).toContain('Memory preview unavailable');expect(text()).not.toContain('SYNTHETIC_ACCOUNT_FACT');
  project=await core.projectCommand({type:'projects.update',projectId:owned.id,expectedRevision:owned.revision,name:owned.name,instructions:owned.instructions,useAccountMemory:false});mode='current';preview.render();await settle();expect(text()).toContain('Account memory off for this project');expect(text()).not.toContain('SYNTHETIC_ACCOUNT_FACT');
  mode='foreign';changed();preview.render();await settle();expect(text()).toContain('Checking memory');expect(text()).not.toContain('SYNTHETIC_ACCOUNT_FACT');
  project=await core.projectCommand({type:'projects.update',projectId:owned.id,expectedRevision:(await core.projectCommand({type:'projects.list'})).find(item=>item.id===owned.id)!.revision,name:owned.name,instructions:owned.instructions,useAccountMemory:true});mode='current';preview.render();await settle();expect(text()).toContain('Memory · 1 fact for this question');expect(text()).toContain('SYNTHETIC_ACCOUNT_FACT');
  expect(calls.length).toBeGreaterThanOrEqual(4);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('Memory settings exposes selected saved-fact JSON export without enabling memory or using unsaved text',async()=>{
 const memory={revision:5,enabled:false,facts:[{id:'owned-qa-fact',revision:4,text:'QA memory 日本語 🪴',topics:['C++']},{id:'unselected',revision:5,text:'UNSELECTED_FACT',topics:[]}]},commands:any[]=[];let cancel=true;
 vi.stubGlobal('window',{companion:{invoke:async(command:any)=>{commands.push(command);if(command.type==='memory.get')return memory;if(command.type==='memory.export')return cancel?{kind:'cancelled'}:{kind:'saved',path:'/owned/synthetic-memory.json',count:1,byteLength:321,memoryRevision:5};throw Error('Unexpected command');},subscribe:()=>()=>{}}});
 const r=createControlledRenderer(()=>createElement(MemorySettings));const content=(node:ReturnType<typeof r.find>):string=>node.type==='#text'?node.props.text:node.children.map(content).join('');const button=(label:string)=>r.find(node=>node.type==='button'&&content(node)===label);async function settle(){for(let i=0;i<8;i++)await Promise.resolve();r.render();}
 r.render();await settle();expect(r.nodes().filter(node=>node.type==='input'&&node.props.type==='checkbox').map(node=>node.props.checked)).toEqual([false,false]);expect(button('Export selected facts…').props.disabled).toBe(true);
 r.find(node=>node.type==='textarea').props.onChange({target:{value:'UNSAVED_EDITOR_TEXT'}});r.find(node=>node.type==='input'&&node.props['aria-label']==='Include saved fact in export: QA memory 日本語 🪴').props.onChange({target:{checked:true}});r.render();expect(navigation.dirty).toBe(true);button('Export selected facts…').props.onClick();await settle();expect(commands.at(-1)).toEqual({type:'memory.export',expectedRevision:5,facts:[{id:'owned-qa-fact',revision:4}]});expect(r.find(node=>node.type==='textarea').props.value).toBe('UNSAVED_EDITOR_TEXT');expect(navigation.dirty).toBe(true);expect(r.nodes().some(node=>node.type==='#text'&&node.props.text.includes('cancelled'))).toBe(true);
 cancel=false;button('Export selected facts…').props.onClick();await settle();expect(r.nodes().some(node=>node.type==='#text'&&node.props.text.includes('Exported 1 saved fact'))).toBe(true);expect(commands.every(command=>command.type==='memory.get'||command.type==='memory.export')).toBe(true);expect(memory.enabled).toBe(false);expect(memory.revision).toBe(5);expect(r.find(node=>node.type==='textarea').props.value).toBe('UNSAVED_EDITOR_TEXT');
});
