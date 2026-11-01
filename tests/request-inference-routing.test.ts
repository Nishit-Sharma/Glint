import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCompanion} from '../src/core/companion';
import {CodexProvider,type CodexConnection} from '../src/host/codex-provider';
import {buildCodexInferenceWire,readRequestInferenceCommand,resolveRequestInference,type RequestInferenceModel} from '../src/shared/request-inference';

const defaults={provider:'codex' as const,model:'gpt-6-luna',effort:'medium',tier:'priority' as const};
const models:RequestInferenceModel[]=[
 {id:'gpt-6-luna',label:'Luna',efforts:['medium','high'],tiers:[{id:'priority',label:'Fast'}],initialEffort:'medium',initialTier:'priority'},
 {id:'gpt-6.1-sol',label:'Sol',efforts:['high'],tiers:[{id:'priority',label:'Fast'}],initialEffort:'high',initialTier:'priority'},
];
it('Auto chooses a model per input while Fixed and pending follow-ups keep their exact choice',()=>{
 const session={requestInference:{revision:2,selection:defaults,policy:'automatic' as const}};
 const routine=resolveRequestInference(session,'codex',defaults,undefined,{prompt:'Say hello in Spanish.',kind:'explain',models});
 const deliberate=resolveRequestInference(session,'codex',defaults,undefined,{prompt:'Compare these database designs and reason through their tradeoffs.',kind:'explain',models});
 expect(routine.selection).toEqual(defaults);
 expect(deliberate.selection).toEqual({provider:'codex',model:'gpt-6.1-sol',effort:'high',tier:'priority'});
 expect(deliberate.decision).toMatchObject({policy:'automatic',rule:'deliberate'});
 expect(session.requestInference.selection).toEqual(defaults);
 expect(resolveRequestInference({...session,requestInference:{...session.requestInference,policy:'fixed'}},'codex',defaults,undefined,{prompt:'Compare architectures.',kind:'explain',models}).selection).toEqual(defaults);
 expect(resolveRequestInference(session,'codex',defaults,{inference:routine.selection},{prompt:'Compare architectures.',kind:'explain',models}).selection).toEqual(defaults);
});

it('classifies the raw preview and trimmed submission identically at the prompt length boundary',()=>{
 const session={requestInference:{revision:2,selection:defaults,policy:'automatic' as const}},prompt='a'.repeat(600)+' \n';
 const previewInput={prompt,kind:'explain' as const,models},preview=resolveRequestInference(session,'codex',defaults,undefined,previewInput);
 const submitted=resolveRequestInference(session,'codex',defaults,undefined,{...previewInput,prompt:prompt.trim()});
 expect(preview.selection).toEqual(defaults);
 expect(preview.selection).toEqual(submitted.selection);expect(preview.decision).toEqual(submitted.decision);
 expect(previewInput.prompt).toBe('a'.repeat(600)+' \n');
 const longer=resolveRequestInference(session,'codex',defaults,undefined,{...previewInput,prompt:'a'.repeat(601)+' \n'});
 expect(longer.selection?.model).toBe('gpt-6.1-sol');
});

