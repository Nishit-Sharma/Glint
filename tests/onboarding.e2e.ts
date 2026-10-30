import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {OnboardingFixture} from './onboarding-fixture';
import type {Task} from '../src/core/types';
import {settleCapture} from './settled-capture';

test('original 3D choice persists, continues into an honest editable local example, and needs no provider',async({page})=>{
 const fixture=await OnboardingFixture.open(page);
 try{
  await expect(page.getByRole('heading',{name:'Choose your companion'})).toBeVisible();await expect(page.getByText('Glint · Pick a shape. Change it anytime.',{exact:true})).toBeVisible();
  const shapes=page.getByRole('radiogroup',{name:'Companion shape'});await expect(shapes.getByRole('radio')).toHaveCount(5);
  for(const name of ['Dumpling','Onigiri','Mushroom','Star','Dollop'])await expect(shapes.getByRole('radio',{name,exact:true})).toBeVisible();
  await expect(page.getByText('Crescent',{exact:true})).toHaveCount(0);await expect(shapes.locator('canvas')).toHaveCount(5);
  await settleCapture(page);await page.screenshot({path:'evidence/onboarding/picker-desktop.png'});
  await page.getByRole('radio',{name:'Sage',exact:true}).click();await expect(page.locator('.choice-colors small')).toHaveText('Sage');
  const previews=await shapes.locator('img').evaluateAll(images=>images.map(image=>(image as HTMLImageElement).src));expect(new Set(previews).size).toBe(5);
  await page.getByRole('radio',{name:'Dumpling',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('radio',{name:'Onigiri',exact:true})).toBeChecked();
  await fixture.restart();await expect(page.getByRole('radio',{name:'Onigiri',exact:true})).toBeChecked();await expect(page.getByRole('radio',{name:'Sage',exact:true})).toBeChecked();
  await settleCapture(page);await page.screenshot({path:'evidence/onboarding/picker-sage.png'});
  await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByText('Local example · Bundled on this device')).toBeVisible();
  await expect(page.locator('#main').getByText('Doors open at 18:00.',{exact:false})).toBeVisible();await expect(page.locator('#main').getByRole('heading',{name:'Before your visit'})).toBeVisible();
  await expect(page.locator('#main').getByRole('checkbox',{name:/Arrive by 17:50/})).not.toBeChecked();await page.locator('#main').getByRole('checkbox',{name:/Arrive by 17:50/}).click();
  await expect(page.locator('#main').getByRole('checkbox',{name:/Arrive by 17:50/})).toBeChecked();await fixture.restart();await expect(page.locator('#main').getByRole('checkbox',{name:/Arrive by 17:50/})).toBeChecked();
  await page.locator('#main').getByRole('button',{name:'Save as document',exact:true}).click();await expect(page.getByRole('dialog',{name:'Document',exact:true})).toBeVisible();const saved=(await fixture.core.listTasks())[0].artifacts.find(item=>item.revisions.at(-1)?.mimeType==='text/markdown')?.revisions.at(-1);expect(saved?.content).toContain('- [x] Arrive by 17:50');expect(saved?.content).not.toContain('Observed pages');await page.getByRole('button',{name:'Back to task',exact:true}).click();
  await expect(page.locator('.workspace')).toHaveAttribute('data-surface-reveal',/settled|skipped|cancelled/);await settleCapture(page);await page.screenshot({path:'evidence/onboarding/local-example.png'});
  await page.getByRole('textbox',{name:'Ask about this task',exact:true}).fill('Can we bring a group of six?');
  await page.getByRole('button',{name:'Connect to ask',exact:true}).click();await expect(page.getByRole('dialog',{name:'Preferences',exact:true})).toBeVisible();await page.getByRole('button',{name:'Back to task',exact:true}).click();await expect(page.getByRole('textbox',{name:'Ask about this task',exact:true})).toHaveValue('Can we bring a group of six?');
  await page.getByRole('button',{name:'Use my window',exact:true}).click();await expect(page.getByText('You can attach context now and connect an AI service when you want an explanation.')).toBeVisible();
  await page.getByRole('button',{name:'Keep exploring',exact:true}).click();await expect(page.locator('#main').getByRole('checkbox',{name:/Arrive by 17:50/})).toBeChecked();
  expect((await fixture.ready()).bots).toHaveLength(1);expect(await fixture.core.listTasks()).toHaveLength(1);
  expect(fixture.commands.filter(command=>['model.run','context.start','windows.capture','connection.configure'].includes(command.type))).toHaveLength(0);expect(fixture.external).toEqual([]);
 }finally{await fixture.close();}
});

