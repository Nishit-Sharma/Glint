import {expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {CodeWorkspace} from '../../src/renderer/src/components/CodeWorkspace';
import type {Task} from '../../src/core/types';
import type {CodeCommand,CodeFolders} from '../../src/shared/code-workspace';

it('discloses the physical folder instruction scope and disables the saved choice through its owner-bound command',async()=>{
 const task:Task={id:'owner',title:'Synthetic owner',goal:'',status:'active',createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z',sources:[],artifacts:[],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}};
 const calls:CodeCommand[]=[],folders:CodeFolders={kind:'folders',folders:[{id:'folder',taskId:task.id,path:'/tmp/owned-guidance731',name:'owned-guidance731',instructions:{revision:3,enabled:true,fileId:'chosen'}}],files:[{id:'chosen',folderId:'folder',relativePath:'instructions.md',artifactId:'saved'}]};
 const invoke=async<T,>(command:CodeCommand):Promise<T>=>{calls.push(command);return (command.type==='code.instructions.disable'?{...folders,folders:[{...folders.folders[0],instructions:{revision:4,enabled:false,fileId:'chosen'}}]}:folders) as T;};
 const r=createControlledRenderer(()=>createElement(CodeWorkspace,{task,cache:{} as never,disabled:false,isCurrent:()=>true,invoke,onTask:()=>{}}));r.render();await Promise.resolve();await Promise.resolve();r.render();const text=()=>r.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join(' ');
 expect(text()).toContain('owned-guidance731');expect(text()).toContain('Folder instructions included: instructions.md');expect(text()).toContain('Other tasks do not inherit');
 r.find(node=>node.type==='button'&&node.children.some(child=>child.type==='#text'&&child.props.text==='Disable folder instructions')).props.onClick();await Promise.resolve();await Promise.resolve();r.render();expect(calls.at(-1)).toEqual({type:'code.instructions.disable',taskId:task.id,folderId:'folder',expectedRevision:3});expect(text()).toContain('Folder instructions off');
});
