import {afterEach,expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...((await import('./controlled-renderer.fixture')).hooks)}));
import {createElement} from 'react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {PublicGithub} from '../src/renderer/src/components/PublicGithub';
import {createControlledRenderer} from './controlled-renderer.fixture';
import type {Run} from '../src/renderer/src/ui';
import type {Command} from '../src/shared/bridge';
import type {PublicGithubCapture} from '../src/shared/public-github';

afterEach(()=>vi.unstubAllGlobals());
test('the direct GitHub action exposes exact scope, captures only on gesture and keeps a saved source after disconnect',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-github-ui-')),core=await createCompanion({dataDir:directory});let task=await core.createTask({title:'GitHub UI QA'});
 const commands:Command[]=[],captured=vi.fn(),open=vi.fn(),beforeAdd=vi.fn(),cancel=vi.fn();vi.stubGlobal('window',{companion:{invoke:cancel}});
 const snapshot={repository:'octocat/hello-world',defaultBranch:'master',path:'README.md',blobSha:'a'.repeat(40),snapshotAt:'2026-10-31T09:00:00.000Z',description:'<img src=x onerror=bad()>',stars:42};
 const run=(async(command:Command)=>{commands.push(command);if(command.type==='github.capture'){const result=await core.savePublicGithubSnapshot(command,snapshot,'# Literal README\n<script>bad()</script>');task=result.task;return result;}if(command.type==='github.disconnect'){task=await core.disconnectPublicGithub(command);return task;}throw Error('Unexpected command');}) as Run;
 const r=createControlledRenderer(()=>createElement(PublicGithub,{task,busy:false,run,isCurrent:()=>true,beforeAdd,onCaptured:captured,onOpen:open,onBack:vi.fn()}));
 const content=(node:ReturnType<typeof r.find>):string=>node.type==='#text'?node.props.text:node.children.map(content).join('');
 const button=(label:string)=>r.find(node=>node.type==='button'&&content(node)===label);
 async function settle(){await Promise.resolve();await core.getTask(task.id);for(let i=0;i<10;i++)await Promise.resolve();r.render();}
 try{
  r.render();expect(commands).toEqual([]);expect(r.nodes().some(node=>content(node).includes('Public-only mode uses no GitHub account or credentials.'))).toBe(true);
  const field=r.find(node=>node.type==='input');field.props.onChange({target:{value:'https://github.com/octocat/Hello-World'}});r.render();expect(r.nodes().filter(node=>node.type==='code').map(content)).toContain('https://api.github.com/repos/octocat/hello-world/readme');
  r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await settle();
  expect(commands).toHaveLength(1);expect(commands[0]).toMatchObject({type:'github.capture',repository:'octocat/hello-world',expectedConnection:null});expect(beforeAdd).toHaveBeenCalledTimes(1);expect(captured).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({sourceId:task.sources[0].id,version:1}));expect(r.nodes().some(node=>node.type==='img'||node.type==='script')).toBe(false);expect(r.nodes().some(node=>node.type==='p'&&content(node)==='<img src=x onerror=bad()>')).toBe(true);
  button('Open saved README').props.onClick();expect(open).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({version:1}));
  r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await settle();expect((commands[1] as PublicGithubCapture).expectedSource?.version).toBe(1);expect(task.sources[0].versions).toHaveLength(1);expect(r.nodes().some(node=>node.props.role==='status'&&content(node).includes('version was retained'))).toBe(true);
  button('Disconnect GitHub').props.onClick();await settle();expect(task.publicGithub).toBeUndefined();expect(task.sources).toHaveLength(1);expect(task.requests).toEqual([]);expect(r.nodes().some(node=>node.props.role==='status'&&content(node).includes('Saved README sources and their history remain'))).toBe(true);expect(commands.every(command=>command.type.startsWith('github.'))).toBe(true);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('contains failed selection saves before capture and after a saved README without losing its bytes',async()=>{
 for(const failure of ['before','after']){
  const task={id:'owner',title:'Owned GitHub task',status:'active',sources:[]} as any,reference={sourceId:'readme',version:1,digest:'a'.repeat(64)},beforeAdd=vi.fn(async()=>{if(failure==='before')throw Error('Synthetic selection failure');}),onCaptured=vi.fn(async()=>{throw Error('Synthetic selection acknowledgement lost');});
  const run=vi.fn(async()=>({task,reference,unchanged:false})),r=createControlledRenderer(()=>createElement(PublicGithub,{task,busy:false,run:run as unknown as Run,isCurrent:()=>true,beforeAdd,onCaptured,onOpen:vi.fn(),onBack:vi.fn()}));
  const text=(node:ReturnType<typeof r.find>):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
  r.render();r.find(node=>node.type==='input').props.onChange({target:{value:'octocat/hello-world'}});r.render();r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});for(let tick=0;tick<12;tick++)await Promise.resolve();r.render();
  expect(run).toHaveBeenCalledTimes(failure==='before'?0:1);expect(onCaptured).toHaveBeenCalledTimes(failure==='before'?0:1);expect(r.find(node=>node.props.role==='alert').children.map(text).join('')).toContain(failure==='before'?'capture was not confirmed':'README is saved');
 }
});