it('persists Auto beside the remembered fixed tuple, freezes queue settings and dispatches the inspected tuple',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-routing-'));let core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Routing owner'});await core.saveComposerDraft(task.id,0,{text:'Keep this unsent text.',kind:'explain'});
  await core.setRequestInference(task.id,0,defaults);await core.setRequestInference(task.id,1,defaults,undefined,'automatic');
  await expect(core.setRequestInference(task.id,2,{...defaults,model:'unadvertised'},undefined,'automatic')).rejects.toThrow(/keeps the existing fixed choice/);
  await core.close();core=await createCompanion({dataDir:directory});const owner=await core.getTask(task.id);
  expect(owner.session?.requestInference).toEqual({revision:2,selection:defaults,policy:'automatic'});expect(owner.session?.draft).toBe('Keep this unsent text.');
  const prompt='Compare these designs and reason about their tradeoffs.',preview=resolveRequestInference(owner.session,'codex',defaults,undefined,{prompt,kind:'explain',models});
  const queuedSettings=resolveRequestInference(owner.session,'codex',defaults,undefined,{prompt:'Say hello.',kind:'explain',models}).selection!;
  const basis=await core.queuedFollowupBasis(task.id,[],[]),item={id:'pending-routed',revision:1,prompt:'Say hello.',kind:'explain' as const,createdAt:'2026-11-01T00:00:00Z',sourceRefs:[],precedingRequestIds:[],basis,scope:'a'.repeat(64),status:'held' as const,inference:queuedSettings};
  await core.saveQueuedFollowup(task.id,item,0);
  const calls:{method:string;params:Record<string,unknown>}[]=[],listeners=new Set<(event:{method:string;params:Record<string,unknown>})=>void>();
  const connection:CodexConnection={notify(){},close(){},subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},async request(method,params){
   calls.push({method,params});if(method==='initialize')return {};if(method==='account/read')return {account:{type:'chatgpt',email:'local-routing@example.invalid'}};
   if(method==='model/list')return {data:models.map(model=>({model:model.id,displayName:model.label,defaultServiceTier:model.initialTier,serviceTiers:model.tiers.map(tier=>({id:tier.id,name:tier.label})),supportedReasoningEfforts:model.efforts.map(reasoningEffort=>({reasoningEffort}))}))};
   if(method==='thread/start')return {thread:{id:'thread'},sandbox:{type:'readOnly'},model:params.model,serviceTier:params.serviceTier,reasoningEffort:(params.config as {model_reasoning_effort:string}).model_reasoning_effort,instructionSources:[]};
   if(method==='turn/start'){queueMicrotask(()=>{for(const listener of listeners){listener({method:'turn/started',params:{threadId:'thread',turn:{id:'turn'}}});listener({method:'item/completed',params:{threadId:'thread',item:{id:'answer',type:'agentMessage',phase:'final_answer',text:'Local protocol fixture.'}}});listener({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});}});return {turn:{id:'turn'}};}throw Error('Unexpected fixture method '+method);
  }};
  const provider=new CodexProvider({connect:async()=>connection,cliPath:'/synthetic/codex',serviceTier:'priority'});
  await core.runRequest({taskId:task.id,requestId:'routed-direct',kind:'explain',prompt,inference:preview.selection,inferenceRevision:preview.revision},async ctx=>{
   expect(ctx.task.session).not.toHaveProperty('requestInference');
   return {title:'Protocol fixture',content:await provider.run({prompt,sources:[],signal:ctx.signal,inference:preview.selection})};
  });
  const wire=buildCodexInferenceWire(preview.selection!);expect(calls.find(call=>call.method==='thread/start')!.params).toMatchObject(wire.thread);expect(calls.find(call=>call.method==='turn/start')!.params).toMatchObject({model:'gpt-6.1-sol',effort:'high',serviceTierForTurn:'priority'});expect(calls.find(call=>call.method==='turn/start')!.params).toMatchObject(wire.turn);
  await core.setRequestInference(task.id,2,defaults,undefined,'fixed');const fixed=await core.getTask(task.id);
  expect(fixed.session?.requestInference).toEqual({revision:3,selection:defaults});expect(fixed.session?.queuedFollowups![0].inference).toEqual(defaults);
  expect(resolveRequestInference(fixed.session,'codex',defaults,fixed.session?.queuedFollowups![0],{prompt,kind:'explain',models}).selection).toEqual(defaults);
  await expect(core.runRequest({taskId:task.id,requestId:'stale-policy',kind:'explain',prompt,inference:preview.selection,inferenceRevision:preview.revision},async()=>({title:'Never',content:'Never'}))).rejects.toThrow(/model choice changed/);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

it('stops an unsupported Auto route without selecting a substitute or a different speed tier',()=>{
 const session={requestInference:{revision:1,selection:null,policy:'automatic' as const}},input={prompt:'Compare these alternatives.',kind:'explain' as const,models};
 expect(()=>resolveRequestInference(session,'codex',defaults,undefined,{...input,models:[models[0]]})).toThrow(/No substitute/);
 expect(()=>resolveRequestInference(session,'codex',{...defaults,tier:'default'},undefined,input)).toThrow(/No substitute/);
 expect(()=>resolveRequestInference(session,'meta',defaults,undefined,input)).toThrow(/Reconnect Codex/);
 expect(()=>readRequestInferenceCommand({type:'inference.select',taskId:'owner',expectedRevision:0,selection:null,policy:'vendor-smart-router'})).toThrow();
});
