import {afterEach,expect,it} from 'vitest';
import ts from 'typescript';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createCompanion} from '../src/core/companion';
import {isExportCommand} from '../src/shared/export-contract';
import {publicErrorMessage} from '../src/shared/public-messages';
import {TaskSourceContinuity} from '../src/renderer/src/components/TaskSourceContinuity';
import {continuityTask} from './task-source-continuity.fixture';
import type {Task} from '../src/core/types';
import type {Command,CompanionEvent} from '../src/shared/bridge';
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
function gate(){let enter!:()=>void,release!:()=>void;return {started:new Promise<void>(done=>enter=done),waiting:new Promise<void>(done=>release=done),enter:()=>enter(),release:()=>release()};}

/** Actual App handlers with substituted React delivery/bridge, real core/store and local summary. */
async function actualHandlers(environment:Record<string,unknown>){
 const source=await readFile(resolve('src/renderer/src/App.tsx'),'utf8'),file=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const app=file.statements.find((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&node.name?.text==='App');if(!app?.body)throw Error('Actual App is unavailable');
 const functions=['run','refresh','selectTask','retireContext'].map(name=>{const node=app.body!.statements.find((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&node.name?.text===name&&!!node.body);if(!node)throw Error('Actual handler missing '+name);return node.getText(file);});
 let subscriber:ts.ArrowFunction|undefined;
 function visit(node:ts.Node){if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.expression.getText(file)==='bridge'&&node.expression.name.text==='subscribe'&&ts.isArrowFunction(node.arguments[0]))subscriber=node.arguments[0];ts.forEachChild(node,visit);}visit(app);
 if(!subscriber)throw Error('Actual App subscriber unavailable');
 expect(source).toContain('<TaskSourceContinuity key={task.id} task={task}/><Conversation task={task}');
 const javascript=ts.transpileModule(functions.join('\n')+'\nconst event='+subscriber.getText(file)+';\nreturn {run,refresh,selectTask,event};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 return new Function(...Object.keys(environment),javascript)(...Object.values(environment)) as {run:(command:Command)=>Promise<unknown>;refresh:()=>Promise<void>;selectTask:(task:Task)=>void;event:(event:CompanionEvent)=>void};
}
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'continuity-app-')),core=await createCompanion({dataDir:directory});
 const a=await continuityTask(core,'Task A'),b=await continuityTask(core,'Task B',false);a.task=await core.pause(a.task.id);
 const resume=gate(),list=gate(),commands:Command[]=[];let holdList=false,dirty=false,held:(()=>void)|undefined;
 const state={task:a.task as Task|undefined,context:undefined as string|undefined,error:'',page:'work',list:[] as Task[]},taskRef={current:state.task},contextRef={current:undefined as string|undefined},incomingActivationEpoch={current:0},newQuestionEpoch={current:0};
 const bridge={invoke:async(command:Command)=>{
  commands.push(command);
  if(command.type==='tasks.resume'){const result=await core.resume(command.taskId);resume.enter();await resume.waiting;return result;}
  if(command.type==='tasks.list'){const all=await core.listTasks();if(holdList){holdList=false;list.enter();await list.waiting;}return all;}
  if(command.type==='context.cancel')return null;
  throw Error('Unexpected fixture command '+command.type);
 }};
 const noop=()=>{},handlers=await actualHandlers({bridge,taskRef,contextRef,incomingActivationEpoch,newQuestionEpoch,isExportCommand,publicErrorMessage,lock:{current:false},setBusy:noop,setError:(value:string)=>{state.error=value;},lastRunError:{current:''},setNotice:noop,requestRef:{current:undefined},arrivedRequests:{current:new Set()},drafts:{hydrate:noop},deletedTaskIds:{current:new Set()},taskListSnapshot:{current:{generation:0,tasks:[]}},setTasks:(tasks:Task[])=>{state.list=tasks;},setTask:(task:Task|undefined)=>{state.task=task;taskRef.current=task;},viewRestored:{current:true},viewSelectionEpoch:{current:0},setTasksHydrated:noop,setArrivalIdentities:noop,setStream:noop,setLocalStart:noop,setAddingBot:noop,setBasePage:noop,setPage:(page:string)=>{state.page=page;},contextStart:{current:undefined},setContext:(value:unknown)=>{if(value===undefined)state.context=undefined;},draftNavigation:{api:{guard:(action:()=>void)=>{if(dirty){held=action;return false;}action();return true;}}},beginContext:async(activation:{activationId:string})=>{contextRef.current=activation.activationId;state.context=activation.activationId;}});
 cleanups.push(async()=>{resume.release();list.release();await core.close();await rm(directory,{recursive:true,force:true});});
 return {core,a,b,handlers,state,commands,resume,list,holdList:()=>{holdList=true;},incomingActivationEpoch,setDirty:(value:boolean)=>{dirty=value;},keep:()=>{held=undefined;},leave:()=>{dirty=false;held?.();held=undefined;},html:()=>state.task?renderToStaticMarkup(createElement(TaskSourceContinuity,{task:state.task})):''};
}

