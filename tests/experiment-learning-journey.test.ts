import {expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
vi.mock('lucide-react',()=>({ArrowLeft:()=>null,Calculator:()=>null,Save:()=>null,ChevronDown:()=>null,Ellipsis:()=>null,MoreHorizontal:()=>null,ExternalLink:()=>null,Info:()=>null}));
vi.mock('../src/renderer/src/components/ReadyArtifact',()=>({ReadyArtifact:({children}:any)=>children}));
vi.mock('../src/renderer/src/components/TaskMenu',()=>({TaskMenu:({children}:any)=>children}));
vi.mock('../src/renderer/src/components/ReadableText',()=>({ReadableText:({text}:any)=>text}));
import {createElement} from 'react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {evaluateExperiment} from '../src/core/experiments';
import {createExperimentPractice,inspectExperimentPractice} from '../src/core/experiment-practice-host';
import {ModelDraftReview} from '../src/renderer/src/components/ModelDraftReview';
import {DraftNavigationProvider,useDraftNavigation} from '../src/renderer/src/draft-navigation';
import {createControlledRenderer} from './controlled-renderer.fixture';
import type {Run} from '../src/renderer/src/ui';

type Node=ReturnType<ReturnType<typeof createControlledRenderer>['nodes']>[number];
const text=(n:Node):string=>n.type==='#text'?n.props.text:n.children.map(text).join('');
const model={schemaVersion:1,kind:'experiment',title:'Travel cost',explanation:'Suggested rate × time plus one fee.',spec:{title:'Travel cost',expression:{op:'add',left:{op:'multiply',left:{op:'variable',name:'rate'},right:{op:'variable',name:'time'}},right:{op:'variable',name:'fee'}},variables:[{name:'rate',unit:'USD/s',min:0,max:100},{name:'time',unit:'s',min:0,max:100},{name:'fee',unit:'USD',min:0,max:100}],assumptions:['Constant rate; fee charged once.']},inputs:{rate:3,time:4,fee:2}};

it('changes a source-linked nested expression, explains equal output, practices a distinct vector and preserves the first answer and worked result on recreation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'experiment-learning-'));let core=await createCompanion({dataDir:dir});try{
  const owner=await core.createTask({title:'Travel cost'}),s=await core.putSource(owner.id,{kind:'text',role:'fact',label:'Cost note',content:'Cost = rate × time + fee, with constant rate and one fee.'}),v=s.sources[0].versions[0],refs=[{sourceId:v.id,version:1,digest:v.digest}],created=await core.saveArtifact(owner.id,{title:model.title,content:JSON.stringify(model),mimeType:'application/json',sourceRefs:refs});
  let task=await core.getTask(owner.id),artifact=task.artifacts.find(a=>a.id===created.artifactId)!,back=0;const original=structuredClone(artifact),commands:any[]=[];
  const run=(async(command:any)=>{commands.push(structuredClone(command));if(command.type==='experiment.evaluate')return evaluateExperiment(command.spec,command.inputs);if(command.type==='artifact.save'){await core.saveArtifact(command.taskId,command.artifact);return task=await core.getTask(owner.id);}if(command.type==='experiment.practice.inspect'){const {type,...input}=command;return inspectExperimentPractice(core,input);}if(command.type==='experiment.practice'){const {type,...input}=command;return createExperimentPractice(core,input);}if(command.type==='tasks.get')return core.getTask(command.taskId);throw Error('Unexpected command: '+command.type);}) as Run;
  let nav!:ReturnType<typeof useDraftNavigation>;function Harness(){nav=useDraftNavigation();return createElement(DraftNavigationProvider,{value:nav.api,children:[createElement(ModelDraftReview,{task,artifact,busy:false,run,back:()=>{back++;}}),nav.review]});}
  const r=createControlledRenderer(()=>createElement(Harness)),contains=(value:string)=>r.nodes().some(n=>text(n).includes(value)),button=(label:string)=>r.find(n=>n.type==='button'&&text(n)===label),field=(label:string)=>{const id=r.find(n=>n.type==='label'&&text(n)===label).props.htmlFor;return r.find(n=>(n.type==='input'||n.type==='textarea')&&n.props.id===id);};
  const calculate=async()=>{r.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await vi.waitFor(()=>{r.render();expect(r.nodes().some(n=>n.props['aria-label']==='Calculation result')).toBe(true);});};
  r.render();await calculate();button('Use as comparison baseline').props.onClick();r.render();
  field('Rate (USD/s)').props.onChange({target:{valueAsNumber:4}});r.render();field('Time (s)').props.onChange({target:{valueAsNumber:3}});r.render();await calculate();
  expect(contains('difference 0 USD')).toBe(true);expect(contains('changed inputs give the same final value')).toBe(true);expect(button('Quick').props['aria-pressed']).toBe(true);
  const modeCommandCount=commands.length;button('Deep').props.onClick();r.render();expect(contains('(3 USD · s^-1) × (4 s) = 12 USD')).toBe(true);expect(contains('(4 USD · s^-1) × (3 s) = 12 USD')).toBe(true);expect(contains('(12 USD) + (2 USD) = 14 USD')).toBe(true);expect(contains('Output unchanged.')).toBe(true);
  button('Visual').props.onClick();r.render();expect(contains('Step 2 · Step 1 + fee')).toBe(true);expect(contains('Output: 14 USD → 14 USD')).toBe(true);expect(contains('Source links do not verify the formula')).toBe(true);expect(commands).toHaveLength(modeCommandCount);
  expect(button('Try separate practice').props.disabled).toBe(false);button('Try separate practice').props.onClick();r.render();expect(contains('Current comparison examples to avoid repeating')).toBe(true);expect(contains('other earlier exposure is unknown')).toBe(true);
  const practiceInputs=(rate:string,time:string,fee:string)=>{for(const [name,unit,value] of [['rate','USD/s',rate],['time','s',time],['fee','USD',fee]]){field(`${name} (${unit})`).props.onChange({target:{value}});r.render();}};
  practiceInputs('3','4','2');expect(button('Check for saved practice').props.disabled).toBe(true);practiceInputs('4','3','2');expect(button('Check for saved practice').props.disabled).toBe(true);
  practiceInputs('5','3','2');expect(button('Check for saved practice').props.disabled).toBe(false);button('Check for saved practice').props.onClick();await vi.waitFor(()=>{r.render();expect(contains('The first completed answer')).toBe(true);});expect(contains('Calculated result: 17')).toBe(false);
  field('Your predicted result (USD)').props.onChange({target:{value:'15'}});r.render();field('Your reasoning').props.onChange({target:{value:'  I forgot the fee.  '}});r.render();button('Save prediction').props.onClick();await vi.waitFor(()=>{r.render();expect(contains('The first prediction is saved')).toBe(true);});expect(contains('Calculated result: 17')).toBe(false);
  button('Show saved answer').props.onClick();await vi.waitFor(()=>{r.render();expect(contains('Calculated result: 17 USD')).toBe(true);});expect(contains('  I forgot the fee.  ')).toBe(true);
  button('Back to experiment').props.onClick();r.render();expect(contains('difference 0 USD')).toBe(true);button('Save result to task').props.onClick();await vi.waitFor(()=>expect(back).toBe(1));
  task=await core.getTask(owner.id);const practice=task.artifacts.find(a=>a.revisions[0].title==='Practice: Travel cost')!,result=task.artifacts.find(a=>a.revisions[0].title==='Travel cost — result')!;expect(task.artifacts.find(a=>a.id===artifact.id)).toEqual(original);expect(result.revisions[0].sourceRefs).toEqual(refs);expect(result.revisions[0].content).toContain('Worked comparison (same formula and assumptions):');expect(result.revisions[0].content).toContain('Changed: (4 USD · s^-1) × (3 s) = 12 USD');expect(result.revisions[0].content).toContain('2. Step 1 + fee');expect(practice.revisions[0].content).toContain('Your first prediction: 15 USD');expect(practice.revisions[0].content).toContain('rate = 4 USD/s, time = 3 s, fee = 2 USD');
  await core.close();core=await createCompanion({dataDir:dir});task=await core.getTask(owner.id);expect(task.artifacts.find(a=>a.id===result.id)).toEqual(result);expect(task.artifacts.find(a=>a.id===practice.id)).toEqual(practice);expect(task.artifacts.find(a=>a.id===artifact.id)).toEqual(original);expect(task.requests).toHaveLength(1);
  task=await core.putSource(owner.id,{id:v.id,kind:'text',role:'fact',label:'Cost note',content:'The formula must be reviewed.'});artifact=task.artifacts.find(a=>a.id===created.artifactId)!;r.render();await calculate();expect(button('Try separate practice').props.disabled).toBe(true);expect(button('Save result to task').props.disabled).toBe(true);expect(contains('Source links need review')).toBe(true);expect((await core.getTask(owner.id)).artifacts.find(a=>a.id===practice.id)).toEqual(practice);
  expect(commands.every(command=>['experiment.evaluate','experiment.practice.inspect','experiment.practice','artifact.save','tasks.get'].includes(command.type))).toBe(true);
 }finally{await core.close();await rm(dir,{recursive:true,force:true});}
});
