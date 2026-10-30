import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>{const fixture=await import('./controlled-renderer.fixture');return {...await original<typeof import('react')>(),...fixture.hooks};});
vi.mock('lucide-react',()=>({ArrowUpRight:()=>null}));
import {createElement} from 'react';
import type {Task} from '../src/core/types';
import {publicErrorMessage} from '../src/shared/public-messages';
import {Conversation} from '../src/renderer/src/components/Conversation';
import {createControlledRenderer} from './controlled-renderer.fixture';

const messages=[
 ['Choice lists in open shadow roots cannot be observed safely yet. Choose another page.','This page’s dropdown cannot be read safely yet. Choose another page.'],
 ['This page uses deferred rendering that cannot be observed safely. Choose a narrower page.','This page renders content in a way Companion cannot safely read yet. Choose a narrower page.'],
 ['This choice list exceeds the observation limit; choose a narrower page.','This dropdown is too large to read safely. Choose a narrower page.'],
 ['This page exceeds the observation limit; choose a narrower page.','This page is too large to read safely. Choose a narrower page.'],
 ['This page exceeds the combined observation limit; choose a narrower page.','This page is too large to read safely. Choose a narrower page.'],
 ['Too many page controls; choose a narrower page.','This page is too large to read safely. Choose a narrower page.'],
 ['This task and page exceed the browser planning limit. Save a checkpoint or choose a narrower page.','This task and page are too large to read together. Choose a narrower page.'],
] as const;
const wrapped=(message:string)=>`Error invoking remote method 'companion:command': Error: ${message}`;
const privateSuffix=' PRIVATE_DIAGNOSTIC /Users/private/page.html';
// Same three-frame format as the retained owned Chromium shadow-select failure; paths are synthetic.
const evaluation=(method:'page'|'elementHandle',message:string)=>`${method}.evaluate: Error: ${message}\n    at browserPageState (eval at evaluate (/Users/private/PRIVATE_DIAGNOSTIC.ts:303:30), <anonymous>:5:45)\n    at UtilityScript.evaluate (<anonymous>:305:16)\n    at UtilityScript.<anonymous> (<anonymous>:1:44)`;

test.each(messages)('exact static recovery survives normal and wrapped formatting: %s',(raw,expected)=>{
 for(const value of [raw,new Error(raw),wrapped(raw),evaluation('page',raw),new Error(evaluation('page',raw)),wrapped(evaluation('page',raw)),evaluation('elementHandle',raw),wrapped(evaluation('elementHandle',raw)),expected,wrapped(expected),publicErrorMessage(raw)])expect(publicErrorMessage(value)).toBe(expected);
 for(const value of [raw+privateSuffix,wrapped(raw+privateSuffix),evaluation('page',raw+privateSuffix),wrapped(evaluation('elementHandle',raw+privateSuffix)),evaluation('page',raw)+'\n'+privateSuffix,expected+privateSuffix,wrapped(expected+privateSuffix)]){const text=publicErrorMessage(value);expect(text).not.toBe(expected);expect(text).not.toContain('PRIVATE_DIAGNOSTIC');expect(text).not.toContain('/Users/private');}
});

test.each(messages)('actual conversation error shows the safe recovery without dispatching work: %s',(raw,expected)=>{
 for(const [error,wanted] of [[raw,expected],[wrapped(raw),expected],[evaluation('page',raw),expected],[wrapped(evaluation('elementHandle',raw)),expected],[raw+privateSuffix,'This action could not be completed. Review the task before continuing.'],[evaluation('page',raw+privateSuffix),'This action could not be completed. Review the task before continuing.']] as const){
  const task:Task={id:'owned',title:'Owned browser task',goal:'',status:'active',createdAt:'time',updatedAt:'time',sources:[],artifacts:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false},requests:[{id:'browser-request',kind:'browser',prompt:'Read the selected page.',digest:'request-digest',sourceRefs:[],startedAt:'time',status:'failed',error}]},before=structuredClone(task),onConnection=vi.fn(),onArtifact=vi.fn();
  const r=createControlledRenderer(()=>createElement(Conversation,{task,active:true,renderBrief:()=>null,onArtifact,onConnection}));r.render();const alert=r.find(node=>node.type==='p'&&node.props.role==='alert'),text=alert.children.filter(node=>node.type==='#text').map(node=>node.props.text).join('');expect(text).toBe(wanted);expect(text).not.toContain('PRIVATE_DIAGNOSTIC');expect(text).not.toContain('/Users/private');expect(r.nodes().filter(node=>node.type==='button')).toEqual([]);expect(onConnection).not.toHaveBeenCalled();expect(onArtifact).not.toHaveBeenCalled();expect(task).toEqual(before);
 }
});

test('nearby or arbitrary failures do not gain the static recovery copy',()=>{
 for(const raw of ['Choice lists in private roots cannot be observed safely yet. Choose another page.','This page uses deferred rendering '+privateSuffix,'Observation limit '+privateSuffix,'This task and page exceed the browser planning limit. '+privateSuffix,'page.textContent: Error: '+messages[0][0],evaluation('page','Choice lists in private roots cannot be observed safely yet. Choose another page.'),evaluation('page',messages[0][0])+'\nnot a stack frame'])expect(publicErrorMessage(raw)).toBe('This action could not be completed. Review the task before continuing.');
});
