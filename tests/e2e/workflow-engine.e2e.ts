import {test,expect,type Page,type Locator} from '@playwright/test';
import {OnboardingFixture} from '../support/onboarding-fixture';
import {createWorkflowExample} from '../../src/core/workflow-lab-host';
import {workflowLab} from '../../src/learning/workflow-lab';
import {parseModuleAnswer} from '../../src/core/interactive-modules';
const evidence='work/continuation';
async function entry(page:Page){
 const fixture=await OnboardingFixture.open(page,{ready:true,port:4631}),catalog=await fixture.ready(),task=await fixture.core.createTask({title:'Bounded workflow renderer',assignedBotId:catalog.defaultBotId}),created=await createWorkflowExample(fixture.core,{taskId:task.id,requestId:'synthetic-engine'});
 await fixture.viewPreferences.select(task.id);await fixture.restart();await page.getByRole('heading',{name:task.title,exact:true}).waitFor();
 const scope=page.getByRole('region',{name:'Workflow experiment',exact:true});await expect(scope).toBeVisible();
 const read=async()=>{const current=await fixture.core.getTask(task.id),artifact=current.artifacts.find(a=>a.id===created.artifactId)!,data=parseModuleAnswer(JSON.parse(artifact.revisions[0].content)).modules[0].data;if(data.kind!=='workflow-lab')throw Error('Expected workflow');return workflowLab.parseState(data,current.session!.moduleStates[0].state);};
 return {fixture,scope,read};
}
async function predict(scope:Locator){await scope.getByRole('combobox',{name:'Final state',exact:true}).selectOption('draft');await scope.getByRole('spinbutton',{name:'Blocked events',exact:true}).fill('1');await scope.getByRole('button',{name:'Check prediction',exact:true}).click();await expect(scope.getByRole('heading',{name:'Final state: Draft',exact:true})).toBeVisible();await scope.getByText('Bounded checks and alternatives',{exact:true}).click();}
test('actual App saves assumptions, counterexamples, sequence tests and checked proposed repairs, then reopens and saves notes',async({page})=>{
 const {fixture,scope,read}=await entry(page);
 try{
  await expect(scope.getByText('Bounded checks and alternatives',{exact:true})).toHaveCount(0);await predict(scope);const panel=scope.getByRole('region',{name:'Bounded workflow checks'});
  await panel.getByText('Edit search assumptions and inputs',{exact:true}).click();await panel.getByLabel('Maximum event depth',{exact:true}).fill('3');await panel.getByLabel('Event-step budget',{exact:true}).fill('100');await panel.getByRole('button',{name:'Save assumptions',exact:true}).click();await expect.poll(async()=>(await read()).experiment?.assumptions.maxDepth).toBe(3);
  await panel.getByText('Add a property',{exact:true}).click();await panel.getByRole('button',{name:'Add bounded property',exact:true}).focus();await page.keyboard.press('Enter');await expect(panel).toContainText('Shortest counterexample (2 events)');await expect(panel).toContainText('Depth limit 3');
  await panel.getByText('Add a sequence test',{exact:true}).click();await panel.getByLabel('Test name',{exact:true}).fill('Review after edit');await panel.getByRole('combobox',{name:'Expected final state',exact:true}).selectOption('ready');await panel.getByRole('button',{name:'Save sequence test',exact:true}).click();await expect(panel).toContainText('Expected final state not reached (Ready)');
  await panel.getByText('Propose an alternative or repair',{exact:true}).click();const proposal=panel.getByRole('textbox',{name:'Alternative rules (JSON)',exact:true}),json=JSON.parse(await proposal.inputValue());json.label='Send edits back to review';json.rules.find((r:{id:string})=>r.id==='ready-edit').toStateId='review';await proposal.fill(JSON.stringify(json));await panel.getByRole('combobox',{name:'Proposal origin',exact:true}).selectOption('muse-proposed');await panel.getByRole('button',{name:'Save and check alternative',exact:true}).click();
  await expect(panel.getByRole('region',{name:'Bounded results for Send edits back to review',exact:true})).toContainText('Expected final state reached (Ready)');await panel.getByRole('button',{name:'Compare Send edits back to review with practice',exact:true}).click();await expect(panel.getByRole('region',{name:'Computed alternative comparison'})).toContainText('First differing event: 3');
  await expect(panel).toContainText('Muse-proposed, unverified');await expect(panel).toContainText('none found within bounds is not proof');const before=await read();expect(before.experiment?.variants).toHaveLength(1);expect(before.practice.rules.find(r=>r.id==='ready-edit')?.toStateId).toBe('draft');
  await panel.getByText('Edit search assumptions and inputs',{exact:true}).click();await panel.getByText('Add a property',{exact:true}).click();await panel.getByText('Add a sequence test',{exact:true}).click();await panel.getByText('Propose an alternative or repair',{exact:true}).click();await panel.scrollIntoViewIfNeeded();await page.screenshot({path:evidence+'/renderer-desktop.png',fullPage:true});
  await fixture.flushDrafts();await fixture.restart();await expect(scope.getByRole('heading',{name:'Final state: Draft',exact:true})).toBeVisible();await scope.getByText('Bounded checks and alternatives',{exact:true}).click();await expect(scope.getByRole('region',{name:'Computed alternative comparison'})).toContainText('First differing event: 3');expect(await read()).toEqual(before);
  await page.getByRole('button',{name:'Save as document',exact:true}).click();const document=page.getByRole('dialog',{name:'Document',exact:true});await expect(document).toContainText('Bounded workflow experiment');await expect(document).toContainText('Muse-proposed, unverified');await expect(document).toContainText('not a guarantee');await expect(document).not.toContainText('equipment-checkout');
  expect(fixture.external).toEqual([]);expect(fixture.commands.some(c=>c.type==='model.run')).toBe(false);expect(fixture.commands.filter(c=>c.type==='module.edit').length).toBeGreaterThanOrEqual(6);
 }finally{await fixture.close();}
});
test('320px keyboard controls retain invalid proposal edits, recover after flush/reload and keep the page within the viewport',async({page})=>{
 await page.setViewportSize({width:320,height:740});const {fixture,scope,read}=await entry(page);
 try{
  await predict(scope);const panel=scope.getByRole('region',{name:'Bounded workflow checks'});await panel.getByText('Propose an alternative or repair',{exact:true}).click();const proposal=panel.getByRole('textbox',{name:'Alternative rules (JSON)',exact:true});await proposal.fill('{ invalid proposed repair');await panel.getByRole('button',{name:'Save and check alternative',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('proposal must be JSON');expect((await read()).experiment).toBeUndefined();
  await fixture.flushDrafts();await fixture.restart();await scope.getByText('Bounded checks and alternatives',{exact:true}).click();await panel.getByText('Propose an alternative or repair',{exact:true}).click();await expect(proposal).toHaveValue('{ invalid proposed repair');await proposal.focus();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:evidence+'/renderer-320px.png',fullPage:true});
  const records=await fixture.learningDrafts.read();expect(records.kind).toBe('available');if(records.kind==='available')expect(records.records.some(r=>r.slot.startsWith('workflow:engine:alternative:'))).toBe(true);expect(fixture.external).toEqual([]);
 }finally{await fixture.close();}
});
test('empty possible and ignored event selections stay editable after saving and restarting',async({page})=>{
 const {fixture,scope,read}=await entry(page);
 try{
  await predict(scope);const panel=scope.getByRole('region',{name:'Bounded workflow checks'});
  await panel.getByText('Edit search assumptions and inputs',{exact:true}).click();await panel.getByText('Possible and explicitly ignored events',{exact:true}).click();
  for(const checkbox of await panel.getByRole('checkbox',{name:/ possible in /}).all())await checkbox.uncheck();
  const ignored=panel.getByRole('checkbox',{name:'Approve ignored in Draft',exact:true});await ignored.check();await panel.getByRole('button',{name:'Save assumptions',exact:true}).click();
  await expect.poll(async()=>(await read()).experiment?.assumptions.ignored).toEqual([{stateId:'draft',eventId:'approve'}]);
  expect((await read()).experiment?.assumptions.allowedEvents.every(row=>row.eventIds.length===0)).toBe(true);
  await ignored.uncheck();await panel.getByLabel('Maximum event depth',{exact:true}).fill('3');await panel.getByRole('button',{name:'Save assumptions',exact:true}).click();
  await expect.poll(async()=>(await read()).experiment?.assumptions.ignored).toEqual([]);
  const saved=(await read()).experiment;await fixture.flushDrafts();await fixture.restart();
  await scope.getByText('Bounded checks and alternatives',{exact:true}).click();await panel.getByText('Edit search assumptions and inputs',{exact:true}).click();
  expect((await read()).experiment).toEqual(saved);await panel.getByLabel('Maximum event depth',{exact:true}).fill('4');await panel.getByRole('button',{name:'Save assumptions',exact:true}).click();
  await expect.poll(async()=>(await read()).experiment?.assumptions).toEqual({...saved!.assumptions,maxDepth:4});
  expect(fixture.external).toEqual([]);
 }finally{await fixture.close();}
});
