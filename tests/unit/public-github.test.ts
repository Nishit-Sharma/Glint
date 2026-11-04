import {afterEach,expect,test,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {PublicGithubReader,type PublicGithubRead} from '../../src/host/public-github';
import {parsePublicGithubRepository,publicGithubSourceRef,readPublicGithubCommand,type PublicGithubCapture} from '../../src/shared/public-github';

const repository='octocat/hello-world',time='2026-10-31T09:00:00.000Z',content='# Hello\n<script>untrusted()</script>\n![image](https://example.com/image.png)';
const snapshot={repository,defaultBranch:'master',path:'README.md',blobSha:'a'.repeat(40),snapshotAt:time,description:'Public sample',stars:42};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const metadata=(extra:Record<string,unknown>={})=>({full_name:'octocat/Hello-World',private:false,visibility:'public',default_branch:'master',description:'Public sample',stargazers_count:42,temp_clone_token:'NEVER-PERSIST-TOKEN',...extra});
const readme=(extra:Record<string,unknown>={})=>({type:'file',path:'README.md',sha:'a'.repeat(40),size:Buffer.byteLength(content),encoding:'base64',content:Buffer.from(content).toString('base64'),download_url:'https://untrusted.example/README',...extra});
const collect=(value:PublicGithubRead)=>Promise.resolve(value);
afterEach(()=>vi.useRealTimers());

test('repository discovery accepts only an owner/repository or exact public GitHub repository link',()=>{
 expect(parsePublicGithubRepository('octocat/Hello-World')).toBe(repository);
 expect(parsePublicGithubRepository('https://github.com/octocat/Hello-World.git/')).toBe(repository);
 for(const value of ['https://api.github.com/repos/octocat/Hello-World','http://github.com/octocat/Hello-World','https://user@github.com/octocat/repo','https://github.com:443/octocat/repo','https://github.com/octocat/repo?x=1','https://github.com/octocat/repo#readme','https://github.com/octocat/repo/tree/main','https://github.com/octocat/a/../repo','https://github.com/octocat/%72epo','a/..','a--b/repo','a/repo/extra',' a/repo'])expect(()=>parsePublicGithubRepository(value),value).toThrow();
 expect(()=>readPublicGithubCommand({type:'github.capture',taskId:'task',operationId:'gesture',repository,expectedConnection:null,authorization:'secret'})).toThrow();
 expect(()=>readPublicGithubCommand({type:'github.capture',taskId:'task',operationId:'gesture',repository:'https://example.com',expectedConnection:null})).toThrow();
});

test('an explicit read uses only two fixed unauthenticated GETs and returns a closed inert projection',async()=>{
 const calls:Array<[string,RequestInit|undefined]>=[];
 const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{calls.push([String(url),init]);return calls.length===1?json(metadata()):json(readme());}) as typeof fetch;
 const reader=new PublicGithubReader(fetcher,15000,()=>new Date(time));
 const result=await reader.read('task','gesture',repository,()=>{},collect);
 expect(result).toEqual({snapshot,content});expect(JSON.stringify(result)).not.toContain('NEVER-PERSIST-TOKEN');expect(JSON.stringify(result)).not.toContain('download_url');
 expect(calls.map(([url])=>url)).toEqual(['https://api.github.com/repos/octocat/hello-world','https://api.github.com/repos/octocat/hello-world/readme']);
 for(const [,init] of calls){expect(init).toMatchObject({method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'}});expect(init?.headers).not.toHaveProperty('Authorization');expect(init?.headers).not.toHaveProperty('Cookie');}
});

test.each([403,404,429,301,422])('GitHub status %i fails honestly without retry or publication',async status=>{
 const fetcher=vi.fn(async()=>json({},status)) as typeof fetch,publish=vi.fn(collect),reader=new PublicGithubReader(fetcher);
 await expect(reader.read('task','gesture',repository,()=>{},publish)).rejects.toThrow(/GitHub|Public repository/);
 expect(fetcher).toHaveBeenCalledTimes(1);expect(publish).not.toHaveBeenCalled();
});

test('private responses, oversized bodies, invalid UTF-8/base64 and unsupported README payloads never publish',async()=>{
 const privateFetch=vi.fn(async()=>json(metadata({private:true}))) as typeof fetch;
 await expect(new PublicGithubReader(privateFetch).read('task','private',repository,()=>{},collect)).rejects.toThrow('Only public');expect(privateFetch).toHaveBeenCalledTimes(1);
 for(const value of [readme({size:262145}),readme({encoding:'none'}),readme({content:'%%%='}),readme({sha:'no'}),readme({content:Buffer.from([0xc3,0x28]).toString('base64'),size:2}),readme({size:1}),readme({type:'symlink'})]){
  const responses=[json(metadata()),json(value)],publish=vi.fn(collect),reader=new PublicGithubReader(vi.fn(async()=>responses.shift()!) as typeof fetch);
  await expect(reader.read('task','invalid',repository,()=>{},publish)).rejects.toThrow();expect(publish).not.toHaveBeenCalled();
 }
 const oversized=new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(65537));controller.close();}}),{headers:{'content-type':'application/json'}}),publish=vi.fn(collect);
 await expect(new PublicGithubReader(vi.fn(async()=>oversized) as typeof fetch).read('task','large',repository,()=>{},publish)).rejects.toThrow('too large');expect(publish).not.toHaveBeenCalled();
});

