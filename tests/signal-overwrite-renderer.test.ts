import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createControlledRenderer} from './controlled-renderer.fixture';
import {createCompanion} from '../src/core/companion';
import {prepareWorkflowReview} from '../src/core/workflow-review-host';
import {createSignalOverwrite,inspectSignalOverwrite} from '../src/core/signal-overwrite-host';
import {prepareSignalOverwrites} from '../src/learning/signal-overwrite';
import {SignalConceptReview} from '../src/renderer/src/components/SignalConceptReview';
import {SignalOverwriteReview} from '../src/renderer/src/components/SignalOverwriteReview';
import type {Run} from '../src/renderer/src/ui';
type Host=ReturnType<ReturnType<typeof createControlledRenderer>['nodes']>[number];
const text=(node:Host):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
const button=(r:ReturnType<typeof createControlledRenderer>,name:string)=>r.find(n=>n.type==='button'&&text(n)===name);
async function flush(){for(let i=0;i<8;i++)await new Promise(resolve=>setTimeout(resolve,0));}

test('ordinary source review enters the pair journey, changes hypothetical execution and reconciles a lost result with the exact locked choice',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'signal-overwrite-render-')),core=await createCompanion({dataDir:dir});try{
  let task=await core.createTask({title:'Owned VHDL'});const quote='q <= a;\nq <= b;';task=await core.putSource(task.id,{kind:'text',role:'fact',label:'Owned pair',content:quote});const v=task.sources[0].versions[0],refs=[{sourceId:v.id,version:1,digest:v.digest}],doc=await core.saveArtifact(task.id,{title:'Basis',content:'Linked.',sourceRefs:refs}),basis={artifactId:doc.artifactId,revision:1,digest:doc.revision.digest};task=await core.getTask(task.id);let created=0,finishSave!:()=>void,finishOpen!:()=>void;const saved=new Promise<void>(r=>finishSave=r),opened=new Promise<void>(r=>finishOpen=r);const commands:any[]=[];
  const run=(async(command:any)=>{commands.push(command);const {type,...input}=command;if(type==='workflow.prepare')return prepareWorkflowReview(core,input);if(type==='signal.overwrite'){await createSignalOverwrite(core,input);finishSave();return undefined;}if(type==='signal.overwrite.inspect')return inspectSignalOverwrite(core,input);if(type==='tasks.get')return core.getTask(command.taskId);throw Error('Unexpected command');}) as Run;
  const r=createControlledRenderer(()=>createElement(SignalConceptReview,{task,basis,busy:false,run,isCurrent:()=>true,onCreated:()=>{created++;finishOpen();},onCancel:()=>{}}));r.render();await flush();r.render();r.find(n=>n.type==='select').props.onChange({target:{value:'0'}});r.render();button(r,'Explore these two assignments to one signal').props.onClick();r.render();expect(r.nodes().some(n=>n.type==='pre'&&text(n)===quote)).toBe(true);expect(r.nodes().some(n=>n.type==='p'&&text(n).includes('Owned pair · version 1'))).toBe(true);
  expect(button(r,'Save source-linked explanation and change').props.disabled).toBe(true);const boxes=r.nodes().filter(n=>n.type==='input'&&n.props.type==='checkbox');boxes[0].props.onChange({target:{checked:true}});boxes[1].props.onChange({target:{checked:false}});r.render();expect(r.nodes().some(n=>n.props.role==='status'&&text(n).includes('changes from 0 to 1'))).toBe(true);button(r,'Save source-linked explanation and change').props.onClick();await saved;await flush();r.render();expect(commands.find(c=>c.type==='signal.overwrite')).toMatchObject({quote,mode:'lesson',secondEnabled:false,expectedSourceRefs:refs});expect(created).toBe(0);expect(r.nodes().filter(n=>n.type==='input'&&n.props.type==='checkbox').every(n=>n.props.disabled)).toBe(true);expect(r.nodes().some(n=>n.type==='button'&&text(n)==='Save source-linked explanation and change')).toBe(false);button(r,'Check saved result').props.onClick();await opened;await flush();r.render();expect(created).toBe(1);expect(commands.filter(c=>c.type==='signal.overwrite')).toHaveLength(1);expect(commands.find(c=>c.type==='signal.overwrite.inspect')).toMatchObject({mode:'lesson',secondEnabled:false});
  const snapshot=await core.getTask(task.id);expect(snapshot.requests).toHaveLength(1);expect(snapshot.artifacts.at(-1)!.revisions[0].content).toContain('final scheduled value changes from 0 to 1');
 }finally{await core.close();await rm(dir,{recursive:true,force:true});}
});

const quote='q <= a;\nq <= b;',pair=prepareSignalOverwrites([{sourceId:'source',text:quote}])[0],input={taskId:'task',basis:{artifactId:'basis',revision:1,digest:'digest'},expectedSourceRefs:[{sourceId:'source',version:1,digest:'digest'}],sourceId:'source',start:0,end:quote.length,quote,confirmed:true as const};
test('separate practice checks previous publication before answering and never reveals feedback before first save',async()=>{
 const commands:any[]=[];let checks=0,opened=0;const run=(async(command:any)=>{commands.push(command);if(command.type==='signal.overwrite.inspect')return ++checks===1?{kind:'not-started'}:{kind:'completed',artifactId:'saved',revision:1};if(command.type==='signal.overwrite')return undefined;throw Error('Unexpected');}) as Run;
 const r=createControlledRenderer(()=>createElement(SignalOverwriteReview,{pair,input,sourceLabel:'Source',busy:false,run,isCurrent:()=>true,onOpen:async()=>{opened++;return true;},onBack:()=>{}}));r.render();r.nodes().filter(n=>n.type==='input'&&n.props.type==='checkbox')[0].props.onChange({target:{checked:true}});r.render();button(r,'Try separate replacement practice').props.onClick();r.render();await flush();r.render();expect(commands).toHaveLength(1);expect(commands[0]).toMatchObject({type:'signal.overwrite.inspect',mode:'practice'});expect(r.nodes().some(n=>text(n).includes('The result is (0, 1)'))).toBe(false);expect(button(r,'Save first answer and reveal explanation').props.disabled).toBe(true);r.nodes().filter(n=>n.type==='input'&&n.props.type==='radio')[2].props.onChange();r.render();button(r,'Save first answer and reveal explanation').props.onClick();await flush();r.render();expect(commands[1]).toMatchObject({type:'signal.overwrite',mode:'practice',answer:'10'});expect(r.find(n=>n.type==='fieldset').props.disabled).toBe(true);button(r,'Check saved result').props.onClick();await flush();expect(opened).toBe(1);expect(commands.filter(c=>c.type==='signal.overwrite')).toHaveLength(1);
});
test('a late pair publication cannot open a superseded navigation owner',async()=>{
 let resolve!:(value:unknown)=>void,owner=true,opened=0;const gate=new Promise(r=>resolve=r),run=(async()=>gate) as Run,r=createControlledRenderer(()=>createElement(SignalOverwriteReview,{pair,input,sourceLabel:'Source',busy:false,run,isCurrent:()=>owner,onOpen:async()=>{opened++;return true;},onBack:()=>{}}));r.render();r.nodes().filter(n=>n.type==='input'&&n.props.type==='checkbox')[0].props.onChange({target:{checked:true}});r.render();button(r,'Save source-linked explanation and change').props.onClick();owner=false;resolve({artifactId:'saved',revision:1});await flush();expect(opened).toBe(0);
});
