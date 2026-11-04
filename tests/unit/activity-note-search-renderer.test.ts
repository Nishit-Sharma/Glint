import {afterEach,expect,test,vi} from 'vitest';
const probe=vi.hoisted(()=>({focus:vi.fn(),scrollIntoView:vi.fn(),isConnected:true,closest:vi.fn(()=>null as unknown)}));
vi.mock('react',async original=>{const fixture=await import('../support/controlled-renderer.fixture');return {...await original<typeof import('react')>(),...fixture.hooks,useRef(initial:unknown){const ref=fixture.hooks.useRef(initial) as {current:unknown};if(initial===null&&ref.current===null)ref.current=probe;return ref;}};});
import {createElement} from 'react';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import type {Task} from '../../src/core/types';
import {searchSavedWork,type SavedWorkSearchState} from '../../src/shared/saved-work-search';
import {SavedWorkSearch,type SavedWorkOpenScope} from '../../src/renderer/src/components/SavedWorkSearch';
import {TaskHistory} from '../../src/renderer/src/components/TaskHistory';
import {requestSavedWorkNavigation} from '../../src/renderer/src/saved-work-navigation';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
type Node=ReturnType<ReturnType<typeof createControlledRenderer>['nodes']>[number];
const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
const at='2026-10-30T10:00:00Z';
const task=(id='a'):Task=>({id,title:'Owner '+id,goal:'',status:'active',createdAt:at,updatedAt:at,sources:[],artifacts:[],requests:[],procedures:[],checkpoints:[{id:'decision',note:'  Mesa decision\n<script>inert note text</script>  ',createdAt:at,sourceRefs:[],artifacts:[]}],actions:[],memory:{enabled:false}});
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
afterEach(()=>{vi.clearAllMocks();probe.closest.mockReturnValue(null);});

test('notes search is explicit, local and inert; a result opens once and stale handlers retire on query/scope changes with whole-note disclosure',()=>{
 const current=task(),oversized=task('large');oversized.checkpoints[0].note='needle'+'x'.repeat(10_000);let state:SavedWorkSearchState={query:'',scope:'all'};const scopes:SavedWorkOpenScope[]=[],open=vi.fn((_match,scope:SavedWorkOpenScope)=>{scopes.push(scope);scope.started();});
 const r=createControlledRenderer(()=>createElement(SavedWorkSearch,{tasks:[current,oversized],state,onChange:next=>{state=next;},onOpen:open}));r.render();
 const query=(value:string)=>{r.find(node=>node.type==='input').props.onChange({target:{value}});r.render();},search=()=>{r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});r.render();};
 r.find(node=>node.type==='select').props.onChange({target:{value:'notes'}});r.render();expect(state.scope).toBe('notes');query('mesa');expect(open).not.toHaveBeenCalled();expect(r.nodes().some(node=>node.props['aria-label']==='Saved work matches')).toBe(false);search();
 const hit=r.find(node=>node.type==='button'&&String(node.props['aria-label']).startsWith('Open Activity note in Owner a:'));expect(text(hit)).toContain(current.checkpoints[0].note);expect(r.nodes().some(node=>node.type==='script')).toBe(false);expect(text(r.find(node=>node.props.role==='status'))).toContain('1 Activity note was not searched');
 const old=hit.props.onClick;old();old();r.render();expect(open).toHaveBeenCalledOnce();expect(scopes[0].current()).toBe(true);query('orchard');old();scopes[0].failed(Error('late old-note failure'));r.render();expect(scopes[0].current()).toBe(false);expect(open).toHaveBeenCalledOnce();expect(r.nodes().some(node=>node.props.role==='alert')).toBe(false);expect(r.nodes().some(node=>text(node).includes('Searching and opening a match do not send it to AI.'))).toBe(true);
 const saved:SavedWorkSearchState={query:'mesa',scope:'notes',results:searchSavedWork([current],'mesa','notes')},restored=createControlledRenderer(()=>createElement(SavedWorkSearch,{tasks:[],state:saved,onChange:()=>{},onOpen:open}));restored.render();expect(restored.find(node=>node.type==='input').props.value).toBe('mesa');expect(restored.nodes().some(node=>String(node.props['aria-label']).startsWith('Open Activity note in Owner a:'))).toBe(true);expect(open).toHaveBeenCalledOnce();
});

