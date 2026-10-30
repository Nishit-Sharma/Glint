import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import type {Task} from '../src/core/types';
import {SavedWorkSearch,type SavedWorkOpenScope} from '../src/renderer/src/components/SavedWorkSearch';
import type {SavedWorkSearchState} from '../src/shared/saved-work-search';
import {savedWorkUnavailable} from '../src/shared/saved-work-search';
import {createControlledRenderer} from './controlled-renderer.fixture';
type Node=ReturnType<ReturnType<typeof createControlledRenderer>['nodes']>[number];
const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
const task:Task={id:'t',title:'Orchard task',goal:'Local plan',status:'active',createdAt:'time',updatedAt:'time',sources:[],artifacts:[{id:'f',revisions:[{revision:1,digest:'d',title:'Crate notes',content:'  Mesa\n<script>inert</script>  ',mimeType:'text/markdown',createdAt:'time',sourceRefs:[]}]}],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}};
function fixture(tasks:readonly Task[]=[task]){
 let state:SavedWorkSearchState={query:'',scope:'all'};const scopes:SavedWorkOpenScope[]=[],open=vi.fn((_match,scope:SavedWorkOpenScope)=>{scopes.push(scope);scope.started();});
 const r=createControlledRenderer(()=>createElement(SavedWorkSearch,{tasks,state,onChange:next=>{state=next;},onOpen:open}));
 const input=()=>r.find(node=>node.type==='input'&&node.props.type==='search'),search=()=>{r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});r.render();},query=(value:string)=>{input().props.onChange({target:{value}});r.render();},match=()=>r.find(node=>node.type==='button'&&node.props['aria-label']==='Open saved revision: Crate notes in Orchard task');
 r.render();return {r,input,search,query,match,open,scopes,getState:()=>state};
}
test('explicit search shows owner/type/exact inert excerpt and makes no navigation until a result is chosen',()=>{
 const f=fixture();expect(f.r.find(node=>node.type==='button'&&text(node)==='Search').props.disabled).toBe(true);f.query('mesa');expect(f.r.nodes().some(node=>node.props['aria-label']==='Saved work matches')).toBe(false);f.search();expect(f.open).not.toHaveBeenCalled();expect(f.r.nodes().some(node=>node.type==='span'&&node.props.className==='saved-work-excerpt'&&text(node)===task.artifacts[0].revisions[0].content)).toBe(true);expect(f.r.nodes().some(node=>node.type==='script')).toBe(false);expect(f.match().props.disabled).toBe(false);expect(f.r.nodes().some(node=>node.props.role==='status'&&text(node).includes('1 match. Searched 2 task, file or note entries.'))).toBe(true);
});
test('repeated clicks dispatch once synchronously and a query change cancels a held lookup and retires old result handlers',()=>{
 const f=fixture();f.query('mesa');f.search();const oldClick=f.match().props.onClick;oldClick();oldClick();f.r.render();expect(f.open).toHaveBeenCalledOnce();expect(f.match().props.disabled).toBe(true);expect(f.scopes[0].current()).toBe(true);f.query('orchard');expect(f.scopes[0].current()).toBe(false);f.scopes[0].failed(Error('late old-query failure'));f.scopes[0].finished();oldClick();f.r.render();expect(f.open).toHaveBeenCalledOnce();expect(f.r.nodes().some(node=>node.props.role==='alert')).toBe(false);expect(f.r.nodes().some(node=>node.props['aria-label']==='Saved work matches')).toBe(false);f.search();expect(f.r.nodes().some(node=>node.props['aria-label']==='Open task: Orchard task')).toBe(true);
});
test('scope changes retire previous matches and errors; failed current lookup remains explicit and retryable',()=>{
 const f=fixture();f.query('mesa');f.search();f.match().props.onClick();f.scopes[0].failed(Error(savedWorkUnavailable));f.scopes[0].finished();f.r.render();expect(text(f.r.find(node=>node.props.role==='alert'))).toBe(savedWorkUnavailable);expect(f.match().props.disabled).toBe(false);const old=f.match().props.onClick;f.r.find(node=>node.type==='select').props.onChange({target:{value:'tasks'}});f.r.render();old();expect(f.open).toHaveBeenCalledOnce();expect(f.scopes[0].current()).toBe(false);expect(f.r.nodes().some(node=>node.props.role==='alert')).toBe(false);f.search();expect(f.r.nodes().some(node=>node.props.role==='status'&&text(node).includes('No matches in the searched saved work.'))).toBe(true);
});
test('returning to a panel keeps its explicit query/results without saving or automatically rerunning them',()=>{
 const f=fixture();f.query('mesa');f.search();const saved=f.getState(),onOpen=vi.fn(),r=createControlledRenderer(()=>createElement(SavedWorkSearch,{tasks:[],state:saved,onChange:()=>{},onOpen}));r.render();expect(r.find(node=>node.type==='input').props.value).toBe('mesa');expect(r.nodes().some(node=>node.props['aria-label']==='Open saved revision: Crate notes in Orchard task')).toBe(true);expect(onOpen).not.toHaveBeenCalled();expect(r.nodes().some(node=>text(node).includes('Opening rechecks the owner and the latest saved revision.'))).toBe(true);
});

test('an ambiguous embedded image entry has an explicit omitted-file disclosure instead of a complete-search claim',()=>{
 const changed=structuredClone(task);changed.artifacts[0].revisions[0].content='> First line\n> ![Diagram](data:image/png;base64,opaque-nested)';const f=fixture([changed]);f.query('opaque-nested');f.search();const status=f.r.find(node=>node.props.role==='status');expect(text(status)).toContain('No matches in the searched saved work.');expect(text(status)).toContain('1 file entry was not searched.');expect(text(status)).toContain('1 could not be projected safely.');expect(f.r.nodes().some(node=>node.props['aria-label']==='Open saved revision: Crate notes in Orchard task')).toBe(false);
});
test('oversized file coverage is explicit and never presented as a partially searched file',()=>{
 const changed=structuredClone(task);changed.artifacts[0].revisions[0].content='needle '+'x'.repeat(100_000);const f=fixture([changed]);f.query('needle');f.search();const status=text(f.r.find(node=>node.props.role==='status'));expect(status).toContain('No matches in the searched saved work.');expect(status).toContain('1 file entry was not searched.');expect(status).toContain('1 did not fit the complete-file or remaining search limits.');expect(status).not.toContain('searched only in part');expect(f.open).not.toHaveBeenCalled();
});
