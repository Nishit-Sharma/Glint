import {afterEach,expect,test,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {createCompanion} from '../../src/core/companion';
import {prepareWorkflowReview,createReviewedWorkflow,createContextualReviewedWorkflow} from '../../src/core/workflow-review-host';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';
import {LearningDraftProvider,LearningDraftReview} from '../../src/renderer/src/learning-draft-context';
import {WorkflowSourceReview} from '../../src/renderer/src/components/WorkflowSourceReview';
import {navigationFormBasis} from '../../src/renderer/src/learning-draft-basis';
import {workflowSourceOwner,initialWorkflowSourceRaw,workflowSourceBasis} from '../../src/renderer/src/workflow-source-review-form';
import {workflowSourceAdmissions as admissions,type WorkflowSourceMode as Mode} from '../../src/shared/workflow-source-admission';
import {learningDraftKey} from '../../src/shared/learning-drafts';
import type {Command} from '../../src/shared/bridge';
import type {Run} from '../../src/renderer/src/ui';
function gate(){let release!:()=>void,enter!:()=>void;return {waiting:new Promise<void>(resolve=>release=resolve),entered:new Promise<void>(resolve=>enter=resolve),release:()=>release(),enter:()=>enter()};}
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
type Renderer=ReturnType<typeof createControlledRenderer>;
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'workflow-mode-final-')),core=await createCompanion({dataDir:directory}),gates={legacy:gate(),contextual:gate()};cleanup.push(async()=>{gates.legacy.release();gates.contextual.release();await core.close();await rm(directory,{recursive:true,force:true});});
 const task=await core.createTask({title:'Owned contextual mode transitions'}),sourced=await core.putSource(task.id,{kind:'text',role:'fact',label:'Owned finite hardware rules',content:'Idle + Clock -> Ready\nReady + Reset -> Idle'}),source=sourced.sources[0],version=source.versions[0],refs=[{sourceId:source.id,version:version.version,digest:version.digest}],saved=await core.saveArtifact(task.id,{title:'Owned linked rules',content:'An explanatory finite model, not HDL simulation.',sourceRefs:refs,mimeType:'text/markdown'}),basis={artifactId:saved.artifactId,revision:1,digest:saved.revision.digest},current=await core.getTask(task.id),prepared=await prepareWorkflowReview(core,{taskId:task.id,basis}),owner=workflowSourceOwner(task.id,basis);
 const store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(item=>item.id===id)}),cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await cache.load();
 let epoch=0,opened=0,published=0,loseReply:Mode|undefined;const delivered:Mode[]=[];
 const run=async(command:Command)=>{
  if(command.type==='workflow.prepare')return prepared;
  if(command.type==='workflow.review'||command.type==='workflow.contextual.review'){const mode=command.type==='workflow.review'?'legacy':'contextual';published++;const {type,...input}=command,result=await (mode==='legacy'?createReviewedWorkflow:createContextualReviewedWorkflow)(core,input);gates[mode].enter();await gates[mode].waiting;delivered.push(mode);if(loseReply===mode)throw Error('Owned reply lost after commit.');return result;}
  throw Error('No other command is permitted in this controller proof.');
 };
 async function open(mode:Mode){const captured=++epoch,renderer=createControlledRenderer(()=>createElement(LearningDraftProvider,{cache,children:createElement(WorkflowSourceReview,{task:current,basis,mode,busy:false,run:run as Run,onCreated:()=>{opened++;},onCancel:()=>{epoch++;},continuationScope:mode+':entry:'+captured,isContinuationCurrent:()=>epoch===captured})}));renderer.render();await vi.waitFor(()=>{renderer.render();expect(renderer.nodes().filter(node=>node.type==='select')).toHaveLength(2);});return renderer;}
 function select(renderer:Renderer,index:number,value:string){renderer.nodes().filter(node=>node.type==='select')[index].props.onChange({target:{value}});renderer.render();}
 async function fill(renderer:Renderer,note:string){select(renderer,0,'Idle');select(renderer,1,'Clock');renderer.find(node=>node.type==='textarea'&&node.props.rows===3).props.onChange({target:{value:note}});renderer.render();await cache.flush();renderer.render();}
 function confirm(renderer:Renderer){renderer.find(node=>node.type==='input'&&node.props.type==='checkbox'&&node.props.checked===false&&node.props.disabled===false).props.onChange({target:{checked:true}});renderer.render();}
 function submit(renderer:Renderer){confirm(renderer);renderer.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});renderer.render();}
 const initial=initialWorkflowSourceRaw(prepared),identity=workflowSourceBasis(basis,refs),cacheBasis=navigationFormBasis(initial,{slot:admissions.legacy.reviewSlot,basisMode:'explicit',basis:identity,variableArrays:['eventSequence']});
 const raw=(mode:Mode)=>cache.readForm(owner,admissions[mode].reviewSlot,initial,cacheBasis,['eventSequence']);
 return {core,task,cache,store,owner,prepared,basis,identity,gates,delivered,open,fill,select,confirm,submit,raw,retire:()=>epoch++,lose:(mode:Mode)=>{loseReply=mode;},get opened(){return opened;},get published(){return published;}};
}

