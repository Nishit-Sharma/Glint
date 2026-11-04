import {afterEach,beforeEach,expect,test,vi} from 'vitest';
const probe=vi.hoisted(()=>({showModal:vi.fn(),close:vi.fn(),focus:vi.fn(),effects:[] as Array<{cleanup:()=>void;setup:()=>void}>}));
vi.mock('react',async original=>{const fixture=await import('../support/controlled-renderer.fixture');return {...await original<typeof import('react')>(),...fixture.hooks,useRef(initial:unknown){const ref=fixture.hooks.useRef(initial) as {current:unknown};if(initial===null&&ref.current===null)ref.current=probe;return ref;},useEffect(fn:()=>void|(()=>void),deps:readonly unknown[]){fixture.hooks.useEffect(()=>{let cleanup=fn();if(typeof cleanup==='function')cleanup();cleanup=fn();const lifetime={cleanup:()=>{if(typeof cleanup==='function')cleanup();},setup:()=>{cleanup=fn();}};probe.effects.push(lifetime);return lifetime.cleanup;},deps);}};});
import {createElement} from 'react';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCompanion} from '../../src/core/companion';
import type {Task} from '../../src/core/types';
import type {LocalTaskStartInput,LocalTaskStartResult} from '../../src/shared/local-task-start';
import {responseBranchSnapshot} from '../../src/core/response-branch';
import {ResponseBranchReview} from '../../src/renderer/src/components/ResponseBranchReview';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';

const task:Task={id:'original-task',title:'Original task',goal:'',status:'active',createdAt:'2026-10-29',updatedAt:'2026-10-29',sources:[],artifacts:[],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}},snapshot={content:'Exact reviewed conversation text',omissions:['No browser authority copied.'],turns:1},result:LocalTaskStartResult={kind:'text',sourceId:'saved-source',task:{...task,id:'new-branch'}};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
async function settle(){for(let i=0;i<5;i++)await Promise.resolve();}
function mount(send:(input:Readonly<LocalTaskStartInput>)=>Promise<LocalTaskStartResult|undefined>,onCreated=vi.fn(),isCurrent=()=>true,value={task,snapshot}){const r=createControlledRenderer(()=>createElement(ResponseBranchReview,{...value,onCreate:send,onCreated,isCurrent,onClose:()=>{}}));r.render();const effect=probe.effects.at(-1)!;return {r,onCreated,effect,submit:async()=>{r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await settle();r.render();},retry:async()=>{r.find(node=>node.type==='button'&&node.children.some(child=>child.type==='#text'&&child.props.text==='Check this task')).props.onClick();await settle();r.render();}};}
beforeEach(()=>{probe.effects=[];probe.showModal.mockClear();probe.close.mockClear();probe.focus.mockClear();class Element{isConnected=true;focus=vi.fn();}vi.stubGlobal('HTMLElement',Element);vi.stubGlobal('document',{activeElement:new Element()});});
afterEach(()=>{for(const effect of probe.effects)effect.cleanup();vi.unstubAllGlobals();});