test('320px keyboard choice retains a visible footer and original reduced-motion actor',async({page})=>{
 await page.setViewportSize({width:320,height:640});await page.emulateMedia({reducedMotion:'reduce'});
 const fixture=await OnboardingFixture.open(page);
 try{
  await expect(page.getByRole('heading',{name:'Choose your companion'})).toBeVisible();await page.getByRole('radio',{name:'Dumpling',exact:true}).focus();await page.keyboard.press('End');await expect(page.getByRole('radio',{name:'Dollop',exact:true})).toBeChecked();
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeInViewport();
  const box=await page.getByRole('button',{name:'Continue',exact:true}).boundingBox();expect(box!.y+box!.height).toBeLessThanOrEqual(640);
  await settleCapture(page);await page.screenshot({path:'evidence/onboarding/picker-320-keyboard.png'});
  await page.getByRole('radio',{name:'Dough',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect(page.getByRole('radio',{name:'Iris',exact:true})).toBeChecked();
  await page.getByRole('button',{name:'Pick for me',exact:true}).click();await expect(page.getByRole('radio',{name:'Dollop',exact:true})).not.toBeChecked();await expect(page.getByRole('radio',{name:'Iris',exact:true})).toBeChecked();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await settleCapture(page);await page.screenshot({path:'evidence/onboarding/picker-320-color.png'});await page.getByRole('radiogroup',{name:'Companion color',exact:true}).scrollIntoViewIfNeeded();await settleCapture(page);await page.screenshot({path:'evidence/onboarding/picker-320-color-controls.png'});
  await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByText('Local example · Bundled on this device')).toBeVisible();await expect(page.locator('[data-character-render="live"]')).toHaveCount(1);
 }finally{await fixture.close();}
});

test('multiple identities remain opt-in and follow assigned threads through header, roster, compact, anchor and restart',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});const fixture=await OnboardingFixture.open(page);
 try{
  await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByText('Local example · Bundled on this device')).toBeVisible();const first=(await fixture.core.listTasks())[0];
  await page.getByRole('button',{name:/^Customize (Bao|Momo)$/}).click();await page.getByRole('button',{name:'Add another bot',exact:true}).click();
  await page.getByRole('radio',{name:'Star',exact:true}).click();await page.getByRole('radio',{name:'Iris',exact:true}).click();await page.getByRole('button',{name:'Add companion',exact:true}).click();
  await page.getByText('Use another companion for this thread',{exact:true}).click();await page.getByRole('button',{name:'Use by default for new threads',exact:true}).click();
  const catalog=await fixture.ready();expect(catalog.bots).toHaveLength(2);expect(catalog.defaultBotId).toBe(catalog.bots[1].id);expect((await fixture.core.getTask(first.id)).assignedBotId).toBe(catalog.bots[0].id);
  const second=await fixture.invoke({type:'tasks.create',title:'Second task'}) as Task;await fixture.core.saveComposerDraft(first.id,0,{text:'First task draft',kind:'explain'});await fixture.core.saveComposerDraft(second.id,0,{text:'Second task draft',kind:'explain'});await fixture.emit({type:'changed'});
  await page.getByRole('button',{name:'Back to task',exact:true}).click();await page.getByRole('button',{name:'Second task',exact:true}).click();
  await expect(page.locator('.chrome .character-slot img')).toHaveAttribute('src',/./);await expect(page.getByRole('textbox',{name:'Ask about this task',exact:true})).toHaveValue('Second task draft');
  await settleCapture(page);await page.screenshot({path:'evidence/onboarding/thread-star.png'});
  await page.setViewportSize({width:360,height:440});await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await expect(page.locator('.character-control-companion')).toBeVisible();await settleCapture(page);await page.screenshot({path:'evidence/onboarding/compact-star.png'});
  await page.setViewportSize({width:100,height:100});await fixture.emit({type:'surface',mode:'anchor'});await expect(page.getByRole('button',{name:'Open Glint'})).toBeVisible();await page.screenshot({path:'evidence/onboarding/anchor-star.png'});
  await fixture.emit({type:'surface',mode:'workspace'});await page.setViewportSize({width:1120,height:760});await page.getByRole('button',{name:'Observatory visit',exact:true}).click();await expect(page.getByRole('textbox',{name:'Ask about this task',exact:true})).toHaveValue('First task draft');
  await fixture.restart();await expect(page.getByRole('textbox',{name:'Ask about this task',exact:true})).toHaveValue('First task draft');
  expect((await fixture.core.getTask(first.id)).assignedBotId).toBe(catalog.bots[0].id);expect((await fixture.core.getTask(second.id)).assignedBotId).toBe(catalog.bots[1].id);
  expect(fixture.external).toEqual([]);await writeFile('evidence/onboarding/identity-commands.json',JSON.stringify(fixture.commands,null,2));
 }finally{await fixture.close();}
});

