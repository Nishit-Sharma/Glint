import {test,expect} from '@playwright/test';
import {BrowserFixture} from './browser-fixture';

test('an unsourced compact draft leads without repeated capture instructions',async({page})=>{
 await page.setViewportSize({width:1080,height:720});const fixture=await BrowserFixture.open(page);
 try{
  const task=await fixture.core.createTask({title:'Invitation'});await fixture.changed();
  await page.getByRole('navigation',{name:'Saved tasks',exact:true}).getByRole('button',{name:'Invitation',exact:true}).click();
  await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();
  await page.setViewportSize({width:390,height:550});
  await expect(page.locator('.compact-source')).toBeHidden();
  await expect(page.getByRole('button',{name:'Use screen context',exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'Ask companion',exact:true}).fill('Help me phrase an invitation.');
  await expect(page.locator('.compact-main .context-welcome')).toBeHidden();
  await expect(page.locator('.compact-source')).toBeHidden();
  await page.getByRole('button',{name:'Request options',exact:true}).click();
  await expect(page.getByRole('button',{name:'Use screen context',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Image',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  expect(fixture.commands.filter(command=>command.type==='windows.capture'||command.type==='context.capture'||command.type==='model.run')).toHaveLength(0);
  expect((await fixture.core.getTask(task.id)).requests).toHaveLength(0);
 }finally{await fixture.close();}
});
