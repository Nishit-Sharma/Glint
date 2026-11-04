import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {BrowserFixture} from '../support/browser-fixture';

test.use({viewport:{width:430,height:760},reducedMotion:'reduce'});
test('Ask submits once with inline context, optional review preserves the draft, and compact context fits',async({page})=>{
 const fixture=await BrowserFixture.open(page);
 try{
  await expect(page.getByRole('heading',{name:'Task Alpha',exact:true})).toBeVisible();
  // ui-compact 2026-11-04: the visible context line is the composer's RequestContext; its own summary is the one to open.
  const context=()=>page.locator('div.request-context:visible');
  await expect(context()).toContainText('Context · Alpha brief + task history');await expect(context()).toContainText('To Meta');
  await page.getByLabel('Ask about this task',{exact:true}).fill('Explain this synthetic source.');
  await page.getByRole('button',{name:'Ask',exact:true}).click();await expect.poll(()=>fixture.pending.size).toBe(1);
  expect(fixture.commands.filter(command=>command.type==='model.run')).toHaveLength(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);fixture.complete('Synthetic source answer.');await expect.poll(()=>fixture.pending.size).toBe(0);
  await page.getByLabel('Ask about this task',{exact:true}).fill('Keep this unsent follow-up.');await expect(page.getByRole('button',{name:'Ask',exact:true})).toBeEnabled();
  await mkdir('evidence/direct-send',{recursive:true});await page.screenshot({path:'evidence/direct-send/workspace-context-430.png'});
  await context().locator(':scope>details>summary').click();await page.getByRole('button',{name:'Review or change context',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Context',exact:true})).toBeVisible();await page.getByRole('button',{name:'Back to task',exact:true}).click();
  await expect(page.getByLabel('Ask about this task',{exact:true})).toHaveValue('Keep this unsent follow-up.');
  await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:320,height:640});
  await expect(page.getByLabel('Ask companion',{exact:true})).toHaveValue('Keep this unsent follow-up.');await expect(context()).toContainText('Alpha brief');
  await page.locator('.compact-compose div.request-context').locator(':scope>details>summary').click();await expect(page.getByRole('button',{name:'Review or change context',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect.poll(()=>page.locator('.compact-companion').evaluate(root=>root.querySelector('.compact-compose')!.getBoundingClientRect().bottom<=root.getBoundingClientRect().bottom)).toBe(true);
  await page.screenshot({path:'evidence/direct-send/compact-context-320.png'});
  await page.locator('.compact-compose div.request-context').locator(':scope>details>summary').click();await page.screenshot({path:'evidence/direct-send/compact-summary-320.png'});await page.getByRole('button',{name:'Ask',exact:true}).click();await expect.poll(()=>fixture.pending.size).toBe(1);
  expect(fixture.commands.filter(command=>command.type==='model.run')).toHaveLength(2);expect(fixture.externalRequests).toEqual([]);fixture.complete('Synthetic follow-up answer.');
 }finally{await fixture.close();}
});
