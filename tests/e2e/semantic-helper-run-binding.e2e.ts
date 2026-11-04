import {expect,test,type Page} from '@playwright/test';
import {textHelperEntry} from '../support/text-helper-entry.fixture';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

const evidence=process.env.SEMANTIC_HELPER_RUN_EVIDENCE??'evidence/semantic-helper-run-qualified';
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true});});

const workspace=(page:Page)=>page.locator('.workspace:visible');
const document=(page:Page)=>page.getByRole('dialog',{name:'Document',exact:true});
const helper=(page:Page)=>document(page).locator('.helper-studio');
async function files(page:Page){await workspace(page).getByRole('button',{name:'Task options',exact:true}).click();await workspace(page).getByRole('button',{name:'Files',exact:true}).click();}

test('a record result stays bound to its submitted input across edits and restart',async({page})=>{
 const entry=await textHelperEntry(page);
 try{
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await workspace(page).getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'New task',exact:true}).click();
  await workspace(page).getByRole('button',{name:'Write a draft',exact:true}).click();
  const start=page.getByRole('region',{name:'Start with a draft',exact:true});await start.getByLabel('Title (optional)',{exact:true}).fill('Run binding owner');await start.getByLabel('Draft content',{exact:true}).fill('Owned local record practice.');await start.getByRole('button',{name:'Create task',exact:true}).click();
  await document(page).getByRole('button',{name:'Back to task',exact:true}).click();await files(page);
  const list=page.getByRole('dialog',{name:'Files',exact:true});await list.getByRole('button',{name:'New file',exact:true}).click();await list.getByRole('button',{name:'Text helper',exact:true}).click();
  let scope=helper(page);await scope.getByRole('button',{name:'Create a local record helper',exact:true}).click();await scope.getByRole('button',{name:'Save draft steps',exact:true}).click();await scope.getByRole('button',{name:'Record local computation',exact:true}).click();await scope.getByRole('button',{name:'Check examples',exact:true}).click();await expect(scope).toContainText('Local checks pass.');await scope.getByRole('button',{name:'Save checked record version',exact:true}).click();await scope.getByRole('button',{name:'Activate version 1',exact:true}).click();
  const versions=scope.getByRole('region',{name:'Record helper versions',exact:true}),number=versions.getByLabel('Fresh record number',{exact:true}),sensitive=versions.getByRole('checkbox',{name:'sensitive',exact:true});
  await number.fill('100');await versions.getByRole('button',{name:'Run active record helper',exact:true}).click();
  const result=versions.getByText('Version 1 local result',{exact:true}).locator('../..');await expect(result).toContainText('standard');await expect(versions.getByRole('button',{name:'Run active record helper',exact:true})).toBeEnabled();
  await expect(number).toHaveValue('100');await expect(sensitive).not.toBeChecked();
  await sensitive.check();await expect(result).toHaveCount(0);
  await versions.getByRole('button',{name:'Run active record helper',exact:true}).click();await expect(result).toContainText('Sensitive input requires review.');await expect(versions.getByRole('button',{name:'Run active record helper',exact:true})).toBeEnabled();await expect(number).toHaveValue('100');await expect(sensitive).toBeChecked();
  await versions.getByRole('button',{name:'Run active record helper',exact:true}).evaluate(node=>node.scrollIntoView({block:'center'}));await page.screenshot({path:join(evidence,'record-run-nondefault-input-stop.png')});
  await entry.fixture.flushDrafts();await entry.fixture.restart();await files(page);await page.getByRole('dialog',{name:'Files',exact:true}).getByRole('button',{name:/^Text helper Document/}).click();
  scope=helper(page);const reopened=scope.getByRole('region',{name:'Record helper versions',exact:true});await expect(reopened.getByLabel('Fresh record number',{exact:true})).toHaveValue('100');await expect(reopened.getByRole('checkbox',{name:'sensitive',exact:true})).toBeChecked();await expect(reopened.getByText('Version 1 local result',{exact:true}).locator('../..')).toContainText('Sensitive input requires review.');
  expect(entry.fixture.external).toEqual([]);
 }finally{await entry.close();}
});
