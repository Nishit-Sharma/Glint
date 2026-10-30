import {expect,it,vi,afterEach} from 'vitest';
vi.mock('react',async original=>{const fixture=await import('./controlled-renderer.fixture');return {...await original<typeof import('react')>(),...fixture.hooks};});
vi.mock('lucide-react',()=>({ArrowUpRight:()=>null}));
import {createElement} from 'react';
import type {Task} from '../src/core/types';
import {emptyTaskSession} from '../src/core/task-session';
import {publicErrorMessage} from '../src/shared/public-messages';
import {BrowserActivity} from '../src/renderer/src/components/BrowserTask';
import {createControlledRenderer} from './controlled-renderer.fixture';

afterEach(()=>vi.unstubAllGlobals());
const cases=[
 ['The task changed while this outcome was being reviewed. Check the action and inspect again if needed.','The task changed during review. Check the action’s current status and inspect again if needed.'],
 ['This action changed while its outcome was being reviewed. Inspect again.','This action changed during review. Inspect its outcome again.'],
 ['The inspected page did not match the selected website. Inspect again.','The inspected page did not match the selected website. Choose the page and inspect again.'],
] as const;
const wrap=(raw:string)=>`Error invoking remote method 'companion:command': Error: ${raw}`;
const text=(node:any):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');

it.each(cases)('shows actionable inspection recovery through the actual renderer boundary: %s',async(raw,expected)=>{
 const observation={id:'before',taskId:'task',browserId:'browser',documentId:'document',url:'https://owned.invalid/form',title:'Form',text:'Form',digest:'digest',targets:[]};
 const task:Task={id:'task',title:'Owned',goal:'',status:'active',createdAt:'time',updatedAt:'time',sources:[],artifacts:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false},requests:[{id:'run',kind:'browser',prompt:'Save once',digest:'request',sourceRefs:[],startedAt:'time',status:'failed'}],session:{...emptyTaskSession(),runs:[{id:'run',endpointKey:'fixture',origin:'https://owned.invalid',browserId:'browser',initialObservation:observation,operations:[{id:'action',intent:{kind:'click',snapshotId:'before',targetId:'save'},reason:'Save once',status:'uncertain'}]}]}};
 const before=structuredClone(task),inspect=vi.fn(async()=>{throw Error(wrap(raw));}),stop=vi.fn();vi.stubGlobal('FormData',class {get(){return 'https://owned.invalid/receipt';}});
 const r=createControlledRenderer(()=>createElement(BrowserActivity,{task,requestId:'run',onInspect:inspect,onStop:stop}));r.render();r.find(node=>node.type==='form').props.onSubmit({preventDefault(){},currentTarget:{}});
 await vi.waitFor(()=>{r.render();expect(text(r.find(node=>node.props.role==='alert'))).toBe(expected);});expect(inspect).toHaveBeenCalledTimes(1);expect(stop).not.toHaveBeenCalled();expect(task).toEqual(before);expect(publicErrorMessage(expected)).toBe(expected);
 for(const value of [raw+' PRIVATE_DIAGNOSTIC',wrap(raw+' PRIVATE_DIAGNOSTIC')]){const mapped=publicErrorMessage(value);expect(mapped).not.toBe(expected);expect(mapped).not.toContain('PRIVATE_DIAGNOSTIC');}
});
