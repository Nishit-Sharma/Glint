import {afterEach,expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {createControlledRenderer} from './controlled-renderer.fixture';
import {recordedTextFixture} from './recorded-text-helper.fixture';
import {createRecordedTextHelper,inspectRecordedTextHelper} from '../src/core/recorded-text-helper-host';
import {ModuleView} from '../src/renderer/src/components/InteractiveModule';
import {helperModule,initialModuleState,parseModuleAnswer} from '../src/core/interactive-modules';
import {semanticHelper} from '../src/learning/semantic-helper';
import {editModule} from '../src/core/module-state';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {LearningDraftProvider} from '../src/renderer/src/learning-draft-context';
import {DraftNavigationProvider,useDraftNavigation} from '../src/renderer/src/draft-navigation';
import {RecordedTextReview} from '../src/renderer/src/components/RecordedTextReview';

type R=ReturnType<typeof createControlledRenderer>;type Node=ReturnType<R['nodes']>[number];
const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
const cleanup:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const close of cleanup.splice(0))await close();vi.unstubAllGlobals();});
const button=(r:R,label:string)=>r.find(node=>node.type==='button'&&text(node)===label);
function click(r:R,label:string){const node=button(r,label);expect(node.props.disabled).not.toBe(true);node.props.onClick();r.render();}
function edit(r:R,label:string,value:string){r.find(node=>['input','textarea','select'].includes(node.type)&&node.props['aria-label']===label).props.onChange({currentTarget:{value},target:{value}});r.render();}
async function fixture(){
 const f=await recordedTextFixture();cleanup.push(f.close);let task=await f.core.getTask(f.owner.taskId),data=f.data,owner=f.owner,state=initialModuleState(data);const requests:unknown[]=[],pending:Promise<unknown>[]=[];
 const store=new LearningDraftStore({directory:f.directory,lookupTask:async id=>(await f.core.listTasks()).find(item=>item.id===id)}),makeCache=()=>createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});let cache=makeCache();await cache.load();
 vi.stubGlobal('window',{companion:{invoke(command:Record<string,unknown>){requests.push(command);const {type,...input}=command;const promise=type==='helper.recorded.inspect'?inspectRecordedTextHelper(f.core,input):type==='helper.recorded.create'?createRecordedTextHelper(f.core,input):Promise.reject(Error('Unexpected command'));pending.push(promise);return promise;}}});
 const action=async(action:unknown)=>{await editModule(f.core,{...owner,action:action as never});task=await f.core.getTask(owner.taskId);state=helperModule.parseState(task.session!.moduleStates.find(item=>item.artifactId===owner.artifactId)!.state);return true;};
 function Surface(){const navigation=useDraftNavigation();return createElement(DraftNavigationProvider,{value:navigation.api,children:[createElement(ModuleView,{key:owner.artifactId,data,state,task,draftOwner:owner,onAction:action=>{const p=actionHost(action);pending.push(p);return p;}}),navigation.review]});}const actionHost=action;
 const render=()=>createControlledRenderer(()=>createElement(LearningDraftProvider,{cache,children:createElement(Surface)}));
 async function settle(r:R){await cache.flush();await new Promise<void>(resolve=>setImmediate(resolve));await Promise.allSettled(pending.splice(0));await new Promise<void>(resolve=>setImmediate(resolve));r.render();}
 async function open(){task=await f.core.getTask(f.owner.taskId);const artifact=task.artifacts.at(-1)!,revision=artifact.revisions.at(-1)!,module=parseModuleAnswer(JSON.parse(revision.content)).modules[0];if(module.data.kind!=='helper-studio')throw Error();data=module.data;owner={taskId:task.id,artifactId:artifact.id,artifactRevision:revision.revision,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version};state=helperModule.parseState(task.session?.moduleStates.find(item=>item.artifactId===owner.artifactId)?.state??initialModuleState(data));}
 return {f,requests,store,get data(){return data;},get state(){return state;},render,settle,open,async restart(){await cache.flush();await f.reopen();cache=makeCache();await cache.load();await open();}};
}

