import {afterEach,expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import type {Task} from '../src/core/types';
import {createControlledRenderer} from './controlled-renderer.fixture';
import {TaskResumeSuggestions,TaskResumeSuggestionSettings} from '../src/renderer/src/components/TaskResumeSuggestions';
import {taskResumePreference,taskResumeSuggestions} from '../src/renderer/src/task-resume-suggestions';

function task(id='other'):Task{return {id,title:'Review orbital periods',goal:'Compare periods',status:'active',createdAt:'2026-11-03T00:00:00.000Z',updatedAt:'2026-11-03T00:00:00.000Z',sources:[],artifacts:[],requests:[{id:'request-'+id,digest:'a'.repeat(64),kind:'explain',prompt:'PRIVATE QUESTION',status:'interrupted',sourceRefs:[],contextSourceRefs:[],startedAt:'2026-11-03T00:00:00.000Z'}],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}};}
function setup(){const data=new Map<string,string>();let fail=false;vi.stubGlobal('window',{localStorage:{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{if(fail)throw Error('Quota');data.set(key,value);}}});taskResumePreference.refresh();return {data,fail(){fail=true;}};}
type R=ReturnType<typeof createControlledRenderer>;type N=ReturnType<R['nodes']>[number];const text=(node:N):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');const button=(r:R,name:string)=>r.find(node=>node.type==='button'&&text(node)===name);
afterEach(()=>vi.unstubAllGlobals());
it('renders default-off Settings opt-in, exact reasons, dismiss/reopen/recompute and visible failure without dispatch',async()=>{
 const saved=setup(),owners=[task('current'),task()],opened:unknown[]=[];let refresh=0;
 const settings=createControlledRenderer(()=>createElement(TaskResumeSuggestionSettings));settings.render();const checkbox=settings.find(node=>node.type==='input');expect(checkbox.props.checked).toBe(false);
 const r=createControlledRenderer(()=>createElement(TaskResumeSuggestions,{tasks:owners,currentTaskId:'current',scope:'1',isCurrent:()=>true,onOpen:c=>opened.push(c),onRefresh:async()=>{refresh++;}}));r.render();expect(r.nodes()).toHaveLength(0);checkbox.props.onChange({currentTarget:{checked:true}});r.render();expect(r.nodes().some(node=>text(node).includes('outcome may need review'))).toBe(true);expect(r.nodes().some(node=>text(node).includes('PRIVATE'))).toBe(false);button(r,'Dismiss suggestion').props.onClick();r.render();expect(r.nodes().some(node=>text(node).includes('No saved task suggestions'))).toBe(true);
 taskResumePreference.refresh();r.render();expect(r.nodes().some(node=>text(node).includes('No saved task suggestions'))).toBe(true);await button(r,'Recompute suggestions').props.onClick();await new Promise<void>(resolve=>setImmediate(resolve));r.render();expect(refresh).toBe(1);button(r,'Open saved task').props.onClick();expect(opened).toHaveLength(1);saved.fail();button(r,'Dismiss suggestion').props.onClick();r.render();expect(r.nodes().some(node=>node.props.role==='alert'&&text(node).includes('could not be saved'))).toBe(true);expect(r.nodes().some(node=>node.type==='button'&&text(node)==='Open saved task')).toBe(false);
});
it('retires captured controls after disable, changed state, navigation and deferred recompute',async()=>{
 setup();taskResumePreference.set(true);let owners=[task()],scope='1',current=true,done!:()=>void;const opened:unknown[]=[];
 const r=createControlledRenderer(()=>createElement(TaskResumeSuggestions,{tasks:owners,scope,isCurrent:()=>current,onOpen:c=>opened.push(c),onRefresh:()=>new Promise<void>(resolve=>done=resolve)}));r.render();const stale=button(r,'Open saved task').props.onClick;owners=[{...owners[0],title:'Changed task'}];r.render();stale();expect(opened).toEqual([]);
 const open=button(r,'Open saved task').props.onClick;taskResumePreference.set(false);open();expect(opened).toEqual([]);taskResumePreference.set(true);r.render();button(r,'Recompute suggestions').props.onClick();taskResumePreference.dismiss(taskResumeSuggestions(owners)[0].binding);scope='2';current=false;r.render();done();await new Promise<void>(resolve=>setImmediate(resolve));expect(taskResumePreference.getSnapshot().dismissed).toHaveLength(1);
});

