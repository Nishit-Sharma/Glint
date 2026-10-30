import {test,expect,type Locator,type Page} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {browserLaunchRendererEntry} from './browser-launch-renderer.fixture';
import {settleCapture} from './settled-capture';

const safe='Glint could not open its browser. Your task is kept.';
const workspace=(page:Page)=>page.locator('.workspace:visible');
async function frame(page:Page,anchor:Locator,name:string){
 await anchor.scrollIntoViewIfNeeded();await settleCapture(page);await expect(anchor).toBeVisible();await expect(anchor).toBeInViewport({ratio:1});
 await expect.poll(()=>anchor.evaluate(element=>{for(let current:Element|null=element;current;current=current.parentElement){const s=getComputedStyle(current);if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)<.99)return false;}return true;})).toBe(true);
 const path=test.info().outputPath(name+'.png');await page.screenshot({path,fullPage:false});await test.info().attach(name,{path,contentType:'image/png'});
}

test('public browser entry retains a prior uncertain action and draft across a controlled launch failure, inspection and Stop',async({page})=>{
 const entry=await browserLaunchRendererEntry(page),f=entry.fixture;
 try{
  await expect(page.getByRole('heading',{name:'Choose your companion',exact:true})).toBeVisible();await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByText('Local example · Bundled on this device',{exact:true})).toBeVisible();const tasks=await f.core.listTasks();expect(tasks).toHaveLength(1);const task=tasks[0];
  const prompt=workspace(page).getByRole('textbox',{name:'Ask about this task',exact:true});await prompt.fill('Record an owned synthetic action.');
  await workspace(page).getByRole('button',{name:'Request options',exact:true}).click();await workspace(page).getByRole('button',{name:'Use a browser',exact:true}).click();
  const start=page.locator('dialog.browser-start');await expect(start).toBeVisible();await start.getByLabel('Page address',{exact:true}).fill('https://owned.example/form');await start.getByRole('button',{name:'Continue',exact:true}).click();
  const previous=workspace(page).locator('.conversation-turn').filter({hasText:'Record an owned synthetic action.'});await expect(previous.getByRole('button',{name:'Inspect outcome',exact:true})).toBeVisible();
  const before=(await f.core.getTask(task.id)).session!.runs[0].operations[0];expect(before).toMatchObject({id:'synthetic-unknown-action',status:'uncertain'});
  entry.setMode('failure');const raw='Keep this exact unsent browser question.';await prompt.fill(raw);await workspace(page).getByRole('button',{name:'Ask',exact:true}).click();
  const failure=workspace(page).locator('.conversation-turn').filter({hasText:raw});await expect(failure.getByText(safe,{exact:true})).toBeVisible();await expect(prompt).toHaveValue(raw);
  await expect.poll(async()=>(await f.core.getTask(task.id)).requests.at(-1)?.status).toBe('failed');const after=await f.core.getTask(task.id);expect(after.session?.draft).toBe(raw);expect(after.session?.runs[0].operations[0]).toEqual(before);expect(after.requests.at(-1)?.error).toBe('Companion could not open its browser. Your task is kept.');expect(after.sources).toEqual(task.sources);expect(after.artifacts).toEqual(task.artifacts);
  await expect(workspace(page).getByRole('button',{name:/^(Install browser|Repair browser|Finish setup)$/})).toHaveCount(0);
  await frame(page,failure.getByText(safe,{exact:true}),'full-launch-failure');
  await previous.getByLabel('Page with the outcome',{exact:true}).fill('https://owned.example/receipt');await previous.getByRole('button',{name:'Inspect outcome',exact:true}).click();await expect(previous.getByRole('alert')).toHaveText(safe);await expect(previous.getByRole('button',{name:'Inspect outcome',exact:true})).toBeVisible();
  expect((await f.core.getTask(task.id)).session?.runs[0].operations[0]).toEqual(before);await frame(page,previous.getByRole('alert'),'full-inspection-failure');
  await workspace(page).getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:640});const compact=page.locator('.compact-companion:visible');await expect(compact.getByRole('region',{name:'Latest request outcome',exact:true})).toContainText(safe);await expect(compact.getByRole('region',{name:'Earlier browser action',exact:true})).toContainText('Outcome needs review');await expect(compact.getByRole('textbox',{name:'Ask companion',exact:true})).toHaveValue(raw);
  await frame(page,compact.getByRole('region',{name:'Latest request outcome',exact:true}).getByText(safe,{exact:true}),'compact-launch-failure');await frame(page,compact.getByRole('region',{name:'Earlier browser action',exact:true}).getByRole('status'),'compact-prior-uncertainty');
  await compact.getByRole('button',{name:'Review browser outcome',exact:true}).click();await page.setViewportSize({width:1080,height:800});await expect(previous.getByRole('button',{name:'Inspect outcome',exact:true})).toBeVisible();await f.restart();await expect(workspace(page).getByRole('textbox',{name:'Ask about this task',exact:true})).toHaveValue(raw);expect((await f.core.getTask(task.id)).session?.runs[0].operations[0]).toEqual(before);
  entry.setMode('hold');await workspace(page).getByRole('button',{name:'Ask',exact:true}).click();await expect.poll(()=>entry.held).toBe(true);await workspace(page).getByRole('button',{name:'Stop',exact:true}).click();await expect.poll(async()=>(await f.core.getTask(task.id)).requests.at(-1)?.status).toBe('cancelled');await expect(workspace(page).getByRole('textbox',{name:'Ask about this task',exact:true})).toHaveValue(raw);expect((await f.core.getTask(task.id)).session?.runs[0].operations[0]).toEqual(before);
  const final=await f.core.getTask(task.id);expect(final.sources).toEqual(task.sources);expect(final.artifacts).toEqual(task.artifacts);
  expect(f.commands.filter(command=>command.type==='browser.run')).toHaveLength(3);expect(f.commands.filter(command=>command.type==='browser.inspect')).toHaveLength(1);expect(f.commands.filter(command=>command.type==='model.cancel')).toHaveLength(1);expect(f.commands.filter(command=>command.type==='model.run'||command.type==='connection.configure')).toEqual([]);expect(f.external).toEqual([]);
  const ledger=test.info().outputPath('journey.json');await writeFile(ledger,JSON.stringify({scope:'Actual renderer/onboarding and disposable core. Browser action, launch failure, inspection and provider status are controlled transport substitutes. No website, BrowserService or provider.',taskId:task.id,requests:final.requests.map(({id,kind,prompt,status,error})=>({id,kind,prompt,status,error})),draft:final.session?.draft,priorOperation:final.session?.runs[0].operations[0],browserCommands:f.commands.filter(command=>command.type==='browser.run'||command.type==='browser.inspect'||command.type==='model.cancel'),externalRequests:f.external},null,2));await test.info().attach('journey',{path:ledger,contentType:'application/json'});
 }finally{await entry.close();}
});
