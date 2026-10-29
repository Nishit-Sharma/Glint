import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {createControlledRenderer} from './controlled-renderer.fixture';
import {SignalSequentialPractice} from '../src/renderer/src/components/SignalSequentialPractice';
import type {Run} from '../src/renderer/src/ui';
type Host=ReturnType<ReturnType<typeof createControlledRenderer>['nodes']>[number];
const text=(node:Host):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
const input={taskId:'task',basis:{artifactId:'basis',revision:1,digest:'digest'},expectedSourceRefs:[{sourceId:'source',version:1,digest:'digest'}],sourceId:'source',start:0,end:7,quote:'q <= d;',confirmed:true as const};
async function flush(){for(let i=0;i<8;i++)await new Promise(resolve=>setTimeout(resolve,0));}
const button=(r:ReturnType<typeof createControlledRenderer>,name:string)=>r.find(n=>n.type==='button'&&text(n)===name);
test('does not reveal feedback before an answer; lost reply locks it until the saved result is checked',async()=>{
 let inspect=0,opened=0;const commands:any[]=[];const run=(async(command:any)=>{commands.push(command);if(command.type==='signal.practice.inspect')return ++inspect===1?{kind:'not-started'}:{kind:'completed',artifactId:'saved',revision:1};if(command.type==='signal.practice')return undefined;throw Error('Unexpected');}) as Run;
 const r=createControlledRenderer(()=>createElement(SignalSequentialPractice,{input,busy:false,run,isCurrent:()=>true,onOpen:async(result,guard)=>{if(guard()){expect(result.artifactId).toBe('saved');opened++;return true;}return false;},onBack:()=>{}}));r.render();await flush();r.render();expect(r.nodes().some(n=>text(n).includes('schedules 0'))).toBe(false);expect(button(r,'Save answer and reveal explanation').props.disabled).toBe(true);r.nodes().filter(n=>n.type==='input'&&n.props.type==='radio')[1].props.onChange();r.render();r.find(n=>n.type==='textarea').props.onChange({target:{value:'First thought'}});r.render();button(r,'Save answer and reveal explanation').props.onClick();await flush();r.render();expect(commands[1]).toMatchObject({type:'signal.practice',answer:1,reasoning:'First thought'});expect(r.find(n=>n.type==='fieldset').props.disabled).toBe(true);expect(r.find(n=>n.type==='textarea').props.disabled).toBe(true);button(r,'Check saved answer').props.onClick();await flush();r.render();expect(opened).toBe(1);expect(commands[2]).toMatchObject({type:'signal.practice.inspect',quote:'q <= d;'});
});
test('a late result cannot open an earlier navigation owner',async()=>{
 let resolve!:(value:unknown)=>void,owner=true,opened=0;const gate=new Promise(r=>resolve=r);const run=(async()=>gate) as Run;const r=createControlledRenderer(()=>createElement(SignalSequentialPractice,{input,busy:false,run,isCurrent:()=>owner,onOpen:async()=>{opened++;return true;},onBack:()=>{}}));r.render();owner=false;resolve({kind:'completed',artifactId:'saved',revision:1});await flush();r.render();expect(opened).toBe(0);
});
