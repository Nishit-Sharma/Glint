import {afterEach,expect,test,vi} from 'vitest';
const probe=vi.hoisted(()=>({scrollIntoView:vi.fn(),focus:vi.fn()}));
vi.mock('react',async original=>{const fixture=await import('./controlled-renderer.fixture');return {...await original<typeof import('react')>(),...fixture.hooks,useRef(initial:unknown){const ref=fixture.hooks.useRef(initial) as {current:unknown};if(initial===null&&ref.current===null)ref.current=probe;return ref;}};});
import {createElement} from 'react';
import type {Source,SourceRef} from '../src/core/types';
import {SourceHistoryComparison} from '../src/renderer/src/components/SourceHistoryComparison';
import {createControlledRenderer} from './controlled-renderer.fixture';
type Node=ReturnType<ReturnType<typeof createControlledRenderer>['nodes']>[number];
const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
const source=(id='a'):Source=>({id,currentVersion:3,freshness:'fresh',versions:['Keep\nFirst exact line.\n','Keep\nSecond exact line.\n','Keep\nThird exact line.\n'].map((content,index)=>({id,version:index+1,digest:id+'-'+(index+1),kind:'text',role:'fact',label:id+' policy '+(index+1),content,capturedAt:'time'}))});
const ref=(value:Source,version=value.currentVersion):SourceRef=>({sourceId:value.id,version,digest:value.versions.find(item=>item.version===version)!.digest});
const value=(version:number,id='a')=>JSON.stringify([version,id+'-'+version]);
afterEach(()=>{vi.unstubAllGlobals();probe.focus.mockClear();probe.scrollIntoView.mockClear();});
test('source-only history chooses explicit versions, preserves whitespace, and never follows a newly saved head',()=>{
 let current=source();const selected=ref(current),r=createControlledRenderer(()=>createElement(SourceHistoryComparison,{taskId:'task',source:current,selectedReference:selected}));
 const button=(label:string)=>r.find(node=>node.type==='button'&&text(node)===label),select=(label:string)=>r.find(node=>node.type==='select'&&node.props['aria-label']===label),contains=(content:string)=>r.nodes().some(node=>text(node).includes(content));
 r.render();button('Compare saved versions').props.onClick();r.render();expect(select('From snapshot').props.value).toBe(value(2));expect(select('To snapshot').props.value).toBe(value(3));expect(probe.focus).toHaveBeenCalledOnce();
 select('From snapshot').props.onChange({target:{value:value(1)}});r.render();select('To snapshot').props.onChange({target:{value:value(2)}});r.render();expect(probe.focus).toHaveBeenCalledOnce();expect(contains('Current live content is unknown.')).toBe(true);expect(contains('Version 3 is newer than your selections. It has not been selected.')).toBe(true);expect(r.nodes().some(node=>node.type==='pre'&&text(node)==='First exact line.\n')).toBe(true);expect(r.nodes().some(node=>node.type==='pre'&&text(node)==='Second exact line.\n')).toBe(true);expect(r.nodes().some(node=>node.type==='pre'&&text(node).includes('Third exact line.'))).toBe(false);
 current={...current,currentVersion:4,versions:[...current.versions,{...current.versions[2],version:4,digest:'a-4',content:'Newest content.'}]};r.render();expect(select('To snapshot').props.value).toBe(value(2));expect(contains('Version 4 is newer than your selections. It has not been selected.')).toBe(true);expect(r.nodes().some(node=>node.type==='pre'&&text(node)==='Newest content.')).toBe(false);
 const full=r.find(node=>node.type==='pre'&&text(node)==='Keep\nFirst exact line.\n');expect(full.props.tabIndex).toBe(0);
});
test('cancel returns focus, while a changed owner or selected snapshot retires old local view and pending focus',()=>{
 let current=source(),selected=ref(current),taskId='task-a';const r=createControlledRenderer(()=>createElement(SourceHistoryComparison,{taskId,source:current,selectedReference:selected})),open=()=>{r.find(node=>node.type==='button'&&text(node)==='Compare saved versions').props.onClick();r.render();},pane=()=>r.nodes().some(node=>node.props['aria-label']==='Selected source version comparison');let frame:(()=>void)|undefined;
 vi.stubGlobal('requestAnimationFrame',(callback:()=>void)=>{frame=callback;return 1;});r.render();open();r.find(node=>node.type==='button'&&text(node)==='Close version comparison').props.onClick();r.render();expect(pane()).toBe(false);frame!();expect(probe.focus).toHaveBeenCalledTimes(2);
 open();const lateClose=r.find(node=>node.type==='button'&&text(node)==='Close version comparison').props.onClick;lateClose();r.render();const focusCalls=probe.focus.mock.calls.length;taskId='task-b';current=source('b');selected=ref(current);r.render();frame!();expect(probe.focus).toHaveBeenCalledTimes(focusCalls);lateClose();expect(pane()).toBe(false);
 taskId='task-a';current=source();selected=ref(current);r.render();expect(pane()).toBe(false);open();selected=ref(current,1);r.render();expect(pane()).toBe(false);open();expect(r.find(node=>node.type==='select'&&node.props['aria-label']==='From snapshot').props.value).toBe(value(1));
});
test('missing, non-text, same or reversed versions show honest fallbacks without an invented diff',()=>{
 let current=source(),selected=ref(current);const r=createControlledRenderer(()=>createElement(SourceHistoryComparison,{taskId:'task',source:current,selectedReference:selected}));r.render();r.find(node=>node.type==='button'&&text(node)==='Compare saved versions').props.onClick();r.render();const choose=(label:string,version:number)=>{r.find(node=>node.type==='select'&&node.props['aria-label']===label).props.onChange({target:{value:value(version)}});r.render();},contains=(content:string)=>r.nodes().some(node=>text(node).includes(content)),diff=()=>r.nodes().some(node=>node.props['aria-label']==='Selected saved text changes');
 choose('To snapshot',2);expect(contains('Choose an earlier From snapshot')).toBe(true);expect(diff()).toBe(false);choose('To snapshot',1);expect(diff()).toBe(false);choose('To snapshot',3);current={...current,versions:current.versions.map(version=>version.version===2?{...version,kind:'image'}:version)};r.render();expect(contains('Window and image snapshots are not compared here.')).toBe(true);expect(diff()).toBe(false);
 current={...current,freshness:'refresh-required',versions:current.versions.filter(version=>version.version!==2)};r.render();expect(contains('An exact selected snapshot is unavailable.')).toBe(true);expect(contains('does not establish freshness.')).toBe(true);expect(diff()).toBe(false);expect(r.nodes().some(node=>node.type==='option'&&text(node)==='Selected snapshot unavailable')).toBe(true);
});
test('an invalid or foreign selected snapshot cannot open a silently rebound comparison',()=>{
 const current=source();for(const selectedReference of [{...ref(current),digest:'wrong'},{...ref(current),sourceId:'other'}]){
  const r=createControlledRenderer(()=>createElement(SourceHistoryComparison,{taskId:'task',source:current,selectedReference}));r.render();const button=r.find(node=>node.type==='button'&&text(node)==='Compare saved versions');expect(button.props.disabled).toBe(true);button.props.onClick();r.render();expect(r.nodes().some(node=>node.props['aria-label']==='Selected source version comparison')).toBe(false);
 }
});
test('closing focus cannot overtake a reopened comparison in the same owner',()=>{
 const current=source(),r=createControlledRenderer(()=>createElement(SourceHistoryComparison,{taskId:'task',source:current,selectedReference:ref(current)})),frames:Array<()=>void>=[];
 vi.stubGlobal('requestAnimationFrame',(callback:()=>void)=>{frames.push(callback);return frames.length;});
 const button=(label:string)=>r.find(node=>node.type==='button'&&text(node)===label),pane=()=>r.nodes().some(node=>node.props['aria-label']==='Selected source version comparison');
 r.render();button('Compare saved versions').props.onClick();r.render();const previousClose=button('Close version comparison').props.onClick;previousClose();r.render();expect(pane()).toBe(false);expect(frames).toHaveLength(1);
 button('Compare saved versions').props.onClick();r.render();expect(pane()).toBe(true);const headingFocusCalls=probe.focus.mock.calls.length;expect(probe.focus).toHaveBeenLastCalledWith({preventScroll:true});frames[0]();expect(probe.focus).toHaveBeenCalledTimes(headingFocusCalls);
 previousClose();r.render();expect(pane()).toBe(true);
 button('Close version comparison').props.onClick();r.render();expect(pane()).toBe(false);expect(frames).toHaveLength(2);frames[1]();expect(probe.focus).toHaveBeenCalledTimes(headingFocusCalls+1);expect(probe.focus).toHaveBeenLastCalledWith();
});