test('setup skip and host denial preserve the task and unsent draft across restart',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});const fixture=await OnboardingFixture.open(page);
 try{
  await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByText('Local example · Bundled on this device')).toBeVisible();
  const input=page.getByRole('textbox',{name:'Ask about this task',exact:true});await input.fill('Keep this question through setup.');
  await page.getByRole('button',{name:'Use my window',exact:true}).click();await page.getByRole('button',{name:'Keep exploring',exact:true}).click();await expect(input).toHaveValue('Keep this question through setup.');
  fixture.configured=true;fixture.denyCapture=true;await fixture.restart();await expect(input).toHaveValue('Keep this question through setup.');
  await page.getByRole('button',{name:'Use my window',exact:true}).click();await page.getByRole('button',{name:'Choose a window',exact:true}).click();await expect(page.locator('#main').getByRole('alert')).toContainText('This action could not be completed.');await expect(input).toHaveValue('Keep this question through setup.');
  await fixture.restart();await expect(input).toHaveValue('Keep this question through setup.');expect(await fixture.core.listTasks()).toHaveLength(1);expect(fixture.external).toEqual([]);
 }finally{await fixture.close();}
});

test('the unchanged original actor stops work for reduced motion and destroys static preview leases',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route('**/onboarding-actor-contract.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>canvas{width:176px;height:176px}</style><canvas></canvas>'}));
 await page.goto(`http://127.0.0.1:${process.env.WINDOW_COMPANION_TEST_PORT??4173}/onboarding-actor-contract.html`);
 const proof=await page.evaluate(async()=>{
  const path='/src/character-original/actor-runtime.js';const {mountOriginal}=await import(/* @vite-ignore */path);
  const actor=mountOriginal(document.querySelector('canvas')!,{shape:'star',color:'iris',face:'curious',motion:true});
  const reduced=actor.stats();actor.destroy();const destroyed=actor.stats();return {reduced,destroyed};
 });
 expect(proof.reduced).toMatchObject({active:false,idle:false,destroyed:false});expect(proof.destroyed).toMatchObject({active:false,idle:false,destroyed:true});
 await writeFile('evidence/onboarding/reduced-motion.json',JSON.stringify(proof,null,2));
});

test('optional custom names remain editable and survive shape changes and restart',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});const fixture=await OnboardingFixture.open(page);
 try{
  await page.getByText('Add a name',{exact:false}).click();await page.getByRole('textbox',{name:'Companion name',exact:true}).fill('Juniper');await page.getByRole('radio',{name:'Mushroom',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('button',{name:'Customize Juniper',exact:true}).click();await page.getByRole('textbox',{name:'Character name',exact:true}).fill('Aster');await page.getByRole('button',{name:'Star',exact:true}).click();await page.getByRole('button',{name:'Save appearance',exact:true}).click();await expect(page.getByText('Appearance saved.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Back to task',exact:true}).click();await expect(page.getByRole('button',{name:'Customize Aster',exact:true})).toBeVisible();await fixture.restart();await expect(page.getByRole('button',{name:'Customize Aster',exact:true})).toBeVisible();
  const catalog=await fixture.ready();expect(catalog.bots[0].profile).toMatchObject({personalName:'Aster',look:{shape:'star'}});await expect(page.locator('.workspace')).toHaveAttribute('data-surface-reveal',/settled|skipped|cancelled/);await settleCapture(page);await page.screenshot({path:'evidence/onboarding/custom-name.png'});
 }finally{await fixture.close();}
});

