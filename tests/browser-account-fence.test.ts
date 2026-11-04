import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,expect,it,vi} from 'vitest';
import {createCompanion} from '../src/core/companion';
import {BrowserService} from '../src/host/browser/service';
import {BROWSER_ACTION_NOT_RUN} from '../src/shared/public-messages';
import {LocalBrowser} from '../src/host/browser/local-browser';
import {choiceBrowser,choiceOrigin,stubChoiceDom} from './browser-select.fixture';
const external=vi.hoisted(()=>({dialog:vi.fn(),launch:vi.fn()}));
vi.mock('electron',()=>({dialog:{showMessageBox:external.dialog}}));
vi.mock('playwright-core',()=>({chromium:{launch:external.launch}}));
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanups.splice(0))await close();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function fixture(){
 stubChoiceDom();external.dialog.mockReset().mockResolvedValue({response:1});external.launch.mockReset();
 const directory=await mkdtemp(join(tmpdir(),'browser-account-')),core=await createCompanion({dataDir:directory}),task=await core.createTask({title:'Account-bound action'}),owned=choiceBrowser(task.id);
 vi.spyOn(LocalBrowser,'open').mockResolvedValue(owned.browser);vi.spyOn(owned.browser,'bringToFront').mockResolvedValue();
 let account='reviewed-account',plans=0;const provider={accountScope:async()=>account,status:async()=>({configured:true,provider:'Codex (temporary)' as const,tier:'Standard' as const,endpoint:'inert',model:'inert',state:'ready' as const,detail:'Inert test provider',specialized:{sam:'off',computer:'off'}}),run:vi.fn(async(input:{sources:readonly {content:string}[]})=>{const observation=JSON.parse(input.sources[0].content).currentObservation;return JSON.stringify(plans++===0?{kind:'action',reason:'Choose parcel once',action:{kind:'select',targetId:observation.targets[0].id,value:'parcel'}}:{kind:'answer',markdown:'The selected option was observed.'});})};
 const service=new BrowserService(core,{panel:()=>({}) as never,route:()=>({key:'unchanged-route',provider}),changed:()=>{},progress:()=>{}}),input={taskId:task.id,requestId:'account-bound'};
 cleanups.push(async()=>{service.close();await core.cancelRequest(task.id,input.requestId).catch(()=>{});await core.close();await rm(directory,{recursive:true,force:true});});
 return {core,task,owned,service,input,provider,changeAccount(){account='different-account';},run(){return service.run({...input,prompt:'Choose parcel',url:choiceOrigin+'/form'});}};
}

it.each(['planner-response','action-review','execution-persistence'] as const)('account change at %s rejects the old plan without execution or replay',async boundary=>{
 const f=await fixture();
 if(boundary==='planner-response'){const original=f.provider.run.getMockImplementation()!;f.provider.run.mockImplementation(async input=>{const result=await original(input);f.changeAccount();return result;});}
 else if(boundary==='execution-persistence'){const original=f.core.replaceSession.bind(f.core);vi.spyOn(f.core,'replaceSession').mockImplementation(async(...args)=>{const result=await original(...args);if(args[2].runs.some(run=>run.operations.some(operation=>operation.status==='executing')))f.changeAccount();return result;});}
 else external.dialog.mockResolvedValueOnce({response:1}).mockImplementationOnce(async()=>{f.changeAccount();return {response:1};});
 await expect(f.run()).rejects.toThrow(boundary==='execution-persistence'?BROWSER_ACTION_NOT_RUN:'account changed');expect(f.owned.selections).toBe(0);expect(f.provider.run).toHaveBeenCalledOnce();expect(external.launch).not.toHaveBeenCalled();
 await expect(f.run()).rejects.toThrow();expect(f.provider.run).toHaveBeenCalledOnce();expect(f.owned.selections).toBe(0);
 const saved=await f.core.getTask(f.task.id);expect(saved.requests.at(-1)?.status).toBe('failed');expect(saved.session!.runs[0].operations.every(operation=>operation.status==='retired'||operation.status==='failed')).toBe(true);
});

it.each(['before','during'] as const)('account change %s Return consent cannot resume the paused browser',async boundary=>{
 const f=await fixture();external.dialog.mockResolvedValueOnce({response:1}).mockResolvedValueOnce({response:2});
 const running=f.run();void running.catch(()=>{});await expect.poll(()=>f.service.controlStatus(f.input).mode).toBe('user');
 const control=f.service.controlStatus(f.input);if(!('id' in control))throw Error('Missing paused control');
 if(boundary==='before')f.changeAccount();else external.dialog.mockImplementationOnce(async()=>{f.changeAccount();return {response:1};});
 await expect(f.service.changeControl({...f.input,id:control.id,action:'return'})).rejects.toThrow('account changed');
 expect(f.service.controlStatus(f.input).mode).toBe('user');expect(f.provider.run).toHaveBeenCalledOnce();expect(f.owned.selections).toBe(0);expect(external.dialog).toHaveBeenCalledTimes(boundary==='before'?2:3);
 await f.core.cancelRequest(f.task.id,f.input.requestId);await expect(running).rejects.toThrow();expect(f.service.controlStatus(f.input)).toEqual({mode:'unavailable'});expect(external.launch).not.toHaveBeenCalled();
});

it('account recheck cannot reuse a target changed during the recheck',async()=>{
 const f=await fixture(),original=f.core.replaceSession.bind(f.core);let persisted=false;
 vi.spyOn(f.core,'replaceSession').mockImplementation(async(...args)=>{const result=await original(...args);if(args[2].runs.some(run=>run.operations.some(operation=>operation.status==='executing')))persisted=true;return result;});
 const account=f.provider.accountScope;vi.spyOn(f.provider,'accountScope').mockImplementation(async()=>{if(persisted)f.owned.element.options[1].label='Changed option';return account();});
 await expect(f.run()).rejects.toThrow('changed');expect(f.owned.selections).toBe(0);expect(f.provider.run).toHaveBeenCalledOnce();expect((await f.core.getTask(f.task.id)).session!.runs[0].operations[0].status).toBe('failed');
});

it('Stop ends a held pre-execution account check and its late completion never dispatches',async()=>{
 const f=await fixture(),original=f.core.replaceSession.bind(f.core);let persisted=false,release!:()=>void,entered!:()=>void;
 const ready=new Promise<void>(resolve=>{entered=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
 vi.spyOn(f.core,'replaceSession').mockImplementation(async(...args)=>{const result=await original(...args);if(args[2].runs.some(run=>run.operations.some(operation=>operation.status==='executing')))persisted=true;return result;});
 const account=f.provider.accountScope;vi.spyOn(f.provider,'accountScope').mockImplementation(async()=>{if(persisted){entered();await held;}return account();});
 const running=f.run();void running.catch(()=>{});await ready;await f.core.cancelRequest(f.task.id,f.input.requestId);await expect(running).rejects.toThrow();release();await Promise.resolve();
 expect(f.owned.selections).toBe(0);expect(f.provider.run).toHaveBeenCalledOnce();const saved=await f.core.getTask(f.task.id);expect(saved.requests.at(-1)?.status).toBe('cancelled');expect(saved.session!.runs[0].operations[0].status).toBe('retired');
});
