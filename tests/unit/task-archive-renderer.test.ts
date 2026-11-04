import {expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import type {Task} from '../../src/core/types';
import {ArchivedTasks,TaskArchiveControl} from '../../src/renderer/src/components/ArchivedTasks';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {navigationTasks} from '../../src/shared/task-archive';
const at='2026-10-30T10:00:00.000Z';
function task(id='task',title='Orchard research'):Task{return {id,title,goal:'PRIVATE_GOAL',status:'paused',createdAt:at,updatedAt:at,sources:[],artifacts:[],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false},session:{revision:0,draft:'PRIVATE_UNSENT',runs:[],moduleStates:[]}};}
type Node=ReturnType<ReturnType<typeof createControlledRenderer>['nodes']>[number];
const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
it('a paused task archive confirmation can be cancelled without invoking an action, then explicitly archived',()=>{
 const owner=task(),onArchive=vi.fn(),onRestore=vi.fn(),r=createControlledRenderer(()=>createElement(TaskArchiveControl,{task:owner,busy:false,onArchive,onRestore}));r.render();const button=(label:string)=>r.find(node=>node.type==='button'&&text(node)===label);button('Archive paused task…').props.onClick();r.render();expect(r.nodes().filter(node=>node.type==='#text').map(text).join('')).toContain('Saved documents and helpers can still appear in search and be opened.');expect(r.nodes().some(node=>node.type==='p'&&text(node)==='Archive “Orchard research”? It will stay paused.')).toBe(true);button('Keep task').props.onClick();r.render();expect(onArchive).not.toHaveBeenCalled();button('Archive paused task…').props.onClick();r.render();button('Archive task').props.onClick();expect(onArchive).toHaveBeenCalledTimes(1);expect(onRestore).not.toHaveBeenCalled();
});
it('active tasks have a clear pause-first path and cannot open the archive confirmation',()=>{
 const r=createControlledRenderer(()=>createElement(TaskArchiveControl,{task:{...task(),status:'active'},busy:false,onArchive:vi.fn(),onRestore:vi.fn()}));r.render();expect(r.nodes().some(node=>node.type==='p'&&text(node)==='Pause this task from Task options before archiving it.')).toBe(true);expect(r.nodes().filter(node=>node.type==='button')).toEqual([]);
});
it('archived task name filtering restores the exact owner, keeps paused wording and never previews drafts or goals',()=>{
 const a={...task(),archive:{id:'22222222-2222-4222-8222-222222222222',archivedAt:at}},b={...task('other','Mesa research'),archive:{id:'33333333-3333-4333-8333-333333333333',archivedAt:'2026-10-29T10:00:00.000Z'}},c=task('current','Current task'),onRestore=vi.fn();let tasks=[a,b,c],busy=false;const r=createControlledRenderer(()=>createElement(ArchivedTasks,{tasks,busy,onRestore}));r.render();expect(r.nodes().filter(node=>node.type==='strong').map(text)).toEqual(['Orchard research','Mesa research']);expect(r.nodes().filter(node=>node.type==='#text').map(text).join('')).toContain('Saved documents and helpers can still appear in search and be opened.');expect(r.nodes().filter(node=>node.type==='#text').map(text).join('')).not.toContain('PRIVATE_');expect(navigationTasks(tasks)).toEqual([c]);r.find(node=>node.type==='input').props.onChange({currentTarget:{value:'  mesa  '}});r.render();expect(r.nodes().filter(node=>node.type==='strong').map(text)).toEqual(['Mesa research']);r.find(node=>node.type==='button').props.onClick();expect(onRestore).toHaveBeenCalledWith(b);busy=true;r.render();expect(r.find(node=>node.type==='button').props.disabled).toBe(true);tasks=[a,c];busy=false;r.render();expect(r.nodes().some(node=>node.type==='p'&&text(node)==='No matching archived tasks.')).toBe(true);
});
it('restoring an archived task uses its own callback and never exposes a Resume action',()=>{
 const onArchive=vi.fn(),onRestore=vi.fn(),r=createControlledRenderer(()=>createElement(TaskArchiveControl,{task:{...task(),archive:{id:'22222222-2222-4222-8222-222222222222',archivedAt:at}},busy:false,onArchive,onRestore}));r.render();const buttons=r.nodes().filter(node=>node.type==='button');expect(buttons.map(text)).toEqual(['Restore task']);buttons[0].props.onClick();expect(onRestore).toHaveBeenCalledTimes(1);expect(onArchive).not.toHaveBeenCalled();
});
