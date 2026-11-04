import {afterEach,expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {sourceIntakeHostFixture} from './source-intake-host.fixture';
import {parseModuleAnswer} from '../src/core/interactive-modules';
import {workflowLab,type WorkflowAction} from '../src/learning/workflow-lab';
import {defaultWorkflowExperiment,type WorkflowExperiment} from '../src/learning/workflow-engine';
import {WorkflowEnginePanel} from '../src/renderer/src/components/WorkflowEnginePanel';
import {LearningDraftProvider,LearningDraftScope} from '../src/renderer/src/learning-draft-context';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {formSubmission} from '../src/renderer/src/draft-navigation';
import {workflowNavigationScopeCurrent} from '../src/renderer/src/workflow-source-navigation';
import {createControlledRenderer} from './controlled-renderer.fixture';
import type {Task} from '../src/core/types';
import type {Command} from '../src/shared/bridge';
const cleanups:Array<()=>void>=[];afterEach(()=>{for(const cleanup of cleanups.splice(0))cleanup();});
function gate(){let enter!:()=>void,release!:()=>void;return {started:new Promise<void>(r=>enter=r),wait:new Promise<void>(r=>release=r),enter:()=>enter(),release:()=>release()};}
const text=(node:any):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
async function actualModuleEdit(environment:Record<string,unknown>){
 const source=await readFile('src/renderer/src/App.tsx','utf8'),file=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let callback:string|undefined;
 function visit(node:ts.Node){if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(file)==='ModuleAnswerView')for(const attr of node.attributes.properties)if(ts.isJsxAttribute(attr)&&attr.name.getText(file)==='onEdit'&&attr.initializer&&ts.isJsxExpression(attr.initializer)&&attr.initializer.expression)callback=attr.initializer.expression.getText(file);ts.forEachChild(node,visit);}visit(file);if(!callback)throw Error('Actual captured module edit callback missing.');
 const js=ts.transpileModule('return '+callback+';',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;return new Function(...Object.keys(environment),js)(...Object.values(environment)) as (moduleId:string,action:import('../src/core/interactive-modules').ModuleAction)=>Promise<void>;
}
async function fixture(){
 const h=await sourceIntakeHostFixture(),created=await h.host.dispatch({type:'workflow.example',taskId:h.task.id,requestId:crypto.randomUUID()}) as {task:Task;artifactId:string},artifact=created.task.artifacts.find(a=>a.id===created.artifactId)!,module=parseModuleAnswer(JSON.parse(artifact.revisions[0].content)).modules[0],data=module.data;if(data.kind!=='workflow-lab')throw Error('Expected workflow');
 const target={taskId:h.task.id,artifactId:artifact.id,artifactRevision:1,moduleId:module.id};await h.host.dispatch({type:'module.edit',...target,action:{kind:'predict',finalStateId:'draft',blockedCount:1,reasoning:'Known sample',expectedRevision:0}});
 const exp:WorkflowExperiment={...defaultWorkflowExperiment(data.practice),properties:[{id:'det',kind:'deterministic'}],fixtures:[{id:'review-after-edit',label:'Review after edit',initialStateId:'draft',eventIds:['submit','approve','edit','approve'],expectedFinalStateId:'ready'}]};await h.host.dispatch({type:'module.edit',...target,action:{kind:'set-experiment',experiment:exp,expectedRevision:1}});
 let task=await h.core.getTask(h.task.id),state=workflowLab.parseState(data,task.session!.moduleStates.find(m=>m.moduleId===module.id)!.state),disabled=false,heldRaw:ReturnType<typeof gate>|undefined,heldReply:ReturnType<typeof gate>|undefined,presented=0;
 const taskRef={current:task},newQuestionEpoch={current:0},incomingActivationEpoch={current:0},workflowContinuation={current:{epoch:0}},surfaceIntentEpoch={current:0},surfaceModeRef={current:'workspace'},commands:Command[]=[],pending:Promise<unknown>[]=[];
 const environment={workflowNavigationScopeCurrent,task,item:artifact,revision:artifact.revisions[0],entryEpoch:0,entryActivationEpoch:0,entryWorkflowEpoch:0,entrySurfaceEpoch:0,entrySurface:'workspace',taskRef,newQuestionEpoch,incomingActivationEpoch,workflowContinuation,surfaceIntentEpoch,surfaceModeRef,bridge:{invoke:async(command:Command)=>{commands.push(command);const result=await h.host.dispatch(command);heldReply?.enter();await heldReply?.wait;return result;}},setTask:(next:Task)=>{presented++;task=next;taskRef.current=next;state=workflowLab.parseState(data,next.session!.moduleStates.find(m=>m.moduleId===module.id)!.state);}};
 const onEdit=await actualModuleEdit(environment);
 const store=new LearningDraftStore({directory:h.directory,lookupTask:id=>h.core.getTask(id)}),cache=createLearningDrafts({read:()=>store.read(),save:async(...args)=>{const held=heldRaw;if(held&&args[1].startsWith('workflow:engine:goal:')){heldRaw=undefined;held.enter();await held.wait;}return store.save(...args);}});await cache.load();
 const owner={taskId:h.task.id,artifactId:artifact.id,artifactRevision:1,artifactDigest:artifact.revisions[0].digest,moduleId:module.id,moduleVersion:module.version};
 const view=createControlledRenderer(()=>createElement(LearningDraftProvider,{cache,children:createElement(LearningDraftScope,{owner,children:createElement(WorkflowEnginePanel,{state,disabled,onAction:(action:WorkflowAction)=>{const expected=workflowLab.update(data,state,action),work=onEdit(module.id,action).then(()=>true,()=>false);pending.push(work);return formSubmission(expected,work);}})})}));
 const button=(label:string)=>view.find(node=>node.type==='button'&&text(node)===label),goal=()=>view.find(node=>node.type==='select'&&node.children.some(c=>text(c)==='Choose a saved check'));
 view.render();cleanups.push(()=>{heldRaw?.release();heldReply?.release();});
 return {h,view,cache,commands,owner,artifact,data,get state(){return state},get presented(){return presented},button,goal,choose(value='fixture:review-after-edit'){goal().props.onChange({target:{value}});view.render();},find(){view.find(node=>node.type==='form'&&node.children.some(c=>c.type==='button'&&text(c)==='Find a local candidate')).props.onSubmit({preventDefault(){}});view.render();},save(){button('Save reviewed local candidate').props.onClick();},holdRaw(){heldRaw=gate();return heldRaw;},holdReply(){heldReply=gate();return heldReply;},retire(kind:string){if(kind==='navigation')newQuestionEpoch.current++;else{surfaceIntentEpoch.current++;surfaceModeRef.current='companion';if(kind==='roundtrip'){surfaceIntentEpoch.current++;surfaceModeRef.current='workspace';}}view.render();},async settle(){await cache.flush().catch(()=>{});await vi.waitFor(()=>{view.render();expect(pending.length?true:cache.getSnapshot().entries).toBeTruthy();});await Promise.all(pending);await Promise.resolve();view.render();},disable(){disabled=true;view.render();}};
}
it('actual goal controls preview locally, then save through captured App→strict IPC→core with original rules intact',async()=>{
 const f=await fixture();f.choose();await f.cache.flush();f.find();expect(f.commands).toEqual([]);expect(text(f.view.find(n=>n.props['aria-label']==='Local repair preview'))).toContain('passed all saved checks');f.save();await vi.waitFor(()=>{f.view.render();expect(f.state.experiment!.variants).toHaveLength(1);});await f.settle();expect(f.commands).toHaveLength(1);expect(f.state.experiment!.variants[0].rules.find(r=>r.id==='ready-edit')!.toStateId).toBe('review');expect(f.state.practice).toEqual(f.data.practice);expect((await f.h.core.getTask(f.owner.taskId)).artifacts.find(a=>a.id===f.artifact.id)!.revisions[0]).toEqual(f.artifact.revisions[0]);expect(f.h.calls.transports).toBe(0);
});
it.each(['navigation','compact','roundtrip'])('a goal save held in raw flush is retired by %s before registered IPC',async kind=>{
 const f=await fixture(),held=f.holdRaw();f.choose();await held.started;f.find();f.save();f.retire(kind);held.release();await f.settle();expect(f.commands).toEqual([]);expect((await f.h.core.getTask(f.owner.taskId)).session!.moduleStates.find(m=>m.moduleId===f.owner.moduleId)!.state).toEqual(f.state);expect(f.state.experiment!.variants).toEqual([]);expect(f.presented).toBe(0);
});
it('a stale preview callback after raw goal changes cannot save the previous candidate',async()=>{
 const f=await fixture();f.choose();await f.cache.flush();f.find();const old=f.button('Save reviewed local candidate');f.choose('property:det');old.props.onClick();await f.settle();expect(f.commands).toEqual([]);expect(f.state.experiment!.variants).toEqual([]);
});
it('an already committed reply after surface retirement cannot overwrite the current task presentation',async()=>{
 const f=await fixture();f.choose();await f.cache.flush();f.find();const held=f.holdReply();f.save();await held.started;f.retire('roundtrip');held.release();await f.settle();expect(f.commands).toHaveLength(1);expect(f.presented).toBe(0);const raw=(await f.h.core.getTask(f.owner.taskId)).session!.moduleStates.find(m=>m.moduleId===f.owner.moduleId)!.state;expect(workflowLab.parseState(f.data,raw).experiment!.variants).toHaveLength(1);expect(f.state.experiment!.variants).toHaveLength(0);
});
it('the shared captured caller still admits a current non-workflow comparison edit from companion mode',async()=>{
 const h=await sourceIntakeHostFixture(),frame={id:'comparison',version:1,provenance:[],data:{kind:'comparison',schemaVersion:1,title:'Two choices',question:'Choose one',columns:['Value'],rows:[{id:'a',label:'A',values:['First']},{id:'b',label:'B',values:['Second']}]}},created=await h.core.runRequest({taskId:h.task.id,requestId:'companion-comparison',kind:'create',prompt:'Synthetic local comparison',sourceIds:[],expectedSourceRefs:[]},async()=>({title:'Comparison',content:JSON.stringify({schemaVersion:1,markdown:'Two choices.',modules:[frame]}),mimeType:'application/vnd.window-companion.modules+json'}));expect(created.status).toBe('completed');const task=await h.core.getTask(h.task.id),item=task.artifacts.find(a=>a.id===created.artifactId)!,revision=item.revisions[0];let presentations=0;
 const edit=await actualModuleEdit({workflowNavigationScopeCurrent,task,item,revision,entryEpoch:0,entryActivationEpoch:0,entryWorkflowEpoch:3,entrySurfaceEpoch:2,entrySurface:'companion',taskRef:{current:task},newQuestionEpoch:{current:0},incomingActivationEpoch:{current:0},workflowContinuation:{current:{epoch:3}},surfaceIntentEpoch:{current:2},surfaceModeRef:{current:'companion'},bridge:{invoke:(command:Command)=>h.host.dispatch(command)},setTask:()=>{presentations++;}});await edit(frame.id,{kind:'select',rowId:'b',expectedRevision:0});const owner=await h.core.getTask(task.id);expect(owner.session!.moduleStates.find(m=>m.moduleId===frame.id)!.state).toMatchObject({selectedRowId:'b',revision:1});expect(presentations).toBe(1);expect(h.calls.transports).toBe(0);
});