test('Activity targets only the exact selected note, exposes its inert full text and back path, and never focuses hidden or replaced content',()=>{
 let current=task(),active=true;const selected=structuredClone(current.checkpoints[0]),run=vi.fn(async()=>undefined),back=vi.fn(),r=createControlledRenderer(()=>createElement(TaskHistory,{task:current,busy:false,run,selectedNote:{taskId:'a',checkpoint:selected},active,onBackToSearch:back}));r.render();
 const found=r.find(node=>node.type==='article'&&node.props['aria-label']==='Found Activity note');expect(found.props.tabIndex).toBe(-1);expect(found.props['aria-current']).toBe('location');expect(text(found)).toContain(selected.note);expect(probe.focus).toHaveBeenCalledWith({preventScroll:true});expect(probe.scrollIntoView).toHaveBeenCalledWith({block:'start'});expect(r.nodes().some(node=>node.type==='script')).toBe(false);r.find(node=>node.type==='button'&&text(node)==='Back to search results').props.onClick();expect(back).toHaveBeenCalledOnce();
 probe.focus.mockClear();active=false;r.render();expect(probe.focus).not.toHaveBeenCalled();active=true;probe.closest.mockReturnValue({hidden:true});r.render();expect(probe.focus).not.toHaveBeenCalled();probe.closest.mockReturnValue(null);active=false;r.render();active=true;r.render();expect(probe.focus).toHaveBeenCalledOnce();
 probe.focus.mockClear();current={...current,checkpoints:[{...selected,note:'Changed after the lookup.'}]};r.render();expect(r.nodes().some(node=>node.props['aria-label']==='Found Activity note')).toBe(false);expect(text(r.find(node=>node.props.role==='alert'))).toContain('This exact saved note changed');expect(probe.focus).not.toHaveBeenCalled();expect(run).not.toHaveBeenCalled();current={...task(),id:'foreign-owner'};r.render();expect(r.nodes().some(node=>node.props['aria-label']==='Found Activity note')).toBe(false);expect(text(r.find(node=>node.props.role==='alert'))).toContain('This exact saved note changed');
});

async function appFunction(){
 const source=await readFile(new URL('../../src/renderer/src/App.tsx',import.meta.url),'utf8'),file=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found:ts.FunctionDeclaration|undefined;const visit=(node:ts.Node)=>{if(ts.isFunctionDeclaration(node)&&node.name?.text==='openSavedWork')found=node;ts.forEachChild(node,visit);};visit(file);expect(found).toBeDefined();return ts.transpileModule('('+found!.getText(file)+')',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
}
test('the actual App handler opens same/cross-task notes under the accepted navigation epoch and refuses a deleted, changed or stale-list held result',async()=>{
 const code=await appFunction();for(const originId of ['a','b'])for(const change of ['none','deleted','updated','new-list']){
  const origin=task(originId),destination=originId==='b'?origin:task('b'),match=searchSavedWork([destination],'mesa','notes').matches[0];let release!:(value:Task)=>void;const held=new Promise<Task>(resolve=>{release=resolve;}),setTask=vi.fn(),setHistorySelection=vi.fn(),setPage=vi.fn(),scope={current:()=>true,started:vi.fn(),finished:vi.fn(),failed:vi.fn()},taskListSnapshot={current:{generation:1,tasks:originId==='b'?[destination]:[origin,destination]}};
  const bindings={requestSavedWorkNavigation,taskRef:{current:origin},newQuestionEpoch:{current:7},incomingActivationEpoch:{current:1},surfaceIntentEpoch:{current:1},surfaceModeRef:{current:'workspace'},taskListSnapshot,deletedTaskIds:{current:new Set()},draftNavigation:{api:{guard:(action:()=>void)=>(action(),true),hasDirty:()=>false}},drafts:{flush:async()=>{},hydrate:()=>{}},bridge:{invoke:()=>held},viewSelectionEpoch:{current:1},viewRestored:{current:true},retireContext:()=>{},setLocalStart:()=>{},setAddingBot:()=>{},setArrivalIdentities:()=>{},setTask,setTasks:()=>{},setBasePage:()=>{},setError:()=>{},setNotice:()=>{},setRevisionOrigin:()=>{},setReviewRevision:()=>{},setHistorySelection,setPage};
  const open=new Function(...Object.keys(bindings),'return '+code)(...Object.values(bindings));open(match,scope);await tick();
  if(change==='deleted')taskListSnapshot.current.tasks=[];if(change==='updated')taskListSnapshot.current.tasks=[{...destination,checkpoints:[{...destination.checkpoints[0],note:'Updated while pending'}]}];if(change==='new-list')taskListSnapshot.current.generation++;
  release(destination);await tick();
  if(change==='none'){expect(setTask).toHaveBeenCalledWith(destination);expect(setPage).toHaveBeenCalledWith('history');expect(setHistorySelection).toHaveBeenCalledWith({taskId:'b',checkpoint:destination.checkpoints[0],navigation:8});expect(scope.failed).not.toHaveBeenCalled();}
  else{expect(setTask).not.toHaveBeenCalled();expect(setHistorySelection).not.toHaveBeenCalled();expect(setPage).not.toHaveBeenCalled();expect(scope.failed).toHaveBeenCalledOnce();}
 }
});
