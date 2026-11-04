import {test,expect} from '@playwright/test';
import {settleCapture} from '../support/settled-capture';
import {OnboardingFixture} from '../support/onboarding-fixture';
import {observe,live,webgl,frame,json,windowOfMotion,expectStill,verifyNarrowFocus} from '../support/companion-motion-public-helpers';


test('wide companion picker keeps five independent original 3D actors alive through sixteen seconds and real pointer keyboard selection',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:1120,height:760});const fixture=await OnboardingFixture.open(page);
 try{
  await observe(page);await settleCapture(page);
  const shapes=page.getByRole('radiogroup',{name:'Companion shape',exact:true});await expect(shapes.locator('canvas')).toHaveCount(5);await expect(shapes.locator('[data-character-state="live"]')).toHaveCount(5);await webgl(page,'wide-picker-webgl');
  const sample=await windowOfMotion(page,'wide-picker-16s');for(const shape of ['soup','onigiri','mushroom','star','sprout'])expect(sample.some(s=>s.some(a=>a.shape===shape&&!a.destroyed&&a.lift>.02)),shape+' must visibly leave the original scene floor').toBe(true);
  const before=await live(page);await page.getByRole('radio',{name:'Onigiri',exact:true}).hover();await page.getByRole('radio',{name:'Onigiri',exact:true}).click();await page.getByText('Add a name',{exact:false}).click();await page.getByRole('textbox',{name:'Companion name',exact:true}).fill('Wide motion friend');
  await page.getByRole('radio',{name:'Onigiri',exact:true}).focus();await page.keyboard.press('End');await expect(page.getByRole('radio',{name:'Dollop',exact:true})).toBeChecked();await page.keyboard.press('Home');await expect(page.getByRole('radio',{name:'Dumpling',exact:true})).toBeChecked();
  expect((await live(page)).map(a=>a.instance)).toEqual(before.map(a=>a.instance));await page.getByRole('button',{name:'Pick for me',exact:true}).click();await expect(page.getByRole('radio',{name:'Dumpling',exact:true})).not.toBeChecked();await frame(page,'wide-picker-real-selection');
  await page.emulateMedia({reducedMotion:'reduce'});await expectStill(page);await frame(page,'wide-picker-reduced');await json('wide-picker-final-actors',await live(page));expect(fixture.external).toEqual([]);expect(fixture.commands.filter(c=>['model.run','context.start','context.capture','windows.capture','browser.inspect'].includes(c.type))).toEqual([]);
 }finally{await fixture.close();}
});

test('narrow companion picker shows sixteen seconds of motion and every offered shape can focus hop without clipping its stable card',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:320,height:640});const fixture=await OnboardingFixture.open(page);
 try{
  await observe(page);await settleCapture(page);
  const shapes=page.getByRole('radiogroup',{name:'Companion shape',exact:true}),first=shapes.getByRole('radio',{name:'Dumpling',exact:true});await expect(first.locator('[data-character-state="live"]')).toHaveCount(1);await webgl(page,'narrow-picker-webgl');
  const sample=await windowOfMotion(page,'narrow-picker-16s');expect(sample.some(s=>s.some(a=>a.lift>.02&&!a.destroyed))).toBe(true);
  const cards=await verifyNarrowFocus(page,shapes,true);
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeInViewport();await page.emulateMedia({reducedMotion:'reduce'});await expectStill(page);await frame(page,'narrow-picker-reduced');await json('narrow-picker-stable-cards',cards);expect(fixture.external).toEqual([]);expect(fixture.commands.filter(c=>['model.run','context.start','context.capture','windows.capture','browser.inspect'].includes(c.type))).toEqual([]);
 }finally{await fixture.close();}
});
