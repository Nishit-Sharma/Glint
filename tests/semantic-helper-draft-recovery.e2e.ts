import {expect,test,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {textHelperEntry} from './text-helper-entry.fixture';

const evidence=process.env.SEMANTIC_HELPER_RUN_EVIDENCE??process.env.SEMANTIC_HELPER_DRAFT_EVIDENCE??'evidence/semantic-helper-drafts';
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true});});
const workspace=(page:Page)=>page.locator('.workspace:visible');
const document=(page:Page)=>page.getByRole('dialog',{name:'Document',exact:true});

async function opened(page:Page,result='review'){
 const entry=await textHelperEntry(page);
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await workspace(page).getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'New task',exact:true}).click();
 await workspace(page).getByRole('button',{name:'Write a draft',exact:true}).click();
 const start=page.getByRole('region',{name:'Start with a draft',exact:true});await start.getByLabel('Title (optional)',{exact:true}).fill('Owned record helper');await start.getByLabel('Draft content',{exact:true}).fill('Owned synthetic local example.');await start.getByRole('button',{name:'Create task',exact:true}).click();
 await document(page).getByRole('button',{name:'Back to task',exact:true}).click();await workspace(page).getByRole('button',{name:'Task options',exact:true}).click();await workspace(page).getByRole('button',{name:'Files',exact:true}).click();
 const files=page.getByRole('dialog',{name:'Files',exact:true});await files.getByRole('button',{name:'New file',exact:true}).click();await files.getByRole('button',{name:'Text helper',exact:true}).click();
 const scope=document(page).locator('.helper-studio');await scope.getByRole('button',{name:'Create a local record helper',exact:true}).click();
 if(result!=='review')await scope.getByLabel('Result when comparison is true',{exact:true}).fill(result);
 await scope.getByRole('button',{name:'Save draft steps',exact:true}).click();await scope.getByRole('button',{name:'Record local computation',exact:true}).click();
 if(result!=='review')await scope.getByLabel('Held-out expected result',{exact:true}).fill(result);
 await scope.getByRole('button',{name:'Check examples',exact:true}).click();await expect(scope).toContainText('Local checks pass.');await scope.getByRole('button',{name:'Save checked record version',exact:true}).click();
 return {entry,scope};
}

test('using an older version as draft preserves a newer unapplied threshold for explicit review',async({page})=>{
 const {entry,scope}=await opened(page);
 try{
  const threshold=scope.getByLabel('Compare with',{exact:true});await threshold.fill('3000');await entry.fixture.flushDrafts();
  await scope.getByRole('button',{name:'Use as draft',exact:true}).click();
  const recovery=scope.locator('.learning-draft-recovery');await expect(recovery).toBeVisible();await expect(threshold).toBeDisabled();
  await recovery.locator('summary').click();await expect(recovery).toContainText('3000');await recovery.scrollIntoViewIfNeeded();await page.screenshot({path:join(evidence,'restore-threshold-recovery.png')});
  await recovery.getByRole('button',{name:'Discard earlier unapplied edits',exact:true}).click();await expect(threshold).toBeEnabled();await expect(threshold).toHaveValue('1000');
 }finally{await entry.close();}
});

test('local record result preserves leading, repeated and trailing spaces on screen',async({page})=>{
 const exact='  review  ',{entry,scope}=await opened(page,exact);
 try{
  await scope.getByRole('button',{name:'Activate version 1',exact:true}).click();await scope.getByRole('button',{name:'Run active record helper',exact:true}).click();
  const result=scope.getByText('Version 1 local result',{exact:true}).locator('..'),value=result.locator('dd').filter({hasText:'review'}).first();
  await expect(value).toHaveJSProperty('textContent',exact);
  const geometry=await value.evaluate(element=>{
   const text=element.firstChild;if(!text)throw Error('Missing result text.');const range=window.document.createRange();
   range.setStart(text,0);range.setEnd(text,2);const leading=range.getBoundingClientRect().width;
   range.setStart(text,text.textContent!.length-2);range.setEnd(text,text.textContent!.length);const trailing=range.getBoundingClientRect().width;
   return {whiteSpace:getComputedStyle(element).whiteSpace,leading,trailing};
  });
  expect(['pre','pre-wrap','break-spaces']).toContain(geometry.whiteSpace);expect(geometry.leading).toBeGreaterThan(0);expect(geometry.trailing).toBeGreaterThan(0);
  await value.scrollIntoViewIfNeeded();await page.screenshot({path:join(evidence,'exact-result-whitespace.png')});
 }finally{await entry.close();}
});

test('a newer compact edit stays reviewable in both surfaces when a saved version becomes the draft',async({page})=>{
 const {entry,scope}=await opened(page);
 try{
  await scope.getByLabel('Compare with',{exact:true}).fill('3000');await entry.fixture.flushDrafts();
  await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:640});
  const compact=page.locator('.compact-companion:visible'),threshold=compact.getByLabel('Compare with',{exact:true});await expect(threshold).toHaveValue('3000');await threshold.fill('4000');await entry.fixture.flushDrafts();
  await compact.getByRole('button',{name:'Use as draft',exact:true}).click();const recovery=compact.locator('.learning-draft-recovery');await recovery.locator('summary').click();await expect(recovery).toContainText('4000');await expect(threshold).toBeDisabled();
  await recovery.locator('summary').evaluate(node=>node.scrollIntoView({block:'center'}));await page.screenshot({path:join(evidence,'compact-restored-threshold-recovery.png')});
  await recovery.locator('pre').first().evaluate(node=>node.scrollIntoView({block:'center'}));await page.screenshot({path:join(evidence,'compact-restored-threshold-values.png')});
  await compact.getByRole('button',{name:'Open task workspace',exact:true}).click();await page.setViewportSize({width:1080,height:800});const full=document(page).locator('.helper-studio'),fullRecovery=full.locator('.learning-draft-recovery');
  await fullRecovery.locator('summary').click();await expect(fullRecovery).toContainText('4000');await expect(full.getByLabel('Compare with',{exact:true})).toBeDisabled();
 }finally{await entry.close();}
});

test('an unconfirmed helper draft write keeps the exact edit and blocks quit until explicit retry',async({page})=>{
 const {entry,scope}=await opened(page);
 try{
  const save=entry.fixture.learningDrafts.save.bind(entry.fixture.learningDrafts);let failed=false;
  entry.fixture.learningDrafts.save=async(...args)=>{if(args[1]==='helper:semantic:steps'&&!failed){failed=true;throw Error('Synthetic sidecar write failure.');}return save(...args);};
  const threshold=scope.getByLabel('Compare with',{exact:true});await threshold.fill('3100');
  await expect(document(page).getByText('Unfinished practice could not be saved. Your input is kept in this open app. Resolve this before quitting.',{exact:true})).toBeVisible();
  await expect(threshold).toHaveValue('3100');await expect(entry.fixture.flushDrafts()).rejects.toThrow();
  await document(page).getByRole('button',{name:'Retry saving practice drafts',exact:true}).click();await expect(document(page).getByRole('button',{name:'Retry saving practice drafts',exact:true})).toHaveCount(0);
  await entry.fixture.flushDrafts();await entry.fixture.restart();await workspace(page).getByRole('button',{name:'Task options',exact:true}).click();await workspace(page).getByRole('button',{name:'Files',exact:true}).click();await page.getByRole('dialog',{name:'Files',exact:true}).getByRole('button',{name:/^Text helper Document/}).click();await expect(document(page).getByLabel('Compare with',{exact:true})).toHaveValue('3100');
 }finally{await entry.close();}
});
