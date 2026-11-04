import {afterEach,expect,it,vi} from 'vitest';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createCompanion} from '../../src/core/companion';
import {parseCurrentState} from '../../src/core/store';
import {MetaProvider} from '../../src/host/provider';
import {runOrdinaryQuestionRequest} from '../../src/host/request-question-runner';
import {MUSE_PROFILES,type MuseProfile} from '../../src/shared/muse-connection';
import {confirmedResponseModel,readProviderModelReceipt,type ProviderModelReceipt} from '../../src/shared/response-model';
import {ResponseModelDetails} from '../../src/renderer/src/components/ResponseModelDetails';
import {Conversation} from '../../src/renderer/src/components/Conversation';

// Inert fetch exercises the installed SDK; no network, native state or real credentials.
const key='inert-meta-receipt-key',cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
function chunk(model:unknown,content:string,finish_reason:string|null=null){return 'data: '+JSON.stringify({id:'inert-response',created:1,...(model===undefined?{}:{model}),choices:[{index:0,delta:{content},finish_reason}]})+'\n\n';}
const complete=(model:unknown,text='Synthetic complete answer')=>new Response(chunk(model,text)+chunk(model,'','stop')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream','x-private':'not-for-receipt'}});
const render=(request:Parameters<typeof ResponseModelDetails>[0]['request'])=>renderToStaticMarkup(createElement(ResponseModelDetails,{request}));
async function coreFixture(){await mkdir(resolve('work/continuation'),{recursive:true});const directory=await mkdtemp(resolve('work/continuation/meta-receipts-'));let core=await createCompanion({dataDir:directory});cleanups.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});return {get core(){return core;},reopen:async()=>{await core.close();core=await createCompanion({dataDir:directory});return core;}};}

it.each(['meta-direct','baseten-hackathon'] as const)('persists actual SDK reported model separately from submitted %s profile and renders the reopened answer',async initialProfile=>{
 const f=await coreFixture(),task=await f.core.createTask({title:'Synthetic receipt owner'});let profile:MuseProfile=initialProfile;
 const fetch=vi.fn(async()=>complete('reported/muse-response-v2')),adapter=new MetaProvider({getKey:async()=>key,getProfile:()=>profile,fetch}),requestId='answer-'+profile;
 let receipt:ProviderModelReceipt|undefined;
 const saved=await f.core.runRequest({taskId:task.id,requestId,kind:'create',prompt:'Synthetic only.'},async()=>({title:'Answer',content:await adapter.run({prompt:'Synthetic only.',sources:[],signal:new AbortController().signal,modelReceipt:{requestId,onConfirmed:value=>{receipt=value;}}}),modelReceipt:receipt}));
 expect(saved.status).toBe('completed');expect(saved.responseModel).toEqual({requestId,provider:'meta',profile,requestedModel:MUSE_PROFILES[profile].model,model:'reported/muse-response-v2',confirmation:'completed-text-response',answer:saved.answer});expect(fetch).toHaveBeenCalledTimes(1);
 const original=saved.responseModel;profile=profile==='meta-direct'?'baseten-hackathon':'meta-direct';await adapter.status();await f.reopen();const reopened=await f.core.getTask(task.id),request=reopened.requests[0];expect(request.responseModel).toEqual(original);expect(confirmedResponseModel(request)).toEqual(original);
 const html=renderToStaticMarkup(createElement(Conversation,{task:reopened,active:false,renderBrief:()=>null,onArtifact:()=>{},onConnection:()=>{}}));expect(html).toContain('Response model · reported/muse-response-v2');expect(html).toContain(initialProfile==='baseten-hackathon'?'Submitted to Baseten hackathon':'Submitted to Meta Model API');expect(html).toContain('service reported');expect(html).not.toContain('reasoning');expect(JSON.stringify(request.responseModel)).not.toMatch(/https?:|endpoint|headers|not-for-receipt|inert-meta-receipt-key|accountScope|Bearer/);
});

it.each([undefined,'','https://inference.example/v1?token=PRIVATE',key,'contains '+key+' inside'])('keeps actual model unknown for missing or unsafe metadata %j, while retaining the submitted profile',async model=>{
 const f=await coreFixture(),task=await f.core.createTask({title:'Unknown model owner'}),adapter=new MetaProvider({getKey:async()=>key,getProfile:()=> 'baseten-hackathon',fetch:async()=>complete(model)});let modelReceipt:ProviderModelReceipt|undefined;
 const saved=await f.core.runRequest({taskId:task.id,requestId:'unknown-model',kind:'explain',prompt:'Synthetic only.'},async()=>({title:'Answer',content:await adapter.run({prompt:'Synthetic only.',sources:[],signal:new AbortController().signal,modelReceipt:{requestId:'unknown-model',onConfirmed:receipt=>{modelReceipt=receipt;}}}),modelReceipt}));
 expect(saved.status).toBe('completed');expect(saved.responseModel).toMatchObject({provider:'meta',model:null,profile:'baseten-hackathon',requestedModel:MUSE_PROFILES['baseten-hackathon'].model});await f.reopen();const request=(await f.core.getTask(task.id)).requests[0],html=render(request);expect(html).toContain('Response model · unknown');expect(html).toContain('could not be confirmed from available metadata');expect(html).toContain('requested model is not confirmation');expect(html).not.toContain('Codex reported');
});

