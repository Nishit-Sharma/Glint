import {afterEach,expect,test,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {createCompanion} from '../../src/core/companion';
import {prepareWorkflowReview,createReviewedWorkflow} from '../../src/core/workflow-review-host';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';
import {LearningDraftProvider} from '../../src/renderer/src/learning-draft-context';
import {WorkflowSourceReview} from '../../src/renderer/src/components/WorkflowSourceReview';
import {workflowSourceOwner,workflowSourceReviewSlot} from '../../src/renderer/src/workflow-source-review-form';

function gate(){let release!:()=>void,enter!:()=>void;return {waiting:new Promise<void>(resolve=>release=resolve),entered:new Promise<void>(resolve=>enter=resolve),release:()=>release(),enter:()=>enter()};}
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
function text(node:{type:string;props:Record<string,any>;children:any[]}):string{return node.type==='#text'?node.props.text:node.children.map(text).join('');}
function injectSyntheticTooLong(cache:any){const original=cache.tryEdit.bind(cache);cache.tryEdit=(owner:any,slot:string,initial:any,basis:string,transform:any,arrays:any)=>{cache.tryEdit=original;return original(owner,slot,initial,basis,(current:any)=>({...transform(current),assumptions:'X'.repeat(600000)}),arrays);};}
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'controlled-literal-review-')),core=await createCompanion({dataDir:directory});cleanup.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 const task=await core.createTask({title:'Owned controlled review'}),sourced=await core.putSource(task.id,{kind:'text',role:'fact',label:'Owned rules',content:'Draft + Submit -> Ready\nReady + Edit -> Draft'}),source=sourced.sources[0],version=source.versions[0],refs=[{sourceId:source.id,version:version.version,digest:version.digest}],saved=await core.saveArtifact(task.id,{title:'Owned document',content:'Owned source reference.',mimeType:'text/markdown',sourceRefs:refs}),basis={artifactId:saved.artifactId,revision:saved.revision.revision,digest:saved.revision.digest},current=await core.getTask(task.id),prepared=await prepareWorkflowReview(core,{taskId:task.id,basis});
 const store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(item=>item.id===id)});let rawGate:ReturnType<typeof gate>|undefined,replyGate:ReturnType<typeof gate>|undefined;
 const cache=createLearningDrafts({read:()=>store.read(),save:async(...args)=>{if(args[1]===workflowSourceReviewSlot&&args[4]!==null&&rawGate){const held=rawGate;rawGate=undefined;held.enter();await held.waiting;}return store.save(...args);}});await cache.load();
 let publishes=0,opened=0,back=0;const submissions:any[]=[];const run=async(command:any)=>{if(command.type==='workflow.prepare')return prepared;if(command.type==='workflow.review'){publishes++;submissions.push(structuredClone(command));const {type,...input}=command,result=await createReviewedWorkflow(core,input);if(replyGate){const held=replyGate;replyGate=undefined;held.enter();await held.waiting;}return result;}throw Error('Unexpected command '+command.type);};
 const renderer=createControlledRenderer(()=>createElement(LearningDraftProvider,{cache,children:createElement(WorkflowSourceReview,{task:current,basis,busy:false,run:run as any,onCreated:()=>{opened++;},onCancel:()=>{back++;},continuationScope:'owned-scope'})}));
 const button=(name:string)=>renderer.find(node=>node.type==='button'&&text(node)===name),textarea=()=>renderer.find(node=>node.type==='textarea'&&node.props.rows===3),form=()=>renderer.find(node=>node.type==='form');
 const select=(index:number,value:string)=>{const items=renderer.nodes().filter(node=>node.type==='select');items[index].props.onChange({target:{value}});renderer.render();};
 renderer.render();await vi.waitFor(()=>{renderer.render();expect(renderer.nodes().some(node=>node.type==='select')).toBe(true);});select(0,'Draft');select(1,'Submit');await cache.flush();renderer.render();
 return {renderer,cache,store,core,task,submissions,owner:workflowSourceOwner(task.id,basis),button,textarea,form,get publishes(){return publishes;},get opened(){return opened;},get back(){return back;},holdRaw(){rawGate=gate();return rawGate;},holdReply(){replyGate=gate();return replyGate;},async confirm(){const checkbox=renderer.find(node=>node.type==='input'&&node.props.type==='checkbox'&&node.props.checked===false&&node.props.onChange&&node.props.disabled===false&&text(node)==='');checkbox.props.onChange({target:{checked:true}});renderer.render();}};
}

