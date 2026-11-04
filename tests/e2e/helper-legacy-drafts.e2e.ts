import {expect,test,type Locator,type Page} from '@playwright/test';
import {textHelperEntry} from '../support/text-helper-entry.fixture';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

const evidence=process.env.SEMANTIC_HELPER_RUN_EVIDENCE??'evidence/semantic-helper-run-qualified';
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true});});

const workspace=(page:Page)=>page.locator('.workspace:visible'),document=(page:Page)=>page.getByRole('dialog',{name:'Document',exact:true});
async function openDetails(scope:Locator,name:string){const summary=scope.locator('summary').filter({hasText:name});if(await summary.locator('../..').getAttribute('open')===null)await summary.click();}
async function files(page:Page){await workspace(page).getByRole('button',{name:'Task options',exact:true}).click();await workspace(page).getByRole('button',{name:'Files',exact:true}).click();return page.getByRole('dialog',{name:'Files',exact:true});}

test('all legacy helper form families restore raw input and selected check after navigation and restart',async({page})=>{
 const entry=await textHelperEntry(page);
 try{
  await page.getByRole('button',{name:'Continue',exact:true}).click();await workspace(page).getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'New task',exact:true}).click();await workspace(page).getByRole('button',{name:'Write a draft',exact:true}).click();
  const start=page.getByRole('region',{name:'Start with a draft',exact:true});await start.getByLabel('Title (optional)',{exact:true}).fill('Legacy helper draft owner');await start.getByLabel('Draft content',{exact:true}).fill('Owned synthetic text.');await start.getByRole('button',{name:'Create task',exact:true}).click();await document(page).getByRole('button',{name:'Back to task',exact:true}).click();
  let list=await files(page);await list.getByRole('button',{name:'New file',exact:true}).click();await list.getByRole('button',{name:'Text helper',exact:true}).click();let scope=document(page).locator('.helper-studio');
  await scope.getByRole('button',{name:'Start demonstration',exact:true}).click();await scope.getByRole('button',{name:'Demonstrate operation',exact:true}).click();await scope.getByRole('button',{name:'Stop and use demonstration',exact:true}).click();await scope.getByLabel('Test input',{exact:true}).fill('');await scope.getByLabel('Expected text',{exact:true}).fill('');await scope.getByRole('button',{name:'Add check',exact:true}).click();await scope.getByRole('button',{name:'Save tested version',exact:true}).click();await scope.getByRole('button',{name:'Activate version 1',exact:true}).click();
  await openDetails(scope,'Name and discovery label');await scope.getByLabel('Helper name',{exact:true}).fill('  Unsaved helper name  ');await scope.getByLabel('Discovery label',{exact:true}).fill('  Find this later  ');
  await openDetails(scope,'Teach or change this helper');await scope.getByLabel('Demonstration input',{exact:true}).fill('  Unsent example\n');await scope.getByLabel('Text operation',{exact:true}).selectOption('replace-literal');await scope.getByLabel('Find exact text',{exact:true}).fill(' x ');await scope.getByLabel('Replace with',{exact:true}).fill('  y  ');
  await openDetails(scope,'Exceptions and checks');await scope.getByLabel('If input contains',{exact:true}).fill('  PRIVATE  ');await scope.getByRole('combobox',{name:'Then',exact:true}).selectOption('abstain');await scope.getByLabel('Why',{exact:true}).fill('  Keep reason  ');
  const check=scope.getByRole('row').filter({hasText:'Protected or unusual input (counterexample)'});await check.getByRole('button',{name:'Edit check',exact:true}).click();await expect(scope.getByLabel('Test input',{exact:true})).toHaveJSProperty('readOnly',false);await scope.getByLabel('Test input',{exact:true}).fill('  Exact check input  ');await scope.getByLabel('Expected text',{exact:true}).fill('  Exact expected output  ');
  await openDetails(scope,'Saved versions');await scope.getByLabel('What changed?',{exact:true}).fill('  Unsent version note  ');await scope.getByLabel('Fresh text',{exact:true}).fill('  Fresh unsent input  ');await entry.fixture.flushDrafts();
  await document(page).getByRole('button',{name:'Back to task',exact:true}).click();await expect(page.getByRole('dialog',{name:'Keep your unsaved edits?',exact:true})).toHaveCount(0);
  list=await files(page);await list.getByRole('button',{name:/^Text helper Document/}).click();scope=document(page).locator('.helper-studio');
  const verify=async()=>{
   await openDetails(scope,'Name and discovery label');await expect(scope.getByLabel('Helper name',{exact:true})).toHaveValue('  Unsaved helper name  ');await expect(scope.getByLabel('Discovery label',{exact:true})).toHaveValue('  Find this later  ');
   await openDetails(scope,'Teach or change this helper');await expect(scope.getByLabel('Demonstration input',{exact:true})).toHaveValue('  Unsent example\n');await expect(scope.getByLabel('Text operation',{exact:true})).toHaveValue('replace-literal');await expect(scope.getByLabel('Find exact text',{exact:true})).toHaveValue(' x ');await expect(scope.getByLabel('Replace with',{exact:true})).toHaveValue('  y  ');
   await openDetails(scope,'Exceptions and checks');await expect(scope.getByLabel('If input contains',{exact:true})).toHaveValue('  PRIVATE  ');await expect(scope.getByRole('combobox',{name:'Then',exact:true})).toHaveValue('abstain');await expect(scope.getByLabel('Why',{exact:true})).toHaveValue('  Keep reason  ');await expect(scope.getByRole('button',{name:'Save check correction',exact:true})).toBeVisible();await expect(scope.getByLabel('Test input',{exact:true})).toHaveValue('  Exact check input  ');await expect(scope.getByLabel('Expected text',{exact:true})).toHaveValue('  Exact expected output  ');
   await openDetails(scope,'Saved versions');await expect(scope.getByLabel('What changed?',{exact:true})).toHaveValue('  Unsent version note  ');await expect(scope.getByLabel('Fresh text',{exact:true})).toHaveValue('  Fresh unsent input  ');
  };
  await verify();await entry.fixture.flushDrafts();await entry.fixture.restart();list=await files(page);await list.getByRole('button',{name:/^Text helper Document/}).click();scope=document(page).locator('.helper-studio');await verify();
  await scope.getByLabel('If input contains',{exact:true}).evaluate(node=>node.scrollIntoView({block:'center'}));await page.screenshot({path:join(evidence,'legacy-restored-exception.png')});
  await scope.getByLabel('Test input',{exact:true}).evaluate(node=>node.scrollIntoView({block:'center'}));await page.screenshot({path:join(evidence,'legacy-restored-selected-check.png')});
 }finally{await entry.close();}
});

