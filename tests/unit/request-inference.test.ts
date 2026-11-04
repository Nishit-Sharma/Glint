import {queuedInferenceReview} from '../../src/host/queued-inference-review';
import type {ConnectionStatus} from '../../src/shared/bridge';
import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createCompanion} from '../../src/core/companion';
import {CodexProvider,type CodexConnection} from '../../src/host/codex-provider';
import {buildCodexInferenceWire,resolveRequestInference,requestInferenceScopeFields,readRequestInferenceCommand,type RequestInferenceSelection} from '../../src/shared/request-inference';
import type {QueuedFollowup} from '../../src/shared/queued-followup';
const selected={provider:'codex' as const,model:'fixture-model',effort:'high',tier:'default' as const};
const future={...selected,effort:'low',tier:'priority' as const};
function protocol(){
 const calls:{method:string;params:Record<string,unknown>}[]=[],listeners=new Set<(event:{method:string;params:Record<string,unknown>})=>void>();
 const connection:CodexConnection={notify(){},subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},close(){},async request(method,params){
  calls.push({method,params});if(method==='initialize')return {};if(method==='account/read')return {account:{type:'chatgpt',email:'private-fixture@example.invalid'}};
  if(method==='model/list')return {data:[{model:'gpt-6-luna',defaultServiceTier:null,serviceTiers:[{id:'priority',name:'Fast'}],supportedReasoningEfforts:[{reasoningEffort:'medium'}]},{model:'fixture-model',displayName:'Fixture model',defaultServiceTier:null,serviceTiers:[{id:'priority',name:'Fast'}],defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}]},{model:'fast-only',defaultServiceTier:'priority',serviceTiers:[{id:'priority',name:'Fast'}],supportedReasoningEfforts:[{reasoningEffort:'low'}]}]};
  if(method==='thread/start')return {thread:{id:'thread'},sandbox:{type:'readOnly'},model:params.model,serviceTier:params.serviceTier,reasoningEffort:(params.config as Record<string,unknown>).model_reasoning_effort,instructionSources:[]};
  if(method==='turn/start'){queueMicrotask(()=>{for(const listener of listeners){listener({method:'turn/started',params:{threadId:'thread',turn:{id:'turn'}}});listener({method:'item/completed',params:{threadId:'thread',item:{id:'answer',type:'agentMessage',phase:'final_answer',text:'Synthetic local protocol result'}}});listener({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});}});return {turn:{id:'turn'}};}throw Error('Unexpected fixture method '+method);
 }};
 return {calls,provider:new CodexProvider({connect:async()=>connection,cliPath:'/synthetic/codex',serviceTier:'default'})};
}
it('persists exact task inference settings without touching its unsent text, sources or another task',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-inference-test-'));let core=await createCompanion({dataDir:directory});try{
  const task=await core.createTask({title:'Inference owner'}),other=await core.createTask({title:'Other owner'});await core.putSource(task.id,{kind:'text',label:'Existing source',content:'Keep this exact source.',role:'fact'});await core.saveComposerDraft(task.id,0,{text:'Keep this unsent question\n',kind:'explain'});const before=await core.getTask(task.id);
  const saved=await core.setRequestInference(task.id,0,selected);expect(saved).toEqual({taskId:task.id,revision:1,selection:selected});const after=await core.getTask(task.id);expect(after.session?.draft).toBe(before.session?.draft);expect(after.session?.draftRevision).toBe(before.session?.draftRevision);expect(after.sources).toEqual(before.sources);expect(after.requests).toEqual([]);expect(await core.getTask(other.id)).toEqual(other);
  await expect(core.setRequestInference(task.id,0,future)).rejects.toThrow(/changed/);await core.close();core=await createCompanion({dataDir:directory});expect((await core.getTask(task.id)).session?.requestInference).toEqual({revision:1,selection:selected});
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
it('binds the exact chosen model, effort and speed to the same preview and real adapter wire fields without fallback',async()=>{
 const f=protocol(),wire=buildCodexInferenceWire(selected);expect(await f.provider.run({prompt:'Synthetic protocol check',sources:[],signal:new AbortController().signal,inference:selected})).toBe('Synthetic local protocol result');
 const thread=f.calls.find(call=>call.method==='thread/start')!.params,turn=f.calls.find(call=>call.method==='turn/start')!.params;
 expect(thread).toMatchObject({model:'fixture-model',serviceTier:'default',allowProviderModelFallback:false,config:{model_reasoning_effort:'high'}});expect(turn).toMatchObject({model:'fixture-model',effort:'high',serviceTierForTurn:'default'});expect(thread).toMatchObject(wire.thread);expect(turn).toMatchObject(wire.turn);
});
it('reads only account/catalog metadata and exposes exactly advertised effort/tier combinations without account identity',async()=>{
 const f=protocol(),catalog=await f.provider.catalog();expect(catalog.kind).toBe('available');if(catalog.kind!=='available')throw Error();expect(catalog.models.find(model=>model.id==='fixture-model')).toMatchObject({efforts:['low','high'],tiers:[{id:'default',label:'Standard'},{id:'priority',label:'Fast'}]});expect(catalog.models.find(model=>model.id==='fast-only')!.tiers).toEqual([{id:'priority',label:'Fast'}]);expect(JSON.stringify(catalog)).not.toContain('private-fixture');expect(f.calls.map(call=>call.method)).toEqual(['initialize','account/read','model/list']);
 const unsupported=protocol();await expect(unsupported.provider.run({prompt:'Never sent',sources:[],signal:new AbortController().signal,inference:{...selected,model:'fast-only',effort:'low',tier:'default'}})).rejects.toMatchObject({code:'TIER_UNAVAILABLE'});expect(unsupported.calls.some(call=>call.method==='thread/start'||call.method==='turn/start')).toBe(false);
});
it('freezes queued options and identity while a newer task preference applies only to later direct requests',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-inference-queue-')),core=await createCompanion({dataDir:directory});try{
  const task=await core.createTask({title:'Queue owner'});await core.setRequestInference(task.id,0,selected);
  const basis=await core.queuedFollowupBasis(task.id,[],[]),scope=createHash('sha256').update(JSON.stringify(['base',...requestInferenceScopeFields(selected)])).digest('hex');
  const item:QueuedFollowup={id:'frozen-options',revision:1,prompt:'Exact queued question',kind:'explain',createdAt:'2026-11-01T00:00:00Z',sourceRefs:[],status:'queued',basis,scope,precedingRequestIds:[],inference:selected};await core.saveQueuedFollowup(task.id,item,0);await core.setRequestInference(task.id,1,future);
  const current=await core.getTask(task.id),queued=current.session!.queuedFollowups![0];expect(queued.inference).toEqual(selected);expect(resolveRequestInference(current.session,'codex',selected).selection).toEqual(future);const frozen=resolveRequestInference(current.session,'codex',selected,queued);expect(frozen.selection).toEqual(selected);expect(requestInferenceScopeFields(future)).not.toEqual(requestInferenceScopeFields(selected));
  const f=protocol();await core.runRequest({taskId:task.id,requestId:item.id,kind:item.kind,prompt:item.prompt,sourceIds:[],inference:frozen.selection,queuedFollowup:{id:item.id,revision:item.revision,basis:item.basis,scope:item.scope}},async ctx=>{expect(ctx.task.session).not.toHaveProperty('requestInference');expect(await f.provider.run({prompt:item.prompt,sources:[],signal:ctx.signal,inference:frozen.selection})).toBe('Synthetic local protocol result');return {title:'Synthetic result',content:'No external request was made.'};});
  expect(f.calls.find(call=>call.method==='turn/start')!.params).toMatchObject({model:'fixture-model',effort:'high',serviceTierForTurn:'default'});expect((await core.getTask(task.id)).requests[0].inference).toEqual(selected);
  await expect(core.runRequest({taskId:task.id,requestId:item.id,kind:item.kind,prompt:item.prompt,sourceIds:[],inference:future,queuedFollowup:{id:item.id,revision:item.revision,basis:item.basis,scope:item.scope}},async()=>({title:'Never',content:'Never'}))).rejects.toThrow(/different payload/);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
it('rejects unadvertised authority and refuses another-provider fallback while preserving explicit connection defaults',()=>{
 expect(()=>readRequestInferenceCommand({type:'inference.select',taskId:'owner',expectedRevision:0,selection:{...selected,tools:true}})).toThrow();expect(()=>resolveRequestInference({requestInference:{revision:1,selection:selected}},'meta',selected)).toThrow(/connection default/);expect(resolveRequestInference(undefined,'meta',selected).selection).toBeUndefined();
});

it('held queued approval validates and discloses its frozen model effort and speed instead of current defaults',async()=>{
 const frozen={...selected,tier:'priority' as const},current:ConnectionStatus={provider:'Codex (temporary)',configured:true,endpoint:'synthetic',model:'gpt-6-luna',reasoning:'medium',tier:'Standard',state:'ready',detail:'Synthetic metadata',specialized:{sam:'Disabled',computer:'Disabled'}},chosen:ConnectionStatus={...current,model:'fixture-model',reasoning:'high',tier:'Fast'};let defaultReads=0,selectedReads=0;
 const readers={current:async()=>{defaultReads++;return current;},selected:async(selection:RequestInferenceSelection)=>{selectedReads++;expect(selection).toEqual(frozen);return chosen;}};
 const review=await queuedInferenceReview(frozen,'codex',readers);expect.soft(review.destination).toBe('Codex (temporary) · fixture-model · high reasoning · Fast speed');expect.soft(defaultReads).toBe(0);expect.soft(selectedReads).toBe(1);
 await expect(queuedInferenceReview(frozen,'meta',readers)).rejects.toThrow(/connection default|Codex/);expect(resolveRequestInference(undefined,'codex',selected,{inference:frozen}).selection).toEqual(frozen);expect(()=>resolveRequestInference(undefined,'meta',selected,{inference:frozen})).toThrow(/Codex/);
});
