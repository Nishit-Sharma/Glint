import {afterEach,expect,it,vi} from 'vitest';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createCompanion} from '../src/core/companion';
import type {SourceVersion} from '../src/core/types';
import {MetaProvider} from '../src/host/provider';
import {runOrdinaryQuestionRequest} from '../src/host/request-question-runner';
import {publicErrorMessage} from '../src/shared/public-messages';
import {MUSE_CONNECTION_MESSAGES,MUSE_PROFILES} from '../src/shared/muse-connection';
import type {ProviderModelReceipt} from '../src/shared/response-model';
import {ResponseModelDetails} from '../src/renderer/src/components/ResponseModelDetails';

// Inert in-process OpenAI-compatible transport only: no network, no real key, no live Baseten result.
const KEY='inert-baseten-fixture-key-0000',ENDPOINT='https://inference.baseten.co/v1',MODEL='meta-models/muse-spark-open-1026';
type Call={url:string;authorization:string|null;headers:Record<string,string>;body:Record<string,any>;signal?:AbortSignal|null};
const cleanups:Array<()=>Promise<void>|void>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();vi.restoreAllMocks();});
const sse=(content:string,finish:string|null=null)=>'data: '+JSON.stringify({id:'inert',object:'chat.completion.chunk',created:1,model:MODEL,choices:[{index:0,delta:{content},finish_reason:finish}]})+'\n\n';
const stream=(...parts:string[])=>new Response(parts.map((part,index)=>sse(part,index===parts.length-1?'stop':null)).join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
function fakeServer(reply:(call:Call)=>Response|Promise<Response>=()=>stream('Synthetic ',"answer")){
 const calls:Call[]=[];
 const fetch=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{const headers=Object.fromEntries(new Headers(init?.headers).entries()),call={url:String(url),authorization:headers.authorization??null,headers,body:JSON.parse(String(init?.body)),signal:init?.signal};calls.push(call);return reply(call);}) as unknown as typeof globalThis.fetch;
 return {calls,fetch};
}
function baseten(fetch:typeof globalThis.fetch,key:string|null=KEY){return new MetaProvider({getKey:async profile=>profile==='baseten-hackathon'?key??undefined:'inert-other-profile-key',getProfile:()=>'baseten-hackathon',fetch});}
function consoleSpies(){return (['log','info','warn','error','debug','trace'] as const).map(name=>vi.spyOn(console,name).mockImplementation(()=>{}));}
const logged=(spies:ReturnType<typeof consoleSpies>)=>JSON.stringify(spies.flatMap(spy=>spy.mock.calls),(_k,v)=>v instanceof Error?{message:v.message,stack:v.stack}:v);
const text=(content='Synthetic fact: 2 + 2 = 4'):SourceVersion=>({id:'synthetic-text',version:1,digest:'synthetic-digest',capturedAt:'2026-11-04T00:00:00Z',kind:'text',label:'Synthetic note',role:'fact',content});

it('sends exactly one request to the Baseten endpoint and exact model, streaming deltas and keeping the key only in Authorization',async()=>{
 const spies=consoleSpies(),server=fakeServer(),adapter=baseten(server.fetch),chunks:string[]=[];
 expect(await adapter.status()).toMatchObject({provider:'Meta',metaProfile:'baseten-hackathon',endpoint:ENDPOINT,model:MODEL,configured:true,verified:false});
 const answer=await adapter.run({prompt:'Explain the synthetic note.',sources:[text()],signal:new AbortController().signal,onChunk:delta=>chunks.push(delta)});
 expect(answer).toBe('Synthetic answer');expect(chunks).toEqual(['Synthetic ','answer']);
 expect(server.calls).toHaveLength(1);const [call]=server.calls;
 expect(call.url).toBe(`${ENDPOINT}/chat/completions`);expect(call.body.model).toBe(MODEL);expect(call.body.stream).toBe(true);expect(call.body.max_tokens).toBe(4096);expect(call.body).not.toHaveProperty('max_completion_tokens');expect(call.body).not.toHaveProperty('tools');
 expect(call.authorization).toBe(`Bearer ${KEY}`);
 const elsewhere=JSON.stringify({url:call.url,body:call.body,headers:Object.fromEntries(Object.entries(call.headers).filter(([name])=>name!=='authorization'))});expect(elsewhere).not.toContain(KEY);
 expect(JSON.stringify(await adapter.status())).not.toContain(KEY);expect(logged(spies)).not.toContain(KEY);
});

