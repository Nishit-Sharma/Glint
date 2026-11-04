import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {learningSurface} from '../support/learning-surface-fixture';
import {exampleLesson} from '../../src/learning/example';
import {helperExample} from '../../src/learning/helper-example';
import type {Page} from '@playwright/test';
import {joinLab} from '../../src/learning/join-lab';
import {helperStudio} from '../../src/learning/reusable-helper';

declare global {interface Window {__learningReveals:string[]}}
async function watchReveals(page:Page){
 await page.evaluate(()=>{
  window.__learningReveals=[];
  new MutationObserver(records=>{for(const record of records){if(record.target instanceof HTMLElement&&record.target.dataset.artifactReveal==='running')window.__learningReveals.push(record.target.dataset.artifactMotion??'');}}).observe(document.body,{subtree:true,attributes:true,attributeFilter:['data-artifact-reveal']});
 });
}
async function settled(page:Page){
 await expect(page.locator('.learning-tool [data-artifact-motion]').first()).toHaveAttribute('data-artifact-reveal',/settled|cancelled|covered|not a new/);
 await expect(page.locator('[data-artifact-reveal="pending"],[data-artifact-reveal="running"]')).toHaveCount(0);
}
async function captureSizes(page:Page,prefix:string){
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.locator('#main').evaluate(element=>{element.scrollTop=0;});await settled(page);
 await page.screenshot({path:`evidence/learning-surface/after-${prefix}-full.png`});
 await page.setViewportSize({width:320,height:700});await settled(page);
 await page.screenshot({path:`evidence/learning-surface/after-${prefix}-320.png`});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(prefix==='join'){
  await page.getByRole('combobox',{name:'Right key',exact:true}).focus();
  await expect(page.getByRole('combobox',{name:'Right key',exact:true})).toBeFocused();
  await page.screenshot({path:'evidence/learning-surface/after-join-320-keyboard.png'});
 }
 await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:440});
 await expect(page.locator('.compact-companion')).toBeVisible();
 await page.locator('.compact-main').evaluate(element=>{element.scrollTop=0;});
 await page.screenshot({path:`evidence/learning-surface/after-${prefix}-compact.png`});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(prefix==='join'){
  const compact=page.locator('.compact-main');
  await compact.getByRole('combobox',{name:'Join type',exact:true}).selectOption('LEFT');
  await expect(compact.getByRole('combobox',{name:'Join type',exact:true})).toHaveValue('LEFT');
  await compact.getByRole('combobox',{name:'Join type',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:'evidence/learning-surface/after-join-compact-controls.png'});
 }
 if(prefix==='helper'){
  const compact=page.locator('.compact-main');
  await compact.getByRole('textbox',{name:'Fresh text',exact:true}).fill('KEEP:   Dock  ');
  await compact.getByRole('button',{name:'Run active helper',exact:true}).click();
  expect(await compact.getByLabel('Helper result',{exact:true}).textContent()).toBe('KEEP:   Dock  ');
  await page.screenshot({path:'evidence/learning-surface/after-helper-compact-result.png'});
 }
 await page.getByRole('button',{name:'Open task workspace',exact:true}).click();await page.setViewportSize({width:1080,height:800});
}

test('actual App learning surface baseline and bounded arrival',async({page})=>{
 const {fixture,arrive}=await learningSurface(page);
 try{
  await arrive(exampleLesson);
  await expect(page.locator('.workspace')).toHaveAttribute('data-surface-reveal',/settled|skipped|cancelled/);
  await page.locator('#main').evaluate(element=>{element.scrollTop=0;});
  if(!process.env.LEARNING_BASELINE)await settled(page);
  await page.screenshot({path:'evidence/learning-surface/'+(process.env.LEARNING_BASELINE?'before':'after')+'-join-full.png'});
  if(process.env.LEARNING_BASELINE){
   await page.setViewportSize({width:320,height:700});await page.screenshot({path:'evidence/learning-surface/before-join-320.png'});
   await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:440});
   await page.screenshot({path:'evidence/learning-surface/before-compact.png'});
   await page.getByRole('button',{name:'Open task workspace',exact:true}).click();await page.setViewportSize({width:1080,height:800});
   await arrive(helperExample);await page.getByRole('heading',{name:helperExample.title,exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'evidence/learning-surface/before-helper-full.png'});
  }
  await expect(page.locator('.learning-tool [data-artifact-motion]').first()).toBeAttached();
  if(!process.env.LEARNING_BASELINE){
   await captureSizes(page,'join');
   const table=page.getByRole('region',{name:'Members table',exact:true});
   await table.focus();await expect(table).toBeFocused();
   await page.keyboard.press('ArrowRight');
   const field=page.getByRole('textbox',{name:'practice-a Team',exact:true});
   expect(await field.evaluate(element=>getComputedStyle(element).backgroundColor)).not.toBe('rgb(255, 255, 255)');
   expect(await field.evaluate(element=>element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(36);
   await writeFile('evidence/learning-surface/join-accessibility.yml',await page.locator('.workspace .learning-tool').ariaSnapshot());
  }
  expect(fixture.external).toEqual([]);
  await writeFile('evidence/learning-surface/commands.json',JSON.stringify(fixture.commands,null,2));
 }finally{await fixture.close();}
});