for(const mode of ['synthetic-rejection','accepted-edit'] as const)test(`literal caller releases a held pre-dispatch preparation after ${mode}`,async()=>{
 const f=await fixture(),held=f.holdRaw();
 try{
  f.textarea().props.onChange({target:{value:'Previous accepted raw'}});f.renderer.render();await held.entered;
  await f.confirm();f.form().props.onSubmit({preventDefault(){}});f.renderer.render();
  expect(f.button('Creating workflow experiment…').props.disabled).toBe(true);expect(f.button('Back to document').props.disabled).toBe(true);
  if(mode==='synthetic-rejection'){
   // The real bounded literal form cannot reach this size through its HTML limits.
   // Inject only an exact-slot cache refusal, never a user-data payload.
   injectSyntheticTooLong(f.cache);
  }
  f.textarea().props.onChange({target:{value:'Corrected user edit'}});f.renderer.render();
  expect(f.button('Back to document').props.disabled).toBe(false);expect(f.textarea().props.disabled).toBe(false);expect(f.button('Create workflow experiment').props.disabled).toBe(true);expect(f.publishes).toBe(0);
  expect(f.textarea().props.value).toBe(mode==='synthetic-rejection'?'Previous accepted raw':'Corrected user edit');
  if(mode==='synthetic-rejection')expect(f.cache.getEditRejection(f.owner,workflowSourceReviewSlot)?.reason).toBe('text-too-long');
  // The controlled onCancel records the caller's Back invocation; it does not
  // emulate an App unmount, so the same fixture can test explicit correction.
  f.button('Back to document').props.onClick();expect(f.back).toBe(1);
  held.release();await f.cache.flush();await Promise.resolve();await Promise.resolve();f.renderer.render();expect(f.publishes).toBe(0);expect((await f.core.getTask(f.task.id)).requests).toEqual([]);
  f.textarea().props.onChange({target:{value:'Fresh explicit correction'}});f.renderer.render();await f.cache.flush();f.renderer.render();expect(f.cache.getEditRejection(f.owner,workflowSourceReviewSlot)).toBeUndefined();await f.confirm();f.form().props.onSubmit({preventDefault(){}});f.renderer.render();
  await vi.waitFor(async()=>expect((await f.core.getTask(f.task.id)).requests).toHaveLength(1));f.cache.setFrozen(true);await f.cache.flushForQuit();const stored=await f.store.read();if(stored.kind!=='available')throw Error('Expected owned sidecar');expect(stored.records.find(record=>record.slot===workflowSourceReviewSlot)?.value).toBeNull();expect(f.publishes).toBe(1);
 }finally{held.release();await f.cache.flush().catch(()=>{});}
});