test('first contextual entry has current defaults, no copied legacy choices, confirmation or publication intent',async()=>{
 const f=await fixture(),legacy=await f.open('legacy');await f.fill(legacy,'Legacy-only raw choice.');const contextual=await f.open('contextual');
 expect(contextual.nodes().filter(node=>node.type==='select').map(node=>node.props.value)).toEqual(['','']);
 expect(f.raw('legacy').value.assumptions).toBe('Legacy-only raw choice.');expect(f.raw('contextual').value.assumptions).toBe('');
 expect(f.cache.getSnapshot().entries[learningDraftKey(f.owner,admissions.contextual.publicationSlot)]?.local).toBeUndefined();expect(f.published).toBe(0);
 expect(contextual.nodes().find(node=>node.type==='button'&&node.props.type==='submit')?.props.disabled).toBe(true);
});

test.each([['legacy','contextual'],['contextual','legacy']] as const)('late %s ack clears only its exact raw while %s opens without typing, including quit drain',async(from,to)=>{
 const f=await fixture(),future=await f.open(to);await f.fill(future,to+' retained raw');const first=await f.open(from);await f.fill(first,from+' dispatched raw');f.submit(first);await f.gates[from].entered;
 const next=await f.open(to),key=learningDraftKey(f.owner,admissions[to].reviewSlot),generation=f.cache.getSnapshot().entries[key].generation;expect(f.raw(to).value.assumptions).toBe(to+' retained raw');
 f.cache.setFrozen(true);const quit=f.cache.flushForQuit();f.gates[from].release();await quit;next.render();
 expect(f.raw(from).value.assumptions).toBe('');expect(f.raw(to).value.assumptions).toBe(to+' retained raw');expect(f.cache.getSnapshot().entries[key].generation).toBe(generation);expect(f.opened).toBe(0);expect(f.published).toBe(1);
 const intent=f.cache.getSnapshot().entries[learningDraftKey(f.owner,admissions[from].publicationSlot)]?.local;expect(intent?.value).toContain(admissions[from].bindingPrefix);
});

test.each([['legacy','contextual'],['contextual','legacy']] as const)('mode %s→%s→same mode never revives confirmation or presentation, even when exact raw bytes return',async(from,to)=>{
 const f=await fixture(),first=await f.open(from);await f.fill(first,'Exact ABA raw');f.submit(first);await f.gates[from].entered;await f.open(to);const again=await f.open(from);
 expect(again.nodes().find(node=>node.type==='button'&&node.props.type==='submit')?.props.disabled).toBe(true);
 f.cache.setFrozen(true);f.gates[from].release();await f.cache.flushForQuit();again.render();expect(f.opened).toBe(0);expect(f.raw(from).value.initialState).toBe('');
});