test('cancel and deadlines retire a read while allowing a later explicit gesture',async()=>{
 let calls=0;
 const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{calls++;if(calls===1)return new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));return calls%2===0?json(metadata()):json(readme());}) as typeof fetch;
 const reader=new PublicGithubReader(fetcher,20,()=>new Date(time));
 const canceled=reader.read('task','old',repository,()=>{},collect);reader.cancel('task','old');await expect(canceled).rejects.toThrow('canceled');
 reader.cancel('task','old');expect((await reader.read('task','new',repository,()=>{},collect)).content).toBe(content);
 const timeoutFetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}))) as typeof fetch;
 await expect(new PublicGithubReader(timeoutFetcher,5).read('task','deadline',repository,()=>{},collect)).rejects.toThrow('timed out');
});

test('selection changes and cancellation while publication waits cannot save a snapshot',async()=>{
 let valid=true,resolve!:(value:Response)=>void;const publish=vi.fn(collect),fetcher=vi.fn(async()=>new Promise<Response>(done=>{resolve=done;})) as typeof fetch;
 const reader=new PublicGithubReader(fetcher),pending=reader.read('task','selection',repository,()=>{if(!valid)throw Error('Task selection changed.');},publish);valid=false;resolve(json(metadata()));await expect(pending).rejects.toThrow('selection changed');expect(publish).not.toHaveBeenCalled();
 const responses=[json(metadata()),json(readme())],reader2=new PublicGithubReader(vi.fn(async()=>responses.shift()!) as typeof fetch);let release!:()=>void,entered!:()=>void;const waiting=new Promise<void>(done=>{entered=done;});
 const queued=reader2.read('task','queued',repository,()=>{},async(value,guard)=>{entered();await new Promise<void>(done=>{release=done;});guard();return value;});await waiting;reader2.cancel('task','queued');release();await expect(queued).rejects.toThrow('canceled');
});

test('capture, unchanged refresh, changed text, disconnect and reopen share durable source versions without changing a draft',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-github-'));let core=await createCompanion({dataDir:directory});
 try{
  let task=await core.createTask({title:'Public GitHub QA'});await core.saveComposerDraft(task.id,0,{text:'Keep this unsent draft',kind:'explain'});
  const command:PublicGithubCapture={type:'github.capture',taskId:task.id,operationId:'first',repository,expectedConnection:null};
  const first=await core.savePublicGithubSnapshot(command,snapshot,content);task=first.task;expect(task.sources).toHaveLength(1);expect(first.reference.version).toBe(1);expect(task.session?.draft).toBe('Keep this unsent draft');expect(task.requests).toHaveLength(0);
  const refresh={...command,operationId:'refresh',expectedConnection:task.publicGithub!,expectedSource:publicGithubSourceRef(task)};
  await core.invalidateSource(task.id,first.reference.sourceId,'Marked changed');
  const same=await core.savePublicGithubSnapshot(refresh,{...snapshot,snapshotAt:'2026-10-31T10:00:00.000Z'},content);expect(same.unchanged).toBe(true);expect(same.reference).toEqual(first.reference);expect(same.task.sources[0].versions).toHaveLength(1);expect(same.task.sources[0].freshness).toBe('fresh');expect(same.task.sources[0].staleReason).toBeUndefined();expect(same.task.publicGithub?.checkedAt).toBe('2026-10-31T10:00:00.000Z');
  await expect(core.savePublicGithubSnapshot(refresh,snapshot,'stale text')).rejects.toThrow('connection changed');
  const changed=await core.savePublicGithubSnapshot({...refresh,expectedConnection:same.task.publicGithub!},{...snapshot,blobSha:'b'.repeat(40),snapshotAt:'2026-10-31T11:00:00.000Z'},content+'\nNew line');expect(changed.reference.version).toBe(2);expect(changed.task.sources[0].versions[0].content).toBe(content);
  await expect(core.savePublicGithubSnapshot({...refresh,expectedConnection:changed.task.publicGithub!},snapshot,'lost update')).rejects.toThrow('source changed');
  const original=changed.task;await expect(core.savePublicGithubSnapshot({...refresh,expectedConnection:changed.task.publicGithub!,expectedSource:changed.reference},snapshot,'canceled',()=>{throw Error('canceled');})).rejects.toThrow('canceled');expect(await core.getTask(task.id)).toEqual(original);
  let detached:unknown;const asked=await core.runRequest({taskId:task.id,requestId:'explicit-prompt-only',kind:'explain',prompt:'Hello',sourceIds:[]},async context=>{detached=context.task;return {title:'Hello',content:'Hello'};});expect(asked.status).toBe('completed');expect(detached).not.toHaveProperty('publicGithub');expect(detached).toHaveProperty('sources',[]);
  const disconnected=await core.disconnectPublicGithub({type:'github.disconnect',taskId:task.id,expectedConnection:changed.task.publicGithub!});expect(disconnected.publicGithub).toBeUndefined();expect(disconnected.sources).toEqual(changed.task.sources);expect(disconnected.session?.draft).toBe('Keep this unsent draft');
  await core.close();core=await createCompanion({dataDir:directory});const reopened=await core.getTask(task.id);expect(reopened.publicGithub).toBeUndefined();expect(reopened.sources[0].versions[0].publicGithub).toEqual(snapshot);expect(reopened.sources[0].versions[1].content).toBe(content+'\nNew line');
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
