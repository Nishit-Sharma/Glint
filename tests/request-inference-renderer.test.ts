import {afterEach,expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {createControlledRenderer} from './controlled-renderer.fixture';
import {emptyTaskSession} from '../src/core/task-session';
import {RequestInferenceSettings} from '../src/renderer/src/components/RequestInferenceSettings';
import {RequestContext} from '../src/renderer/src/components/RequestContext';
import type {Task} from '../src/core/types';
import type {Command} from '../src/shared/bridge';
const base:Task={id:'owner',title:'Owner',goal:'',status:'active',createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z',sources:[],artifacts:[],requests:[],checkpoints:[],procedures:[],actions:[],memory:{enabled:false},session:emptyTaskSession()};
const catalog={kind:'available',defaultSelection:{provider:'codex',model:'luna',effort:'medium',tier:'default'},models:[{id:'luna',label:'Luna',efforts:['medium'],tiers:[{id:'default',label:'Standard'}],initialEffort:'medium',initialTier:'default'},{id:'alternate',label:'Alternate',efforts:['low','high'],tiers:[{id:'default',label:'Standard'},{id:'priority',label:'Fast'}],initialEffort:'high',initialTier:'default'}]};
afterEach(()=>vi.unstubAllGlobals());
async function settle(renderer:ReturnType<typeof createControlledRenderer>){await Promise.resolve();await Promise.resolve();renderer.render();}
it('loads metadata only on demand, locks rapid changes and ignores a confirmation after task retargeting',async()=>{
 const calls:Command[]=[];let complete:(value:unknown)=>void=()=>{};vi.stubGlobal('window',{companion:{invoke:async(command:Command)=>{calls.push(command);if(command.type==='inference.catalog')return catalog;if(command.type==='inference.select')return new Promise(resolve=>{complete=resolve;});throw Error('Unexpected command');}}});
 let task=base;const renderer=createControlledRenderer(()=>createElement(RequestInferenceSettings,{task}));renderer.render();expect(calls).toEqual([]);renderer.find(node=>node.type==='details'&&node.props.className==='request-inference').props.onToggle({currentTarget:{open:true}});await settle(renderer);
 renderer.find(node=>node.type==='select'&&node.props['aria-label']==='Request model').props.onChange({target:{value:'alternate'}});renderer.find(node=>node.type==='select'&&node.props['aria-label']==='Request model').props.onChange({target:{value:'luna'}});expect(calls.filter(command=>command.type==='inference.select')).toEqual([{type:'inference.select',taskId:'owner',expectedRevision:0,selection:{provider:'codex',model:'alternate',effort:'high',tier:'default'}}]);
 task={...base,id:'another-owner'};renderer.render();complete({taskId:'owner',revision:1,selection:{provider:'codex',model:'alternate',effort:'high',tier:'default'}});await settle(renderer);expect(renderer.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join(' ')).not.toContain('Saved for this task');
});
it('keeps unavailable saved choices visible and hides controls outside ordinary text requests',async()=>{
 const choice={provider:'codex' as const,model:'retired',effort:'ultra',tier:'priority' as const},task={...base,session:{...emptyTaskSession(),requestInference:{revision:3,selection:choice}}};vi.stubGlobal('window',{companion:{invoke:async()=>catalog}});const renderer=createControlledRenderer(()=>createElement(RequestInferenceSettings,{task}));renderer.render();renderer.find(node=>node.type==='details'&&node.props.className==='request-inference').props.onToggle({currentTarget:{open:true}});await settle(renderer);expect(renderer.find(node=>node.type==='select'&&node.props['aria-label']==='Request model').props.value).toBe('retired');expect(renderer.nodes().some(node=>node.type==='p'&&node.props.role==='alert')).toBe(true);
 for(const kind of ['experiment','procedure'] as const){const outside=createControlledRenderer(()=>createElement(RequestContext,{task,kind}));outside.render();expect(outside.nodes().some(node=>node.props.className==='request-inference')).toBe(false);}const browser=createControlledRenderer(()=>createElement(RequestContext,{task:{...task,session:{...task.session,browserContext:{origin:'https://owned.invalid',url:'https://owned.invalid',requestId:'browser'}}}}));browser.render();expect(browser.nodes()).toEqual([]);
});
it('shows the authoritative committed task choice after a lost save acknowledgment without claiming success',async()=>{
 let rejectSave:(error:Error)=>void=()=>{};vi.stubGlobal('window',{companion:{invoke:async(command:Command)=>command.type==='inference.catalog'?catalog:new Promise((_resolve,reject)=>{rejectSave=reject;})}});
 let task=base;const renderer=createControlledRenderer(()=>createElement(RequestInferenceSettings,{task}));renderer.render();renderer.find(node=>node.type==='details'&&node.props.className==='request-inference').props.onToggle({currentTarget:{open:true}});await settle(renderer);renderer.find(node=>node.type==='select'&&node.props['aria-label']==='Request model').props.onChange({target:{value:'alternate'}});
 task={...base,session:{...emptyTaskSession(),requestInference:{revision:1,selection:{provider:'codex',model:'alternate',effort:'high',tier:'default'}}}};renderer.render();rejectSave(Error('Synthetic acknowledgment lost after commit'));await settle(renderer);await settle(renderer);
 expect(renderer.find(node=>node.type==='select'&&node.props['aria-label']==='Request model').props.value).toBe('alternate');expect(renderer.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join(' ')).toContain('not confirmed');
});

it('inspect completion keeps its same-revision wire preview visible until task connection context changes',async()=>{
 vi.stubGlobal('window',{companion:{invoke:async(command:Command)=>command.type==='inference.catalog'?catalog:{taskId:base.id,revision:0,selection:catalog.defaultSelection,wire:{thread:{model:'luna',serviceTier:'default',allowProviderModelFallback:false,config:{model_reasoning_effort:'medium'}},turn:{model:'luna',effort:'medium',serviceTierForTurn:'default'}}}}});
 let connectionKey='codex';const renderer=createControlledRenderer(()=>createElement(RequestInferenceSettings,{task:base,connectionKey}));renderer.render();renderer.find(node=>node.type==='details'&&node.props.className==='request-inference').props.onToggle({currentTarget:{open:true}});await settle(renderer);renderer.find(node=>node.type==='button'&&node.children.some(child=>child.type==='#text'&&child.props.text==='Inspect next request settings')).props.onClick();renderer.render();await settle(renderer);await settle(renderer);
 expect(renderer.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join(' ')).toContain('Outgoing settings · nothing sent');expect(renderer.nodes().some(node=>node.type==='pre')).toBe(true);
 connectionKey='meta';renderer.render();expect(renderer.nodes().some(node=>node.type==='pre')).toBe(false);
});

it('saves Auto without replacing Fixed and inspects the actual unsent message again after edits',async()=>{
 const fixed={provider:'codex' as const,model:'alternate',effort:'high',tier:'default' as const},calls:Command[]=[];
 let revision=4;vi.stubGlobal('window',{companion:{invoke:async(command:Command)=>{
  calls.push(command);if(command.type==='inference.catalog')return catalog;
  if(command.type==='inference.select')return {taskId:base.id,revision:++revision,selection:command.selection,...(command.policy?{policy:command.policy}:{})};
  if(command.type==='inference.preview')return {taskId:base.id,revision,prompt:command.prompt,kind:command.kind,selection:catalog.defaultSelection,decision:{policy:'automatic',rule:'routine',reason:'Short question under local policy.'},wire:{thread:{model:'luna',serviceTier:'default',config:{model_reasoning_effort:'medium'}},turn:{model:'luna',effort:'medium',serviceTierForTurn:'default'}}};
  throw Error('Unexpected command');
 }}});
 let prompt='Say hello.',kind:'explain'|'create'='explain';const task={...base,session:{...emptyTaskSession(),requestInference:{revision:4,selection:fixed}}};
 const renderer=createControlledRenderer(()=>createElement(RequestInferenceSettings,{task,prompt,kind}));renderer.render();renderer.find(node=>node.type==='details'&&node.props.className==='request-inference').props.onToggle({currentTarget:{open:true}});await settle(renderer);
 renderer.find(node=>node.type==='select'&&node.props['aria-label']==='Request model routing').props.onChange({target:{value:'automatic'}});await settle(renderer);
 expect(calls.filter(command=>command.type==='inference.select')).toEqual([{type:'inference.select',taskId:base.id,expectedRevision:4,selection:fixed,policy:'automatic'}]);
 const inspect=()=>renderer.find(node=>node.type==='button'&&node.children.some(child=>child.type==='#text'&&child.props.text==='Inspect next request settings')).props.onClick();
 inspect();await settle(renderer);expect(renderer.nodes().some(node=>node.type==='pre')).toBe(true);
 prompt='Compare these designs.';kind='create';renderer.render();expect(renderer.nodes().some(node=>node.type==='pre')).toBe(false);inspect();await settle(renderer);
 expect(calls.filter(command=>command.type==='inference.preview')).toEqual([{type:'inference.preview',taskId:base.id,prompt:'Say hello.',kind:'explain'},{type:'inference.preview',taskId:base.id,prompt:'Compare these designs.',kind:'create'}]);
 renderer.find(node=>node.type==='select'&&node.props['aria-label']==='Request model routing').props.onChange({target:{value:'fixed'}});await settle(renderer);
 expect(renderer.find(node=>node.type==='select'&&node.props['aria-label']==='Request model').props.value).toBe('alternate');
 expect(calls.some(command=>command.type==='model.run')).toBe(false);
});
