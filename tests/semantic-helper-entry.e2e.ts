import {expect,test,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {textHelperEntry} from './text-helper-entry.fixture';

const evidence=process.env.SEMANTIC_HELPER_RUN_EVIDENCE??process.env.SEMANTIC_HELPER_EVIDENCE??'evidence/semantic-helper-entry';
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true});});
const workspace=(page:Page)=>page.locator('.workspace:visible');
const dialog=(page:Page)=>page.getByRole('dialog',{name:'Document',exact:true});
const helper=(page:Page)=>dialog(page).locator('.helper-studio');
async function menu(page:Page){await workspace(page).getByRole('button',{name:'Task options',exact:true}).click();await workspace(page).getByRole('button',{name:'Files',exact:true}).click();}

test('ordinary helper entry builds, checks, activates, corrects, rolls back and reopens local records',async({page})=>{
 const entry=await textHelperEntry(page);
 try{
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await workspace(page).getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'New task',exact:true}).click();
  await workspace(page).getByRole('button',{name:'Write a draft',exact:true}).click();
  const start=page.getByRole('region',{name:'Start with a draft',exact:true});await start.getByLabel('Title (optional)',{exact:true}).fill('Record helper owner');await start.getByLabel('Draft content',{exact:true}).fill('Owned local record practice.');await start.getByRole('button',{name:'Create task',exact:true}).click();
  await dialog(page).getByRole('button',{name:'Back to task',exact:true}).click();await menu(page);
  const files=page.getByRole('dialog',{name:'Files',exact:true});await files.getByRole('button',{name:'New file',exact:true}).click();await files.getByRole('button',{name:'Text helper',exact:true}).click();
  let scope=helper(page);await scope.getByRole('button',{name:'Create a local record helper',exact:true}).click();await expect(scope.getByRole('heading',{name:'Local record helper',exact:true})).toBeVisible();await expect(dialog(page)).toContainText('Local record helper. Choose fields and check local computations here.');await expect(dialog(page)).not.toContainText('Teach only the listed text operations');
  await scope.getByRole('button',{name:'Save draft steps',exact:true}).click();
  await scope.getByRole('button',{name:'Record local computation',exact:true}).click();
  const first=scope.locator('summary').filter({hasText:'Computed result'}).first();await first.click();await expect(first.locator('..')).toContainText('standard');await expect(first.locator('..')).toContainText('Compare the number');
  await scope.getByRole('button',{name:'Check examples',exact:true}).click();await expect(scope).toContainText('Local checks pass.');await expect(scope).toContainText('Different input alone does not verify independence.');
  await scope.getByText('Correct the proposed reason',{exact:true}).click();await scope.getByLabel('Corrected reason',{exact:true}).fill('The number chooses a local route.');await scope.getByLabel('Why',{exact:true}).fill('Clarify the local scope.');await scope.getByRole('button',{name:'Save correction',exact:true}).click();await expect(scope).toContainText('Corrected: The number chooses a local route.');
  await scope.getByRole('button',{name:'Save checked record version',exact:true}).click();await expect(scope).toContainText('Active version: none.');await scope.getByRole('button',{name:'Activate version 1',exact:true}).click();
  await scope.getByRole('button',{name:'Run active record helper',exact:true}).click();await expect(scope.getByText('Version 1 local result',{exact:true}).locator('..')).toContainText('review');
  await scope.getByLabel('Compare with',{exact:true}).fill('2000');await scope.getByRole('button',{name:'Save revised draft steps',exact:true}).click();
  await scope.getByLabel('Held-out expected result',{exact:true}).fill('standard');await scope.getByRole('button',{name:'Check examples',exact:true}).click();await expect(scope).toContainText('Local checks pass.');
  await scope.getByRole('button',{name:'Save checked record version',exact:true}).click();await expect(scope).toContainText('Active version: 1.');await scope.getByRole('button',{name:'Activate version 2',exact:true}).click();await scope.getByRole('button',{name:'Run active record helper',exact:true}).click();await expect(scope.getByText('Version 2 local result',{exact:true}).locator('..')).toContainText('standard');
  await scope.getByRole('button',{name:'Roll back to version 1',exact:true}).click();await scope.getByRole('button',{name:'Run active record helper',exact:true}).click();await expect(scope.getByText('Version 1 local result',{exact:true}).locator('..')).toContainText('review');
  await scope.getByText('Earlier proposed and corrected reasons',{exact:true}).click();await expect(scope).toContainText('The number chooses a local route.');await scope.getByText('Version 1 local result',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:join(evidence,'record-rollback.png')});
  await dialog(page).getByRole('button',{name:'Back to task',exact:true}).click();await workspace(page).getByRole('textbox',{name:'Ask about this task',exact:true}).fill('Keep the owner question.');
  await workspace(page).getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'New task',exact:true}).click();await workspace(page).getByRole('button',{name:'Write a draft',exact:true}).click();
  const other=page.getByRole('region',{name:'Start with a draft',exact:true});await other.getByLabel('Title (optional)',{exact:true}).fill('Another task');await other.getByLabel('Draft content',{exact:true}).fill('A separate owned task.');await other.getByRole('button',{name:'Create task',exact:true}).click();await dialog(page).getByRole('button',{name:'Back to task',exact:true}).click();await workspace(page).getByRole('textbox',{name:'Ask about this task',exact:true}).fill('Keep the other question.');
  await menu(page);await page.getByRole('dialog',{name:'Files',exact:true}).getByRole('button',{name:'Saved helpers',exact:true}).click();
  const catalog=page.getByRole('dialog',{name:'Saved helpers',exact:true}),item=catalog.getByRole('article',{name:'Text helper · request in Record helper owner',exact:true});await expect(item).toContainText('Active version 1');await item.getByRole('button',{name:'Open helper',exact:true}).click();await expect(workspace(page).getByRole('heading',{name:'Record helper owner',exact:true})).toBeVisible();await expect(helper(page).getByRole('heading',{name:'Local record helper',exact:true})).toBeVisible();
  await dialog(page).getByRole('button',{name:'Back to task',exact:true}).click();await expect(workspace(page).getByRole('textbox',{name:'Ask about this task',exact:true})).toHaveValue('Keep the owner question.');await workspace(page).getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'Another task',exact:true}).click();await expect(workspace(page).getByRole('textbox',{name:'Ask about this task',exact:true})).toHaveValue('Keep the other question.');await workspace(page).getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'Record helper owner',exact:true}).click();
  await entry.fixture.restart();await menu(page);await page.getByRole('dialog',{name:'Files',exact:true}).getByRole('button',{name:/^Text helper Document/}).click();scope=helper(page);await expect(scope.getByText('Version 1 local result',{exact:true}).locator('..')).toContainText('review');
  expect(entry.fixture.external).toEqual([]);expect(entry.fixture.commands.filter(command=>command.type==='model.run'||command.type==='browser.run'||command.type==='windows.capture'||command.type.startsWith('export.'))).toEqual([]);
 }finally{await entry.close();}
});
