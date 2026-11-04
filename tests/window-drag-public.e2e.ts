import {test,expect,type Page} from '@playwright/test';
import {OnboardingFixture} from './onboarding-fixture';
import {settleCapture} from './settled-capture';
import {frame,json} from './companion-motion-public-helpers';

async function checkChrome(page:Page,selector:string){
 const geometry=await page.locator(selector).evaluate(header=>{
  const box=header.getBoundingClientRect(),style=getComputedStyle(header),grip=getComputedStyle(header,'::before'),left=box.left+parseFloat(style.borderLeftWidth)+parseFloat(style.paddingLeft),width=parseFloat(grip.width),height=parseFloat(grip.height),top=box.top+(box.height-height)/2;
  const controls=[...header.querySelectorAll<HTMLElement>('button,summary,a,input,select,textarea')].filter(control=>control.getClientRects().length).map(control=>{const rect=control.getBoundingClientRect();return {label:control.getAttribute('aria-label')??control.getAttribute('title')??control.textContent?.trim(),left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height,region:getComputedStyle(control).getPropertyValue('-webkit-app-region')};});
  return {region:style.getPropertyValue('-webkit-app-region'),grip:{left,top,width,height,right:left+width,bottom:top+height,region:grip.getPropertyValue('-webkit-app-region')},controls,viewport:{width:innerWidth,height:innerHeight}};
 });
 expect(geometry.region).toBe('drag');expect(geometry.grip.region).toBe('drag');expect(geometry.grip.width).toBe(28);expect(geometry.grip.height).toBe(32);expect(geometry.controls.length).toBeGreaterThan(2);
 for(const control of geometry.controls){expect(control.region,control.label??'control').toBe('no-drag');expect(control.left).toBeGreaterThanOrEqual(geometry.grip.right);expect(control.right).toBeLessThanOrEqual(geometry.viewport.width);expect(control.width).toBeGreaterThan(0);expect(control.height).toBeGreaterThanOrEqual(28);}
 return geometry;
}