test('appearance conflict reload stays on the active bot and reassignment respects unsaved edits',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});const fixture=await OnboardingFixture.open(page);
 try{
  await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByText('Local example · Bundled on this device')).toBeVisible();let catalog=await fixture.ready();const first=catalog.bots[0],task=(await fixture.core.listTasks())[0];
  await fixture.bots.command({type:'add',expectedRevision:catalog.revision,profile:{personalName:null,look:{shape:'star',color:'iris',face:'curious',motion:true}}});await fixture.restart();catalog=await fixture.ready();
  await page.getByRole('button',{name:'Customize '+first.profile.personalName,exact:true}).click();await page.getByRole('textbox',{name:'Character name',exact:true}).fill('Unsaved local name');
  await page.getByText('Use another companion for this thread',{exact:true}).click();await page.getByRole('button',{name:/^Lumi/}).click();await expect(page.getByRole('dialog',{name:'Keep your unsaved edits?'})).toBeVisible();expect((await fixture.core.getTask(task.id)).assignedBotId).toBe(first.id);await page.getByRole('button',{name:'Keep editing',exact:true}).click();
  await fixture.bots.command({type:'update',expectedRevision:catalog.revision,botId:first.id,profile:{...first.profile,personalName:'Changed elsewhere'}});
  await page.getByRole('button',{name:'Save appearance',exact:true}).click();await expect(page.getByText('Your saved appearance changed elsewhere. Your edits have not been saved.',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Load saved appearance',exact:true}).click();await expect(page.getByRole('textbox',{name:'Character name',exact:true})).toHaveValue('Changed elsewhere');
  await page.getByRole('textbox',{name:'Character name',exact:true}).fill('Saved name');await page.getByRole('button',{name:'Save appearance',exact:true}).click();await expect(page.getByText('Appearance saved.',{exact:true})).toBeVisible();
  expect(fixture.commands.filter(command=>command.type==='preferences.get'||command.type==='preferences.update')).toHaveLength(0);
  await page.getByRole('button',{name:/^Lumi/}).click();await expect.poll(async()=>(await fixture.core.getTask(task.id)).assignedBotId).toBe(catalog.bots[1].id);
  await page.getByRole('button',{name:'Add another bot',exact:true}).click();await expect(page.locator('canvas')).toHaveCount(2);await page.getByRole('button',{name:'Cancel',exact:true}).click();
 }finally{await fixture.close();}
});

test('a missing assigned identity retains task navigation and requires an explicit repair',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});const fixture=await OnboardingFixture.open(page);
 try{
  await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByText('Local example · Bundled on this device')).toBeVisible();const catalog=await fixture.ready(),task=(await fixture.core.listTasks())[0];
  await fixture.core.saveComposerDraft(task.id,0,{text:'Retain this task through identity recovery.',kind:'explain'});await fixture.core.assignBot(task.id,'missing-saved-bot',catalog.defaultBotId);const other=await fixture.invoke({type:'tasks.create',title:'Unaffected task'}) as Task;await fixture.restart();
  await expect(page.getByRole('button',{name:'Companion unavailable',exact:true})).toBeVisible();await expect(page.locator('[data-character-render="live"]')).toHaveCount(0);await page.getByRole('button',{name:'Unaffected task',exact:true}).click();await expect(page.getByRole('button',{name:'Customize '+catalog.bots[0].profile.personalName,exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Observatory visit',exact:true}).click();await page.getByRole('button',{name:'Companion unavailable',exact:true}).click();await expect(page.getByText("This task's original companion is unavailable. Your work is kept. Choose a companion below to repair this task.",{exact:true})).toBeVisible();
  await page.locator('.identity-row').getByRole('button').first().click();await expect.poll(async()=>(await fixture.core.getTask(task.id)).assignedBotId).toBe(catalog.defaultBotId);expect((await fixture.core.getTask(task.id)).session?.draft).toBe('Retain this task through identity recovery.');expect((await fixture.core.getTask(other.id)).assignedBotId).toBe(catalog.defaultBotId);
 }finally{await fixture.close();}
});

