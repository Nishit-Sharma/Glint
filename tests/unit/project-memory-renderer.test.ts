import {afterEach,expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...((await import('../support/controlled-renderer.fixture')).hooks)}));
import {createElement} from 'react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {ProjectMemory} from '../../src/renderer/src/components/ProjectMemory';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import type {ProjectCommand} from '../../src/shared/projects';
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});

async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'project-memory-renderer-')),core=await createCompanion({dataDir:directory});
 const project=await core.projectCommand({type:'projects.create',name:'Owned synthetic project'}),commands:ProjectCommand[]=[];let loseAck=false;
 vi.stubGlobal('window',{companion:{subscribe:()=>()=>{},invoke:async(command:any)=>{if(command.type==='memory.get')return core.getUserMemory();commands.push(command);const result=await core.projectCommand(command);if(command.type==='projects.memory.change'&&loseAck){loseAck=false;throw Error('Synthetic lost acknowledgement');}return result;}}});
 const r=createControlledRenderer(()=>createElement(ProjectMemory,{project,busy:false}));
 const text=(node:ReturnType<typeof r.find>):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
 const button=(label:string)=>r.find(node=>node.type==='button'&&text(node)===label),expiry=()=>r.find(node=>node.type==='input'&&node.props.placeholder==='2026-12-01T15:00:00.000Z'),body=()=>r.nodes().filter(n=>n.type==='#text').map(n=>n.props.text).join('');
 async function settle(){await core.getUserMemory();for(let i=0;i<15;i++)await Promise.resolve();r.render();}
 r.render();await settle();
 return {core,project,r,commands,text,button,expiry,body,settle,loseAck(){loseAck=true;},close:async()=>{await core.close();await rm(directory,{recursive:true,force:true});}};
}
it('retains raw invalid UTC, explicitly saves an expired fact, edits it back to no expiry and exposes scoped danger Forget',async()=>{
 const f=await fixture();try{
  f.r.find(node=>node.type==='textarea').props.onChange({currentTarget:{value:'Synthetic retained lesson'}});f.expiry().props.onChange({currentTarget:{value:'not-a-date'}});f.r.render();expect(f.expiry().props.value).toBe('not-a-date');expect(f.expiry().props['aria-invalid']).toBe(true);expect(f.body()).toContain('Use an exact UTC date');
  f.r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await f.settle();expect(f.commands.filter(c=>c.type==='projects.memory.change')).toEqual([]);
  f.expiry().props.onChange({currentTarget:{value:'2000-01-01T00:00:00.000Z'}});f.r.render();f.button('Add project fact').props.onClick?.();f.r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await f.settle();
  const saved=await f.core.projectCommand({type:'projects.memory.get',projectId:f.project.id});expect(saved.facts[0].expiresAt).toBe('2000-01-01T00:00:00.000Z');expect(f.body()).toContain('Expired — excluded from new memory selections');
  f.button('Edit project fact').props.onClick();f.r.render();expect(f.expiry().props.value).toBe(saved.facts[0].expiresAt);f.expiry().props.onChange({currentTarget:{value:''}});f.r.render();f.r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await f.settle();expect((await f.core.projectCommand({type:'projects.memory.get',projectId:f.project.id})).facts[0]).not.toHaveProperty('expiresAt');
  expect(f.button('Forget project fact').props.className).toContain('danger');expect(f.body()).toContain('Earlier messages, source copies, archives and anything already sent remain');f.button('Forget project fact').props.onClick();await f.settle();expect((await f.core.projectCommand({type:'projects.memory.get',projectId:f.project.id})).facts).toEqual([]);expect(f.body()).toContain('Project fact forgotten for future memory use');expect((await f.core.listTasks())).toEqual([]);
 }finally{await f.close();}
});
it('keeps edits on CAS conflict and requires reload after a committed Forget loses acknowledgement',async()=>{
 const f=await fixture();try{
  f.r.find(node=>node.type==='textarea').props.onChange({currentTarget:{value:'Original synthetic lesson'}});f.r.render();f.r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await f.settle();let saved=await f.core.projectCommand({type:'projects.memory.get',projectId:f.project.id});
  f.button('Edit project fact').props.onClick();f.r.render();f.expiry().props.onChange({currentTarget:{value:'2001-01-01T00:00:00.000Z'}});f.r.render();await f.core.projectCommand({type:'projects.memory.change',projectId:f.project.id,expectedRevision:saved.revision,change:{kind:'save',id:saved.facts[0].id,text:'Concurrent synthetic lesson',topics:[]}});
  f.r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await f.settle();expect(f.body()).toContain('Project memory changed elsewhere');expect(f.expiry().props.value).toBe('2001-01-01T00:00:00.000Z');expect(f.expiry().props.disabled).toBe(true);f.button('Load saved project memory and replace these edits').props.onClick();await f.settle();expect(f.body()).toContain('Concurrent synthetic lesson');expect(f.expiry().props.value).toBe('');
  f.loseAck();f.button('Forget project fact').props.onClick();await f.settle();expect((await f.core.projectCommand({type:'projects.memory.get',projectId:f.project.id})).facts).toEqual([]);expect(f.body()).toContain('Load saved project memory to confirm');expect(f.button('Forget project fact').props.disabled).toBe(true);const count=f.commands.length;f.button('Forget project fact').props.onClick();await f.settle();expect(f.commands.length).toBe(count);f.button('Load saved project memory and replace these edits').props.onClick();await f.settle();expect(f.body()).toContain('No project facts saved');
 }finally{await f.close();}
});

it('synchronizes an expiry crossed between render and its first effect without a future timer or render loop',()=>{
 const expiresAt='2026-11-03T12:00:00.000Z',deadline=Date.parse(expiresAt);let reads=0;
 vi.spyOn(Date,'now').mockImplementation(()=>reads++===0?deadline-1:deadline+1);
 vi.stubGlobal('window',{companion:{subscribe:()=>()=>{},invoke:async()=>({revision:0,enabled:false,facts:[]})}});
 const project={id:'owned',name:'Owned synthetic project',instructions:'',revision:1,createdAt:expiresAt,updatedAt:expiresAt,sources:[],memory:{revision:1,enabled:true,facts:[{id:'fact',revision:1,text:'Inspectable expired lesson',topics:[],expiresAt}]}};
 const r=createControlledRenderer(()=>createElement(ProjectMemory,{project,busy:false}));r.render();const text=r.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join('');expect(text).toContain('Expired — excluded from new memory selections');expect(reads).toBeLessThan(10);
});
