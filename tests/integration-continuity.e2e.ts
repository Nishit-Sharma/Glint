import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {OnboardingFixture} from './onboarding-fixture';
import {BrowserFixture} from './browser-fixture';
import {currentSourceRefs} from '../src/renderer/src/editor-state';

test('Continue selects the useful local example with the actual last-task preference contract',async({page})=>{
 const fixture=await OnboardingFixture.open(page);
 try{
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByText('Local example · Bundled on this device')).toBeVisible();
  await expect(page.locator('#main').getByRole('checkbox',{name:/Arrive by 17:50/})).toBeVisible();
  await fixture.restart();
  await expect(page.getByText('Local example · Bundled on this device')).toBeVisible();
  expect(fixture.commands.filter(command=>['context.start','context.capture','model.run','windows.capture'].includes(command.type))).toHaveLength(0);
 }finally{await fixture.close();}
});

test('a suggestion keeps the exact frozen source instead of silently recapturing and reviewing it',async({page})=>{
 const fixture=await BrowserFixture.open(page);
 try{
  const captured=await fixture.core.putSource(fixture.taskA.id,{kind:'window',label:'Frozen join notes',role:'fact',windowId:'window:99',documentToken:'frozen-document',content:JSON.stringify({imageSha256:'browser-fixture-no-pixels'})}),refs=currentSourceRefs(captured).filter(ref=>ref.sourceId===captured.sources.at(-1)!.id);
  await fixture.core.runRequest({taskId:captured.id,requestId:'brief',kind:'brief',prompt:'Read the selected source.',sourceIds:refs.map(ref=>ref.sourceId)},async()=>({title:'Brief',mimeType:'application/json',content:JSON.stringify({schemaVersion:1,kind:'screen-brief',insight:'Duplicate team keys expand the matching rows.',actions:[{label:'Explain the matching rows',outcome:'Trace the matching pairs.',requestKind:'explain',seedPrompt:'Explain the matching pairs in this snapshot.',sourceRefs:refs}]})}));
  await fixture.changed(captured.id);
  await page.getByRole('button',{name:'Explain the matching rows',exact:true}).click();
  expect(fixture.commands.filter(command=>command.type==='windows.capture')).toHaveLength(0);
  await expect.poll(()=>fixture.pending.size).toBe(1);
  const request=[...fixture.pending.values()][0].command;
  expect(request.expectedSourceRefs).toEqual(refs);
  fixture.complete('Each result row is one matching pair in the frozen source.');
  await expect(page.locator('.conversation')).toContainText('one matching pair');
 }finally{await fixture.close();}
});


