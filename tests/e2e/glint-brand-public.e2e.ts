import {test,expect,type Page} from '@playwright/test';
import {OnboardingFixture} from '../support/onboarding-fixture';
import {settleCapture} from '../support/settled-capture';

async function frame(page:Page,name:string,settled=true){if(settled)await settleCapture(page);const path=test.info().outputPath(name+'.png');await page.screenshot({path,fullPage:false});await test.info().attach(name,{path,contentType:'image/png'});}

test('Glint names the product while the companion and macOS permission entry stay distinct',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:1120,height:760});const fixture=await OnboardingFixture.open(page);
 try{
  await expect(page).toHaveTitle('Glint');await expect(page.getByRole('heading',{name:'Choose your companion',exact:true})).toBeVisible();await expect(page.getByText('Glint · Pick a shape. Change it anytime.',{exact:true})).toBeVisible();await frame(page,'glint-onboarding-wide');
  await page.setViewportSize({width:320,height:640});await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeInViewport();await frame(page,'glint-onboarding-narrow');
  await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByText('Local example · Bundled on this device',{exact:true})).toBeVisible();await page.setViewportSize({width:1120,height:760});
  await page.locator('.task-sidebar').getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('tab',{name:'Screen & shortcut',exact:true}).click();await page.getByText('Turn on screen recording',{exact:true}).click();
  await expect(page.getByText('System Settings → Privacy & Security → Screen & System Audio Recording (Screen Recording before macOS 15) → Glint. Allow access, then reopen Glint.',{exact:true})).toBeVisible();await frame(page,'glint-system-permission-help');
  await fixture.emit({type:'surface',mode:'anchor'});await page.setViewportSize({width:74,height:64});await expect(page.getByRole('button',{name:'Open Glint',exact:true})).toBeVisible();await frame(page,'glint-anchor',false);
  expect(fixture.commands.filter(command=>['model.run','browser.run','browser.inspect','context.start','context.capture','windows.capture'].includes(command.type))).toEqual([]);expect(fixture.external).toEqual([]);
 }finally{await fixture.close();}
});