it.each([[401,'AUTHENTICATION'],[403,'AUTHENTICATION'],[429,'RATE_LIMIT'],[500,'PROTOCOL'],[0,'TRANSPORT']] as const)('fails closed with no retry, fallback or key leakage on %s',async(status,code)=>{
 const spies=consoleSpies(),echo=`{"error":"PRIVATE_ECHO_BODY Authorization: Bearer ${KEY}"}`;
 const server=fakeServer(call=>{if(!status)throw new TypeError(`connect failed ${call.url} ${call.authorization}`);return new Response(echo,{status,headers:{'Content-Type':'application/json','x-echo':`Bearer ${KEY}`}});}),adapter=baseten(server.fetch),chunks:string[]=[];
 const error=await adapter.run({prompt:'Synthetic only.',sources:[],signal:new AbortController().signal,onChunk:delta=>chunks.push(delta)}).catch(value=>value);
 expect(error).toMatchObject({name:'MetaProviderError',code});expect(chunks).toEqual([]);
 expect(server.calls).toHaveLength(1);expect(server.calls[0].url).toBe(`${ENDPOINT}/chat/completions`);expect(server.calls[0].body.model).toBe(MODEL);
 const visible=JSON.stringify({message:error.message,stack:error.stack,status:await adapter.status()});
 expect(visible).toContain('inference.baseten.co');for(const secret of [KEY,'Bearer','Authorization','PRIVATE_ECHO_BODY'])expect(visible).not.toContain(secret);expect(logged(spies)).not.toContain(KEY);
});

it('never transmits or substitutes another profile key or model when the Baseten key is missing',async()=>{
 const server=fakeServer(),adapter=baseten(server.fetch,null);
 await expect(adapter.run({prompt:'Synthetic only.',sources:[],signal:new AbortController().signal})).rejects.toMatchObject({code:'UNCONFIGURED',message:expect.stringContaining('inference.baseten.co')});
 expect(server.fetch).not.toHaveBeenCalled();expect(await adapter.status()).toMatchObject({configured:false,endpoint:ENDPOINT,model:MODEL});
});

it('Stop aborts the in-flight Baseten stream, saves no completion receipt and does not retry',async()=>{
 const controller=new AbortController(),onConfirmed=vi.fn(),chunks:string[]=[];let transportSignal:AbortSignal|null|undefined;
 const server=fakeServer(call=>{transportSignal=call.signal;const encoder=new TextEncoder();return new Response(new ReadableStream({start(stream){stream.enqueue(encoder.encode(sse('Partial ')));call.signal?.addEventListener('abort',()=>stream.error(call.signal?.reason),{once:true});}}),{headers:{'Content-Type':'text/event-stream'}});});
 const adapter=baseten(server.fetch),pending=adapter.run({prompt:'Synthetic only.',sources:[],signal:controller.signal,onChunk:delta=>{chunks.push(delta);controller.abort();},modelReceipt:{requestId:'stopped',onConfirmed}});
 await expect(pending).rejects.toMatchObject({code:'CANCELLED'});
 expect(chunks).toEqual(['Partial ']);expect(transportSignal?.aborted).toBe(true);expect(server.calls).toHaveLength(1);expect(onConfirmed).not.toHaveBeenCalled();expect((await adapter.status()).verified).toBe(false);
});