test('switching a blank helper to record mode keeps earlier text-mode input copyable in Files',async({page})=>{
 const entry=await textHelperEntry(page);
 try{
  await page.getByRole('button',{name:'Continue',exact:true}).click();await workspace(page).getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'New task',exact:true}).click();await workspace(page).getByRole('button',{name:'Write a draft',exact:true}).click();
  const start=page.getByRole('region',{name:'Start with a draft',exact:true});await start.getByLabel('Title (optional)',{exact:true}).fill('Mode transition owner');await start.getByLabel('Draft content',{exact:true}).fill('Owned synthetic content.');await start.getByRole('button',{name:'Create task',exact:true}).click();await document(page).getByRole('button',{name:'Back to task',exact:true}).click();
  let list=await files(page);await list.getByRole('button',{name:'New file',exact:true}).click();await list.getByRole('button',{name:'Text helper',exact:true}).click();const scope=document(page).locator('.helper-studio');
  await openDetails(scope,'Name and discovery label');await scope.getByLabel('Helper name',{exact:true}).fill('  Unapplied text-mode name  ');await entry.fixture.flushDrafts();
  await scope.getByRole('button',{name:'Create a local record helper',exact:true}).click();await expect(scope.getByRole('heading',{name:'Local record helper',exact:true})).toBeVisible();await expect(page.getByRole('dialog',{name:'Keep your unsaved edits?',exact:true})).toHaveCount(0);
  await document(page).getByRole('button',{name:'Back to task',exact:true}).click();list=await files(page);await list.getByText('Unfinished practice',{exact:true}).click();
  const old=list.locator('article').filter({hasText:'  Unapplied text-mode name  '});await expect(old).toBeVisible();await expect(old).toContainText(/changed|earlier/i);await expect(old.getByRole('button',{name:'Keep my edits',exact:true})).toHaveCount(0);await expect(old.getByRole('button',{name:'Discard this practice draft',exact:true})).toBeEnabled();
  await entry.fixture.flushDrafts();await entry.fixture.restart();list=await files(page);await list.getByText('Unfinished practice',{exact:true}).click();const reopenedOld=list.locator('article').filter({hasText:'  Unapplied text-mode name  '});await expect(reopenedOld).toBeVisible();await reopenedOld.getByText('Your unapplied edits',{exact:true}).evaluate(node=>node.scrollIntoView({block:'center'}));await page.screenshot({path:join(evidence,'legacy-obsolete-mode-files.png')});
 }finally{await entry.close();}
});
