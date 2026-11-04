import {expect,it,vi} from 'vitest';
import {MetaProvider} from '../src/host/provider';
import {MuseConnectionTest} from '../src/host/muse-connection-test';
import {MUSE_PROFILES,MUSE_TEST_PROMPT,MUSE_TEST_REPLY,type MuseProfile} from '../src/shared/muse-connection';

const signal=()=>new AbortController().signal;
function response(profile:MuseProfile,text:string=MUSE_TEST_REPLY,reason='stop'){
 const chunk=(delta:unknown,finish_reason:string|null)=>'data: '+JSON.stringify({id:'inert-only',object:'chat.completion.chunk',created:1,model:MUSE_PROFILES[profile].model,choices:[{index:0,delta,finish_reason}]})+'\n\n';
 return new Response(chunk({content:text},null)+chunk({},reason)+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
}
function fixture(initial:MuseProfile='baseten-hackathon'){
 let profile=initial,key:string|undefined='synthetic-only-key';
 const fetch=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>response(profile)),provider=new MetaProvider({getProfile:()=>profile,getKey:async()=>key,fetch});
 return {provider,fetch,setProfile:(next:MuseProfile)=>{profile=next;provider.reset();},setKey:(next:string|undefined)=>{key=next;}};
}

it.each(['meta-direct','baseten-hackathon'] as const)('sends the exact reviewed synthetic body with no task/source/account context through the installed SDK: %s',async profile=>{
 const f=fixture(profile),approve=vi.fn(async(_detail:string)=>true),test=new MuseConnectionTest(f.provider,approve),preview=f.provider.connectionTestPreview();
 expect(await f.provider.status()).toMatchObject({configured:true,verified:false,metaProfile:profile});expect(f.fetch).not.toHaveBeenCalled();
 expect(await test.run('inert-test',profile,()=>{})).toMatchObject({kind:'passed'});expect(f.fetch).toHaveBeenCalledTimes(1);const [url,init]=f.fetch.mock.calls[0];expect(String(url)).toBe(preview.url);expect(init?.redirect).toBe('error');const body=JSON.parse(String(init?.body));expect(body).toEqual(preview.body);expect(body.messages).toHaveLength(2);expect(body.messages[1].content).toBe('User task: '+MUSE_TEST_PROMPT);expect(body.tools).toBeUndefined();expect(approve.mock.calls[0]?.[0]).toContain(JSON.stringify(preview.body,null,2));expect(approve.mock.calls[0]?.[0]).toContain('incur provider charges');expect(await f.provider.status()).toMatchObject({verified:true});
});

it('keeps the organizer exact model without substituting the public alias or falling back to Meta',async()=>{
 const f=fixture();f.fetch.mockImplementation(async()=>new Response('private rejected body',{status:404}));const test=new MuseConnectionTest(f.provider,async()=>true);await expect(test.run('inert-test','baseten-hackathon',()=>{})).rejects.toMatchObject({code:'PROTOCOL'});expect(f.fetch).toHaveBeenCalledTimes(1);expect(JSON.parse(String(f.fetch.mock.calls[0][1]?.body)).model).toBe('meta-models/muse-spark-open-1026');expect((await f.provider.status()).detail).not.toContain('private rejected body');
});

it('declining exact approval or missing credentials sends nothing and does not claim entitlement',async()=>{
 const f=fixture(),approve=vi.fn(async()=>false),test=new MuseConnectionTest(f.provider,approve);expect(await test.run('inert-test','baseten-hackathon',()=>{})).toMatchObject({kind:'cancelled'});expect(f.fetch).not.toHaveBeenCalled();f.setKey(undefined);await expect(test.run('inert-test','baseten-hackathon',()=>{})).rejects.toThrow('Configure a key');expect(approve).toHaveBeenCalledTimes(1);expect((await f.provider.status()).verified).toBe(false);
});

it('retires a native approval on Stop, rejects a concurrent test and ignores cancellation for another identity',async()=>{
 const f=fixture();let entered!:()=>void,release!:(value:boolean)=>void;const started=new Promise<void>(done=>entered=done),approval=new Promise<boolean>(done=>release=done),test=new MuseConnectionTest(f.provider,async()=>{entered();return approval;});
 const pending=test.run('inert-test','baseten-hackathon',()=>{}),rejected=expect(pending).rejects.toThrow('stopped');await started;test.cancel('other');await expect(test.run('second','baseten-hackathon',()=>{})).rejects.toThrow('already pending');test.cancel('inert-test');release(true);await rejected;expect(f.fetch).not.toHaveBeenCalled();
});

