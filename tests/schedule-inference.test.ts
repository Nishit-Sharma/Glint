import {expect,test} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {transformSync} from 'esbuild';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {CodexProvider} from '../src/host/codex-provider';
import {recurringInference,recurringRequestInference,recurringResponseScope,readRecurringInferenceCommand} from '../src/shared/recurring-work';
import type {RequestInferenceCatalog} from '../src/shared/request-inference';

test('a schedule saves its own tuple paused, retains it through reopen, retires authorization on edit and prepares the actual task with that tuple',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-schedule-inference-'));const now=new Date('2026-11-01T15:00:00.000Z');let core=await createCompanion({dataDir:directory,now:()=>now});
 try{
  const original=await core.createTask({title:'Unrelated task'}),inference={provider:'codex' as const,model:'advertised-model',effort:'high',tier:'default' as const},save={kind:'save' as const,id:'owned-schedule',expectedRevision:0,title:'Owned model schedule',instruction:'Synthetic unsent question.',intervalHours:24 as const,nextDueAt:now.toISOString(),mode:'response' as const,inference};
  let [item]=await core.changeRecurringWork(save);expect(item).toMatchObject({enabled:false,inference});expect(await core.prepareRecurringWork('bot',()=>{},[item.id])).toEqual([]);
  await core.close();core=await createCompanion({dataDir:directory,now:()=>now});[item]=await core.getRecurringWork();expect(item).toMatchObject({enabled:false,inference});expect((await core.getTask(original.id)).session?.requestInference).toBeUndefined();
  [item]=await core.changeRecurringWork({...save,expectedRevision:item.revision,inference:{...inference,effort:'low'}});expect(item.enabled).toBe(false);await core.changeRecurringWork({kind:'resume',id:item.id,expectedRevision:item.revision});const [id]=await core.prepareRecurringWork('bot',()=>{},[item.id]),prepared=await core.getTask(id);expect(prepared.session?.requestInference).toMatchObject({selection:{...inference,effort:'low'},policy:'fixed'});expect(prepared.requests).toEqual([]);expect(prepared.sources).toEqual([]);
  const catalog:RequestInferenceCatalog={kind:'available',defaultSelection:{...inference,model:'connection-default',effort:'medium'},models:[{id:inference.model,label:'Advertised model',efforts:['low','high'],tiers:[{id:'default',label:'Standard'}],initialEffort:'high',initialTier:'default'}]},snapshot=await core.contentSnapshot(),decision=recurringInference(item,'codex',catalog.defaultSelection,catalog),scope=recurringResponseScope(item);
  expect(decision).toMatchObject({source:'saved',selection:{...inference,effort:'low'},wire:{thread:{model:inference.model,allowProviderModelFallback:false,config:{model_reasoning_effort:'low'}},turn:{model:inference.model,effort:'low'}}});expect(await core.contentSnapshot()).toEqual(snapshot);expect(recurringResponseScope({...item,inference})).not.toBe(scope);expect(()=>recurringInference(item,'meta',catalog.defaultSelection,catalog)).toThrow(/Codex/);expect(()=>recurringInference(item,'codex',catalog.defaultSelection,{kind:'unavailable',message:'No cached options'})).toThrow(/cached/);
  const options=recurringRequestInference({inference:decision.selection},prepared);await core.runRequest({taskId:id,requestId:'owned-protocol-only',kind:'explain',prompt:save.instruction,inference:options.selection,inferenceRevision:options.revision},async()=>({title:'Synthetic local boundary',content:'No provider transport exists in this test.'}));expect((await core.getTask(id)).requests[0].inference).toEqual(decision.selection);
  [item]=await core.getRecurringWork();[item]=await core.changeRecurringWork({...save,expectedRevision:item.revision,inference});expect(item).toMatchObject({enabled:false,inference});await expect(core.changeRecurringWork(save)).rejects.toThrow(/changed/);
  let calls=0;const provider=new CodexProvider({connect:async()=>{calls++;throw Error('No connection permitted');}});expect(provider.cachedCatalog().kind).toBe('unavailable');expect(calls).toBe(0);provider.close();
  // Execute the unchanged production admission prefix and actual schedule read
  // cases. No Electron startup, OS surface or provider transport is constructed.
  const source=await readFile('src/host/index.ts','utf8'),start=source.indexOf('function validate(value:unknown):Command{'),end=source.indexOf("  if(c.type==='schedules.get')",start),helpers=source.slice(source.indexOf('const object='),source.indexOf('function validateComposerValue'));
  if(start<0||end<start)throw Error('Production schedule admission boundary missing');
  const code=transformSync(helpers+source.slice(start,end)+"\n throw Error('Outside this bounded schedule admission check');\n}",{loader:'ts'}).code,validate=new Function('readRecurringInferenceCommand',code+'\nreturn validate;')(readRecurringInferenceCommand) as (input:unknown)=>unknown;
  expect(validate({type:'schedules.models'})).toEqual({type:'schedules.models'});expect(()=>validate({type:'schedules.models',refresh:true})).toThrow();expect(()=>validate({type:'schedules.execute'})).toThrow();
  const readStart=source.indexOf("    case 'schedules.models':"),readEnd=source.indexOf("    case 'schedules.get':",readStart);if(readStart<0||readEnd<readStart)throw Error('Production schedule dispatch boundary missing');
  const dispatch=new Function('core','codexProvider','selectedProvider','assertCurrentWork','recurringGrants','recurringScope','createHash','recurringInference','keyEpoch','return async c=>{const lifecycle=0;switch(c.type){'+source.slice(readStart,readEnd)+'}};')(core,{cachedCatalog:()=>catalog,defaultInference:()=>catalog.defaultSelection},'codex',()=>{},new Map(),recurringResponseScope,createHash,recurringInference,0) as (input:unknown)=>Promise<unknown>;
  const prior=await core.contentSnapshot();expect(await dispatch(validate({type:'schedules.models'}))).toEqual(catalog);expect(await dispatch(validate({type:'schedules.preview',id:item.id,expectedRevision:item.revision}))).toMatchObject({id:item.id,revision:item.revision,authorized:false,source:'saved',selection:inference,wire:{thread:{model:inference.model,allowProviderModelFallback:false}}});expect(await core.contentSnapshot()).toEqual(prior);
 }
 finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
