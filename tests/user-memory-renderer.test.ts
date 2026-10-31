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

test('Memory settings explicitly enable saved facts, edit and forget through the real core, and show matching facts by the composer',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-memory-ui-')),core=await createCompanion({dataDir:directory}),commands:string[]=[];
 vi.stubGlobal('window',{companion:{invoke:async(command:any)=>{commands.push(command.type);if(command.type==='memory.get')return core.getUserMemory();if(command.type==='memory.change'){const {type,...input}=command;return core.changeUserMemory(input);}throw Error('Unexpected command');},subscribe:()=>()=>{}}});
 const r=createControlledRenderer(()=>createElement(MemorySettings));
 const content=(node:ReturnType<typeof r.find>):string=>node.type==='#text'?node.props.text:node.children.map(content).join('');
 const button=(label:string)=>r.find(node=>node.type==='button'&&content(node)===label);
 async function settle(){await core.getUserMemory();for(let i=0;i<8;i++)await Promise.resolve();r.render();}
 try{
  r.render();await settle();expect(content(button('Enable memory'))).toBe('Enable memory');
  r.find(node=>node.type==='textarea').props.onChange({target:{value:'I am new to Rust.'}});r.find(node=>node.type==='input').props.onChange({target:{value:'rust'}});r.render();expect(navigation.dirty).toBe(true);
  r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await settle();expect(await core.getUserMemory()).toMatchObject({enabled:false,facts:[{text:'I am new to Rust.',topics:['rust']}]});expect(navigation.dirty).toBe(false);
  button('Enable memory').props.onClick();await settle();expect((await core.getUserMemory()).enabled).toBe(true);
  const preview=createControlledRenderer(()=>createElement(MemoryStatus,{task:{title:'Rust',goal:''},prompt:'Explain borrowing',kind:'explain',onManage:()=>{}}));preview.render();await core.getUserMemory();for(let i=0;i<8;i++)await Promise.resolve();preview.render();expect(content(preview.find(node=>node.type==='summary'))).toBe('Memory · 1 fact for this question');expect(content(preview.find(node=>node.type==='li'))).toBe('I am new to Rust.');
  button('Edit').props.onClick();r.render();expect(r.find(node=>node.type==='textarea').props.value).toBe('I am new to Rust.');r.find(node=>node.type==='textarea').props.onChange({target:{value:'I understand Rust ownership.'}});r.render();r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await settle();expect((await core.getUserMemory()).facts[0].text).toBe('I understand Rust ownership.');
  button('Turn off memory').props.onClick();await settle();expect((await core.getUserMemory()).enabled).toBe(false);
  button('Forget').props.onClick();await settle();expect((await core.getUserMemory()).facts).toEqual([]);expect(commands.every(type=>type==='memory.get'||type==='memory.change')).toBe(true);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