test.each([['legacy','contextual'],['contextual','legacy']] as const)('two dispatched modes settle in %s then %s reply order without cross-acknowledging a newer generation',async(firstReply,secondReply)=>{
 const f=await fixture(),legacy=await f.open('legacy');await f.fill(legacy,'Legacy dispatched');f.submit(legacy);await f.gates.legacy.entered;const contextual=await f.open('contextual');await f.fill(contextual,'Contextual dispatched');f.submit(contextual);await f.gates.contextual.entered;
 const now=await f.open('contextual');await f.fill(now,'Newer contextual input');f.retire();f.cache.setFrozen(true);f.gates[firstReply].release();await vi.waitFor(()=>expect(f.delivered).toContain(firstReply));f.gates[secondReply].release();await f.cache.flushForQuit();
 expect(f.raw('legacy').value.assumptions).toBe('');expect(f.raw('contextual').value.assumptions).toBe('Newer contextual input');expect(f.opened).toBe(0);expect((await f.core.getTask(f.task.id)).requests).toHaveLength(2);
});

test('lost legacy completion keeps its intent independent while contextual dispatch completes; no implicit replay occurs',async()=>{
 const f=await fixture();f.lose('legacy');const legacy=await f.open('legacy');await f.fill(legacy,'Legacy uncertain raw');f.submit(legacy);await f.gates.legacy.entered;const contextual=await f.open('contextual');await f.fill(contextual,'Contextual independent raw');f.submit(contextual);await f.gates.contextual.entered;f.retire();f.cache.setFrozen(true);f.gates.legacy.release();f.gates.contextual.release();await f.cache.flushForQuit();
 expect(f.raw('legacy').value.assumptions).toBe('Legacy uncertain raw');expect(f.raw('contextual').value.assumptions).toBe('');
 const entries=f.cache.getSnapshot().entries,left=JSON.parse(entries[learningDraftKey(f.owner,admissions.legacy.publicationSlot)].local!.value),right=JSON.parse(entries[learningDraftKey(f.owner,admissions.contextual.publicationSlot)].local!.value);expect(left.requestId).not.toBe(right.requestId);expect(left.binding).toMatch(/^literal-workflow-review-v1:/);expect(right.binding).toMatch(/^contextual-workflow-review-v1:/);expect(f.published).toBe(2);
 f.cache.setFrozen(false);const reopened=await f.open('legacy');expect(f.raw('legacy').value.assumptions).toBe('Legacy uncertain raw');expect(reopened.nodes().find(node=>node.type==='button'&&node.props.type==='submit')?.props.disabled).toBe(true);expect(f.published).toBe(2);
});

test('retiring a mode during the raw preflush wait cannot dispatch or copy intent into the next editor',async()=>{
 const f=await fixture(),legacy=await f.open('legacy');await f.fill(legacy,'Legacy preparing raw');const hold=gate(),original=f.cache.flushForm;const spy=vi.spyOn(f.cache,'flushForm').mockImplementationOnce(async(...args)=>{hold.enter();await hold.waiting;return original(...args);});try{f.submit(legacy);await hold.entered;const contextual=await f.open('contextual');hold.release();await vi.waitFor(()=>{legacy.render();expect(legacy.nodes().filter(node=>node.type==='button'&&node.props.type==='submit')[0].props.disabled).toBe(false);});expect(f.published).toBe(0);expect(f.raw('legacy').value.assumptions).toBe('Legacy preparing raw');expect(f.raw('contextual').value.assumptions).toBe('');expect(contextual.nodes().filter(node=>node.type==='select').map(node=>node.props.value)).toEqual(['','']);expect(f.cache.getSnapshot().entries[learningDraftKey(f.owner,admissions.legacy.publicationSlot)]?.local).toBeUndefined();}finally{hold.release();spy.mockRestore();}
});

test('Files distinguishes both contextual records and recognizes the actual hook-wrapped raw basis',async()=>{
 const f=await fixture(),contextual=await f.open('contextual');await f.fill(contextual,'Contextual review remains independent');f.cache.edit(f.owner,admissions.contextual.publicationSlot,{requestId:'',binding:''},f.identity,()=>({requestId:'owned-inert-intent',binding:'contextual-workflow-review-v1:owned'}));await f.cache.flush();const current=await f.core.getTask(f.task.id),files=createControlledRenderer(()=>createElement(LearningDraftReview,{task:current,cache:f.cache}));files.render();const text=files.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join(' ');expect(text).toContain('Contextual workflow review');expect(text).toContain('Contextual workflow publication attempt');expect(text).not.toContain('Join keys');expect(text).not.toContain('original answer or module changed');expect(text.match(/Review the applied inputs before continuing/g)).toHaveLength(2);
});