test('first-time setup keeps the original window while exploring and allows capture without connecting first',async({page})=>{
 const target={id:'window:55',title:'Owned join worksheet',owner:{name:'Owned source'},bounds:{x:0,y:0,width:800,height:600}},activation={activationId:'setup-original',trigger:'shortcut' as const,tucked:false,newTask:true,target,choices:[]};
 const fixture=await OnboardingFixture.open(page,{pendingActivation:activation});
 try{
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Bring a window into this conversation.'})).toBeVisible();
  await expect(page.locator('.workspace:not([hidden])')).toHaveAttribute('data-surface-reveal','settled');await expect.poll(()=>page.locator('.workspace:not([hidden])').evaluate(element=>getComputedStyle(element).opacity)).toBe('1');await mkdir('evidence/integration',{recursive:true});await page.screenshot({path:'evidence/integration/setup-original-target.png'});
  expect(fixture.commands.filter(c=>c.type==='context.capture')).toHaveLength(0);
  await page.getByRole('button',{name:'Keep exploring',exact:true}).click();
  expect(fixture.commands.filter(c=>c.type==='context.cancel')).toHaveLength(0);
  await page.getByRole('button',{name:'Use my window',exact:true}).click();
  await expect(page.getByRole('button',{name:'Use this window',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Use this window',exact:true}).click();
  await expect.poll(()=>fixture.commands.filter(c=>c.type==='context.capture')).toEqual([{type:'context.capture',activationId:'setup-original',windowId:'window:55'}]);
  expect(fixture.commands.filter(c=>c.type==='model.run'||c.type==='context.start')).toHaveLength(0);
  expect((await fixture.core.listTasks())[0].provenance).toBe('local-example');
 }finally{await fixture.close();}
});

test('a returning profile recovers a live activation emitted before renderer subscription exactly once',async({page})=>{
 const activation={activationId:'before-subscription',trigger:'shortcut' as const,tucked:false,newTask:true,target:{id:'window:56',title:'Owned source before subscription',owner:{name:'Owned source'},bounds:{x:0,y:0,width:800,height:600}},choices:[]};
 const fixture=await OnboardingFixture.open(page,{ready:true,pendingActivation:activation});
 try{
  await expect.poll(()=>fixture.commands.filter(c=>c.type==='context.capture')).toEqual([{type:'context.capture',activationId:'before-subscription',windowId:'window:56'}]);
  expect(fixture.commands.filter(c=>c.type==='model.run'||c.type==='context.start')).toHaveLength(0);
 }finally{await fixture.close();}
});


function deferred(){let release!:()=>void;const promise=new Promise<void>(resolve=>release=resolve);return {promise,release:()=>release()};}
const exactStartupActivation=(activationId:string)=>({activationId,trigger:'shortcut' as const,tucked:false,newTask:true,target:{id:'window:'+activationId,title:'Owned '+activationId,owner:{name:'Owned fixture'},bounds:{x:0,y:0,width:800,height:600}},choices:[]});

test('startup waits for the final last-thread restore before consuming the queued shortcut',async({page})=>{
 const gate=deferred(),fixture=await OnboardingFixture.open(page,{ready:true,viewReadBarrier:gate.promise});
 try{
  const owner=(await fixture.core.listTasks())[0];
  await expect.poll(()=>fixture.commands.filter(c=>c.type==='task-view.get').length).toBeGreaterThan(0);
  await fixture.emit({type:'context.activate',activation:{...exactStartupActivation('restore'),newTask:false,ownerTaskId:owner.id}});
  expect(fixture.commands.filter(c=>c.type==='context.capture')).toHaveLength(0);gate.release();
  await expect.poll(()=>fixture.commands.filter(c=>c.type==='context.capture')).toEqual([{type:'context.capture',activationId:'restore',windowId:'window:restore',taskId:owner.id}]);
 }finally{gate.release();await fixture.close();}
});

test('a newer live shortcut wins over a delayed pending-target read',async({page})=>{
 const gate=deferred(),fixture=await OnboardingFixture.open(page,{ready:true,pendingActivation:exactStartupActivation('old-read'),pendingReadBarrier:gate.promise});
 try{
  await expect(page.getByText('Local example · Bundled on this device')).toBeVisible();
  await fixture.emit({type:'context.activate',activation:{...exactStartupActivation('new-event'),newTask:false,ownerTaskId:(await fixture.core.listTasks())[0].id}});
  await expect.poll(()=>fixture.commands.filter(c=>c.type==='context.capture').length).toBe(1);gate.release();
  await expect(page.getByRole('heading',{name:'No space beside this window',exact:true})).toBeVisible();
  expect(fixture.commands.filter(c=>c.type==='context.capture').map(c=>'activationId' in c?c.activationId:'')).toEqual(['new-event']);
 }finally{gate.release();await fixture.close();}
});

test('first-run picker owns the startup reveal and Continue does not replay it',async({page})=>{
 const fixture=await OnboardingFixture.open(page);
 try{
  const intro=page.locator('.onboarding-root[data-runtime-scope="whole-surface"]');
  await expect(intro).toHaveAttribute('data-surface-reveal','settled');
  const entrance=await intro.getAttribute('data-presentation-entrance');
  await page.getByRole('radio',{name:'Star',exact:true}).click();
  await expect(intro).toHaveAttribute('data-presentation-entrance',entrance!);
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  const workspace=page.locator('.workspace:not([hidden])');
  await expect(workspace).toHaveAttribute('data-surface-reveal','settled');
  await expect(workspace).toHaveAttribute('data-surface-reveal-reason','entrance already used');
  await expect(page.getByText('Local example · Bundled on this device')).toBeVisible();
 }finally{await fixture.close();}
});
