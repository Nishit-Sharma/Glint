import {test,expect} from '@playwright/test';
import {BrowserFixture} from './browser-fixture';
test.use({viewport:{width:430,height:760},reducedMotion:'reduce'});
test('request options remain inside the composer and can be opened by pointer and keyboard',async({page})=>{
 const fixture=await BrowserFixture.open(page);
 try{
  await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await expect(page.getByLabel('Ask companion',{exact:true})).toBeVisible();
  await expect(page.locator('.compact-companion')).toHaveAttribute('data-surface-reveal','settled');
  const button=page.getByRole('button',{name:'Request options',exact:true});
  // Compact fitting can resize between two awaited boundingBox calls.
  const {bounds,input}=await page.locator('.compact-companion').evaluate(root=>({bounds:root.querySelector('.composer-options>summary')!.getBoundingClientRect().toJSON(),input:root.querySelector('.nexvyn-composer')!.getBoundingClientRect().toJSON()}));
  expect(bounds.x).toBeGreaterThanOrEqual(input.x);expect(bounds.y).toBeGreaterThanOrEqual(input.y);expect(bounds.right).toBeLessThanOrEqual(input.right);expect(bounds.bottom).toBeLessThanOrEqual(input.bottom);
  await button.click();await expect(page.getByLabel('Companion request type',{exact:true})).toBeVisible();await button.click();await expect(page.getByLabel('Companion request type',{exact:true})).toBeHidden();
  await button.focus();await page.keyboard.press('Enter');await expect(page.getByLabel('Companion request type',{exact:true})).toBeVisible();await expect(button).toBeFocused();
  for(const name of ['Use screen context','Image','Paste text','Use a browser']){await page.keyboard.press('Tab');await expect(page.getByRole('button',{name,exact:true})).toBeFocused();}
  await page.keyboard.press('Tab');await expect(page.locator('.compact-companion .request-sources>summary')).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByLabel('Companion request type',{exact:true})).toBeFocused();
 }finally{await fixture.close()}
});