test('new-task compact view does not show an old task beneath the new default identity',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});const fixture=await OnboardingFixture.open(page);
 try{
  await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByText('Local example · Bundled on this device')).toBeVisible();let catalog=await fixture.ready();const task=(await fixture.core.listTasks())[0];
  await fixture.core.saveComposerDraft(task.id,0,{text:'Old thread draft',kind:'explain'});await fixture.bots.command({type:'add',expectedRevision:catalog.revision,profile:{personalName:null,look:{shape:'star',color:'iris',face:'curious',motion:true}}});catalog=await fixture.ready();await fixture.bots.command({type:'default',expectedRevision:catalog.revision,botId:catalog.bots[1].id});await fixture.restart();
  await page.getByRole('button',{name:'New task',exact:true}).click();await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await expect(page.locator('.compact-companion')).toBeVisible();await expect(page.locator('.compact-companion').getByText('Observatory visit',{exact:true})).toHaveCount(0);await expect(page.locator('.compact-companion').getByRole('textbox')).toHaveCount(0);await expect(page.getByRole('button',{name:'Customize Lumi',exact:true})).toBeVisible();expect((await fixture.core.getTask(task.id)).session?.draft).toBe('Old thread draft');
  await page.locator('.compact-companion').getByRole('button',{name:'Use screen context',exact:true}).click();await expect.poll(()=>fixture.commands.filter(command=>command.type==='context.start').length).toBe(1);const capture=fixture.commands.find(command=>command.type==='context.start');expect(capture).toMatchObject({type:'context.start',newTask:true});expect(capture).not.toHaveProperty('ownerTaskId');expect((await fixture.core.getTask(task.id)).sources).toHaveLength(1);expect((await fixture.core.getTask(task.id)).assignedBotId).toBe(catalog.bots[0].id);
 }finally{await fixture.close();}
});

function hydrationGate(){let release!:()=>void;const promise=new Promise<void>(resolve=>release=resolve);return {promise,release:()=>release()};}
const settleStartup=(page:import('@playwright/test').Page)=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
const startupTarget=(id:string,title:string)=>({id,title,owner:{name:'Owned startup fixture'},bounds:{x:0,y:0,width:960,height:640}});
for(const first of ['bots','tasks'] as const)test(`startup hydration drains the newest exact activation once when ${first} load first`,async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});const bots=hydrationGate(),tasks=hydrationGate();const fixture=await OnboardingFixture.open(page,{ready:true,botGetBarrier:bots.promise,taskListBarrier:tasks.promise});
 try{
  const task=(await fixture.core.listTasks())[0];await fixture.core.saveComposerDraft(task.id,0,{text:'Keep the startup draft.',kind:'explain'});
  await expect.poll(()=>fixture.commands.filter(command=>command.type==='bots.get').length).toBeGreaterThan(0);await expect.poll(()=>fixture.commands.filter(command=>command.type==='tasks.list').length).toBeGreaterThan(0);
  await fixture.emit({type:'context.activate',activation:{activationId:'startup-old',trigger:'shortcut',tucked:false,ownerTaskId:task.id,target:startupTarget('owned-old','Previous owned target'),choices:[]}});
  (first==='bots'?bots:tasks).release();await settleStartup(page);expect(fixture.commands.filter(command=>command.type==='context.capture')).toEqual([]);
  const activation={activationId:'startup-new',trigger:'shortcut' as const,tucked:false,ownerTaskId:task.id,target:startupTarget('owned-new','Newest owned target'),choices:[]};
  await fixture.emit({type:'context.activate',activation});await fixture.emit({type:'context.activate',activation});expect(fixture.commands.filter(command=>command.type==='context.capture')).toEqual([]);
  (first==='bots'?tasks:bots).release();
  await expect.poll(()=>fixture.commands.filter(command=>command.type==='context.capture').length).toBe(1);await expect(page.getByRole('heading',{name:'No space beside this window',exact:true})).toBeVisible();await settleStartup(page);
  expect(fixture.commands.filter(command=>command.type==='context.capture')).toEqual([{type:'context.capture',activationId:'startup-new',windowId:'owned-new',taskId:task.id}]);
  expect(fixture.commands.filter(command=>command.type==='context.cancel')).toEqual([{type:'context.cancel',activationId:'startup-old'}]);expect((await fixture.core.getTask(task.id)).session?.draft).toBe('Keep the startup draft.');expect(fixture.commands.filter(command=>command.type==='model.run')).toEqual([]);expect(fixture.external).toEqual([]);
  await writeFile(`evidence/onboarding/startup-${first}-first.json`,JSON.stringify({mode:'Real renderer/local stores; capture dispatch ends at substituted host no-room result, no OS pixels.',commands:fixture.commands},null,2));
 }finally{bots.release();tasks.release();await fixture.close();}
});

