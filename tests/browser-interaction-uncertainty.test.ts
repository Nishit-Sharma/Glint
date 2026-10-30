import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {projectTaskDialogue} from '../src/core/task-dialogue';
import {BrowserCoordinator,taskContext,type BrowserPlanner} from '../src/host/browser/coordinator';
import {publicErrorMessage} from '../src/shared/public-messages';
import {LocalBrowser} from '../src/host/browser/local-browser';
import {BrowserService} from '../src/host/browser/service';
import {BrowserReconciliation} from '../src/host/browser/reconciliation';
import type {ConnectionStatus} from '../src/shared/bridge';
const external=vi.hoisted(()=>({dialog:vi.fn()}));
vi.mock('electron',()=>({dialog:{showMessageBox:external.dialog}}));

const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{vi.restoreAllMocks();for(const close of cleanups.splice(0))await close();});
function ownedBrowser(taskId:string,origin:string,mode:'normal'|'lost-response'|'lost-observation'|'stop'|'later-observation'='normal',onStop?:()=>Promise<void>){
 let version=0,dispatched=0,closed=false,reads=0,nextFailure='';let browser:LocalBrowser;
 const fingerprint=()=>JSON.stringify({version}),handle={dispose:async()=>{},isVisible:async()=>true,evaluate:async(fn:Function)=>{const source=String(fn);if(source.includes('Choice lists in open shadow roots'))return {label:'Owned control'};if(source.includes('new FormData'))return undefined;if(source.includes('sensitive'))return {sensitive:false,info:{role:'button',label:'Owned control'},fingerprint:fingerprint()};return fingerprint();},click:async()=>dispatch(),fill:async()=>dispatch()};
 async function dispatch(){dispatched++;version++;if(mode==='stop')await onStop?.();if(mode==='lost-response'||mode==='stop')throw Error('PRIVATE_AFTER_DISPATCH');}
 const page={on:()=>{},isClosed:()=>closed,evaluate:async()=>{reads++;if(nextFailure){const message=nextFailure;nextFailure='';throw Error(message);}if(mode==='later-observation'&&reads>=3)throw Error('PRIVATE_LATER_OBSERVATION');if(dispatched&&mode==='lost-observation')throw Error('PRIVATE_OBSERVATION');return {text:'Owned page '+version,title:'Owned page',url:origin+'/page'};},locator:()=>({count:async()=>1,nth:()=>({isVisible:async()=>true,elementHandle:async()=>handle})})};
 browser=Reflect.construct(LocalBrowser,[{close:async()=>{closed=true;}},{on:()=>{},close:async()=>{closed=true;}},page,taskId,origin]) as LocalBrowser;
 return {browser,get dispatched(){return dispatched;},change(){version++;},failNextRead(message='PRIVATE_PRE_DISPATCH'){nextFailure=message;}};
}
async function fixture(){const dir=await mkdtemp(join(tmpdir(),'browser-interaction-')),taskIdRef={value:''};let core=await createCompanion({dataDir:dir});const task=await core.createTask({title:'Owned interaction'});taskIdRef.value=task.id;cleanups.push(async()=>{await core.close();await rm(dir,{recursive:true,force:true});});return {dir,task,get core(){return core;},async reopen(){await core.close();core=await createCompanion({dataDir:dir});}};}
const origin='https://owned.invalid';
function plan(kind:'click'|'fill',answerAfter=false):BrowserPlanner{let n=0;return {endpointKey:'owned',async plan(input){if(answerAfter&&n++)return {kind:'answer',markdown:'A page was observed.',modules:[]};const targetId=input.observation.targets[0].id;return {kind:'action',reason:'Use the owned control',action:kind==='click'?{kind:'click',targetId}:{kind:'fill',targetId,value:'Owned text'}};}};}
function run(f:Awaited<ReturnType<typeof fixture>>,planner:BrowserPlanner,requestId:string,site=origin,approve=vi.fn(async()=>({approved:true as const}))){return {approve,result:new BrowserCoordinator(f.core,planner).run({taskId:f.task.id,requestId,goal:'Use this page',origin:site,url:site+'/page',transmissionApproved:true,approveAction:approve})};}

it.each(['click','fill'] as const)('normal %s is observed once and completes',async kind=>{const f=await fixture(),owned=ownedBrowser(f.task.id,origin);vi.spyOn(LocalBrowser,'open').mockResolvedValue(owned.browser);const r=run(f,plan(kind,true),'normal');expect((await r.result).status).toBe('completed');expect(owned.dispatched).toBe(1);expect(r.approve).toHaveBeenCalledOnce();expect((await f.core.getTask(f.task.id)).session!.runs[0].operations[0].status).toBe('observed');});

