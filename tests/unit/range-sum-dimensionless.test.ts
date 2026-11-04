import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
vi.mock('lucide-react',()=>({ArrowLeft:()=>null,Calculator:()=>null,Save:()=>null,ChevronDown:()=>null,Ellipsis:()=>null,MoreHorizontal:()=>null,ExternalLink:()=>null,Info:()=>null,X:()=>null}));
vi.mock('../../src/renderer/src/components/TaskMenu',()=>({TaskMenu:({children}:any)=>children}));
vi.mock('../../src/renderer/src/components/ReadyArtifact',()=>({ReadyArtifact:({children}:any)=>children}));
import {createElement} from 'react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {createCompanion} from '../../src/core/companion';
import {saveSourceFormula} from '../../src/core/source-formula-host';
import {evaluateExperiment} from '../../src/core/experiments';
import {recognizeRangeSum,rangeSumVariables,RANGE_SUM_FORMULA,RANGE_SUM_ASSUMPTION} from '../../src/learning/python-range-sum';
import type {SourceFormulaInput} from '../../src/learning/source-formula';
import {ModelDraftReview} from '../../src/renderer/src/components/ModelDraftReview';
import {LearningDraftProvider} from '../../src/renderer/src/learning-draft-context';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';
import type {Run} from '../../src/renderer/src/ui';
type R=ReturnType<typeof createControlledRenderer>;type Node=ReturnType<R['nodes']>[number];
const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
const button=(r:R,name:string)=>r.find(n=>n.type==='button'&&text(n)===name);

test.each(['loop','ordinary dimensionless','physical'] as const)('unit presentation is scoped to the reviewed loop: %s',async kind=>{
 const dir=await mkdtemp(join(tmpdir(),'range-units-')),core=await createCompanion({dataDir:dir});try{
  let task=await core.createTask({title:'Unit display'});const loop=kind==='loop',quote=loop?'total = 2\nfor item in range(5):\n    total += item':'output = rate * time';task=await core.putSource(task.id,{kind:'text',role:'fact',label:'Owned source',content:quote});const source=task.sources[0],ref={sourceId:source.id,version:1,digest:source.versions[0].digest};
  const input:SourceFormulaInput={taskId:task.id,sourceRef:ref,lineNumber:1,start:0,end:quote.length,title:'Unit display',formula:loop?RANGE_SUM_FORMULA:quote,variables:loop?rangeSumVariables(recognizeRangeSum(quote)!):[{name:'rate',unit:kind==='physical'?'m/s':'1',min:0,max:100,value:3},{name:'time',unit:kind==='physical'?'s':'1',min:0,max:100,value:4}],assumptions:[loop?RANGE_SUM_ASSUMPTION:'Ordinary constant-rate model.'],correctionReason:loop?'Reviewed derived model.':'',confirmed:'reviewed-source-transcription',...(loop?{derivation:'python-range-sum-v1'}:{})};
  const saved=await saveSourceFormula(core,{input});task=await core.getTask(task.id);const artifact=task.artifacts.find(a=>a.id===saved.artifactId)!,bytes=artifact.revisions[0].content,original=structuredClone(artifact);const store=new LearningDraftStore({directory:dir,lookupTask:async id=>(await core.listTasks()).find(t=>t.id===id)}),cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await cache.load();
  const run=(async(command:any)=>{if(command.type==='experiment.evaluate')return evaluateExperiment(command.spec,command.inputs);throw Error('No mutation expected');}) as Run,r=createControlledRenderer(()=>createElement(LearningDraftProvider,{cache,children:createElement(ModelDraftReview,{task,artifact,busy:false,run,back:()=>{}})}));r.render();
  const calculate=async()=>{r.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await vi.waitFor(()=>{r.render();expect(r.nodes().some(n=>n.props['aria-label']==='Calculation result')).toBe(true);});};await calculate();button(r,'Use as comparison baseline').props.onClick();r.render();const variableName=loop?'Count':kind==='physical'?'Time (s)':'Time',label=r.find(n=>n.type==='label'&&text(n)===variableName),field=r.find(n=>n.type==='input'&&n.props.id===label.props.htmlFor);field.props.onChange({target:{valueAsNumber:6}});r.render();await calculate();
  const comparison=r.find(n=>n.props['aria-label']==='Experiment comparison');expect(text(comparison)).toContain(loop?'Baseline: 12.':kind==='physical'?'Baseline: 12 m.':'Baseline: 12 1.');expect(text(comparison)).toContain(loop?'Calculated result: 12 → 17; difference 5.':kind==='physical'?'Calculated result: 12 → 18 m; difference 6 m.':'Calculated result: 12 → 18 1; difference 6 1.');
  r.find(n=>n.props['aria-label']==='Target missing input').props.onChange({currentTarget:{value:loop?'count':'time'}});r.render();const heading=r.find(n=>n.type==='h4'&&text(n).startsWith('Calculated target:'));expect(text(heading)).toBe(loop?'Calculated target: 30':kind==='physical'?'Calculated target: 75 m':'Calculated target: 75 1');const challenge=r.find(n=>n.props['aria-label']==='Calculated target challenge');expect(text(challenge)).toContain(loop?'initial: 2':kind==='physical'?'rate: 3 m/s':'rate: 3 1');if(loop){expect(text(challenge)).not.toContain('30 1');expect(text(challenge)).toContain('from 0 to 32, using whole numbers only');expect(r.nodes().some(n=>n.type==='p'&&text(n)==='Values in this range-sum model are dimensionless.')).toBe(true);}
  expect((await core.getTask(task.id)).artifacts.find(a=>a.id===artifact.id)).toEqual(original);expect(artifact.revisions[0].content).toBe(bytes);await cache.flush();
 }finally{await core.close();await rm(dir,{recursive:true,force:true});}
});
