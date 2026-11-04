import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {chromium,type Browser} from 'playwright-core';
import {OnboardingFixture} from '../support/onboarding-fixture';
import {BrowserCoordinator} from '../../src/host/browser/coordinator';
import {BrowserControl} from '../../src/host/browser/control';
import type {Command} from '../../src/shared/bridge';
import {installLoopbackTestEngine} from '../support/loopback-browser.fixture';
// Loopback-locked engine only: these specs never launch or select the person's installed browsers.
installLoopbackTestEngine();

// Real renderer, coordinator, store and owned browser; native dialogs and planner are substitutes.
test('user pauses, edits the active browser, returns deliberately, and stops another paused request',async({page})=>{
 let visits=0;const server=createServer((req,res)=>{res.setHeader('content-type','text/html');if(req.url==='/next'){visits++;res.end('<h1>Owned result</h1>');}else res.end('<h1>Owned control page</h1><label>Note<input value="Before"></label><a href="/next">Next</a>');});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw Error('Missing owned port');const origin=`http://127.0.0.1:${address.port}`;
 const fixture=await OnboardingFixture.open(page,{ready:true}),original=fixture.invoke.bind(fixture);fixture.configured=true;
 let active:{taskId:string;requestId:string;control:BrowserControl}|undefined,plans=0,approvals=0;const work=new Set<Promise<unknown>>();
 const launch=chromium.launch.bind(chromium);let ownedBrowser:Browser|undefined;
 // Capture only the fresh Chromium launched by this test's coordinator.
 chromium.launch=async options=>{ownedBrowser=await launch(options);return ownedBrowser;};
 const handle=async(c:Command):Promise<unknown>=>{
  if(c.type==='browser.control.status')return active&&active.taskId===c.taskId&&active.requestId===c.requestId?active.control.status():{mode:'unavailable'};
  if(c.type==='browser.control'){
   if(!active||active.taskId!==c.taskId||active.requestId!==c.requestId||active.control.status().id!==c.id)throw Error('Expired owned control');
   fixture.commands.push(c);return c.action==='take'?active.control.take():active.control.returnToAgent();
  }
  if(c.type==='model.cancel'){fixture.commands.push(c);return fixture.core.cancelRequest(c.taskId,c.requestId);}
  if(c.type!=='browser.run')return original(c);
  fixture.commands.push(c);const control=new BrowserControl();active={taskId:c.taskId,requestId:c.requestId,control};let turn=0;
  const coordinator=new BrowserCoordinator(fixture.core,{endpointKey:'owned-scripted-planner',async plan(input){
   plans++;if(++turn===1)return new Promise((_resolve,reject)=>input.signal.addEventListener('abort',()=>reject(Error('Paused scripted planner')),{once:true}));
   const target=input.observation.targets.find(item=>item.label==='Next');
   if(target){expect(input.observation.targets.find(item=>item.label==='Note')?.value).toBe('Manual revision');return {kind:'action',reason:'Read owned next page after return',action:{kind:'click',targetId:target.id}};}
   return {kind:'answer',markdown:'Owned result observed after manual handoff.',modules:[]};
  }});
  try{const result=await coordinator.run({taskId:c.taskId,requestId:c.requestId,goal:c.prompt,origin,url:c.url,submittedDraft:c.submittedDraft,transmissionApproved:true,control,headless:false,approveAction:async()=>{approvals++;return {approved:true};},onProgress:()=>{void fixture.emit({type:'changed',taskId:c.taskId});}});await fixture.emit({type:'changed',taskId:c.taskId});if(result.status!=='completed')throw Error(result.error??'Owned request stopped');return fixture.core.getTask(c.taskId);}finally{active=undefined;}
 };
 fixture.invoke=c=>{const promise=handle(c);work.add(promise);void promise.finally(()=>work.delete(promise)).catch(()=>{});return promise;};
 try{
  await page.reload();const workspace=page.locator('.workspace:visible'),prompt=workspace.getByRole('textbox',{name:'Ask about this task',exact:true});await prompt.fill('Read the owned next page after I edit.');await workspace.getByRole('button',{name:'Request options',exact:true}).click();await workspace.getByRole('button',{name:'Use a browser',exact:true}).click();const start=page.locator('dialog.browser-start');await start.getByLabel('Page address',{exact:true}).fill(origin);await start.getByRole('button',{name:'Continue',exact:true}).click();await expect.poll(()=>plans).toBe(1);
  await page.screenshot({path:test.info().outputPath('agent-before-pause.png')});
  const pause=workspace.getByRole('button',{name:'Pause and take control',exact:true});await expect(pause).toBeVisible();await pause.focus();await page.keyboard.press('Enter');await expect(workspace.getByRole('status').filter({hasText:'You control the browser'})).toBeVisible();expect(visits).toBe(0);expect(plans).toBe(1);
  await ownedBrowser!.contexts()[0].pages()[0].getByLabel('Note',{exact:true}).fill('Manual revision');await page.screenshot({path:test.info().outputPath('workspace-user-control.png')});
  await workspace.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:700});const compact=page.locator('.compact-companion:visible');await expect(compact.getByRole('button',{name:'Return browser control',exact:true})).toBeVisible();await page.screenshot({path:test.info().outputPath('compact-user-control.png')});await compact.getByText('What you can do',{exact:true}).click();await expect(compact.getByRole('status').filter({hasText:'the page may keep running or loading'})).toBeVisible();await expect(compact).toContainText('Manual same-site navigation and GET forms can change the website without another Glint approval.');await expect(compact).toContainText('including requests started or scheduled earlier');await expect(compact.getByRole('button',{name:'Return browser control',exact:true})).toBeInViewport();await expect(compact.getByRole('button',{name:'Stop',exact:true})).toBeInViewport();expect(await compact.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);await page.screenshot({path:test.info().outputPath('compact-control-limits.png')});await compact.getByText('What you can do',{exact:true}).click();await compact.getByRole('button',{name:'Return browser control',exact:true}).click();await expect(compact).toContainText('Owned result observed after manual handoff.');expect(visits).toBe(1);expect(approvals).toBe(1);
  await compact.getByRole('button',{name:'Open task workspace',exact:true}).click();await page.setViewportSize({width:1080,height:800});await prompt.fill('Pause this second owned request.');await workspace.getByRole('button',{name:'Ask',exact:true}).click();await expect.poll(()=>plans).toBe(4);const beforeStopVisits=visits;expect(beforeStopVisits).toBe(2);await workspace.getByRole('button',{name:'Pause and take control',exact:true}).click();await expect(workspace.getByRole('button',{name:'Return browser control',exact:true})).toBeVisible();await workspace.getByRole('button',{name:'Stop',exact:true}).click();await expect(workspace.getByRole('button',{name:'Return browser control',exact:true})).toHaveCount(0);expect(visits).toBe(beforeStopVisits);expect(fixture.external).toEqual([]);expect((await fixture.core.listTasks())[0].requests.at(-1)?.status).toBe('cancelled');
 }finally{chromium.launch=launch;if(active)await fixture.core.cancelRequest(active.taskId,active.requestId);await Promise.allSettled([...work]);await ownedBrowser?.close();await fixture.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