it('actual Resume publishes refreshed selected-task data and the local source view without an additional command',async()=>{
 const f=await fixture(),before=await f.core.getTask(f.a.task.id),pending=f.handlers.run({type:'tasks.resume',taskId:f.a.task.id});await f.resume.started;f.resume.release();await pending;
 expect(f.state.task?.status).toBe('active');expect(f.html()).toContain('Task A procedure');expect(f.commands.map(command=>command.type)).toEqual(['tasks.resume','tasks.list']);expect((await f.core.getTask(f.a.task.id)).procedures).toEqual(before.procedures);
});

it('Keep editing cancels an actual guarded task change, and discard selects only the next task summary',async()=>{
 const f=await fixture();f.setDirty(true);f.handlers.selectTask(f.b.task);f.keep();expect(f.state.task?.id).toBe(f.a.task.id);expect(f.html()).toContain('Task A procedure');expect(f.commands).toEqual([]);
 f.handlers.selectTask(f.b.task);f.leave();expect(f.state.task?.id).toBe(f.b.task.id);expect(f.html()).toBe('');expect(f.state.page).toBe('work');
});

it('a late Resume reply cannot transplant its source summary over a newly selected task or newer saved result',async()=>{
 const f=await fixture(),pending=f.handlers.run({type:'tasks.resume',taskId:f.a.task.id});await f.resume.started;f.handlers.selectTask(f.b.task);
 const updated=await f.core.putSource(f.b.task.id,{id:f.b.ref.sourceId,kind:'text',role:'fact',label:'Task B revised',content:'PRIVATE_LATE_BODY'});await f.core.saveArtifact(updated.id,{title:'New B result',content:'Saved during held A resume',sourceRefs:[]});
 f.resume.release();await pending;expect(f.state.task?.id).toBe(f.b.task.id);expect(f.html()).toContain('Task B procedure');expect(f.html()).not.toContain('Task A');expect(f.state.task?.artifacts.at(-1)?.revisions[0].title).toBe('New B result');
});

it('an incoming context remains owned while a held Resume completes, with no context cancellation or source action',async()=>{
 const f=await fixture(),pending=f.handlers.run({type:'tasks.resume',taskId:f.a.task.id});await f.resume.started;f.handlers.event({type:'context.activate',activation:{activationId:'incoming-owned',tucked:false,ownerTaskId:f.a.task.id,choices:[]}});f.resume.release();await pending;
 expect(f.state.context).toBe('incoming-owned');expect(f.incomingActivationEpoch.current).toBe(1);expect(f.commands.map(command=>command.type)).toEqual(['tasks.resume','tasks.list']);expect(f.html()).not.toContain('PRIVATE_');
});

it('a delayed task-list refresh uses the current selection rather than the earlier task owner',async()=>{
 const f=await fixture();f.holdList();const pending=f.handlers.refresh();await f.list.started;f.handlers.selectTask(f.b.task);f.list.release();await pending;expect(f.state.task?.id).toBe(f.b.task.id);expect(f.html()).toBe('');expect(f.state.error).toBe('');
});