it('encodes an explicitly attached captured image as an OpenAI-compatible image_url data part for the Baseten model',async()=>{
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('synthetic-non-image-payload')]).toString('base64');
 const image:SourceVersion={id:'synthetic-window',version:1,digest:'synthetic-image-digest',capturedAt:'2026-11-04T00:00:00Z',kind:'window',label:'Synthetic window',role:'fact',content:`data:image/png;base64,${png}`};
 const server=fakeServer(),adapter=baseten(server.fetch);
 await adapter.run({prompt:'Describe the synthetic image.',sources:[image],signal:new AbortController().signal});
 const body=server.calls[0].body,parts=body.messages.flatMap((message:{content:unknown})=>Array.isArray(message.content)?message.content:[]);
 expect(body.model).toBe(MODEL);expect(parts.filter((part:{type:string})=>part.type==='image_url')).toEqual([{type:'image_url',image_url:{url:`data:image/png;base64,${png}`}}]);
 expect(parts.some((part:{type:string;text?:string})=>part.type==='text'&&part.text?.includes('"sourceId":"synthetic-window"'))).toBe(true);
});

it('sends only the selected current (redacted) source version through core and records Baseten provenance with endpoint and exact model',async()=>{
 await mkdir(resolve('work/continuation'),{recursive:true});const directory=await mkdtemp(resolve('work/continuation/muse-baseten-')),core=await createCompanion({dataDir:directory});cleanups.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 let task=await core.createTask({title:'Synthetic Baseten owner'});
 task=await core.putSource(task.id,{id:'chosen',kind:'text',label:'Chosen synthetic note',content:'Visible PRIVATE_SYNTHETIC_MARK tail',role:'fact'});
 task=await core.putSource(task.id,{id:'unselected',kind:'text',label:'Unselected synthetic note',content:'UNSELECTED_SYNTHETIC_MARK',role:'fact'});
 const chosen=task.sources.find(source=>source.id==='chosen')!,version=chosen.versions.at(-1)!;
 await core.redactSource(task.id,{sourceId:'chosen',version:version.version,digest:version.digest},[{start:8,end:30}]);
 const server=fakeServer(),adapter=baseten(server.fetch);let receipt:ProviderModelReceipt|undefined;
 const saved=await core.runRequest({taskId:task.id,requestId:'baseten-answer',kind:'explain',prompt:'Explain the chosen synthetic note.',sourceIds:['chosen']},async ctx=>({title:'Answer',
  // Mirrors the host model.run mapping: each projected source contributes only its current version.
  content:await adapter.run({prompt:'Explain the chosen synthetic note.',sources:ctx.task.sources.map(source=>({...source.versions.at(-1)!})),signal:ctx.signal,modelReceipt:{requestId:'baseten-answer',onConfirmed:value=>{receipt=value;}}}),modelReceipt:receipt}));
 const wire=JSON.stringify(server.calls[0].body);
 expect(wire).toContain('Visible [redacted] tail');expect(wire).not.toContain('PRIVATE_SYNTHETIC_MARK');expect(wire).not.toContain('UNSELECTED_SYNTHETIC_MARK');expect(server.calls).toHaveLength(1);
 expect(saved.status).toBe('completed');expect(saved.responseModel).toMatchObject({provider:'meta',profile:'baseten-hackathon',requestedModel:MODEL,model:MODEL,confirmation:'completed-text-response'});
 expect(MUSE_PROFILES['baseten-hackathon'].endpoint).toBe(ENDPOINT);expect(JSON.stringify(saved.responseModel)).not.toContain(KEY);
 const html=renderToStaticMarkup(createElement(ResponseModelDetails,{request:saved}));expect(html).toContain('Submitted to Baseten hackathon');expect(html).toContain(ENDPOINT);expect(html).toContain(`requested ${MODEL}`);
});