test('startup onboarding workspace and compact expose separate drag grips while controls fields scrolling and edge source gestures retain ownership',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:430,height:760});let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),fixture=await OnboardingFixture.open(page,{botGetBarrier:gate});const stages=[];
 try{
  const startup=page.locator('.window-startup-drag');await expect(page.locator('#root>.loading[role=status]')).toBeVisible();await expect(startup).toBeVisible();await expect(startup).toHaveCSS('-webkit-app-region','drag');expect(await startup.getAttribute('tabindex')).toBeNull();
  const loadingClearance=await page.locator('#root>.loading').evaluate(element=>{const text=document.createRange();text.selectNodeContents(element);const bounds=text.getBoundingClientRect(),grip=document.querySelector('.window-startup-drag')!.getBoundingClientRect();return {textTop:bounds.top,gripBottom:grip.bottom};});expect(loadingClearance.textTop).toBeGreaterThan(loadingClearance.gripBottom);await frame(page,'drag-startup-loading');
  release();await expect(page.getByRole('heading',{name:'Choose your companion',exact:false})).toBeVisible();await settleCapture(page);await expect(startup).toBeVisible();await frame(page,'drag-onboarding-wide');
  await page.getByRole('radio',{name:'Mushroom',exact:true}).click();await page.getByText('Add a name',{exact:false}).click();await page.getByRole('textbox',{name:'Companion name',exact:true}).fill('Movable companion');await expect(page.getByRole('textbox',{name:'Companion name',exact:true})).toHaveValue('Movable companion');
  await page.setViewportSize({width:320,height:640});const choice=page.locator('.choice-scroll');await choice.evaluate(element=>{element.scrollTop=element.scrollHeight;});expect(await choice.evaluate(element=>element.scrollTop)).toBeGreaterThan(0);const gripBox=(await startup.boundingBox())!;
  // Scrolled controls keep raw boxes above the scroller; the browser clips their painted and hit regions.
  const onboardingGeometry=await page.locator('.companion-choice button,.companion-choice input,.companion-choice summary').evaluateAll(async(nodes,grip)=>{
   const entries=await new Promise<IntersectionObserverEntry[]>(resolve=>{const observer=new IntersectionObserver(entries=>{observer.disconnect();resolve(entries);});nodes.forEach(node=>observer.observe(node));});
   const controls=entries.map(entry=>{const node=entry.target,visible=entry.intersectionRect,hit=visible.width>0&&visible.height>0?document.elementFromPoint(visible.x+visible.width/2,visible.y+visible.height/2):null;return {label:node.getAttribute('aria-label')??node.textContent?.trim()??null,raw:entry.boundingClientRect.toJSON(),visible:visible.toJSON(),visibleCenterOwned:!!hit&&(node===hit||node.contains(hit))};});
   const controlHits: {x:number;y:number}[]=[],gripMisses: {x:number;y:number}[]=[];
   for(let y=grip.y+.5;y<grip.y+grip.height;y++)for(let x=grip.x+.5;x<grip.x+grip.width;x++){
    const hits=document.elementsFromPoint(x,y);if(hits.some(node=>nodes.some(control=>control===node)))controlHits.push({x,y});if(!hits[0]?.matches('.window-startup-drag'))gripMisses.push({x,y});
   }
   return {controls,controlHits,gripMisses};
  },gripBox);
  const overlapping=onboardingGeometry.controls.filter(({visible:r})=>r.width>0&&r.height>0&&r.left<gripBox.x+gripBox.width&&r.right>gripBox.x&&r.top<gripBox.y+gripBox.height&&r.bottom>gripBox.y);
  await json('window-drag-onboarding-geometry',{grip:gripBox,...onboardingGeometry});expect(overlapping).toEqual([]);expect(onboardingGeometry.controlHits).toEqual([]);expect(onboardingGeometry.gripMisses).toEqual([]);
  const mushroom=onboardingGeometry.controls.find(control=>control.label==='Mushroom');expect(mushroom?.visible.height).toBeGreaterThan(0);expect(mushroom?.visibleCenterOwned).toBe(true);await frame(page,'drag-onboarding-narrow');
  await page.getByRole('button',{name:'Continue',exact:true}).click();const main='.workspace:not([hidden]) .chrome';await expect(page.locator(main)).toBeVisible();await settleCapture(page);await expect(startup).toBeHidden();await page.setViewportSize({width:360,height:760});stages.push({surface:'workspace',geometry:await checkChrome(page,main)});await frame(page,'drag-workspace-narrow');
  await page.getByRole('button',{name:'Choose task',exact:true}).click();await expect(page.locator('.task-chooser')).toBeVisible();await page.getByRole('button',{name:'Back to task',exact:true}).click();
  await fixture.emit({type:'surface',mode:'companion'});await page.setViewportSize({width:360,height:440});const compact='.compact-companion:not([hidden]) .compact-chrome';await expect(page.locator(compact)).toBeVisible();await settleCapture(page);await expect(startup).toBeHidden();stages.push({surface:'compact',geometry:await checkChrome(page,compact)});await frame(page,'drag-compact');
  await fixture.emit({type:'surface',mode:'anchor'});await page.setViewportSize({width:74,height:64});await expect(page.locator('.anchor-wrap:not([hidden]) button.anchor')).toBeVisible();await expect(startup).toBeHidden();await frame(page,'drag-edge-source-gesture-preserved');
  await json('window-drag-surface-contract',{stages,scope:'Actual renderer geometry and interactions on owned browser fixture. CSS drag regions do not prove native window movement; OS manual will-move and character source drag require separate Terra native acceptance.'});expect(fixture.external).toEqual([]);expect(fixture.commands.filter(command=>['model.run','context.start','context.capture','windows.capture','browser.inspect'].includes(command.type))).toEqual([]);
 }finally{release();await fixture.close();}
});

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