test('StrictMode setup-cleanup-setup keeps the reviewed form usable and preserves lost-ack recovery',async()=>{
 const send=vi.fn<(input:Readonly<LocalTaskStartInput>)=>Promise<LocalTaskStartResult|undefined>>().mockResolvedValue(undefined),m=mount(send);expect(probe.showModal).toHaveBeenCalledTimes(2);expect(probe.close).toHaveBeenCalledTimes(1);await m.submit();expect(send).toHaveBeenCalledTimes(1);expect(m.r.find(node=>node.props.role==='alert')).toBeDefined();expect(m.onCreated).not.toHaveBeenCalled();
});
test('effect replay during an in-flight save retains one frozen attempt and one completion',async()=>{
 const response=deferred<LocalTaskStartResult|undefined>(),send=vi.fn((_input:Readonly<LocalTaskStartInput>)=>response.promise),m=mount(send);await m.submit();expect(send).toHaveBeenCalledTimes(1);const input=send.mock.calls[0][0];m.effect.cleanup();m.effect.setup();await m.submit();expect(send).toHaveBeenCalledTimes(1);expect(Object.isFrozen(input)).toBe(true);response.resolve(result);await settle();m.r.render();expect(m.onCreated).toHaveBeenCalledTimes(1);expect(m.onCreated).toHaveBeenCalledWith(result);
});
test('a true unmount suppresses a late completion and prevents further submissions',async()=>{
 const response=deferred<LocalTaskStartResult|undefined>(),send=vi.fn((_input:Readonly<LocalTaskStartInput>)=>response.promise),m=mount(send);await m.submit();m.effect.cleanup();response.resolve(result);await settle();expect(m.onCreated).not.toHaveBeenCalled();await m.submit();expect(send).toHaveBeenCalledTimes(1);
});
test('owner change suppresses a late completion and a stale review cannot submit',async()=>{
 let current=true;const response=deferred<LocalTaskStartResult|undefined>(),send=vi.fn((_input:Readonly<LocalTaskStartInput>)=>response.promise),m=mount(send,vi.fn(),()=>current);await m.submit();current=false;response.resolve(result);await settle();m.r.render();expect(m.onCreated).not.toHaveBeenCalled();await m.submit();expect(send).toHaveBeenCalledTimes(1);
});
test('loss followed by effect replay retries the identical frozen request without duplicate sends',async()=>{
 const send=vi.fn<(input:Readonly<LocalTaskStartInput>)=>Promise<LocalTaskStartResult|undefined>>().mockResolvedValueOnce(undefined).mockResolvedValueOnce(result),m=mount(send);await m.submit();const first=send.mock.calls[0][0];m.effect.cleanup();m.effect.setup();await m.submit();expect(send).toHaveBeenCalledTimes(1);await m.retry();expect(send).toHaveBeenCalledTimes(2);expect(send.mock.calls[1][0]).toBe(first);expect(m.onCreated).toHaveBeenCalledTimes(1);await m.submit();expect(send).toHaveBeenCalledTimes(2);
});
test('a reopened review checks the same durable branch after a committed lost acknowledgement',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'branch-review-remount-')),core=await createCompanion({dataDir:directory});try{const original=await core.createTask({title:'Original work'});await core.runRequest({taskId:original.id,requestId:'saved-answer',kind:'explain',prompt:'Saved user question'},async()=>({title:'Saved answer',content:'Exact saved reply',mimeType:'text/markdown'}));const owner=await core.getTask(original.id),selection={taskId:owner.id,requestId:'saved-answer',answer:owner.requests[0].answer!},preview=responseBranchSnapshot(owner,selection),commands:unknown[]=[];let lose=true;const send=async(input:Readonly<LocalTaskStartInput>)=>{const command={...selection,title:input.title!,expectedSnapshot:input.content};commands.push(command);const saved=await core.branchFromResponse(command,'owned-default');if(lose){lose=false;return undefined;}return saved;};const first=mount(send,vi.fn(),()=>true,{task:owner,snapshot:preview});await first.submit();await vi.waitFor(async()=>expect(await core.listTasks()).toHaveLength(2));await settle();expect(first.onCreated).not.toHaveBeenCalled();first.effect.cleanup();const reopened=mount(send,vi.fn(),()=>true,{task:owner,snapshot:preview});expect(commands).toHaveLength(1);await reopened.submit();await vi.waitFor(()=>expect(reopened.onCreated).toHaveBeenCalledTimes(1));expect(commands).toHaveLength(2);expect(commands[1]).toEqual(commands[0]);expect(await core.listTasks()).toHaveLength(2);expect(await core.getTask(owner.id)).toEqual(owner);const saved=reopened.onCreated.mock.calls[0][0] as LocalTaskStartResult;expect(saved.task.sources[0].versions[0].content).toBe(preview.content);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