it('reports status and account scope from the credential identity only, and Stop ends a pending Keychain unlock before any transport',async()=>{
 const server=fakeServer(),getKey=vi.fn((_profile:string,wait?:{signal?:AbortSignal;onWaiting?:()=>void})=>new Promise<string|undefined>((_resolve,reject)=>{wait?.onWaiting?.();wait?.signal?.addEventListener('abort',()=>reject(Error('stopped')),{once:true});}));
 const statuses:string[]=[],adapter=new MetaProvider({getKey,credentialIdentity:async()=>'encrypted:inert-identity',getProfile:()=>'baseten-hackathon',fetch:server.fetch,onStatus:status=>statuses.push(status.detail)});
 expect(await adapter.status()).toMatchObject({configured:true,endpoint:ENDPOINT,model:MODEL});expect(await adapter.accountScope()).toMatch(/^[a-f0-9]{64}$/);expect(getKey).not.toHaveBeenCalled();
 const controller=new AbortController(),pending=adapter.run({prompt:'Synthetic only.',sources:[],signal:controller.signal});
 await vi.waitFor(()=>expect(getKey).toHaveBeenCalledTimes(1));expect(statuses).toContain(MUSE_CONNECTION_MESSAGES.keychainWaiting);expect(await adapter.status()).toMatchObject({configured:true});
 controller.abort();await expect(pending).rejects.toMatchObject({code:'CANCELLED',message:MUSE_CONNECTION_MESSAGES.keychainCancelled});expect(server.fetch).not.toHaveBeenCalled();expect(statuses.at(-1)).not.toBe(MUSE_CONNECTION_MESSAGES.keychainWaiting);
});

it.each(['denied','rejected'] as const)('maps a saved key that Keychain will not unlock (%s) to a clear public message and a needs-reconnection status, without transport',async mode=>{
 const server=fakeServer(),getKey=vi.fn(async()=>{if(mode==='rejected')throw Error('PRIVATE keychain diagnostic');return undefined;}),adapter=new MetaProvider({getKey,credentialIdentity:async()=>'encrypted:inert-identity',getProfile:()=>'baseten-hackathon',fetch:server.fetch});
 const error=await adapter.run({prompt:'Synthetic only.',sources:[],signal:new AbortController().signal}).catch(value=>value);
 expect(error).toMatchObject({name:'MetaProviderError',code:'UNCONFIGURED',message:MUSE_CONNECTION_MESSAGES.keychainUnavailable});expect(publicErrorMessage(error)).toBe(MUSE_CONNECTION_MESSAGES.keychainUnavailable);expect(server.fetch).not.toHaveBeenCalled();
 expect(await adapter.status()).toMatchObject({configured:true,verified:false,state:'error',detail:MUSE_CONNECTION_MESSAGES.keychainUnavailable});expect(JSON.stringify(await adapter.status())).not.toContain('PRIVATE');
 adapter.reset();expect(await adapter.status()).toMatchObject({configured:true,state:'ready'});
});

it('Stop on an ordinary Ask ends a pending Keychain wait through the core request, with nothing sent or saved',async()=>{
 const directory=await mkdtemp(resolve('work/continuation/muse-keychain-stop-')),core=await createCompanion({dataDir:directory});cleanups.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 const task=await core.createTask({title:'Synthetic keychain stop'}),server=fakeServer(),getKey=vi.fn((_profile:string,wait?:{signal?:AbortSignal})=>new Promise<string|undefined>((_resolve,reject)=>{wait?.signal?.addEventListener('abort',()=>reject(Error('stopped')),{once:true});}));
 const adapter=new MetaProvider({getKey,credentialIdentity:async()=>'encrypted:inert-identity',getProfile:()=>'baseten-hackathon',fetch:server.fetch});
 const running=core.runRequest({taskId:task.id,requestId:'keychain-stop',kind:'explain',prompt:'Synthetic only.'},async ctx=>({title:'Never saved',content:await runOrdinaryQuestionRequest(adapter,{prompt:'Synthetic only.',sources:[]},{signal:ctx.signal},{check:async()=>{},ask:async()=>({kind:'skip'})})}));
 await vi.waitFor(()=>expect(getKey).toHaveBeenCalledTimes(1));await core.cancelRequest(task.id,'keychain-stop');
 const saved=await running;expect(saved.status).not.toBe('completed');expect(saved.answer).toBeUndefined();expect(server.fetch).not.toHaveBeenCalled();expect((await core.getTask(task.id)).artifacts).toEqual([]);
});