test('startup hydration cancels an activation whose owner differs after task hydration',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});const bots=hydrationGate(),tasks=hydrationGate();const fixture=await OnboardingFixture.open(page,{ready:true,botGetBarrier:bots.promise,taskListBarrier:tasks.promise});
 try{
  await expect.poll(()=>fixture.commands.filter(command=>command.type==='bots.get').length).toBeGreaterThan(0);await fixture.emit({type:'context.activate',activation:{activationId:'startup-wrong-owner',trigger:'shortcut',tucked:false,ownerTaskId:'another-task',target:startupTarget('owned-other','Other task target'),choices:[]}});bots.release();tasks.release();
  await expect(page.getByText('Local example · Bundled on this device')).toBeVisible();await expect.poll(()=>fixture.commands.filter(command=>command.type==='context.cancel')).toEqual([{type:'context.cancel',activationId:'startup-wrong-owner'}]);await settleStartup(page);expect(fixture.commands.filter(command=>command.type==='context.capture')).toEqual([]);
 }finally{bots.release();tasks.release();await fixture.close();}
});

test('startup hydration keeps first-time choice and setup ahead of the queued activation',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});const bots=hydrationGate();const fixture=await OnboardingFixture.open(page,{botGetBarrier:bots.promise});
 try{
  await expect.poll(()=>fixture.commands.filter(command=>command.type==='bots.get').length).toBeGreaterThan(0);await fixture.emit({type:'context.activate',activation:{activationId:'startup-first-choice',trigger:'shortcut',tucked:false,newTask:true,target:startupTarget('owned-first','First owned target'),choices:[]}});bots.release();
  await expect(page.getByRole('heading',{name:'Choose your companion',exact:true})).toBeVisible();expect(fixture.commands.filter(command=>command.type==='context.capture')).toEqual([]);await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByText('You can attach context now and connect an AI service when you want an explanation.',{exact:false})).toBeVisible();await settleStartup(page);expect(fixture.commands.filter(command=>command.type==='context.capture')).toEqual([]);await page.getByRole('button',{name:'Keep exploring',exact:true}).click();expect(fixture.commands.filter(command=>command.type==='context.cancel')).toEqual([]);
 }finally{bots.release();await fixture.close();}
});

test('startup hydration preserves an unowned new-task shortcut when an existing thread hydrates',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});const bots=hydrationGate(),tasks=hydrationGate();const fixture=await OnboardingFixture.open(page,{ready:true,botGetBarrier:bots.promise,taskListBarrier:tasks.promise});
 try{
  const oldTask=(await fixture.core.listTasks())[0];await expect.poll(()=>fixture.commands.filter(command=>command.type==='bots.get').length).toBeGreaterThan(0);
  await fixture.emit({type:'context.activate',activation:{activationId:'startup-unowned-new-task',trigger:'shortcut',tucked:false,newTask:true,target:startupTarget('owned-new-task','New task owned target'),choices:[]}});bots.release();tasks.release();
  await expect.poll(()=>fixture.commands.filter(command=>command.type==='context.capture').length).toBe(1);await settleStartup(page);
  expect(fixture.commands.filter(command=>command.type==='context.capture')).toEqual([{type:'context.capture',activationId:'startup-unowned-new-task',windowId:'owned-new-task'}]);expect(fixture.commands.filter(command=>command.type==='context.cancel')).toEqual([]);expect(await fixture.core.getTask(oldTask.id)).toEqual(oldTask);
  await writeFile('evidence/onboarding/startup-unowned-new-task.json',JSON.stringify({mode:'Real renderer/local stores; no-room host substitute, no OS pixels.',commands:fixture.commands},null,2));
 }finally{bots.release();tasks.release();await fixture.close();}
});
