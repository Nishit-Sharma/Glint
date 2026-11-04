import {test,expect} from '@playwright/test';
import {BrowserFixture} from '../support/browser-fixture';
test.use({viewport:{width:360,height:440},reducedMotion:'reduce'});
let f:BrowserFixture;
test.afterEach(async()=>{await f?.close();});
test('a very large measured body cannot exceed the native fit protocol or hide a reopened task',async({page})=>{
 f=await BrowserFixture.open(page,'anchor');await page.addStyleTag({content:'.compact-content{min-height:150000px}'});const base=Reflect.get(f,'invoke').bind(f),heights:number[]=[];
 Reflect.set(f,'invoke',async(c:any)=>{if(c.type!=='surface.fit')return base(c);heights.push(c.height);if(c.height>100000)throw Error('Invalid compact content height.');return {height:440,maxHeight:440};});
 await f.enter('companion',{id:'large-body',maxHeight:440});await expect(page.locator('.compact-companion')).toHaveAttribute('data-surface-reveal','settled');expect(heights.length).toBeGreaterThan(0);expect(Math.max(...heights)).toBeLessThanOrEqual(100000);await expect(page.locator('.compact-main')).toBeVisible();
});
