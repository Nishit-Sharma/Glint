import {test,expect} from '@playwright/test';
import {OnboardingFixture} from '../support/onboarding-fixture';
import {settleCapture} from '../support/settled-capture';
import {frame,json} from '../support/companion-motion-public-helpers';

import {checkChrome} from '../support/window-drag-contract';

test('a cold ready profile keeps one visible drag grip outside the normal motion reveal and hands its reserved slot back without covering controls',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:430,height:760});let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),fixture=await OnboardingFixture.open(page,{ready:true,botGetBarrier:gate});
 try{
  const grip=page.locator('.window-startup-drag'),surface=page.locator('.workspace:not([hidden])');await expect(page.locator('#root>.loading[role=status]')).toBeVisible();await expect(grip).toBeVisible();await frame(page,'drag-ready-profile-loading');release();
  await expect(surface).toHaveAttribute('data-surface-reveal','running');await expect(page.locator('.t-gen')).toHaveCount(1);await expect(grip).toHaveAttribute('data-native-chrome','bridged');await expect(grip).toBeVisible();await expect(page.locator('.window-startup-drag:not([hidden])')).toHaveCount(1);
  const bridge=await grip.evaluate(element=>{
   const box=element.getBoundingClientRect(),header=document.querySelector<HTMLElement>('.workspace:not([hidden]) .chrome')!,pseudo=getComputedStyle(header,'::before');let painted=true;
   for(let node:Element|null=element;node;node=node.parentElement){const s=getComputedStyle(node);if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)<.99||s.clipPath!=='none'||s.filter!=='none')painted=false;}
   const overlaps=[...header.querySelectorAll<HTMLElement>('button,summary,a,input,select,textarea')].filter(control=>{const r=control.getBoundingClientRect();return r.width>0&&r.height>0&&r.left<box.right&&r.right>box.left&&r.top<box.bottom&&r.bottom>box.top;}).length;
   return {painted,overlaps,bounds:{x:box.x,y:box.y,width:box.width,height:box.height},region:getComputedStyle(element).getPropertyValue('-webkit-app-region'),z:Number(getComputedStyle(element).zIndex),layerZ:[...document.querySelectorAll('.t-gen')].map(layer=>Number(getComputedStyle(layer).zIndex)),innerGripBackground:pseudo.backgroundImage,stage:header.closest<HTMLElement>('[data-runtime-scope]')?.dataset.surfaceReveal};
  });await json('window-drag-ready-reveal',bridge);expect(bridge.painted).toBe(true);expect(bridge.overlaps).toBe(0);expect(bridge.bounds.width).toBe(28);expect(bridge.bounds.height).toBe(32);expect(bridge.region).toBe('drag');expect(bridge.innerGripBackground).toBe('none');expect(bridge.stage).toBe('running');for(const z of bridge.layerZ)expect(bridge.z).toBeGreaterThan(z);await frame(page,'drag-ready-profile-running');
  await settleCapture(page);await expect(grip).toBeHidden();expect(await page.locator('.workspace:not([hidden]) .chrome').evaluate(header=>getComputedStyle(header,'::before').backgroundImage)).not.toBe('none');await checkChrome(page,'.workspace:not([hidden]) .chrome');await frame(page,'drag-ready-profile-settled');
  expect(fixture.external).toEqual([]);expect(fixture.commands.filter(command=>['model.run','context.start','context.capture','windows.capture','browser.inspect'].includes(command.type))).toEqual([]);
 }finally{release();await fixture.close();}
});