it.each(['click','fill'] as const)('a stale %s target after consent fails before dispatch',async kind=>{const f=await fixture(),owned=ownedBrowser(f.task.id,origin);vi.spyOn(LocalBrowser,'open').mockResolvedValue(owned.browser);const r=run(f,plan(kind),'stale',origin,vi.fn(async()=>{owned.change();return {approved:true as const};}));expect((await r.result).status).toBe('failed');expect(owned.dispatched).toBe(0);expect((await f.core.getTask(f.task.id)).session!.runs[0].operations[0].status).toBe('failed');});

it.each(['click','fill'] as const)('denying %s consent never dispatches',async kind=>{const f=await fixture(),owned=ownedBrowser(f.task.id,origin);vi.spyOn(LocalBrowser,'open').mockResolvedValue(owned.browser);const r=run(f,plan(kind),'denied',origin,vi.fn(async()=>({approved:false as const})) as never);expect((await r.result).status).toBe('failed');expect(owned.dispatched).toBe(0);expect((await f.core.getTask(f.task.id)).session!.runs[0].operations[0].status).toBe('retired');});

it.each(['click','fill'] as const)('lost %s result is uncertain after local reopen and blocks a new same-site interaction',async kind=>{const f=await fixture(),owned=ownedBrowser(f.task.id,origin,'lost-response');const open=vi.spyOn(LocalBrowser,'open').mockResolvedValue(owned.browser);const first=run(f,plan(kind),'lost');expect((await first.result).status).toBe('failed');expect(owned.dispatched).toBe(1);const saved=await f.core.getTask(f.task.id);expect(saved.session!.runs[0].operations[0].status).toBe('uncertain');for(const text of [JSON.stringify(saved),await readFile(join(f.dir,'tasks.json'),'utf8'),projectTaskDialogue(saved,'later',[])])expect(text).not.toContain('PRIVATE_AFTER_DISPATCH');await f.reopen();const current=await f.core.getTask(f.task.id);expect(current.session!.runs[0].operations[0].status).toBe('uncertain');const fresh=ownedBrowser(f.task.id,origin);open.mockResolvedValue(fresh.browser);const next=run(f,plan(kind),'next');expect((await next.result).error).toContain('uncertain outcome');expect(next.approve).not.toHaveBeenCalled();expect(fresh.dispatched).toBe(0);});

it.each(['click','fill'] as const)('lost post-%s observation and cancellation preserve uncertainty',async kind=>{for(const mode of ['lost-observation','stop'] as const){const f=await fixture(),owned=ownedBrowser(f.task.id,origin,mode,async()=>{await f.core.cancelRequest(f.task.id,'lost');});vi.spyOn(LocalBrowser,'open').mockResolvedValue(owned.browser);const result=await run(f,plan(kind),'lost').result;expect(result.status).toBe(mode==='stop'?'cancelled':'failed');expect(owned.dispatched).toBe(1);const saved=await f.core.getTask(f.task.id);expect(saved.session!.runs[0].operations[0].status).toBe('uncertain');expect(JSON.stringify(saved)).not.toContain('PRIVATE_OBSERVATION');vi.restoreAllMocks();}});

it('unrelated sites and read-only answers remain possible without settling the earlier effect',async()=>{const f=await fixture(),first=ownedBrowser(f.task.id,origin,'lost-response'),open=vi.spyOn(LocalBrowser,'open').mockResolvedValue(first.browser);await run(f,plan('click'),'lost').result;const before=(await f.core.getTask(f.task.id)).session!.runs[0];expect(before.operations[0].status).toBe('uncertain');const otherOrigin='https://other.invalid',other=ownedBrowser(f.task.id,otherOrigin);open.mockResolvedValue(other.browser);expect((await run(f,plan('click',true),'other',otherOrigin).result).status).toBe('completed');expect(other.dispatched).toBe(1);const read=ownedBrowser(f.task.id,origin);open.mockResolvedValue(read.browser);const answer:BrowserPlanner={endpointKey:'owned',plan:async()=>({kind:'answer',markdown:'The current page was read; the earlier effect remains unknown.',modules:[]})};expect((await run(f,answer,'read').result).status).toBe('completed');expect(read.dispatched).toBe(0);expect((await f.core.getTask(f.task.id)).session!.runs[0]).toEqual(before);});