test('existing text controls record actions, review exact proposal, explicitly create a separate helper and reopen raw staged edits',async()=>{
 const f=await fixture(),r=f.render();r.render();expect(button(r,'Review recorded text proposal').props.disabled).toBe(true);
 edit(r,'Demonstration input','  Private local demonstration  ');click(r,'Start demonstration');await f.settle(r);click(r,'Demonstrate operation');await f.settle(r);click(r,'Stop and use demonstration');await f.settle(r);
 const original=await f.f.read();expect(original.observations?.[0].steps).toHaveLength(1);expect(f.requests).toEqual([]);click(r,'Review recorded text proposal');await f.settle(r);expect(f.requests).toHaveLength(1);expect(r.nodes().some(node=>node.props['aria-label']==='Proposed recorded stages')).toBe(true);expect((await f.f.core.getTask(f.f.owner.taskId)).artifacts).toHaveLength(1);
 click(r,'Cancel proposal review');expect(r.nodes().some(node=>node.type==='button'&&text(node)==='Create separate inactive procedure')).toBe(false);click(r,'Review recorded text proposal');await f.settle(r);click(r,'Create separate inactive procedure');await f.settle(r);expect((await f.f.core.getTask(f.f.owner.taskId)).artifacts).toHaveLength(2);expect(await f.f.read()).toEqual(original);expect(r.nodes().some(node=>node.props.role==='status'&&text(node).includes('Separate inactive procedure saved in Files'))).toBe(true);
 await f.open();const target=f.render();target.render();expect(target.nodes().some(node=>node.type==='h3'&&text(node)==='Staged procedure helper')).toBe(true);expect(target.nodes().some(node=>node.type==='summary'&&text(node)==='Original recorded text actions')).toBe(true);expect(semanticHelper.parseState(f.data.id,f.state).activeVersion).toBeNull();expect(button(target,'Save checked procedure version').props.disabled).toBe(true);
 edit(target,'Stage 1 result text operation','replace-literal');edit(target,'Stage 1 result find','Dock');edit(target,'Stage 1 result replacement','Pier');await f.settle(target);expect(semanticHelper.parseState(f.data.id,f.state).definitions[0].procedure.root).toMatchObject({value:{operation:{kind:'trim'}}});
 await f.restart();const reopened=f.render();reopened.render();expect(reopened.find(node=>node.props['aria-label']==='Stage 1 result text operation').props.value).toBe('replace-literal');expect(reopened.find(node=>node.props['aria-label']==='Stage 1 result replacement').props.value).toBe('Pier');click(reopened,'Save revised staged procedure');await f.settle(reopened);expect(semanticHelper.parseState(f.data.id,f.state).definitions.at(-1)?.procedure.root).toMatchObject({value:{operation:{kind:'replace-literal',find:'Dock',replacement:'Pier'}}});expect(f.data.recordedText?.observation.steps[0].operation).toEqual({kind:'trim'});expect(await f.f.read()).toEqual(original);expect(f.requests.every(command=>(command as {type:string}).type.startsWith('helper.recorded.'))).toBe(true);
});

test('late proposal replies and captured stale callbacks cannot present or create against a changed helper',async()=>{
 const f=await recordedTextFixture();cleanup.push(f.close);const first=await f.record(),owner=f.owner;let state=first,release:(value:unknown)=>void=()=>{},sent=0;vi.stubGlobal('window',{companion:{invoke(){sent++;return new Promise(resolve=>{release=resolve;});}}});
 const r=createControlledRenderer(()=>createElement(RecordedTextReview,{data:f.data,state,pending:false,owner}));r.render();click(r,'Review recorded text proposal');const preview=await inspectRecordedTextHelper(f.core,await f.request());state=await f.act({kind:'set-details',name:'Changed',description:'Changed',invocation:'Changed'});r.render();release(preview);await new Promise<void>(resolve=>setImmediate(resolve));r.render();expect(r.nodes().some(node=>node.type==='button'&&text(node)==='Create separate inactive procedure')).toBe(false);expect(sent).toBe(1);
 // A captured earlier inspection handler must not send after the owner revision moves.
 const handler=button(r,'Review recorded text proposal').props.onClick;state=await f.act({kind:'set-details',name:'Again',description:'Again',invocation:'Again'});r.render();handler();expect(sent).toBe(1);
});
