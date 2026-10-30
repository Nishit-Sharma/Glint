import {test,expect} from '@playwright/test';
import {OnboardingFixture} from './onboarding-fixture';
import {settleCapture} from './settled-capture';
import {observe,frame,json,expectStill,verifyNarrowFocus} from './companion-motion-public-helpers';

test('narrow keyboard choice keeps the complete original focus ring inside every scroll edge and clear of the footer',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:320,height:640});const fixture=await OnboardingFixture.open(page);
 try{
  await observe(page);await settleCapture(page);const shapes=page.getByRole('radiogroup',{name:'Companion shape',exact:true});const cards=await verifyNarrowFocus(page,shapes,false);
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeInViewport();await expectStill(page);await frame(page,'narrow-focus-footer-clearance');await json('narrow-focus-regression',cards);
  expect(fixture.external).toEqual([]);expect(fixture.commands.filter(c=>['model.run','context.start','context.capture','windows.capture','browser.inspect'].includes(c.type))).toEqual([]);
 }finally{await fixture.close();}
});