it('replaces a prior clarification model receipt with unknown metadata on the final successful turn',async()=>{
 const question='GLINT_QUESTION_V1\n'+JSON.stringify({question:'Choose a synthetic format',mode:'single',options:[{id:'short',label:'Short'},{id:'long',label:'Long'}]});
 const fetch=vi.fn().mockResolvedValueOnce(complete('reported/clarification-only',question)).mockResolvedValueOnce(complete(undefined)),adapter=new MetaProvider({getKey:async()=>key,fetch}),receipts:ProviderModelReceipt[]=[];
 const content=await runOrdinaryQuestionRequest(adapter,{prompt:'Synthetic only.',sources:[]},{signal:new AbortController().signal,modelReceipt:{requestId:'same-request',onConfirmed:receipt=>receipts.push(receipt)}},{check:async()=>{},ask:async()=>({kind:'skip'})});
 expect(content).toBe('Synthetic complete answer');expect(receipts.map(receipt=>receipt.model)).toEqual(['reported/clarification-only',null]);expect(receipts.at(-1)).toMatchObject({requestId:'same-request',provider:'meta',model:null});
});

it('keeps metadata unknown when the installed adapter emitted only early identity metadata before a late model',async()=>{
 let receipt:ProviderModelReceipt|undefined;const adapter=new MetaProvider({getKey:async()=>key,fetch:async()=>new Response(chunk(undefined,'Synthetic answer')+chunk('late/model','','stop')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}})});
 await adapter.run({prompt:'Synthetic only.',sources:[],signal:new AbortController().signal,modelReceipt:{requestId:'late-metadata',onConfirmed:value=>{receipt=value;}}});expect(receipt).toMatchObject({model:null});
});

it.each(['length','http','abort'] as const)('does not issue or persist a completion receipt after %s failure',async mode=>{
 const f=await coreFixture(),task=await f.core.createTask({title:'Terminal receipt owner'}),controller=new AbortController(),onConfirmed=vi.fn();
 const fetch:typeof globalThis.fetch=async()=>mode==='http'?new Response('private service body '+key,{status:403}):new Response(chunk('reported/partial','Partial text')+chunk('reported/partial','','length')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}}),adapter=new MetaProvider({getKey:async()=>key,fetch});
 const saved=await f.core.runRequest({taskId:task.id,requestId:'terminal',kind:'explain',prompt:'Synthetic only.'},async()=>({title:'Never saved',content:await adapter.run({prompt:'Synthetic only.',sources:[],signal:controller.signal,onChunk:()=>{if(mode==='abort')controller.abort();},modelReceipt:{requestId:'terminal',onConfirmed}})}));
 expect(saved.status).toBe('failed');expect(saved.responseModel).toBeUndefined();expect(saved.answer).toBeUndefined();expect(onConfirmed).not.toHaveBeenCalled();expect((await f.core.getTask(task.id)).artifacts).toEqual([]);expect(saved.error).not.toContain(key);
});

it('strictly validates Meta variants, saved inference, request identity and answer binding',async()=>{
 const f=await coreFixture(),task=await f.core.createTask({title:'Strict Meta receipt owner'}),receipt={requestId:'strict',provider:'meta' as const,profile:'meta-direct' as const,requestedModel:MUSE_PROFILES['meta-direct'].model,model:'reported/model',confirmation:'completed-text-response' as const};
 expect(readProviderModelReceipt({...receipt,requestedModel:'historical/model-v1'})).toMatchObject({requestedModel:'historical/model-v1'});
 for(const invalid of [{...receipt,endpoint:'https://private.invalid/?secret=1'},{...receipt,profile:'untrusted'},{...receipt,requestedModel:'https://private.invalid/?secret=1'},{...receipt,confirmation:'accepted-thread-and-completed-turn'},{...receipt,effort:'high',tier:'default'}])expect(()=>readProviderModelReceipt(invalid)).toThrow();
 const mismatched=await f.core.runRequest({taskId:task.id,requestId:'wrong-owner',kind:'explain',prompt:'Synthetic only.'},async()=>({title:'Never saved',content:'Synthetic only.',modelReceipt:receipt}));expect(mismatched.status).toBe('failed');expect(mismatched.answer).toBeUndefined();
 const inference={provider:'codex' as const,model:'fixture-codex',effort:'medium',tier:'default' as const};const wrongProvider=await f.core.runRequest({taskId:task.id,requestId:'wrong-provider',kind:'explain',prompt:'Synthetic only.',inference,inferenceRevision:0},async()=>({title:'Never saved',content:'Synthetic only.',modelReceipt:{...receipt,requestId:'wrong-provider'}}));expect(wrongProvider.status).toBe('failed');expect(wrongProvider.responseModel).toBeUndefined();
 const saved=await f.core.runRequest({taskId:task.id,requestId:'strict',kind:'explain',prompt:'Synthetic only.'},async()=>({title:'Saved answer',content:'Synthetic only.',modelReceipt:receipt})),owner=await f.core.getTask(task.id),state={schemaVersion:2,tasks:[owner],usedRequestIds:owner.requests.map(request=>request.id)};expect(parseCurrentState(state).tasks[0].requests.at(-1)?.responseModel).toEqual(saved.responseModel);
 const request=owner.requests.at(-1)!;request.responseModel={...request.responseModel!,answer:{...request.responseModel!.answer,digest:'f'.repeat(64)}};expect(()=>parseCurrentState(state)).toThrow();expect(render(request)).toContain('Response model · unavailable');
});
