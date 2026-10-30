import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
vi.mock('lucide-react',()=>({ExternalLink:()=>null,Info:()=>null,ChevronDown:()=>null}));
import {createElement} from 'react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createControlledRenderer} from './controlled-renderer.fixture';
import {createCompanion} from '../src/core/companion';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {LearningDraftProvider} from '../src/renderer/src/learning-draft-context';
import {SourceFormulaWorkbench} from '../src/renderer/src/components/SourceFormulaWorkbench';
import {RangeSumExplanation} from '../src/renderer/src/components/RangeSumExplanation';
import {sourceFormulaPreview,type SourceFormulaInput,type SourceFormulaPacket} from '../src/learning/source-formula';
import {RANGE_SUM_FORMULA,RANGE_SUM_ASSUMPTION,recognizeRangeSum,rangeSumVariables} from '../src/learning/python-range-sum';
type R=ReturnType<typeof createControlledRenderer>;type Node=ReturnType<R['nodes']>[number];
const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
const button=(r:R,name:string)=>r.find(n=>n.type==='button'&&text(n)===name);
const edit=(r:R,label:string,value:string)=>{r.find(n=>n.props['aria-label']===label).props.onChange({currentTarget:{value}});r.render();};
test('stages exact source into existing raw fields, preserves an earlier review, and restores staged integer metadata without publication',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'range-stage-')),core=await createCompanion({dataDir:dir});try{
  let task=await core.createTask({title:'Range source'});const quote='total = 2\nfor item in range(5):\n    total += item';task=await core.putSource(task.id,{kind:'text',role:'fact',label:'Reviewed loop',content:quote});const source=task.sources[0],ref={sourceId:source.id,version:1,digest:source.versions[0].digest},lookupTask=async(id:string)=>(await core.listTasks()).find(t=>t.id===id);let store=new LearningDraftStore({directory:dir,lookupTask}),cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await cache.load();
  const render=()=>{const r=createControlledRenderer(()=>createElement(LearningDraftProvider,{cache,children:createElement(SourceFormulaWorkbench,{task})}));r.render();return r;};let r=render();edit(r,'Saved formula source',JSON.stringify(ref));expect(button(r,'Stage bounded range-sum model for review').props.disabled).toBe(false);
  edit(r,'Reviewed source formula','earlier + model');r.render();expect(button(r,'Stage bounded range-sum model for review').props.disabled).toBe(true);button(r,'Stage bounded range-sum model for review').props.onClick();r.render();expect(r.find(n=>n.props['aria-label']==='Reviewed source formula').props.value).toBe('earlier + model');
  button(r,'Clear formula review fields').props.onClick();r.render();edit(r,'Saved formula source',JSON.stringify(ref));button(r,'Stage bounded range-sum model for review').props.onClick();r.render();expect(r.find(n=>n.props['aria-label']==='Reviewed source formula').props.value).toBe(RANGE_SUM_FORMULA);expect(r.find(n=>n.props['aria-label']==='Exact formula source line').props.value).toBe('range-sum');expect(r.find(n=>n.props['aria-label']==='Formula count domain').props.value).toBe('integer');await cache.flush();
  store=new LearningDraftStore({directory:dir,lookupTask});cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await cache.load();r=render();expect(r.find(n=>n.props['aria-label']==='Reviewed source formula').props.value).toBe(RANGE_SUM_FORMULA);expect(r.find(n=>n.props['aria-label']==='Formula initial domain').props.value).toBe('integer');button(r,'Review cited formula and calculation').props.onClick();r.render();expect(r.nodes().some(n=>n.type==='p'&&text(n)==='Calculated result: 12 1.')).toBe(true);expect(r.nodes().some(n=>n.type==='h4'&&text(n)==='Derived arithmetic model — not executed Python')).toBe(true);expect((await core.getTask(task.id)).requests).toHaveLength(0);
  edit(r,'Formula count value','2.5');button(r,'Review cited formula and calculation').props.onClick();r.render();expect(r.nodes().filter(n=>n.props.role==='alert'||n.props.role==='status').map(text).join(' | ')).toContain('exact source mapping');expect((await core.getTask(task.id)).artifacts).toHaveLength(0);
 }finally{await core.close();await rm(dir,{recursive:true,force:true});}
});
test('parameterized Quick/Deep/Visual distinguishes source defaults and changed inputs, with an honest empty-range case',()=>{
 const quote='total = 2\nfor item in range(5):\n    total += item',loop=recognizeRangeSum(quote)!,input:SourceFormulaInput={taskId:'task',sourceRef:{sourceId:'source',version:1,digest:'a'.repeat(64)},lineNumber:1,start:0,end:loop.end,title:'Loop model',formula:RANGE_SUM_FORMULA,variables:rangeSumVariables(loop),assumptions:[RANGE_SUM_ASSUMPTION],correctionReason:'Derived sum.',confirmed:'reviewed-source-transcription',derivation:'python-range-sum-v1'},packet={input,citation:{...input.sourceRef,sourceRef:input.sourceRef,lineNumber:1,start:0,end:loop.end,quote,lineCount:3}} as Pick<SourceFormulaPacket,'input'|'citation'>;let inputs={initial:2,count:3};const r=createControlledRenderer(()=>createElement(RangeSumExplanation,{packet,inputs}));r.render();expect(r.nodes().some(n=>n.type==='p'&&text(n).includes('Starting at 2 gives 5'))).toBe(true);expect(r.nodes().some(n=>n.type==='p'&&text(n).includes('source defaults remain initial = 2, count = 5'))).toBe(true);button(r,'Deep').props.onClick();r.render();expect(r.nodes().some(n=>n.type==='p'&&text(n).includes('two copies therefore total n × (n - 1)'))).toBe(true);button(r,'Visual').props.onClick();r.render();expect(r.nodes().filter(n=>n.type==='li').map(text)).toEqual(['item = 0: total 2 + 0 → 2.','item = 1: total 2 + 1 → 3.','item = 2: total 3 + 2 → 5.']);inputs={initial:2,count:0};r.render();expect(r.nodes().some(n=>n.type==='p'&&text(n)==='No illustrative body steps: count is 0.')).toBe(true);
});