function app(){
 setup();taskResumePreference.set(true);const origin=task('current'),other=task(),candidate=taskResumeSuggestions([origin,other],'current')[0],selected:Task[]=[],errors:string[]=[],calls:string[]=[];let authoritative=structuredClone([origin,other]),held:(()=>void)|undefined,dirty=false,gate:Promise<void>|undefined;
 const environment:Record<string,any>={taskResumePreference,taskResumeSuggestions,ordinaryRequests:{get:()=>undefined},requestRef:{current:undefined},taskRef:{current:origin},newQuestionEpoch:{current:0},incomingActivationEpoch:{current:0},surfaceIntentEpoch:{current:0},surfaceModeRef:{current:'workspace'},resumeSuggestionIntent:{current:0},deletedTaskIds:{current:new Set()},taskListSnapshot:{current:{tasks:[origin,other]}},bridge:{invoke:async(command:{type:string})=>{calls.push(command.type);if(command.type!=='tasks.list')throw Error('Unexpected dispatch');await gate;return structuredClone(authoritative);}},draftNavigation:{api:{hasDirty:()=>dirty,guard:(action:()=>void)=>{if(dirty){held=action;return false;}action();return true;}}},setEditingBotId:()=>{},setLocalStart:()=>{},setAddingBot:()=>{},viewSelectionEpoch:{current:0},viewRestored:{current:false},retireContext:()=>{},setTask:(owner:Task)=>selected.push(owner),setBasePage:()=>{},setPage:()=>{},setError:(error:string)=>errors.push(error),setNotice:()=>{},go:()=>{},publicErrorMessage:(error:Error)=>error.message};
 const file=ts.createSourceFile('App.tsx',readFileSync('src/renderer/src/App.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),functions:string[]=[];
 function visit(node:ts.Node){if(ts.isFunctionDeclaration(node)&&node.name&&['selectTask','openResumeSuggestion'].includes(node.name.text))functions.push(node.getText(file));ts.forEachChild(node,visit);}visit(file);expect(functions).toHaveLength(2);
 const code=ts.transpileModule(functions.join('\n')+'\nreturn {openResumeSuggestion};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,entry=Function(...Object.keys(environment),code)(...Object.values(environment));
 return {candidate,selected,errors,calls,environment,open:()=>entry.openResumeSuggestion(candidate),dirty(){dirty=true;},release(){dirty=false;held?.();held=undefined;},mutate(fn:(owner:Task)=>void){fn(authoritative[1]);},holdRead(value:Promise<void>){gate=value;},async settle(){await new Promise<void>(resolve=>setImmediate(resolve));}};
}
it('actual App Open re-reads authoritative state after held discard and refuses changed/archived/deleted tasks',async()=>{
 for(const mutate of [(owner:Task)=>{owner.title='Changed';},(owner:Task)=>{owner.archive={id:'archive',archivedAt:owner.updatedAt};},(owner:Task)=>{owner.requests[0].status='running';},(owner:Task)=>{owner.requests[0].sourceRefs=[{sourceId:'withdrawn',version:1,digest:'b'.repeat(64)}];}]){const f=app();f.dirty();f.open();expect(f.calls).toEqual([]);f.mutate(mutate);f.release();await f.settle();expect(f.selected).toEqual([]);expect(f.calls).toEqual(['tasks.list']);}
 const unchanged=app();unchanged.dirty();unchanged.open();expect(unchanged.calls).toEqual([]);unchanged.release();await unchanged.settle();expect(unchanged.selected).toHaveLength(1);expect(unchanged.calls).toEqual(['tasks.list']);
 const f=app();f.dirty();f.open();f.environment.deletedTaskIds.current.add(f.candidate.taskId);f.release();await f.settle();expect(f.selected).toEqual([]);expect(f.calls).toEqual([]);
});
it('actual App guards delayed read, disable and workspace ABA, then opens only an unchanged saved task',async()=>{
 for(const retire of [(f:ReturnType<typeof app>)=>taskResumePreference.set(false),(f:ReturnType<typeof app>)=>{f.environment.surfaceIntentEpoch.current+=2;},(f:ReturnType<typeof app>)=>{f.environment.newQuestionEpoch.current++;}]){const f=app();let release!:()=>void;f.holdRead(new Promise<void>(resolve=>release=resolve));f.open();retire(f);release();await f.settle();expect(f.selected).toEqual([]);expect(f.calls).toEqual(['tasks.list']);}
 const f=app();f.open();await f.settle();expect(f.selected).toHaveLength(1);expect(f.selected[0].id).toBe(f.candidate.taskId);expect(f.calls).toEqual(['tasks.list']);
});
it('actual App re-reads after a new dirty form arrives during saved-state read',async()=>{
 const f=app();let release!:()=>void;f.holdRead(new Promise<void>(resolve=>release=resolve));f.open();f.dirty();release();await f.settle();expect(f.selected).toEqual([]);f.mutate(owner=>{owner.requests[0].status='failed';});f.release();await f.settle();expect(f.selected).toEqual([]);expect(f.calls).toEqual(['tasks.list','tasks.list']);
});