test('arriving join parts use the actual runtime once; edits, hidden answers and restart remain coherent',async({page})=>{
 const {fixture,task,arrive,streamProse}=await learningSurface(page);
 try{
  await expect(page.locator('.workspace')).toHaveAttribute('data-surface-reveal',/settled|skipped|cancelled/);
  await page.emulateMedia({reducedMotion:'no-preference'});await watchReveals(page);
  await arrive(exampleLesson);
  const heading=page.locator('.workspace .join-lab [data-artifact-motion$=":heading"]');
  await heading.scrollIntoViewIfNeeded();
  await expect(heading).toHaveAttribute('data-artifact-reveal','running');
  await expect(page.locator('.t-gen')).not.toHaveCount(0);
  await page.screenshot({path:'evidence/learning-surface/join-runtime-running.png'});
  await settled(page);
  const startsBeforeEdits=await page.evaluate(()=>window.__learningReveals);
  expect(startsBeforeEdits.filter(id=>id.endsWith(':heading'))).toHaveLength(1);
  expect(startsBeforeEdits.filter(id=>id.endsWith(':join-controls'))).toHaveLength(1);
  await expect(page.getByRole('region',{name:'Computed result',exact:true})).toHaveCount(0);
  const field=page.getByRole('textbox',{name:'practice-b Team',exact:true});
  await field.fill('q');
  await expect(heading).toHaveAttribute('data-artifact-reveal',/settled|cancelled/);
  await page.getByRole('button',{name:'Visual',exact:true}).click();await page.getByRole('button',{name:'Quick',exact:true}).click();
  await expect(field).toHaveValue('q');
  await page.getByRole('row').filter({has:field}).getByRole('button',{name:'Apply row',exact:true}).click();
  await expect.poll(async()=>(await fixture.core.getTask(task.id)).session?.moduleStates.length).toBe(1);
  await page.getByRole('button',{name:'Try duplicate key',exact:true}).click();
  await page.locator('.workspace').getByLabel('Predict the output row count',{exact:true}).fill('4');await page.getByRole('button',{name:'Check prediction',exact:true}).click();
  await expect(page.getByRole('heading',{name:'4 output rows',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Try separate challenge',exact:true}).click();
  await expect(page.getByRole('region',{name:'Computed result',exact:true})).toHaveCount(0);
  await expect(page.locator('.workspace').getByText('Synthetic transfer · Supplied lesson tables, not a reading of your screen.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Try duplicate key',exact:true})).toHaveCount(0);
  await page.locator('.workspace').getByLabel('Predict the output row count',{exact:true}).fill('5');await page.getByRole('button',{name:'Check prediction',exact:true}).click();
  await expect(page.getByRole('heading',{name:'6 output rows',exact:true})).toBeVisible();
  const prose=await streamProse();await prose.stream('One local word.');await prose.stream('One local word. More local words.');
  await expect(page.locator('.conversation .streaming-text')).toContainText('More local words.');
  await expect(page.locator('.t-gen,.t-tig')).toHaveCount(0);prose.finish();
  await expect(page.locator('.conversation')).toContainText('The checked lesson stays with this task.');
  const starts=await page.evaluate(()=>window.__learningReveals);
  expect(starts).toEqual(startsBeforeEdits);
  await writeFile('evidence/learning-surface/join-motion.json',JSON.stringify(starts,null,2));
  await fixture.restart();
  await expect(page.getByRole('heading',{name:'6 output rows',exact:true})).toBeVisible();
  const saved=(await fixture.core.getTask(task.id)).session?.moduleStates[0];
  expect(joinLab.observe(exampleLesson,joinLab.parseState(exampleLesson,saved?.state)).assessment).toMatchObject({actualCount:6,correct:false});
  await expect(page.locator('.t-gen,.t-tig')).toHaveCount(0);
  await captureSizes(page,'join-reviewed');
  expect(fixture.external).toEqual([]);
  await writeFile('evidence/learning-surface/join-commands.json',JSON.stringify(fixture.commands,null,2));
 }finally{await fixture.close();}
});

test('helper arrival cancels on interaction; real demonstrations, checks and saved runs persist in full and compact App',async({page})=>{
 const {fixture,task,arrive}=await learningSurface(page);
 try{
  await expect(page.locator('.workspace')).toHaveAttribute('data-surface-reveal',/settled|skipped|cancelled/);
  await page.emulateMedia({reducedMotion:'no-preference'});await watchReveals(page);
  await arrive(helperExample);
  const heading=page.locator('.workspace .helper-studio [data-artifact-motion$=":heading"]');
  await heading.scrollIntoViewIfNeeded();
  await expect(heading).toHaveAttribute('data-artifact-reveal','running');
  await page.screenshot({path:'evidence/learning-surface/helper-runtime-running.png'});
  await page.getByRole('button',{name:'Observatory visit',exact:true}).click();
  await expect(page.locator('.helper-studio')).toHaveCount(0);await expect(page.locator('.t-gen,.t-tig')).toHaveCount(0);
  await page.getByRole('button',{name:task.title,exact:true}).click();
  await expect(heading).toHaveAttribute('data-artifact-reveal','not a new visible arrival');
  await page.getByRole('textbox',{name:'Demonstration input',exact:true}).focus();
  await expect(page.locator('.workspace .helper-studio [data-artifact-motion$=":demonstration"]')).toHaveAttribute('data-artifact-reveal',/cancelled|settled|not a new visible arrival/);
  await page.getByRole('button',{name:'Start demonstration',exact:true}).click();await page.getByRole('button',{name:'Demonstrate operation',exact:true}).click();
  await expect(page.locator('.workspace').getByLabel('Current demonstration result',{exact:true})).toHaveText('River   Dock');
  await page.locator('.workspace').getByLabel('Text operation',{exact:true}).selectOption('collapse-spaces');await page.getByRole('button',{name:'Demonstrate operation',exact:true}).click();
  await expect(page.locator('.workspace').getByLabel('Current demonstration result',{exact:true})).toHaveText('River Dock');
  await page.getByRole('button',{name:'Stop and use demonstration',exact:true}).click();
  await page.getByRole('button',{name:'Add check',exact:true}).click();await expect(page.getByRole('button',{name:'Save tested version',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Add exception',exact:true}).click();await expect(page.locator('.workspace').getByText('Draft checks: 2 / 2 passing.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Save tested version',exact:true}).click();await page.getByRole('button',{name:'Activate version 1',exact:true}).click();
  await page.getByRole('button',{name:'Run active helper',exact:true}).click();await expect(page.locator('.workspace').getByLabel('Helper result',{exact:true})).toHaveText('New Dock');
  const starts=await page.evaluate(()=>window.__learningReveals);
  expect(starts.filter(id=>id.endsWith(':heading'))).toHaveLength(1);
  expect(starts.filter(id=>id.endsWith(':demonstration')).length).toBeLessThanOrEqual(1);
  await writeFile('evidence/learning-surface/helper-motion.json',JSON.stringify(starts,null,2));
  await fixture.restart();await expect(page.locator('.workspace').getByLabel('Helper result',{exact:true})).toHaveText('New Dock');
  await page.locator('.workspace').getByText('Teach or change this helper',{exact:true}).click();
  await page.getByRole('button',{name:'Start demonstration',exact:true}).click();await page.getByRole('button',{name:'Cancel demonstration',exact:true}).click();
  const saved=(await fixture.core.getTask(task.id)).session?.moduleStates[0];
  expect(helperStudio.parseState(helperExample,saved?.state)).toMatchObject({activeVersion:1,recording:null,draft:{operations:[{kind:'trim'},{kind:'collapse-spaces'}]}});
  await captureSizes(page,'helper');
  await page.locator('.workspace').getByLabel('Fresh text',{exact:true}).fill('KEEP:   Dock  ');await page.getByRole('button',{name:'Run active helper',exact:true}).click();
  expect(await page.locator('.workspace').getByLabel('Helper result',{exact:true}).textContent()).toBe('KEEP:   Dock  ');
  await expect(page.locator('.t-gen,.t-tig')).toHaveCount(0);
  expect(fixture.external).toEqual([]);
  await writeFile('evidence/learning-surface/helper-commands.json',JSON.stringify(fixture.commands,null,2));
 }finally{await fixture.close();}
});