it('refuses profile or account changes after review before any transport and scopes identical keys to different destinations',async()=>{
 const f=fixture(),original=await f.provider.accountScope(),test=new MuseConnectionTest(f.provider,async()=>{f.setProfile('meta-direct');return true;});await expect(test.run('inert-test','baseten-hackathon',()=>{})).rejects.toThrow('Connection changed');expect(await f.provider.accountScope()).not.toBe(original);expect(f.fetch).not.toHaveBeenCalled();
 const changedKey=new MuseConnectionTest(f.provider,async()=>{f.setKey('other-inert-key');return true;});await expect(changedKey.run('key-test','meta-direct',()=>{})).rejects.toThrow('Connection changed');expect(f.fetch).not.toHaveBeenCalled();
});

it('aborts an active synthetic test and reset never leaves a successful verification behind',async()=>{
 const f=fixture();let entered!:()=>void;const started=new Promise<void>(done=>entered=done);f.fetch.mockImplementation(async(_url,init)=>{entered();return new Promise((_done,reject)=>{init?.signal?.addEventListener('abort',()=>reject(init.signal?.reason),{once:true});});});const test=new MuseConnectionTest(f.provider,async()=>true),pending=test.run('inert-test','baseten-hackathon',()=>{}),rejected=expect(pending).rejects.toMatchObject({code:'CANCELLED'});await started;test.cancel();await rejected;expect((await f.provider.status()).verified).toBe(false);
 f.fetch.mockImplementation(async()=>response('baseten-hackathon'));await test.run('second','baseten-hackathon',()=>{});expect((await f.provider.status()).verified).toBe(true);f.provider.reset();expect((await f.provider.status()).verified).toBe(false);
});

it.each([400,401,402,403,404,429,500,529])('preserves safe HTTP %i errors, no retries or body leaks',async status=>{
 const f=fixture();f.fetch.mockImplementation(async()=>new Response(JSON.stringify({error:{message:'synthetic-only-key PRIVATE_PROVIDER_BODY'}}),{status,headers:{'Content-Type':'application/json'}}));
 await expect(f.provider.run({prompt:'inert',sources:[],signal:signal()})).rejects.toMatchObject({code:[401,403].includes(status)?'AUTHENTICATION':status===429?'RATE_LIMIT':'PROTOCOL'});expect(f.fetch).toHaveBeenCalledTimes(1);expect((await f.provider.status()).detail).not.toMatch(/synthetic-only-key|PRIVATE_PROVIDER_BODY/);expect((await f.provider.status()).verified).toBe(false);
});

it('rejects malformed, incomplete or unexpected test replies without accepting a successful test',async()=>{
 for(const mode of ['wrong','truncated','malformed']){const f=fixture();f.fetch.mockImplementation(async()=>mode==='malformed'?new Response('not SSE',{headers:{'Content-Type':'application/json'}}):response('baseten-hackathon',mode==='wrong'?'unexpected':MUSE_TEST_REPLY,mode==='truncated'?'length':'stop'));await expect(new MuseConnectionTest(f.provider,async()=>true).run('inert-test','baseten-hackathon',()=>{})).rejects.toThrow();expect((await f.provider.status()).verified).toBe(false);}
});

it('blocks invalid persisted profile identifiers without consulting credentials or transport',async()=>{
 const getKey=vi.fn(async()=> 'inert-key'),fetch=vi.fn();const provider=new MetaProvider({getProfile:()=> 'unrecognized' as MuseProfile,getKey,fetch});expect(await provider.status()).toMatchObject({state:'error',configured:false,verified:false});await expect(provider.run({prompt:'inert',sources:[],signal:signal()})).rejects.toThrow();expect(getKey).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});

it.each(['source','credential','cancel','profile'] as const)('blocks a %s change while awaiting the last credential read before transport',async change=>{
 let reads=0,current=true,profile:MuseProfile='meta-direct',key='inert-key',entered!:()=>void,release!:()=>void;
 const started=new Promise<void>(done=>entered=done),waiting=new Promise<void>(done=>release=done),controller=new AbortController(),fetch=vi.fn();
 const provider=new MetaProvider({getProfile:()=>profile,getKey:async()=>{if(++reads===2){entered();await waiting;}return key;},fetch});
 const pending=provider.run({prompt:'inert',sources:[],signal:controller.signal,captureFence:{check:async()=>{if(!current)throw Error('Source changed');},assertCurrent:()=>{if(!current)throw Error('Source changed');}}}),rejected=expect(pending).rejects.toThrow();
 await started;
 if(change==='source')current=false;else if(change==='credential')key='new-inert-key';else if(change==='cancel')controller.abort();else profile='baseten-hackathon';
 release();await rejected;expect(reads).toBe(2);expect(fetch).not.toHaveBeenCalled();
});
