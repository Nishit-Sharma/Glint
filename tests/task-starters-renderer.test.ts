import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {createControlledRenderer} from './controlled-renderer.fixture';
import {TaskStarters} from '../src/renderer/src/components/TaskStarters';
import {getTaskStarters,type SuggestedTaskInput,type SuggestedTaskResult} from '../src/shared/task-starters';
import type {Task} from '../src/core/types';
const task:Task={id:'new-task',title:'Started',goal:'Saved goal',status:'active',createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z',sources:[],artifacts:[],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
function button(renderer:ReturnType<typeof createControlledRenderer>,label:string){const text=(node:ReturnType<typeof renderer.nodes>[number]):string=>node.type==='#text'?String(node.props.text):node.children.map(text).join('');return renderer.find(node=>node.type==='button'&&text(node)===label);}
function starterButton(renderer:ReturnType<typeof createControlledRenderer>,title:string){const text=(node:ReturnType<typeof renderer.nodes>[number]):string=>node.type==='#text'?String(node.props.text):node.children.map(text).join('');return renderer.find(node=>node.type==='button'&&node.props.className==='task-starter'&&node.children.some(child=>child.type==='strong'&&text(child)===title));}
async function settle(renderer:ReturnType<typeof createControlledRenderer>){for(let i=0;i<10;i++){await Promise.resolve();renderer.render();}}
test('actual review Cancel makes no command; Create uses the exact reviewed starter and rapid clicks navigate only once',async()=>{
 const starter=getTaskStarters()[0],reply=deferred<SuggestedTaskResult|undefined>(),onCreate=vi.fn((_input:Readonly<SuggestedTaskInput>)=>reply.promise),onCreated=vi.fn();const renderer=createControlledRenderer(()=>createElement(TaskStarters,{originTaskId:'original',disabled:false,isCurrent:()=>true,onCreate,onCreated}));renderer.render();starterButton(renderer,starter.title).props.onClick();renderer.render();expect(renderer.find(node=>node.type==='textarea'&&node.props.value===starter.prompt).props.readOnly).toBe(true);button(renderer,'Cancel').props.onClick();renderer.render();expect(onCreate).not.toHaveBeenCalled();
 starterButton(renderer,starter.title).props.onClick();renderer.render();const create=button(renderer,'Start or open task');expect(create.props.type).toBe('button');expect(create.props.disabled).toBe(false);create.props.onClick();create.props.onClick();expect(onCreate).toHaveBeenCalledTimes(1);expect(onCreate.mock.calls[0][0]).toEqual({originTaskId:'original',starter:starter.reference});reply.resolve({task,created:true});await settle(renderer);expect(onCreated).toHaveBeenCalledTimes(1);expect(onCreated.mock.calls[0][0]).toEqual({task,created:true});
});
test('uncertain completion retries the same immutable input and a late result cannot navigate a retired owner',async()=>{
 const starter=getTaskStarters()[1],reply=deferred<SuggestedTaskResult|undefined>(),onCreate=vi.fn<(input:Readonly<SuggestedTaskInput>)=>Promise<SuggestedTaskResult|undefined>>().mockResolvedValueOnce(undefined).mockImplementationOnce(()=>reply.promise),onCreated=vi.fn();let current=true;const renderer=createControlledRenderer(()=>createElement(TaskStarters,{originTaskId:'original',disabled:false,isCurrent:()=>current,onCreate,onCreated}));renderer.render();starterButton(renderer,starter.title).props.onClick();renderer.render();button(renderer,'Start or open task').props.onClick();await settle(renderer);expect(button(renderer,'Check same starter task').props.disabled).toBe(false);button(renderer,'Check same starter task').props.onClick();expect(onCreate).toHaveBeenCalledTimes(2);expect(onCreate.mock.calls[1][0]).toBe(onCreate.mock.calls[0][0]);expect(Object.isFrozen(onCreate.mock.calls[0][0])).toBe(true);expect(Object.isFrozen(onCreate.mock.calls[0][0].starter)).toBe(true);current=false;reply.resolve({task,created:false});await settle(renderer);expect(onCreated).not.toHaveBeenCalled();
});
test('each starter is one whole label: its title names the button and its description is separate',()=>{
 const renderer=createControlledRenderer(()=>createElement(TaskStarters,{originTaskId:null,disabled:false,isCurrent:()=>true,onCreate:async()=>undefined,onCreated:()=>{}}));renderer.render();
 const text=(node:ReturnType<typeof renderer.nodes>[number]):string=>node.type==='#text'?String(node.props.text):node.children.map(text).join('');
 const cards=renderer.nodes().filter(node=>node.type==='button'&&node.props.className==='task-starter');expect(cards).toHaveLength(getTaskStarters().length);
 for(const [index,starter] of getTaskStarters().entries()){const card=cards[index],title=card.children.find(child=>child.type==='strong')!,description=card.children.find(child=>child.type==='small')!;expect(text(title)).toBe(starter.title);expect(text(description)).toBe(starter.description);expect(card.props['aria-labelledby']).toBe(title.props.id);expect(card.props['aria-describedby']).toBe(description.props.id);expect(text(card)).toBe(starter.title+starter.description);}
});
test('choosing a starter puts its review heading in focus order as the landing point',()=>{
 const renderer=createControlledRenderer(()=>createElement(TaskStarters,{originTaskId:null,disabled:false,isCurrent:()=>true,onCreate:async()=>undefined,onCreated:()=>{}}));renderer.render();
 const starter=getTaskStarters()[0];starterButton(renderer,starter.title).props.onClick();renderer.render();
 const heading=renderer.find(node=>node.type==='h4');expect(heading.props.tabIndex).toBe(-1);expect(heading.props.ref).toBeDefined();
 button(renderer,'Cancel').props.onClick();renderer.render();expect(starterButton(renderer,starter.title).props['data-starter']).toBe(starter.reference.id);
});
