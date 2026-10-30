import {expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import type {Task} from '../src/core/types';
import {SavedDocumentSource} from '../src/renderer/src/components/SavedDocumentSource';
import {createControlledRenderer} from './controlled-renderer.fixture';
import type {Run} from '../src/renderer/src/ui';
const time='2026-10-30',ref={sourceId:'source',version:1,digest:'a'.repeat(64)};
function owner():Task{return {id:'owner',title:'Original research',goal:'',status:'active',createdAt:time,updatedAt:time,sources:[{id:'source',currentVersion:1,freshness:'fresh',versions:[{id:'source',version:1,digest:ref.digest,kind:'text',role:'fact',label:'Requirements',content:'PRIVATE_SOURCE_BODY',capturedAt:time}]}],artifacts:[{id:'document',revisions:[{revision:1,digest:'b'.repeat(64),title:'Visit plan',content:'Saved document text',mimeType:'text/markdown',sourceRefs:[ref],createdAt:time}]}],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}};}
type Node=ReturnType<ReturnType<typeof createControlledRenderer>['nodes']>[number];
const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
function mount(send=vi.fn(async(_command:unknown)=>undefined as unknown)){
 let tasks=[owner()],current=true;const task={...owner(),id:'destination',title:'New research',sources:[],artifacts:[]},beforeAdd=vi.fn(),onAdded=vi.fn(),onCancel=vi.fn(),r=createControlledRenderer(()=>createElement(SavedDocumentSource,{task,tasks,busy:false,run:send as unknown as Run,isCurrent:()=>current,beforeAdd,onAdded,onCancel}));r.render();
 const choose=()=>{r.find(node=>node.type==='button'&&text(node)==='Visit plan · Original research · revision 1').props.onClick();r.render();},add=()=>r.find(node=>node.type==='button'&&text(node)==='Add local source snapshot');
 return {r,send,beforeAdd,onAdded,onCancel,choose,add,setCurrent:(value:boolean)=>{current=value;},setTasks:(value:Task[])=>{tasks=value;r.render();},get tasks(){return tasks;}};
}
it('shows saved ownership before selection, then exact read-only copy and freshness before any add',()=>{
 const f=mount();expect(f.r.nodes().map(text).join('\n')).toContain('Visit plan · Original research · revision 1');expect(f.r.nodes().map(text).join('\n')).not.toContain('Saved document text');expect(f.r.nodes().some(node=>node.type==='textarea')).toBe(false);f.choose();const preview=f.r.find(node=>node.type==='textarea');expect(preview.props.readOnly).toBe(true);expect(preview.props.value).toContain('Original task: Original research');expect(preview.props.value).toContain('Revision: 1');expect(preview.props.value).toContain('current saved version');expect(preview.props.value).toContain('Saved document text');expect(preview.props.value).not.toContain('PRIVATE_SOURCE_BODY');expect(f.add().props.disabled).toBe(false);expect(f.send).not.toHaveBeenCalled();
});
it('disables an already reviewed choice when its owner is deleted or linked source freshness changes',()=>{
 for(const change of ['deleted','freshness']){const f=mount();f.choose();if(change==='deleted')f.setTasks([]);else{const tasks=structuredClone(f.tasks);tasks[0].sources[0].freshness='refresh-required';f.setTasks(tasks);}expect(f.add().props.disabled).toBe(true);f.add().props.onClick();expect(f.send).not.toHaveBeenCalled();expect(f.r.nodes().some(node=>node.props.role==='alert')).toBe(true);}
});
it('rejects a captured add after navigation without changing source selection or dispatching',()=>{
 const f=mount();f.choose();const old=f.add();f.setCurrent(false);old.props.onClick();expect(f.beforeAdd).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();expect(f.onAdded).not.toHaveBeenCalled();
});
it('dispatches once and never opens a source in a different task after a held response',async()=>{
 let resolve!:(value:unknown)=>void;const pending=new Promise<unknown>(done=>{resolve=done;}),send=vi.fn((_command:unknown)=>pending),f=mount(send);f.choose();const old=f.add();old.props.onClick();old.props.onClick();expect(send).toHaveBeenCalledTimes(1);expect(f.beforeAdd).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][0]).toMatchObject({type:'source.document',taskId:'destination',ownerTaskId:'owner',artifact:{artifactId:'document',revision:1,digest:'b'.repeat(64)}});f.setCurrent(false);resolve({reference:{sourceId:'copy',version:1,digest:'c'.repeat(64)}});await pending;for(let i=0;i<5;i++)await Promise.resolve();expect(f.onAdded).not.toHaveBeenCalled();
});
it('keeps an unconfirmed review intact and retries the same exact snapshot without copying new text',async()=>{
 const send=vi.fn(async(_command:unknown)=>undefined as unknown),f=mount(send);f.choose();f.add().props.onClick();await vi.waitFor(()=>{f.r.render();expect(f.r.nodes().some(node=>node.props.role==='status'&&text(node).startsWith('The copy was not confirmed.'))).toBe(true);});const first=send.mock.calls[0][0];f.add().props.onClick();await vi.waitFor(()=>expect(send).toHaveBeenCalledTimes(2));expect(send.mock.calls[1][0]).toEqual(first);expect(f.onAdded).not.toHaveBeenCalled();
});
it('changing the source role requires a new reviewed choice',()=>{
 const f=mount();f.choose();f.r.find(node=>node.type==='select').props.onChange({target:{value:'style'}});f.r.render();expect(f.r.nodes().some(node=>node.type==='textarea')).toBe(false);expect(f.send).not.toHaveBeenCalled();f.choose();expect(f.r.find(node=>node.type==='select').props.value).toBe('style');expect(f.r.find(node=>node.type==='textarea').props.value).toContain('Saved document text');
});
