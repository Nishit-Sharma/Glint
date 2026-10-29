import {test,expect} from '@playwright/test';
import {BrowserFixture} from './browser-fixture';

test('plain shape names omit Crescent choices while an older saved shape remains editable',async({page})=>{
 await page.setViewportSize({width:1080,height:720});await page.emulateMedia({reducedMotion:'reduce'});
 const fixture=await BrowserFixture.open(page);
 try{
  const before=await fixture.core.getTask(fixture.taskA.id);
  await fixture.preferences.update({expectedRevision:0,profile:{personalName:null,look:{shape:'dumpling',color:'sage',face:'curious',motion:false}}});
  await page.reload();await page.getByRole('button',{name:'Customize Companion',exact:true}).click();
  await expect(page.getByRole('button',{name:'Crescent',exact:true})).toHaveCount(0);
  for(const name of ['Dumpling','Onigiri','Star'])await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'Character name',exact:true}).fill('My companion');
  await page.getByRole('button',{name:'Save appearance',exact:true}).click();
  await expect(page.getByText('Appearance saved.',{exact:true})).toBeVisible();
  expect(await fixture.preferences.read()).toMatchObject({kind:'available',current:{profile:{personalName:'My companion',look:{shape:'dumpling'}}}});
  expect(await fixture.core.getTask(fixture.taskA.id)).toEqual(before);
 }finally{await fixture.close();}
});
