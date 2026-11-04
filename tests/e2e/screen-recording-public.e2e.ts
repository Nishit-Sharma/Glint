import {test,expect,type Page} from '@playwright/test';
import {OnboardingFixture} from '../support/onboarding-fixture';

// Browser fixture only: proves the Settings control, indicator and commands; native pixel protection needs the installed app.
test('Screen & shortcut offers a protected-by-default screen recording choice with a main-window indicator',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:1120,height:760});const fixture=await OnboardingFixture.open(page);
 try{
  await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByText('Local example · Bundled on this device',{exact:true})).toBeVisible();
  const indicator=page.getByRole('region',{name:'Screen recording status'});await expect(indicator).toHaveCount(0);
  await page.locator('.task-sidebar').getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('tab',{name:'Screen & shortcut',exact:true}).click();
  const toggle=page.getByRole('checkbox',{name:'Allow screen recording',exact:true});await expect(toggle).not.toBeChecked();await expect(toggle).toBeEnabled();
  await expect(page.getByText('Glint windows become visible to screen recording and screenshots. The Muse key window stays hidden. This resets to protected each time Glint opens.',{exact:true})).toBeVisible();
  await toggle.click();await expect(toggle).toBeChecked();await expect(indicator).toContainText('Visible to screen recording');
  await toggle.click();await expect(toggle).not.toBeChecked();await expect(indicator).toHaveCount(0);
  await toggle.click();await expect(indicator).toBeVisible();await page.keyboard.press('Escape');await expect(toggle).toHaveCount(0);
  await indicator.getByRole('button',{name:'Hide from recording',exact:true}).click();await expect(indicator).toHaveCount(0);await expect(page.locator('#main')).toBeFocused();
  await page.locator('.task-sidebar').getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('tab',{name:'Screen & shortcut',exact:true}).click();await expect(toggle).not.toBeChecked();
  expect(fixture.commands.filter(command=>command.type.startsWith('screen-recording.set'))).toEqual([{type:'screen-recording.set',allowed:true},{type:'screen-recording.set',allowed:false},{type:'screen-recording.set',allowed:true},{type:'screen-recording.set',allowed:false}]);
  expect(fixture.external).toEqual([]);
 }finally{await fixture.close();}
});

async function frame(page:Page,name:string){const path=test.info().outputPath(name+'.png');await page.screenshot({path,fullPage:false});await test.info().attach(name,{path,contentType:'image/png'});}

test('compact companion and minimized anchor show a small recording cue that leaves the character visible',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:1120,height:760});const fixture=await OnboardingFixture.open(page);
 try{
  await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByText('Local example · Bundled on this device',{exact:true})).toBeVisible();
  const cue=page.getByRole('img',{name:'Visible to screen recording',exact:true});
  await fixture.emit({type:'surface',mode:'companion'});await page.setViewportSize({width:360,height:440});await expect(page.locator('.compact-chrome')).toBeVisible();await expect(page.locator('.screen-recording-cue')).toHaveCount(0);
  await page.evaluate(()=>window.companion.invoke({type:'screen-recording.set',allowed:true}));
  const compact=page.locator('.compact-chrome .screen-recording-cue--compact');await expect(compact).toBeVisible();await expect(compact).toHaveAccessibleName('Visible to screen recording');
  const box=(await compact.boundingBox())!;expect(box.width).toBeLessThanOrEqual(16);expect(box.height).toBeLessThanOrEqual(16);await frame(page,'compact-recording-cue');
  await fixture.emit({type:'surface',mode:'anchor'});await page.setViewportSize({width:74,height:64});
  const anchor=page.getByRole('button',{name:'Open Glint · Visible to screen recording',exact:true});await expect(anchor).toBeVisible();
  const anchorCue=page.locator('.anchor-wrap .screen-recording-cue--anchor');await expect(anchorCue).toBeVisible();
  const cueBox=(await anchorCue.boundingBox())!,anchorBox=(await anchor.boundingBox())!;expect(cueBox.width).toBeLessThanOrEqual(16);expect(cueBox.height).toBeLessThanOrEqual(16);expect(anchorBox.width).toBeGreaterThan(40);
  expect(await page.evaluate(()=>document.querySelectorAll('.screen-recording-cue.anchor,.screen-recording-cue.compact').length)).toBe(0);
  expect(await page.evaluate(({x,y})=>!!document.elementFromPoint(x,y)?.closest('.anchor'),{x:anchorBox.x+anchorBox.width/2,y:anchorBox.y+anchorBox.height/2})).toBe(true);
  await frame(page,'anchor-recording-cue');
  await page.evaluate(()=>window.companion.invoke({type:'screen-recording.set',allowed:false}));await expect(anchorCue).toHaveCount(0);await expect(page.getByRole('button',{name:'Open Glint',exact:true})).toBeVisible();await expect(cue).toHaveCount(0);
  expect(fixture.external).toEqual([]);
 }finally{await fixture.close();}
});