it.each(['click','fill'] as const)('rechecks uncertainty introduced during %s consent before dispatch',async kind=>{
 const f=await fixture(),owned=ownedBrowser(f.task.id,origin);vi.spyOn(LocalBrowser,'open').mockResolvedValue(owned.browser);
 const approval=vi.fn(async()=>{const session=(await f.core.getTask(f.task.id)).session!,current=session.runs[0];await f.core.replaceSession(f.task.id,session.revision,{...session,runs:[...session.runs,{...current,id:'earlier',operations:[{id:'earlier-action',intent:{kind:'click',snapshotId:current.initialObservation.id,targetId:'earlier-target'},reason:'Earlier effect',status:'uncertain'}]}]});return {approved:true as const};});
 const result=await run(f,plan(kind),'race',origin,approval).result;expect(result.error).toContain('uncertain outcome');expect(approval).toHaveBeenCalledOnce();expect(owned.dispatched).toBe(0);const session=(await f.core.getTask(f.task.id)).session!;expect(session.runs.find(run=>run.id==='earlier')!.operations[0].status).toBe('uncertain');expect(session.runs.find(run=>run.id==='race')!.operations[0].status).toBe('retired');
});

it.each(['click','fill'] as const)('Stop after recording %s as executing but before dispatch retires the action',async kind=>{
 const f=await fixture(),owned=ownedBrowser(f.task.id,origin);vi.spyOn(LocalBrowser,'open').mockResolvedValue(owned.browser);const replace=f.core.replaceSession.bind(f.core);let stopped=false;vi.spyOn(f.core,'replaceSession').mockImplementation(async(...args)=>{const result=await replace(...args);if(!stopped&&args[2].runs.some(run=>run.id==='stop-before'&&run.operations.some(operation=>operation.status==='executing'))){stopped=true;await f.core.cancelRequest(f.task.id,'stop-before');}return result;});
 const result=await run(f,plan(kind),'stop-before').result;expect(result.status).toBe('cancelled');expect(owned.dispatched).toBe(0);expect((await f.core.getTask(f.task.id)).session!.runs[0].operations[0].status).toBe('retired');
});


it.each(['click','fill'] as const)('host consent explains same-site GET effects before %s',async kind=>{
 const f=await fixture(),owned=ownedBrowser(f.task.id,origin);vi.spyOn(LocalBrowser,'open').mockResolvedValue(owned.browser);external.dialog.mockReset().mockResolvedValueOnce({response:1}).mockResolvedValueOnce({response:0});
 const service=new BrowserService(f.core,{panel:()=>({}) as never,route:()=>({key:'owned',provider:{status:async()=>({configured:true,provider:'Codex (temporary)'} as ConnectionStatus),run:async input=>{const observation=JSON.parse(input.sources[0].content).currentObservation,targetId=observation.targets[0].id;return JSON.stringify({kind:'action',reason:'Use the owned control',action:kind==='click'?{kind,targetId}:{kind,targetId,value:'Owned text'}});}}}),changed:()=>{},progress:()=>{}});
 try{await expect(service.run({taskId:f.task.id,requestId:'consent',prompt:'Use the page',url:origin+'/page'})).rejects.toThrow('not authorized');const consent=external.dialog.mock.calls[1][1];expect(consent.detail).toContain('same-site GET or HEAD requests that change the website');expect(consent.detail).toContain('their effects may be unknown');expect(consent.detail).toContain('Other website writes are blocked unless included in the reviewed submission');expect(consent.detail).toContain('An observed page does not verify the website effect.');expect(owned.dispatched).toBe(0);}finally{service.close();}
});


it('a separate task on the same site is not blocked by this task’s uncertainty',async()=>{
 const f=await fixture(),first=ownedBrowser(f.task.id,origin,'lost-response'),open=vi.spyOn(LocalBrowser,'open').mockResolvedValue(first.browser);await run(f,plan('click'),'lost').result;const other=await f.core.createTask({title:'Other task'}),otherBrowser=ownedBrowser(other.id,origin);open.mockResolvedValue(otherBrowser.browser);const otherFixture={...f,task:other};expect((await run(otherFixture,plan('click',true),'other-task').result).status).toBe('completed');expect(otherBrowser.dispatched).toBe(1);expect((await f.core.getTask(f.task.id)).session!.runs[0].operations[0].status).toBe('uncertain');
});

it('an uncertain review stays blocked until a user settles that exact action',async()=>{
 const f=await fixture(),first=ownedBrowser(f.task.id,origin,'lost-response'),open=vi.spyOn(LocalBrowser,'open').mockResolvedValue(first.browser);await run(f,plan('click'),'lost').result;const original=(await f.core.getTask(f.task.id)).session!.runs[0],op=original.operations[0],reconciliation=new BrowserReconciliation(f.core),input={taskId:f.task.id,runId:original.id,operationId:op.id,url:origin+'/page'};
 for(const outcome of ['uncertain','not-completed'] as const){const inspectionBrowser=ownedBrowser(f.task.id,origin);open.mockResolvedValue(inspectionBrowser.browser);const inspection=await reconciliation.inspect(input);await reconciliation.resolve(inspection.id,async()=>({outcome,note:'User reviewed the owned page.'}));const current=(await f.core.getTask(f.task.id)).session!.runs[0].operations[0];expect(current.status).toBe(outcome==='uncertain'?'uncertain':'failed');expect(inspectionBrowser.dispatched).toBe(0);if(outcome==='uncertain'){const blockedBrowser=ownedBrowser(f.task.id,origin);open.mockResolvedValue(blockedBrowser.browser);const blocked=run(f,plan('click'),'blocked');expect((await blocked.result).error).toContain('uncertain outcome');expect(blocked.approve).not.toHaveBeenCalled();expect(blockedBrowser.dispatched).toBe(0);}}
 const fresh=ownedBrowser(f.task.id,origin);open.mockResolvedValue(fresh.browser);expect((await run(f,plan('click',true),'after-review').result).status).toBe('completed');expect(fresh.dispatched).toBe(1);
});


