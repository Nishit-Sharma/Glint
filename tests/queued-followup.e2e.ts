import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {BrowserFixture} from './browser-fixture';
test.use({viewport:{width:430,height:760},reducedMotion:'reduce'});
test('ordinary follow-up text can be queued, edited, cancelled, recovered and reviewed after restart at both sizes',async({page})=>{
 const fixture=await BrowserFixture.open(page);
 try{
  const input=()=>page.getByLabel('Ask about this task',{exact:true});
  await input().fill('Initial synthetic question.');await page.getByRole('button',{name:'Ask',exact:true}).click();await expect.poll(()=>fixture.pending.size).toBe(1);
  await expect(page.getByRole('button',{name:'Queue follow-up',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Stop response',exact:true})).toBeVisible();
  await input().fill('Keep this first queued message.');await input().press('Enter');await expect(page.locator('.queued-followups:visible summary')).toContainText('1 queued follow-up');await expect(input()).toHaveValue('');
  await input().fill('A newer unsent draft stays here.');await page.locator('.queued-followups:visible summary').click();await page.getByRole('button',{name:'Edit',exact:true}).click();await expect(page.getByLabel('Edit queued message')).toBeVisible();
  await page.getByLabel('Edit queued message').fill('Edited queued message.');await page.getByRole('button',{name:'Save follow-up',exact:true}).click();await expect(page.locator('.queue-prompt:visible')).toHaveText('Edited queued message.');await expect(input()).toHaveValue('A newer unsent draft stays here.');
  await input().fill('Cancel and recover this text.');await input().press('Enter');await expect(page.locator('.queued-followups:visible summary')).toContainText('2 queued follow-ups');
  const last=page.locator('.queued-followups:visible li').last();await last.getByRole('button',{name:'Cancel follow-up',exact:true}).click();await expect(last).toContainText('Cancelled');await last.getByRole('button',{name:'Use text in composer',exact:true}).click();await expect(input()).toHaveValue('Cancel and recover this text.');
  await expect(last.getByRole('button',{name:'Use text in composer',exact:true})).toBeDisabled();
  fixture.complete('Synthetic initial answer.');await expect.poll(()=>fixture.pending.size).toBe(0);await expect(page.getByRole('button',{name:'Ask',exact:true})).toBeVisible();
  await fixture.restartCore();await expect(page.locator('.queued-followups:visible')).toContainText('Held for review');await expect(page.locator('.queued-followups:visible')).toContainText('Glint restarted.');expect(fixture.pending.size).toBe(0);
  await page.locator('.queued-followups:visible ol').evaluate(element=>element.scrollTop=0);await mkdir('evidence/queue',{recursive:true});await page.screenshot({path:'evidence/queue/workspace-held-430.png'});
  await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:320,height:640});await expect(page.getByLabel('Ask companion',{exact:true})).toHaveValue('Cancel and recover this text.');await expect(page.locator('.compact-companion')).toHaveAttribute('data-surface-reveal','settled');
  await page.locator('.queued-followups:visible summary').click();await expect(page.locator('.queued-followups:visible')).toContainText('Edited queued message.');await expect(page.getByRole('button',{name:'Review or edit',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect.poll(()=>page.locator('.compact-companion').evaluate(root=>root.querySelector('.compact-compose')!.getBoundingClientRect().bottom<=root.getBoundingClientRect().bottom)).toBe(true);await expect(page.getByLabel('Ask companion',{exact:true})).toBeInViewport();await page.getByRole('button',{name:'Review or edit',exact:true}).scrollIntoViewIfNeeded();await expect(page.getByRole('button',{name:'Review or edit',exact:true})).toBeInViewport();await page.screenshot({path:'evidence/queue/compact-held-320.png'});
  expect(fixture.commands.filter(command=>command.type==='queue.submit')).toHaveLength(2);expect(fixture.commands.filter(command=>command.type==='model.run')).toHaveLength(1);expect(fixture.externalRequests).toEqual([]);
 }finally{await fixture.close();}
});
