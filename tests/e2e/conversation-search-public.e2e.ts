import {expect,test,type Page} from '@playwright/test';
import {BrowserFixture} from '../support/browser-fixture';

test.use({viewport:{width:1080,height:800},reducedMotion:'reduce'});
const workspace=(page:Page)=>page.locator('.workspace:visible');
async function option(page:Page,name:string){await workspace(page).getByRole('button',{name:'Task options',exact:true}).click();await workspace(page).getByRole('button',{name,exact:true}).click();}
const panel=(page:Page)=>page.getByRole('dialog',{name:'Find saved work',exact:true});
async function search(page:Page,query='mesa'){const view=panel(page);await view.getByRole('combobox',{name:'Search in',exact:true}).selectOption('conversations');await view.getByRole('searchbox',{name:'Search saved work',exact:true}).fill(query);await view.getByRole('button',{name:'Search',exact:true}).click();return view;}
function noEffects(fixture:BrowserFixture){expect(fixture.commands.filter(command=>command.type==='model.run'||command.type.startsWith('browser.')||command.type.startsWith('windows.')||command.type.startsWith('export.')||command.type==='artifact.save'||command.type==='tasks.update'||command.type==='tasks.create'||command.type==='tasks.delete'||command.type==='source.text')).toEqual([]);expect(fixture.externalRequests).toEqual([]);}

test('conversation search opens exact questions and original answers across tasks, preserves drafts, returns to results and survives controlled recreation',async({page},info)=>{
 const fixture=await BrowserFixture.open(page,undefined,Number(process.env.WINDOW_COMPANION_TEST_PORT));
 try{
  for(const [owner,prompt,content] of [[fixture.taskA,'Mesa Alpha question?','Mesa Alpha original answer.'],[fixture.taskB,'Mesa Beta question?','  Mesa Beta original answer.\n\n<script>inert text</script>  ']] as const){
   await fixture.core.runRequest({taskId:owner.id,requestId:'recorded-'+owner.id,kind:'explain',prompt,sourceIds:[]},async()=>({title:'Recorded answer',content,mimeType:'text/markdown'}));
   const current=await fixture.core.getTask(owner.id),answer=current.artifacts.at(-1)!;await fixture.core.saveArtifact(owner.id,{artifactId:answer.id,expectedRevision:1,title:'Edited document',content:'Edited file content is separate.'});await fixture.changed(owner.id);
  }
  const composer=workspace(page).getByRole('textbox',{name:'Ask about this task',exact:true});await composer.fill('Keep this unsent Alpha question.');await expect.poll(async()=>(await fixture.core.getTask(fixture.taskA.id)).session?.draft).toBe('Keep this unsent Alpha question.');
  const before=await fixture.core.listTasks();await option(page,'Find saved work');let results=await search(page);await expect(results.getByRole('button',{name:/^Open conversation question in Task Alpha/})).toHaveCount(1);await expect(results.getByRole('button',{name:/^Open conversation answer in Task Beta/})).toHaveCount(1);await expect(results).toContainText('4 matches.');
  await results.getByRole('button',{name:/^Open conversation answer in Task Beta/}).click();let found=workspace(page).locator('[aria-label="Found conversation answer"]');await expect(found).toBeFocused();await expect(found).toContainText('Mesa Beta original answer.');await expect(found).not.toContainText('Edited file content is separate.');await expect(found.locator('script')).toHaveCount(0);await expect(workspace(page).getByRole('button',{name:'Choose task',exact:true})).toContainText('Task Beta');await workspace(page).screenshot({path:info.outputPath('original-answer-full.png')});
  await page.setViewportSize({width:360,height:640});await expect(found).toBeFocused();expect(await workspace(page).evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);await workspace(page).screenshot({path:info.outputPath('original-answer-narrow.png')});
  await workspace(page).getByRole('button',{name:'Back to search results',exact:true}).click();results=panel(page);await expect(results.getByRole('searchbox')).toHaveValue('mesa');await expect(results.getByRole('combobox')).toHaveValue('conversations');await results.getByRole('button',{name:/^Open conversation question in Task Alpha/}).click();found=workspace(page).locator('[aria-label="Found conversation question"]');await expect(found).toBeFocused();await expect(found.locator('p')).toHaveText('Mesa Alpha question?');await expect(composer).toHaveValue('Keep this unsent Alpha question.');await workspace(page).screenshot({path:info.outputPath('original-question-narrow.png')});
  await fixture.restartCore();await page.reload();await expect(composer).toHaveValue('Keep this unsent Alpha question.');await option(page,'Find saved work');results=await search(page);await results.getByRole('button',{name:/^Open conversation answer in Task Beta/}).click();await expect(workspace(page).locator('[aria-label="Found conversation answer"]')).toBeFocused();
  for(const original of before){const current=await fixture.core.getTask(original.id);expect(current.requests).toEqual(original.requests);expect(current.artifacts).toEqual(original.artifacts);expect(current.actions).toEqual(original.actions);}
  noEffects(fixture);
 }finally{await fixture.close();}
});

test('a deleted or changed task during a held conversation lookup stays in search',async({page})=>{
 const fixture=await BrowserFixture.open(page,undefined,Number(process.env.WINDOW_COMPANION_TEST_PORT));let release=()=>{};
 try{
  await fixture.core.runRequest({taskId:fixture.taskB.id,requestId:'recorded',kind:'explain',prompt:'Mesa question?',sourceIds:[]},async()=>({title:'Recorded answer',content:'Mesa governing answer.'}));await fixture.changed(fixture.taskB.id);await option(page,'Find saved work');
  for(const change of ['updated','deleted']){
   const results=await search(page),held=new Promise<void>(resolve=>{release=resolve;});fixture.taskRead=async taskId=>{const captured=await fixture.core.getTask(taskId);if(taskId===fixture.taskB.id)await held;return captured;};await results.getByRole('button',{name:/^Open conversation answer in Task Beta/}).click();await expect(results.getByRole('status').filter({hasText:'Opening saved work…'})).toBeVisible();
   if(change==='updated')await fixture.core.updateTask(fixture.taskB.id,{title:'Task Beta revised'});else await fixture.core.deleteTask(fixture.taskB.id);await fixture.changed(fixture.taskA.id);await expect(workspace(page).locator('.task-sidebar-task[aria-label="Task Beta"]')).toHaveCount(0);if(change==='updated')await expect(workspace(page).locator('.task-sidebar-task[aria-label="Task Beta revised"]')).toHaveCount(1);else await expect(workspace(page).locator('.task-sidebar-task[aria-label="Task Beta revised"]')).toHaveCount(0);release();await expect(results.getByRole('alert')).toBeVisible();await expect(workspace(page).getByRole('button',{name:'Choose task',exact:true})).toContainText('Task Alpha');await expect(workspace(page).locator('[aria-label="Found conversation answer"]')).toHaveCount(0);fixture.taskRead=undefined;
  }
  noEffects(fixture);
 }finally{release();await fixture.close();}
});