it('later observation errors cannot persist or enter task dialogue',async()=>{
 const f=await fixture(),owned=ownedBrowser(f.task.id,origin,'later-observation');vi.spyOn(LocalBrowser,'open').mockResolvedValue(owned.browser);const result=await run(f,plan('click'),'later-error').result;const saved=await f.core.getTask(f.task.id);expect(result.error).not.toContain('PRIVATE_LATER_OBSERVATION');expect(owned.dispatched).toBe(0);for(const text of [JSON.stringify(saved),await readFile(join(f.dir,'tasks.json'),'utf8'),projectTaskDialogue(saved,'next',[])])expect(text).not.toContain('PRIVATE_LATER_OBSERVATION');
});

it.each(['click','fill'] as const)('unknown pre-dispatch %s validation errors cannot persist or enter dialogue',async kind=>{
 const f=await fixture(),owned=ownedBrowser(f.task.id,origin);vi.spyOn(LocalBrowser,'open').mockResolvedValue(owned.browser);const r=run(f,plan(kind),'validation-error',origin,vi.fn(async()=>{owned.failNextRead();return {approved:true as const};}));const result=await r.result,saved=await f.core.getTask(f.task.id);expect(result.status).toBe('failed');expect(result.error).toBe('The browser action could not be prepared safely. It was not run.');expect(publicErrorMessage(result.error)).toBe(result.error);expect(owned.dispatched).toBe(0);expect(saved.session!.runs[0].operations[0].status).toBe('failed');for(const text of [JSON.stringify(saved),await readFile(join(f.dir,'tasks.json'),'utf8'),projectTaskDialogue(saved,'next',[]),taskContext(saved,'next')])expect(text).not.toContain('PRIVATE_PRE_DISPATCH');
});


it.each(['propose','review'] as const)('unknown %s diagnostics never persist or enter model contexts',async stage=>{
 const f=await fixture(),owned=ownedBrowser(f.task.id,origin);vi.spyOn(LocalBrowser,'open').mockResolvedValue(owned.browser);vi.spyOn(owned.browser,stage).mockRejectedValue(Error('PRIVATE_PHASE_DIAGNOSTIC'));const result=await run(f,plan('click'),'phase').result,saved=await f.core.getTask(f.task.id);expect(result.status).toBe('failed');expect(result.error).toBe('The browser action could not be prepared safely. It was not run.');expect(owned.dispatched).toBe(0);for(const text of [JSON.stringify(saved),await readFile(join(f.dir,'tasks.json'),'utf8'),projectTaskDialogue(saved,'next',[]),taskContext(saved,'next')])expect(text).not.toContain('PRIVATE_PHASE_DIAGNOSTIC');
});

it('preserves recognized later page-limit recovery without leaking diagnostics',async()=>{
 const f=await fixture(),owned=ownedBrowser(f.task.id,origin);vi.spyOn(LocalBrowser,'open').mockResolvedValue(owned.browser);const observe=owned.browser.observe.bind(owned.browser);let calls=0;vi.spyOn(owned.browser,'observe').mockImplementation(async()=>{if(calls++===1)throw Error('This page exceeds the observation limit; choose a narrower page.');return observe();});const result=await run(f,plan('click'),'limit').result;expect(result.error).toBe('This page exceeds the observation limit; choose a narrower page.');expect(owned.dispatched).toBe(0);
});


it('preserves recognized page refusal during pre-dispatch validation',async()=>{
 const f=await fixture(),owned=ownedBrowser(f.task.id,origin);vi.spyOn(LocalBrowser,'open').mockResolvedValue(owned.browser);const approval=vi.fn(async()=>{owned.failNextRead('page.evaluate: Error: This page exceeds the observation limit; choose a narrower page.');return {approved:true as const};});const result=await run(f,plan('click'),'limit-before',origin,approval).result;expect(result.error).toBe('This page exceeds the observation limit; choose a narrower page.');expect((await f.core.getTask(f.task.id)).session!.runs[0].operations[0]).toMatchObject({status:'failed',error:result.error});expect(owned.dispatched).toBe(0);
});
