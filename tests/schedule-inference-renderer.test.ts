import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
vi.mock('lucide-react',()=>({Check:()=>null}));
import {createElement} from 'react';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {RecurringWorkPanel} from '../src/renderer/src/components/RecurringWork';
import {recurringInference,recurringResponseScope} from '../src/shared/recurring-work';
import type {Command} from '../src/shared/bridge';
import type {RequestInferenceCatalog} from '../src/shared/request-inference';
import {createControlledRenderer} from './controlled-renderer.fixture';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';

test('actual schedule controls save an explicit tuple paused and inspect the production resolution without enabling or preparing work',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-schedule-inference-ui-')),core=await createCompanion({dataDir:directory});
 try{
  const catalog:Extract<RequestInferenceCatalog,{kind:'available'}>={kind:'available',defaultSelection:{provider:'codex',model:'default-model',effort:'medium',tier:'default'},models:[{id:'default-model',label:'Default model',efforts:['medium'],tiers:[{id:'default',label:'Standard'}],initialEffort:'medium',initialTier:'default'},{id:'chosen-model',label:'Chosen model',efforts:['low','high'],tiers:[{id:'default',label:'Standard'}],initialEffort:'high',initialTier:'default'}]},calls:Command[]=[];let tail:Promise<unknown>=Promise.resolve();
  vi.stubGlobal('crypto',{randomUUID});vi.stubGlobal('window',{companion:{subscribe:()=>()=>{},invoke(input:Command){calls.push(input);const operation=(async()=>{
   if(input.type==='schedules.get')return {items:await core.getRecurringWork(),runtime:{state:'stopped',message:'No schedule execution in this local test.'}};
   if(input.type==='schedules.models')return catalog;
   if(input.type==='schedules.change'){if(input.change.kind!=='save')throw Error('No authorization permitted');return {items:await core.changeRecurringWork(input.change),runtime:{state:'stopped',message:'No schedule execution.'}};}
   if(input.type==='schedules.preview'){const item=(await core.getRecurringWork()).find(item=>item.id===input.id)!;if(item.revision!==input.expectedRevision)throw Error('Stale configuration');return {id:item.id,revision:item.revision,configurationDigest:createHash('sha256').update(recurringResponseScope(item)).digest('hex'),authorized:false,...recurringInference(item,'codex',catalog.defaultSelection,catalog)};}
   throw Error('Unexpected command '+input.type);
  })();tail=operation;return operation;}}});
  const store=new LearningDraftStore({directory,lookupTask:async()=>undefined}),cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await cache.load();
  const renderer=createControlledRenderer(()=>createElement(RecurringWorkPanel,{cache,isCurrent:()=>true,onOpenTask(){throw Error('No task navigation');}}));type Node=ReturnType<typeof renderer.nodes>[number];const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join(''),button=(label:string)=>renderer.find(node=>node.type==='button'&&text(node)===label),select=(index:number)=>renderer.nodes().filter(node=>node.type==='select')[index],settle=async()=>{await tail;await Promise.resolve();await Promise.resolve();renderer.render();};
  renderer.render();await settle();button('New schedule').props.onClick();renderer.render();await settle();renderer.find(node=>node.type==='input'&&!node.props.type).props.onChange({target:{value:'Owned paused model QA'}});renderer.find(node=>node.type==='textarea').props.onChange({target:{value:'Synthetic unsent question.'}});renderer.render();select(1).props.onChange({target:{value:'codex'}});renderer.render();select(2).props.onChange({target:{value:'chosen-model'}});renderer.render();select(3).props.onChange({target:{value:'low'}});renderer.render();await renderer.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await settle();
  const [item]=await core.getRecurringWork();expect(item).toMatchObject({enabled:false,mode:'response',inference:{provider:'codex',model:'chosen-model',effort:'low',tier:'default'}});const before=await core.contentSnapshot();button('Inspect schedule request settings').props.onClick();await settle();const displayed=renderer.nodes().filter(node=>node.type==='#text').map(text).join(' ');expect(displayed).toContain('chosen-model · low reasoning');expect(displayed).toContain('Model fallback disabled.');expect(displayed).toContain('No matching session grant');expect(JSON.parse(renderer.find(node=>node.type==='pre').children.map(text).join(''))).toMatchObject({thread:{model:'chosen-model',config:{model_reasoning_effort:'low'},allowProviderModelFallback:false},turn:{model:'chosen-model',effort:'low'}});expect(await core.contentSnapshot()).toEqual(before);expect(await core.listTasks()).toEqual([]);expect(calls.filter(input=>input.type==='schedules.change').every(input=>input.type==='schedules.change'&&input.change.kind==='save')).toBe(true);expect(calls.some(input=>input.type==='model.run'||input.type==='inference.catalog'||input.type==='connection.status')).toBe(false);
 }
 finally{vi.unstubAllGlobals();await core.close();await rm(directory,{recursive:true,force:true});}
});
