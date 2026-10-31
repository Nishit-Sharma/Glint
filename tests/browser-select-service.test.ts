import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,expect,it,vi} from 'vitest';
import {createCompanion} from '../src/core/companion';
import {BrowserService} from '../src/host/browser/service';
import {LocalBrowser} from '../src/host/browser/local-browser';
import {choiceBrowser,choiceOrigin,stubChoiceDom} from './browser-select.fixture';
const external=vi.hoisted(()=>({dialog:vi.fn(),launch:vi.fn()}));
vi.mock('electron',()=>({dialog:{showMessageBox:external.dialog}}));
vi.mock('playwright-core',()=>({chromium:{launch:external.launch}}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

it.each([true,false])('host consent shows exact selected label and value; decision %s never creates a write grant',async approve=>{
 stubChoiceDom();const directory=await mkdtemp(join(tmpdir(),'choice-consent-')),core=await createCompanion({dataDir:directory}),task=await core.createTask({title:'Parcel choice'}),owned=choiceBrowser(task.id);vi.spyOn(LocalBrowser,'open').mockResolvedValue(owned.browser);let plans=0;
 external.dialog.mockReset().mockResolvedValueOnce({response:1}).mockResolvedValueOnce({response:approve?1:0});
 const service=new BrowserService(core,{panel:()=>({}) as never,route:()=>({key:'owned',provider:{status:async()=>({configured:true,provider:'Codex (temporary)' as const,tier:'Standard',endpoint:'inert',model:'inert',state:'ready' as const,detail:'Inert test provider',specialized:{sam:'off',computer:'off'}}),run:async input=>{const current=JSON.parse(input.sources[0].content).currentObservation;return JSON.stringify(plans++===0?{kind:'action',reason:'Choose the requested parcel delivery',action:{kind:'select',targetId:current.targets[0].id,value:'parcel'}}:{kind:'answer',markdown:'The selected option is visible. No form was submitted.'});}}}),changed:()=>{},progress:()=>{}});
 try{
  if(approve)await service.run({taskId:task.id,requestId:'select',prompt:'Choose parcel',url:choiceOrigin+'/form'});else await expect(service.run({taskId:task.id,requestId:'select',prompt:'Choose parcel',url:choiceOrigin+'/form'})).rejects.toThrow('not authorized');
  const consent=external.dialog.mock.calls[1][1];expect(consent.message).toBe('Select this option?');expect(consent.detail).toContain('Control: Delivery');expect(consent.detail).toContain('Option: Ship parcel\nValue: parcel');expect(consent.detail).toContain('can change the website through same-site GET or HEAD requests');expect(consent.detail).toContain('their effects may be unknown');expect(consent.detail).toContain('POST, PUT, PATCH and DELETE requests are blocked');expect(consent.buttons).toEqual(['Cancel','Select once','Pause and take control']);expect(owned.selections).toBe(approve?1:0);expect(external.launch).not.toHaveBeenCalled();
 }finally{service.close();await core.close();await rm(directory,{recursive:true,force:true});}
});

it('selection-triggered POST without a separately reviewed form grant is blocked by the existing route',async()=>{
 stubChoiceDom();let routeRequest!:(route:any)=>Promise<void>,blocked=0,forwarded=0;
 const owned=choiceBrowser('route-choice');
 const context={on:()=>{},newPage:async()=>owned.page,route:async(_pattern:string,handler:(route:any)=>Promise<void>)=>{routeRequest=handler;},routeWebSocket:async()=>{},addInitScript:async()=>{},close:async()=>{}};
 external.launch.mockReset().mockResolvedValue({newContext:async()=>context,close:async()=>{}});
 const browser=await LocalBrowser.open({taskId:'route-choice',origin:choiceOrigin,url:choiceOrigin+'/form'});
 try{owned.onSelection(async()=>{await routeRequest({request:()=>({url:()=>choiceOrigin+'/save',method:()=>'POST',postData:()=> 'delivery=parcel'}),abort:async()=>{blocked++;},fetch:async()=>{forwarded++;throw Error('Unapproved network path');}});});const snapshot=await browser.observe(),proposal=await browser.propose({kind:'select',snapshotId:snapshot.id,targetId:snapshot.targets[0].id,value:'parcel'}),token=browser.approve(proposal.id);await browser.execute(proposal.id,token);await expect(browser.execute(proposal.id,token)).rejects.toThrow('already');expect(blocked).toBe(1);expect(forwarded).toBe(0);expect(browser.diagnostics.blockedRequests).toBe(1);expect(owned.selections).toBe(1);}finally{await browser.close();}
});

it.each(['GET','HEAD'])('selection consent includes possibly effectful same-site %s requests; lost selection result never repeats them',async method=>{
 stubChoiceDom();let routeRequest!:(route:any)=>Promise<void>,effects=0,fulfilled=0;
 const owned=choiceBrowser('get-choice'),context={on:()=>{},newPage:async()=>owned.page,route:async(_pattern:string,handler:(route:any)=>Promise<void>)=>{routeRequest=handler;},routeWebSocket:async()=>{},addInitScript:async()=>{},close:async()=>{}};
 external.launch.mockReset().mockResolvedValue({newContext:async()=>context,close:async()=>{}});const browser=await LocalBrowser.open({taskId:'get-choice',origin:choiceOrigin,url:choiceOrigin+'/form'});
 try{
  owned.onSelection(async()=>{await routeRequest({request:()=>({url:()=>choiceOrigin+'/possibly-effectful',method:()=>method}),abort:async()=>{throw Error('The established same-site request path should be allowed.');},fetch:async()=>{effects++;return {status:()=>200,dispose:async()=>{}};},fulfill:async()=>{fulfilled++;}});});owned.failSelection();
  const snapshot=await browser.observe(),proposal=await browser.propose({kind:'select',snapshotId:snapshot.id,targetId:snapshot.targets[0].id,value:'parcel'}),token=browser.approve(proposal.id);await expect(browser.execute(proposal.id,token)).rejects.toThrow('lost');expect(browser.proposal(proposal.id)?.status).toBe('uncertain');await expect(browser.execute(proposal.id,token)).rejects.toThrow('already');expect(effects).toBe(1);expect(fulfilled).toBe(1);expect(owned.selections).toBe(1);
 }finally{await browser.close();}
});

it('bounds the exact escaped context plus observation before calling a provider',async()=>{
 stubChoiceDom();const directory=await mkdtemp(join(tmpdir(),'choice-context-limit-')),core=await createCompanion({dataDir:directory}),task=await core.createTask({title:'Bounded source',goal:'\\'.repeat(10000)}),owned=choiceBrowser(task.id);vi.spyOn(LocalBrowser,'open').mockResolvedValue(owned.browser);
 for(let index=0;index<6;index++)await core.runRequest({taskId:task.id,requestId:'history-'+index,kind:'experiment',prompt:'\\'.repeat(1000),sourceIds:[]},async()=>({title:'Prior response',content:'\\'.repeat(2000)}));
 owned.element.options=Array.from({length:8},(_,index)=>({...owned.element.options[0],value:String(index)+'\\'.repeat(6000),label:'Option '+index}));external.dialog.mockReset().mockResolvedValue({response:1});const provider=vi.fn(async()=>{throw Error('Oversized browser data must not reach a provider.');}),service=new BrowserService(core,{panel:()=>({}) as never,route:()=>({key:'owned',provider:{status:async()=>({configured:true,provider:'Codex (temporary)' as const,endpoint:'inert',model:'inert',state:'ready' as const,detail:'Inert provider',specialized:{sam:'off',computer:'off'}}),run:provider}}),changed:()=>{},progress:()=>{}});
 try{await expect(service.run({taskId:task.id,requestId:'capacity',prompt:'Read visible choices',url:choiceOrigin+'/form'})).rejects.toThrow('browser planning limit');expect(provider).not.toHaveBeenCalled();const kept=await core.getTask(task.id);expect(kept.session!.runs[0].operations).toEqual([]);expect(JSON.stringify(kept.session!.runs[0].initialObservation).length).toBeLessThan(120001);expect(owned.selections).toBe(0);}finally{service.close();await core.close();await rm(directory,{recursive:true,force:true});}
});
