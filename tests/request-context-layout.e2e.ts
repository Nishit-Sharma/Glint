import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test,expect} from '@playwright/test';
import {BrowserFixture} from './browser-fixture';

test.use({reducedMotion:'reduce'});
test('Context keeps a readable row and leaves the conversation and composer usable',async({page})=>{
 const fixture=await BrowserFixture.open(page),evidence=join(process.cwd(),'evidence/context-composer-layout',process.env.LAYOUT_PHASE??'candidate');
 try{
  await mkdir(evidence,{recursive:true});
  await fixture.core.putSource(fixture.taskA.id,{kind:'text',role:'fact',label:'GLINT Study A731 · glint-local-helper-reference-with-a-long-readable-source-name.md',content:'Synthetic layout context only.'});
  const question='Create a local text helper to teach, check and explain a short synthetic example.';
  await fixture.core.runRequest({taskId:fixture.taskA.id,requestId:crypto.randomUUID(),kind:'explain',prompt:question},async()=>({title:'Layout fixture answer',content:'A saved synthetic response remains readable above the composer.',mimeType:'text/markdown'}));
  await fixture.changed(fixture.taskA.id);
  const input=page.getByLabel('Ask about this task',{exact:true});
  await input.fill('Unsent layout check — keep this text.\nSecond line stays editable.');
  const measurements=[];
  for(const width of [430,1080,390]){
   await page.setViewportSize({width,height:760});
   await expect(page.locator('.workspace .chrome h1')).toHaveText('Task Alpha');
   await expect(page.locator('.workspace')).toHaveAttribute('data-surface-reveal',/^(settled|cancelled)$/);
   await expect(input).toHaveValue('Unsent layout check — keep this text.\nSecond line stays editable.');
   const geometry=await page.locator('.workspace-body').evaluate(root=>{
    const context=root.querySelector('.request-context')!,summary=context.querySelector(':scope>details>summary')!,end=context.querySelector(':scope>.request-context-end'),input=root.querySelector('#workspace-prompt')!,main=root.querySelector('main')!;
    const rect=(el:Element)=>el.getBoundingClientRect().toJSON();
    return {context:rect(context),summary:rect(summary),end:end?rect(end):undefined,input:rect(input),main:rect(main),viewport:innerHeight};
   });
   measurements.push({width,...geometry});
   await page.screenshot({path:join(evidence,`workspace-${width}.png`)});
   await writeFile(join(evidence,'geometry.json'),JSON.stringify(measurements,null,2)+'\n');
   // ui-compact 2026-11-04: the summary stops before the destination/Details group on the same row.
   expect(geometry.summary.width).toBeGreaterThan(geometry.context.width*.6);if(geometry.end)expect(geometry.summary.right).toBeLessThanOrEqual(geometry.end.left);
   expect(geometry.summary.height).toBeLessThan(90);
   expect(geometry.main.height).toBeGreaterThan(180);
   expect(geometry.input.y).toBeGreaterThan(geometry.main.y);
   expect(geometry.input.bottom).toBeLessThanOrEqual(geometry.viewport);
  }
  const context=page.locator('.workspace-compose .request-context');
  await context.locator(':scope>details:first-child>summary').click();
  await expect(context.getByRole('button',{name:'Review or change context',exact:true})).toBeVisible();
  await context.locator(':scope>details:first-child>summary').click();
  const options=page.getByRole('button',{name:'Request options',exact:true});
  await options.focus();await page.keyboard.press('Enter');
  await expect(page.getByLabel('Request type',{exact:true})).toBeVisible();
  await options.click();await input.focus();await input.press('End');await input.press('ArrowLeft');
  await expect(input).toBeFocused();
  expect(fixture.modelInvocations).toEqual([]);expect(fixture.externalRequests).toEqual([]);
 }finally{await fixture.close();}
});
