import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {createCompanion} from '../src/core/companion';
import {BrowserCoordinator,type BrowserPlanner} from '../src/host/browser/coordinator';
import {LocalBrowser} from '../src/host/browser/local-browser';

const origin='https://owned.invalid';
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{vi.restoreAllMocks();for(const close of cleanup.splice(0))await close();});
/** Inert transport/DOM boundary. Actual LocalBrowser identity validation, proposal,
 * review, approval and execution code runs; no Chromium/page JavaScript/network. */
function ownedBrowser(taskId:string,write=false,failAfterDispatch=false){
 let pageVersion=0,targetVersion=0,clicks=0,closed=false,pageOrigin=origin,nextRead:(()=>void|Promise<void>)|undefined;
 let browser:LocalBrowser;
 const fingerprint=()=>JSON.stringify({targetVersion});
 const handle={dispose:async()=>{},isVisible:async()=>true,click:async()=>{clicks++;if(failAfterDispatch){(browser as any).active.used=true;throw Error('Scripted transport lost after dispatch.');}pageVersion++;targetVersion++;},evaluate:async(fn:Function)=>{
  const source=String(fn);
  if(source.includes('Choice lists in open shadow roots'))return {label:'Current control '+targetVersion};
  if(source.includes('new FormData'))return write?{method:'POST',url:origin+'/save',body:'',formFields:[]}:undefined;
  if(source.includes('sensitive'))return {sensitive:false,info:{role:'button',label:'Current control '+targetVersion},fingerprint:fingerprint()};
  return fingerprint();
 }};
 const page={on:()=>{},isClosed:()=>closed,evaluate:async()=>{const hook=nextRead;nextRead=undefined;await hook?.();return {text:'Current page '+pageVersion,title:'Owned page',url:pageOrigin+'/page'};},locator:()=>({count:async()=>1,nth:()=>({isVisible:async()=>true,elementHandle:async()=>handle})})};
 browser=Reflect.construct(LocalBrowser,[{close:async()=>{closed=true;}},{on:()=>{},close:async()=>{closed=true;}},page,taskId,origin]) as LocalBrowser;
 return {browser,changePage(){pageVersion++;},changeTarget(){targetVersion++;},changeOrigin(){pageOrigin="https://outside.invalid";},beforeNextRead(hook:()=>void|Promise<void>){nextRead=hook;},get clicks(){return clicks;}};
}
async function fixture(write=false,failAfterDispatch=false){
 const directory=await mkdtemp(join(tmpdir(),'preproposal-recovery-'));let core=await createCompanion({dataDir:directory});cleanup.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});const task=await core.createTask({title:'Current observed target'}),owned=ownedBrowser(task.id,write,failAfterDispatch);vi.spyOn(LocalBrowser,'open').mockResolvedValue(owned.browser);return {task,owned,get core(){return core;},async restart(){await core.close();core=await createCompanion({dataDir:directory});}};
}
const action=(input:Parameters<BrowserPlanner['plan']>[0],write=false)=>({kind:'action' as const,reason:'Use only the newly observed control',action:{kind:'click' as const,targetId:input.observation.targets[0].id,...(write?{expectedFields:[]}: {})}});
function run(f:Awaited<ReturnType<typeof fixture>>,planner:BrowserPlanner,approve=vi.fn(async(_input:any)=>({approved:true as const})),requestId='run'){
 return {approve,result:new BrowserCoordinator(f.core,planner).run({taskId:f.task.id,requestId,goal:'Read the current page',origin,url:origin+'/page',transmissionApproved:true,approveAction:approve})};
}
it.each(['page','target'] as const)('refreshes once after trusted %s staleness before a proposal and uses fresh target IDs',async kind=>{
 const f=await fixture(),seen:Array<Parameters<BrowserPlanner['plan']>[0]>=[];
 const planner:BrowserPlanner={endpointKey:'owned',async plan(input){seen.push(input);if(seen.length===1){kind==='page'?f.owned.changePage():f.owned.changeTarget();return action(input);}if(seen.length===2)return action(input);return {kind:'answer',markdown:'The newly observed page was read.',modules:[]};}};
 const r=run(f,planner),result=await r.result;expect(result.status,JSON.stringify(result)).toBe('completed');expect(seen).toHaveLength(3);expect(seen[1].observation.targets[0].id).not.toBe(seen[0].observation.targets[0].id);expect(r.approve).toHaveBeenCalledTimes(1);expect(r.approve.mock.calls[0][0].proposal.intent.targetId).toBe(seen[1].observation.targets[0].id);expect(f.owned.clicks).toBe(1);const task=await f.core.getTask(f.task.id);expect(task.session!.runs[0].operations).toHaveLength(1);expect(task.session!.runs[0].operations[0].status).toBe('observed');
});
it('stops at a second stale proposal instead of repeatedly planning or approving',async()=>{
 const f=await fixture();let plans=0;const r=run(f,{endpointKey:'owned',async plan(input){plans++;f.owned.changePage();return action(input);}});expect((await r.result).status).toBe('failed');expect(plans).toBe(2);expect(r.approve).not.toHaveBeenCalled();expect(f.owned.clicks).toBe(0);expect((await f.core.getTask(f.task.id)).session!.runs[0].operations).toEqual([]);
});
it.each(['forged name','missing target'] as const)('does not classify %s as trusted page staleness',async kind=>{
 const f=await fixture();if(kind==='forged name'){const untrusted=Error('The page changed. Observe it again before proposing an action.');untrusted.name='BrowserObservationChangedError';vi.spyOn(f.owned.browser,'propose').mockRejectedValue(untrusted);}let plans=0;const r=run(f,{endpointKey:'owned',async plan(input){plans++;return kind==='missing target'?{...action(input),action:{kind:'click',targetId:'invented-target'}}:action(input);}});expect((await r.result).status).toBe('failed');expect(plans).toBe(1);expect(r.approve).not.toHaveBeenCalled();expect(f.owned.clicks).toBe(0);
});
it('does not refresh a stale page discovered after approval',async()=>{
 const f=await fixture();let plans=0;const approval=vi.fn(async()=>{f.owned.changePage();return {approved:true as const};}),r=run(f,{endpointKey:'owned',async plan(input){plans++;return action(input);}},approval);expect((await r.result).status).toBe('failed');expect(plans).toBe(1);expect(approval).toHaveBeenCalledTimes(1);expect(f.owned.clicks).toBe(0);expect((await f.core.getTask(f.task.id)).session!.runs[0].operations[0].status).toBe('failed');
});
it('keeps a possibly dispatched write uncertain after reopen and blocks another write before approval',async()=>{
 const f=await fixture(true,true);let plans=0;const planner:BrowserPlanner={endpointKey:'owned',async plan(input){plans++;return action(input,true);}},approval=vi.fn(async(input:any)=>({approved:true as const,write:input.review.write})),first=run(f,planner,approval);expect((await first.result).status).toBe('failed');expect(plans).toBe(1);expect(f.owned.clicks).toBe(1);expect((await f.core.getTask(f.task.id)).session!.runs[0].operations[0].status).toBe('uncertain');await f.restart();const before=(await f.core.getTask(f.task.id)).session!.runs[0];expect(before.operations[0].status).toBe('uncertain');const next=ownedBrowser(f.task.id,true);vi.mocked(LocalBrowser.open).mockClear().mockResolvedValue(next.browser);let secondPlans=0;const secondPlanner:BrowserPlanner={endpointKey:'owned',async plan(input){if(secondPlans++===0)next.changePage();return action(input,true);}},secondApproval=vi.fn(async(input:any)=>({approved:true as const,write:input.review.write})),second=run(f,secondPlanner,secondApproval,'second');expect((await second.result).error).toContain('uncertain outcome');expect(secondPlans).toBe(0);expect(LocalBrowser.open).not.toHaveBeenCalled();expect(secondApproval).not.toHaveBeenCalled();expect(next.clicks).toBe(0);expect((await f.core.getTask(f.task.id)).session!.runs[0]).toEqual(before);
});
it('counts the stale refresh in the existing eight-plan budget and preserves earlier observed actions',async()=>{
 const f=await fixture();let plans=0;const r=run(f,{endpointKey:'owned',async plan(input){plans++;if(plans===8)f.owned.changePage();return action(input);}}),result=await r.result;expect(result.error).toContain('eight-step limit');expect(plans).toBe(8);expect(r.approve).toHaveBeenCalledTimes(7);expect(f.owned.clicks).toBe(7);expect((await f.core.getTask(f.task.id)).session!.runs[0].operations.map(op=>op.status)).toEqual(Array(7).fill('observed'));
});
it.each(['owner','origin'] as const)('rejects changed durable run %s before recovery',async kind=>{
 const f=await fixture();let plans=0;const r=run(f,{endpointKey:'owned',async plan(input){plans++;f.owned.changePage();const task=await f.core.getTask(f.task.id),session=task.session!;await f.core.replaceSession(task.id,session.revision,{...session,runs:session.runs.map(run=>({...run,...(kind==='owner'?{browserId:'different-browser'}:{origin:'https://different.invalid'})}))});return action(input);}});expect((await r.result).error).toContain('browser binding changed');expect(plans).toBe(1);expect(r.approve).not.toHaveBeenCalled();expect(f.owned.clicks).toBe(0);
});
it.each(['stop','route'] as const)('rechecks %s during the trusted stale detection before recovery',async kind=>{
 const f=await fixture();let endpoint='owned',plans=0;const r=run(f,{get endpointKey(){return endpoint;},async plan(input){plans++;f.owned.changePage();f.owned.beforeNextRead(async()=>{if(kind==='stop')await f.core.cancelRequest(f.task.id,'run');else endpoint='other';});return action(input);}}),result=await r.result;expect(result.status).toBe(kind==='stop'?'cancelled':'failed');if(kind==='route')expect(result.error).toContain('configuration changed');expect(plans).toBe(1);expect(r.approve).not.toHaveBeenCalled();expect(f.owned.clicks).toBe(0);
});
it('does not recover a changed page detected during review of an already durable proposal',async()=>{
 const f=await fixture(),review=f.owned.browser.review.bind(f.owned.browser);vi.spyOn(f.owned.browser,'review').mockImplementation(async id=>{f.owned.changePage();return review(id);});let plans=0;const r=run(f,{endpointKey:'owned',async plan(input){plans++;return action(input);}});expect((await r.result).status).toBe('failed');expect(plans).toBe(1);expect(r.approve).not.toHaveBeenCalled();expect(f.owned.clicks).toBe(0);expect((await f.core.getTask(f.task.id)).session!.runs[0].operations[0].status).toBe('retired');
});
it('does not classify an unauthorized origin as a recoverable changed page',async()=>{
 const f=await fixture();let plans=0;const r=run(f,{endpointKey:'owned',async plan(input){plans++;f.owned.changeOrigin();return action(input);}});expect((await r.result).error).toContain('authorized origin');expect(plans).toBe(1);expect(r.approve).not.toHaveBeenCalled();expect(f.owned.clicks).toBe(0);
});
it.each(['owner','route'] as const)('rechecks %s changed during the fresh observation before another planner call',async kind=>{
 const f=await fixture();let plans=0,endpoint='owned';const r=run(f,{get endpointKey(){return endpoint;},async plan(input){plans++;if(plans===1){f.owned.changePage();f.owned.beforeNextRead(()=>{f.owned.beforeNextRead(async()=>{if(kind==='route')endpoint='different';else{const task=await f.core.getTask(f.task.id),session=task.session!;await f.core.replaceSession(task.id,session.revision,{...session,runs:session.runs.map(run=>({...run,browserId:'changed-during-refresh'}))});}});});}return action(input);}}),result=await r.result;expect(result.status).toBe('failed');expect(plans).toBe(1);expect(r.approve).not.toHaveBeenCalled();expect(f.owned.clicks).toBe(0);
});
