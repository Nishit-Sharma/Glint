import {BrowserControl} from '../../src/host/browser/control';
import {test,expect,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {OnboardingFixture} from '../support/onboarding-fixture';
import {workflowSite} from '../support/browser-workflow-site';
import {saveBrowserWorkflow} from '../../src/core/browser-workflow-host';
import {executeBrowserWorkflow} from '../../src/host/browser/authored-workflow';
import type {Command} from '../../src/shared/bridge';

/** Actual App → real core → existing Coordinator → actual isolated Chromium.
 * Native dialogs are explicit approval substitutes; no provider is configured. */
async function entry(page:Page,deny=false,pauseOnce=false){
 const site=await workflowSite(),fixture=await OnboardingFixture.open(page,{ready:true,port:4327}),catalog=await fixture.ready(),task=await fixture.core.createTask({title:'Browser workflow authoring',assignedBotId:catalog.defaultBotId}),approvals:string[]=[];
 let active:{control:BrowserControl;taskId:string;requestId:string}|undefined,didPause=false;
 const invoke=fixture.invoke.bind(fixture);fixture.invoke=async(command:Command)=>{
  if(command.type==='browser.control.status')return active?.taskId===command.taskId&&active.requestId===command.requestId?active.control.status():{mode:'unavailable'};
  if(command.type==='browser.control'){if(!active||active.taskId!==command.taskId||active.requestId!==command.requestId||active.control.status().id!==command.id)throw Error('Expired browser control');fixture.commands.push(command);if(command.action==='take')return active.control.take();approvals.push('return-control-fixture');return active.control.returnToAgent();}
  if(command.type==='browser.workflow.save'){fixture.commands.push(structuredClone(command));const {type,...input}=command;const result=await saveBrowserWorkflow(fixture.core,input);await fixture.emit({type:'changed',taskId:task.id});return result;}
  if(command.type==='browser.workflow.run'){
   fixture.commands.push(structuredClone(command));const {type,...input}=command;
   const control=new BrowserControl();active={control,taskId:input.taskId,requestId:input.requestId};
   try{const result=await executeBrowserWorkflow(fixture.core,input,{control,headless:true,authorizeStart:async()=>{approvals.push('fresh-browser');},approveAction:async current=>{approvals.push(current.proposal.intent.kind);if(pauseOnce&&!didPause){didPause=true;control.take();return {approved:false};}return deny?{approved:false}:{approved:true,...(current.review.write?{write:current.review.write}:{})};}});
   await fixture.emit({type:'changed',taskId:task.id});return {task:await fixture.core.getTask(task.id),requestId:result.id,status:result.status,error:result.error};}finally{control.close();active=undefined;}
  }
  if(command.type==='model.cancel'){fixture.commands.push(structuredClone(command));return fixture.core.cancelRequest(command.taskId,command.requestId);}
  return invoke(command);
 };
 await fixture.viewPreferences.select(task.id);await fixture.restart();await page.getByRole('button',{name:task.title,exact:true}).click();await page.locator('.workspace').getByRole('heading',{name:task.title,exact:true}).waitFor();
 return {site,fixture,task,approvals,close:async()=>{await fixture.close();await site.close();}};
}
async function files(page:Page){await page.locator('.workspace').getByRole('button',{name:'Task options',exact:true}).click();await page.locator('.workspace').getByRole('button',{name:'Files',exact:true}).click();}
async function author(page:Page,origin:string){
 await files(page);await page.getByRole('dialog',{name:'Files',exact:true}).getByRole('button',{name:'New file',exact:true}).click();await page.getByRole('button',{name:'Browser workflow',exact:true}).click();
 const studio=page.getByRole('region',{name:'Authored browser workflow',exact:true});await expect(studio).toContainText('This starter has not observed a website.');await studio.getByLabel('Workflow name',{exact:true}).fill('Authored request workflow');await studio.getByLabel('Website origin',{exact:true}).fill(origin);
 await studio.getByText('Step 1: Enter the request title',{exact:true}).click();await expect(studio.getByLabel('Step 1 value',{exact:true})).toHaveValue('{{title}}');await expect(studio.getByLabel('Step 1 after check 1 expected text',{exact:true})).toHaveValue('{{title}}');await studio.getByText('Step 1: Enter the request title',{exact:true}).click();
 await studio.getByRole('button',{name:'Save workflow',exact:true}).click();await expect(studio.getByRole('heading',{name:'Authored request workflow',exact:true})).toBeVisible();await expect(studio.getByRole('heading',{name:'Steps and checks',exact:true})).toHaveCount(0);await expect(studio).toContainText('Saved revision 1');await expect(page.locator('.workspace .conversation')).not.toContainText('schemaVersion');await expect(page.locator('.workspace .conversation')).not.toContainText('pathPrefix');await expect(studio.getByRole('heading',{name:'Authored request workflow',exact:true})).toBeFocused();return studio;
}

test('author, inspect, save, reuse on two fresh form targets, and reopen the saved workflow',async({page})=>{
 const e=await entry(page);await mkdir('evidence/browser-workflow',{recursive:true});
 try{
  let studio=await author(page,e.site.origin);await expect(studio).toContainText('Before');await expect(studio).toContainText('After');await page.screenshot({path:'evidence/browser-workflow/authored-review-desktop.png'});
  await page.getByRole('button',{name:'Back to task',exact:true}).click();await page.locator('.workspace').getByRole('button',{name:'Task options',exact:true}).click();await page.locator('.workspace').getByRole('button',{name:'History',exact:true}).click();await page.getByRole('dialog',{name:'History',exact:true}).getByRole('button',{name:'Authored request workflow · Revision 1',exact:true}).click();const history=page.getByRole('region',{name:'Saved revision',exact:true});await expect(history).toContainText('Request title equals: {{title}}');await expect(history).not.toContainText('schemaVersion');await expect(history).not.toContainText('pathPrefix');await page.screenshot({path:'evidence/browser-workflow/historical-workflow-readable.png'});await page.getByRole('button',{name:'Back to task',exact:true}).click();await files(page);await page.getByRole('dialog',{name:'Files',exact:true}).getByRole('button',{name:/Authored request workflow Browser workflow/}).click();studio=page.getByRole('region',{name:'Authored browser workflow',exact:true});
  for(const [target,title,delivery] of [['teach','Harbor lights','courier'],['fresh','Juniper inventory','post']]){
   await studio.getByLabel('Fresh target URL',{exact:true}).fill(e.site.origin+'/requests/'+target);await studio.getByLabel('Request title',{exact:true}).fill(title);await studio.getByLabel('Delivery value',{exact:true}).fill(delivery);await studio.getByRole('button',{name:'Review fresh run',exact:true}).click();const review=studio.getByRole('region',{name:'Fresh workflow run review',exact:true});await expect(review).toContainText(title);await expect(review).toContainText(delivery);await review.getByRole('button',{name:'Open fresh browser',exact:true}).click();await expect(studio.getByRole('heading',{name:'Workflow checks passed',exact:true})).toBeVisible();await expect(studio.getByRole('heading',{name:'Workflow checks passed',exact:true})).toBeFocused();await expect.poll(()=>e.site.effects.length).toBe(target==='teach'?1:2);await studio.getByRole('button',{name:'Prepare another fresh target',exact:true}).click();
  }
  const saved=await e.fixture.core.getTask(e.task.id);expect(e.approvals).toEqual(['fresh-browser','fill','fill','click','fresh-browser','fill','fill','click']);expect(saved.session!.runs).toHaveLength(2);expect(e.site.effects.map(effect=>effect.title)).toEqual(['Harbor lights','Juniper inventory']);expect(e.fixture.commands.filter(command=>command.type==='model.run'||command.type==='browser.run'||command.type.startsWith('export.')||command.type==='windows.capture')).toEqual([]);expect(e.fixture.configured).toBe(false);expect(e.fixture.external).toEqual([]);
  await e.fixture.restart();await page.locator('.workspace').getByRole('heading',{name:e.task.title,exact:true}).waitFor();await files(page);await page.getByRole('dialog',{name:'Files',exact:true}).getByRole('button',{name:/Authored request workflow Browser workflow/}).click();studio=page.getByRole('region',{name:'Authored browser workflow',exact:true});await expect(studio).toContainText('Saved revision 1');await expect(studio.getByRole('heading',{name:'Workflow checks passed',exact:true})).toBeVisible();await page.setViewportSize({width:390,height:800});await studio.getByRole('heading',{name:'Authored request workflow',exact:true}).scrollIntoViewIfNeeded();expect(await studio.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);await page.screenshot({path:'evidence/browser-workflow/reopened-review-narrow.png'});
  await writeFile('evidence/browser-workflow/public-ledger.json',JSON.stringify({mode:'Actual renderer/core/Chromium; injected host approval callbacks, no native dialog clicks or provider',approvals:e.approvals,effects:e.site.effects,commands:e.fixture.commands,task:await e.fixture.core.getTask(e.task.id)},null,2));
 }finally{await e.close();}
});

test('declining a step keeps the workflow and stops before any form write',async({page})=>{
 const e=await entry(page,true);
 try{const studio=await author(page,e.site.origin);await studio.getByLabel('Fresh target URL',{exact:true}).fill(e.site.origin+'/requests/declined');await studio.getByLabel('Request title',{exact:true}).fill('Do not submit');await studio.getByLabel('Delivery value',{exact:true}).fill('courier');await studio.getByRole('button',{name:'Review fresh run',exact:true}).click();await studio.getByRole('button',{name:'Open fresh browser',exact:true}).click();await expect(studio.getByRole('heading',{name:'Workflow stopped: failed',exact:true})).toBeVisible();await expect(studio).toContainText('not authorized');expect(e.site.effects).toEqual([]);expect(e.approvals).toEqual(['fresh-browser','fill']);expect((await e.fixture.core.getTask(e.task.id)).session!.runs[0].operations[0].status).toBe('retired');await expect(studio.getByRole('button',{name:'Edit workflow',exact:true})).toBeEnabled();}finally{await e.close();}
});


test('paused authored work can be returned through the existing browser control inside the recipe inspector',async({page})=>{
 const e=await entry(page,false,true);
 try{
  const studio=await author(page,e.site.origin);await studio.getByLabel('Fresh target URL',{exact:true}).fill(e.site.origin+'/requests/inspector-control');await studio.getByLabel('Request title',{exact:true}).fill('Inspector return');await studio.getByLabel('Delivery value',{exact:true}).fill('courier');await studio.getByRole('button',{name:'Review fresh run',exact:true}).click();await studio.getByRole('button',{name:'Open fresh browser',exact:true}).click();
  const control=studio.getByRole('region',{name:'Browser control',exact:true});await expect(control).toContainText('You control the browser');expect(e.site.effects).toEqual([]);await control.getByRole('button',{name:'Return browser control',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'evidence/browser-workflow/inspector-user-control.png'});await control.getByRole('button',{name:'Return browser control',exact:true}).click();await expect(studio.getByRole('heading',{name:'Workflow checks passed',exact:true})).toBeVisible();expect(e.site.effects).toHaveLength(1);expect(e.approvals).toEqual(['fresh-browser','fill','return-control-fixture','fill','fill','click']);
 }finally{await e.close();}
});