test('a synthetic later refusal cannot cancel a real dispatched commit or its exact raw acknowledgement',async()=>{
 const f=await fixture(),reply=f.holdReply();
 try{
  f.textarea().props.onChange({target:{value:'Accepted raw before dispatch'}});f.renderer.render();await f.cache.flush();await f.confirm();
  f.form().props.onSubmit({preventDefault(){}});f.renderer.render();await reply.entered;expect(f.publishes).toBe(1);expect((await f.core.getTask(f.task.id)).requests[0].status).toBe('completed');
  injectSyntheticTooLong(f.cache);f.textarea().props.onChange({target:{value:'Synthetic refused edit'}});f.renderer.render();
  expect(f.cache.getEditRejection(f.owner,workflowSourceReviewSlot)?.reason).toBe('text-too-long');expect(f.button('Back to document').props.disabled).toBe(true);expect(f.button('Creating workflow experiment…').props.disabled).toBe(true);
  f.cache.setFrozen(true);const quit=f.cache.flushForQuit();reply.release();await quit;
  const stored=await f.store.read();if(stored.kind!=='available')throw Error('Expected owned sidecar');expect(stored.records.find(record=>record.slot===workflowSourceReviewSlot)?.value).toBeNull();expect((await f.core.getTask(f.task.id)).requests).toHaveLength(1);expect(f.opened).toBe(0);
 }finally{reply.release();await f.cache.flush().catch(()=>{});}
});

for(const order of ['old-first','new-first'] as const)test(`retired literal preparation cannot suppress newer confirmed work when ${order} flush result is delivered`,async()=>{
 for(const preserveNewer of [false,true]){
  const f=await fixture(),raw=f.holdRaw(),oldResult=gate(),newResult=gate(),reply=f.holdReply(),original=f.cache.flushForm.bind(f.cache);let calls=0;
  // Actual sidecar/CAS writes still drain in their native order. Only delivery
  // of the two successful raw flush results is controlled by these gates.
  (f.cache as any).flushForm=async(owner:any,slot:string)=>{const wait=slot===workflowSourceReviewSlot&&calls<2?[oldResult,newResult][calls++]:undefined;await original(owner,slot);if(wait){wait.enter();await wait.waiting;}};
  try{
   f.textarea().props.onChange({target:{value:'First accepted raw'}});f.renderer.render();await raw.entered;await f.confirm();
   f.form().props.onSubmit({preventDefault(){}});f.renderer.render();expect(f.button('Creating workflow experiment…').props.disabled).toBe(true);
   f.textarea().props.onChange({target:{value:'Second confirmed raw'}});f.renderer.render();expect(f.button('Back to document').props.disabled).toBe(false);await f.confirm();
   f.form().props.onSubmit({preventDefault(){}});f.renderer.render();expect(f.button('Creating workflow experiment…').props.disabled).toBe(true);
   raw.release();await Promise.all([oldResult.entered,newResult.entered]);expect(calls).toBe(2);
   if(order==='old-first'){oldResult.release();await new Promise<void>(resolve=>setImmediate(resolve));newResult.release();}
   else newResult.release();
   await vi.waitFor(()=>expect(f.publishes).toBe(1),{timeout:2000});await reply.entered;expect(f.submissions[0].review.assumptions).toEqual(['Second confirmed raw']);expect((await f.core.getTask(f.task.id)).requests[0].status).toBe('completed');
   if(order==='new-first'){oldResult.release();await new Promise<void>(resolve=>setImmediate(resolve));}
   if(preserveNewer){f.textarea().props.onChange({target:{value:'Third unapplied raw'}});f.renderer.render();await f.cache.flush();}
   reply.release();
   if(!preserveNewer)await vi.waitFor(()=>expect(f.opened).toBe(1),{timeout:2000});
   f.cache.setFrozen(true);await f.cache.flushForQuit();const task=await f.core.getTask(f.task.id);expect(task.requests).toHaveLength(1);expect(task.requests[0].status).toBe('completed');
   const read=await f.store.read();if(read.kind!=='available')throw Error('Expected owned sidecar');const record=read.records.find(item=>item.slot===workflowSourceReviewSlot);
   if(preserveNewer){expect(f.opened).toBe(0);expect(record?.value).toBeTruthy();expect(JSON.parse(record!.value!.value).assumptions).toBe('Third unapplied raw');}else expect(record?.value).toBeNull();
  }finally{raw.release();oldResult.release();newResult.release();reply.release();await f.cache.flush().catch(()=>{});}
 }
});
