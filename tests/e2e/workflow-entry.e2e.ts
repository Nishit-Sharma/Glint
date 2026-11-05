import {test,expect,type Page,type Locator} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {workflowEntry} from '../support/workflow-entry.fixture';
import {readTaskArtifactText} from '../../src/core/task-dialogue';
import {parseModuleAnswer} from '../../src/core/interactive-modules';
import {workflowLab} from '../../src/learning/workflow-lab';
import {MODULE_MIME} from '../../src/shared/module-contract';

const evidence='evidence/workflow-entry',title='What happens to review after an edit?';
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true});});
const experiment=(page:Page)=>page.getByRole('region',{name:'Workflow experiment',exact:true});
async function menu(page:Page,name:'Files'|'History'){
 await page.locator('.workspace').getByRole('button',{name:'Task options',exact:true}).click();await page.locator('.workspace').getByRole('button',{name,exact:true}).click();
}
async function productEntry(page:Page){
 await menu(page,'Files');const files=page.getByRole('dialog',{name:'Files',exact:true});await files.getByRole('button',{name:'New file',exact:true}).click();await files.getByRole('button',{name:'Workflow example',exact:true}).click();
 await expect(experiment(page).getByRole('heading',{name:title,exact:true})).toBeVisible();
}
async function predict(scope:Locator,state:string,blocked:string){
 await scope.getByRole('combobox',{name:'Final state',exact:true}).selectOption({label:state});await scope.getByLabel('Blocked events',{exact:true}).fill(blocked);await scope.getByRole('button',{name:'Check prediction',exact:true}).click();await expect(scope.getByRole('region',{name:'Computed workflow result',exact:true})).toBeVisible();
}
async function changeReady(scope:Locator,to='In review'){
 await scope.getByText('Change Edit from Ready',{exact:true}).click();await scope.getByLabel('Edit from Ready destination',{exact:true}).selectOption({label:to});await scope.getByLabel('Edit from Ready reason',{exact:true}).fill('Explore the explicit local change from Ready back to review.');
 await scope.getByText('Change Edit from Ready',{exact:true}).locator('../..').getByRole('button',{name:'Apply rule',exact:true}).click();await expect(scope.getByRole('combobox',{name:'Final state',exact:true})).toBeVisible();
}
async function back(page:Page){await page.getByRole('button',{name:'Back to task',exact:true}).click();}
async function offline(entry:Awaited<ReturnType<typeof workflowEntry>>,examples=1){
 const task=await entry.fixture.core.getTask(entry.task.id);
 expect(entry.fixture.configured).toBe(false);expect(entry.fixture.external).toEqual([]);
 expect(entry.fixture.commands.filter(command=>command.type==='model.run'||command.type==='browser.run'||/^(?:windows\.capture|context\.(?:start|capture)|export\.)/.test(command.type))).toEqual([]);
 expect(entry.counters.exampleRequests).toHaveLength(examples);expect(task.requests).toHaveLength(1);
 if(examples)expect(task.requests[0].id).toBe(entry.counters.exampleRequests[0].requestId);
 return task;
}
async function record(entry:Awaited<ReturnType<typeof workflowEntry>>,name:string){await writeFile(evidence+'/'+name+'.json',JSON.stringify({commands:entry.fixture.commands,counters:entry.counters,task:await entry.fixture.core.getTask(entry.task.id)},null,2));}

test('offline Files entry supports prediction, local rule change, readable notes and Activity, restart and first transfer attempt',async({page})=>{
 const entry=await workflowEntry(page);const {fixture}=entry;
 try{
  await productEntry(page);let scope=experiment(page);
  await expect(scope).toContainText('Illustrative local sample');await expect(scope).toContainText('No real procedure or screen was observed.');await expect(scope.getByRole('region',{name:'Computed workflow result',exact:true})).toHaveCount(0);
  await scope.getByRole('combobox',{name:'Final state',exact:true}).selectOption({label:'Ready'});await scope.getByLabel('Blocked events',{exact:true}).fill('0');await scope.getByRole('heading',{name:'Predict this sequence',exact:true}).evaluate(element=>element.scrollIntoView({block:'start'}));await page.screenshot({path:evidence+'/desktop-prediction-form.png'});
  await scope.getByRole('button',{name:'Check prediction',exact:true}).click();await expect(scope.getByRole('heading',{name:'Final state: Draft',exact:true})).toBeVisible();await expect(scope).toContainText('1 blocked event');await expect(scope).toContainText('Prediction score: 0 / 2');
  await scope.getByRole('heading',{name:'Final state: Draft',exact:true}).evaluate(element=>element.scrollIntoView({block:'start'}));await page.screenshot({path:evidence+'/desktop-wrong-prediction.png'});
  await changeReady(scope);await expect(scope.getByRole('region',{name:'Computed workflow result',exact:true})).toHaveCount(0);await predict(scope,'Ready','0');
  await expect(scope.getByRole('heading',{name:'Final state: Ready',exact:true})).toBeVisible();await expect(scope).toContainText('0 blocked events');await expect(scope.getByLabel('Computed workflow change',{exact:true})).toContainText('Blocked events: 1 → 0');await expect(scope.getByLabel('Computed workflow change',{exact:true})).toContainText('Final state: Draft → Ready');
  await scope.getByRole('button',{name:'Deep',exact:true}).click();await expect(scope).toContainText('no hidden conditions');await scope.getByRole('button',{name:'Visual',exact:true}).click();await expect(scope.getByLabel('Computed state path',{exact:true}).locator('li')).toHaveCount(4);
  await scope.getByRole('heading',{name:'Final state: Ready',exact:true}).evaluate(element=>element.scrollIntoView({block:'start'}));await page.screenshot({path:evidence+'/desktop-changed-result.png'});
  await page.getByRole('button',{name:'Save as document',exact:true}).click();const document=page.getByRole('dialog',{name:'Document',exact:true});await expect(document.getByRole('heading',{name:title+' notes',exact:true})).toBeVisible();await expect(document).toContainText('Ready');await expect(document).not.toContainText('Unseen equipment checkout');await page.screenshot({path:evidence+'/desktop-readable-document.png'});
  const saved=await offline(entry),module=saved.artifacts.find(artifact=>artifact.revisions.at(-1)!.mimeType===MODULE_MIME)!,notes=saved.artifacts.find(artifact=>artifact.revisions.at(-1)!.title===title+' notes')!.revisions.at(-1)!.content;
  expect(notes).not.toContain('equipment-checkout');expect(notes).not.toContain('Available');expect(notes).not.toContain('contextDigest');expect(notes).not.toContain('ready-edit');expect(notes).not.toMatch(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-/);const readable=readTaskArtifactText(saved,module.id,module.revisions.at(-1)!.revision);expect(readable.available).toBe(true);if(readable.available){expect(readable.text).not.toContain('equipment-checkout');expect(readable.text).not.toContain('Available');}
  await back(page);await menu(page,'History');const activity=page.getByRole('dialog',{name:'History',exact:true});await page.screenshot({path:evidence+'/desktop-activity-list.png'});await activity.getByRole('button',{name:title+' · Revision 1',exact:true}).click();const revision=page.getByRole('dialog',{name:'Saved revision',exact:true});await expect(revision).toContainText('Ready');await expect(revision).not.toContainText('equipment-checkout');await expect(revision).not.toContainText('Available');await page.screenshot({path:evidence+'/desktop-readable-activity.png'});await back(page);
  await fixture.restart();await expect(experiment(page).getByRole('heading',{name:'Final state: Ready',exact:true})).toBeVisible();await offline(entry);scope=experiment(page);
  await scope.getByRole('button',{name:'Try unseen transfer',exact:true}).click();await expect(scope).toContainText('Unseen synthetic transfer');await expect(scope.getByRole('region',{name:'Computed workflow result',exact:true})).toHaveCount(0);await expect(scope.getByText('Change Edit from Ready',{exact:true})).toHaveCount(0);
  await predict(scope,'Reserved','1');await expect(scope.getByRole('heading',{name:'Final state: Available',exact:true})).toBeVisible();await expect(scope).toContainText('2 blocked events');await expect(scope).toContainText('First transfer prediction score: 0 / 2');await scope.getByRole('heading',{name:'Final state: Available',exact:true}).evaluate(element=>element.scrollIntoView({block:'start'}));await page.screenshot({path:evidence+'/desktop-transfer-result.png'});
  const first=(await fixture.core.getTask(entry.task.id)).session!.moduleStates[0].state;
  await fixture.restart();scope=experiment(page);await expect(scope.getByRole('heading',{name:'Final state: Available',exact:true})).toBeVisible();expect((await fixture.core.getTask(entry.task.id)).session!.moduleStates[0].state).toEqual(first);
  await scope.getByRole('button',{name:'Return to practice',exact:true}).click();await changeReady(scope,'Draft');await predict(scope,'Draft','1');await scope.getByRole('button',{name:'Open saved transfer',exact:true}).click();await expect(scope).toContainText('First transfer prediction score: 0 / 2');await expect(scope.getByRole('combobox',{name:'Final state',exact:true})).toHaveCount(0);
  await offline(entry);await record(entry,'desktop-ledger');
 }finally{await fixture.close();}
});

test('compact 360px actual App keeps current workflow, modes, contained tables and saved state after restart',async({page})=>{
 const entry=await workflowEntry(page);const {fixture}=entry;
 try{
  await productEntry(page);await back(page);await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:640});let scope=experiment(page);
  await expect(page.locator('.compact-companion')).toBeVisible();await scope.getByText('Change the starting state or event sequence',{exact:true}).click();await scope.getByLabel('Edited event 4',{exact:true}).selectOption({label:'Submit'});await scope.getByLabel('Sequence change reason',{exact:true}).fill('Submit after editing instead of approving a draft.');await scope.getByRole('button',{name:'Apply event sequence',exact:true}).click();await predict(scope,'In review','0');await expect(scope).toContainText('Prediction score: 2 / 2');
  for(const mode of ['Deep','Visual','Quick','Visual'])await scope.getByRole('button',{name:mode,exact:true}).click();await expect(scope.getByLabel('Computed state path',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await scope.getByLabel('Computed state path',{exact:true}).evaluate(element=>element.scrollIntoView({block:'start'}));await page.screenshot({path:evidence+'/compact-current-result.png'});
  const state=(await fixture.core.getTask(entry.task.id)).session!.moduleStates[0].state;await fixture.restart();await page.locator('.workspace').getByRole('heading',{name:entry.task.title,exact:true}).waitFor();await fixture.emit({type:'surface',mode:'companion'});scope=experiment(page);await expect(scope.getByRole('heading',{name:'Final state: In review',exact:true})).toBeVisible();await expect(scope.getByRole('button',{name:'Visual',exact:true})).toHaveAttribute('aria-pressed','true');expect((await fixture.core.getTask(entry.task.id)).session!.moduleStates[0].state).toEqual(state);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await scope.getByRole('heading',{name:'Final state: In review',exact:true}).evaluate(element=>element.scrollIntoView({block:'start'}));await page.screenshot({path:evidence+'/compact-restarted-result.png'});await offline(entry);await record(entry,'compact-ledger');
 }finally{await fixture.close();}
});

test('injected reviewed-text fixture uses exact host admission, human citations and stale-source guards without inference',async({page})=>{
 const entry=await workflowEntry(page,true);const {fixture}=entry;
 try{
  let scope=experiment(page);await expect(scope).toContainText('Reviewed source interpretation');await expect(scope).toContainText('not automatic screen inference');await changeReady(scope);await predict(scope,'Ready','0');await scope.getByText('Original rule interpretations, source and changes',{exact:true}).click();await expect(scope.getByText('Ready + Edit -> Draft',{exact:true})).toBeVisible();await expect(scope).toContainText(entry.sourceLabel);await expect(scope).toContainText('version 1');expect(await scope.innerText()).not.toContain('owned-reviewed-workflow-rules');expect(await scope.innerText()).not.toContain('rule-citation-');await expect(scope.getByLabel('Latest applied workflow change',{exact:true})).toContainText('explicit local change');await scope.getByRole('heading',{name:'Frozen source citations',exact:true}).evaluate(element=>element.scrollIntoView({block:'start'}));await page.screenshot({path:evidence+'/reviewed-fixture-citations.png'});
  const before=await offline(entry,0),state=before.session!.moduleStates,artifactCount=before.artifacts.length;
  await entry.changeSource();await expect(scope.getByRole('alert')).toContainText('reviewed source changed');await expect(scope.getByRole('button',{name:'Deep',exact:true})).toBeDisabled();await expect(scope.getByLabel('Edit from Ready destination',{exact:true})).toBeDisabled();await expect(scope.getByRole('heading',{name:'Final state: Ready',exact:true})).toBeVisible();
  const save=page.getByRole('button',{name:'Save as document',exact:true});if(await save.isEnabled()){await save.click();await expect(page.getByRole('alert').filter({hasText:/source changed|fresh capture/}).last()).toBeVisible();}else await expect(save).toBeDisabled();
  const stale=await fixture.core.getTask(entry.task.id);expect(stale.artifacts).toHaveLength(artifactCount);expect(stale.session!.moduleStates).toEqual(state);await page.screenshot({path:evidence+'/reviewed-fixture-stale-result.png'});
  await fixture.restart();scope=experiment(page);await expect(scope.getByRole('heading',{name:'Final state: Ready',exact:true})).toBeVisible();await expect(scope.getByRole('button',{name:'Visual',exact:true})).toBeDisabled();const saved=await offline(entry,0),module=saved.artifacts.find(artifact=>artifact.revisions.at(-1)!.mimeType===MODULE_MIME)!,data=parseModuleAnswer(JSON.parse(module.revisions.at(-1)!.content)).modules[0].data;if(data.kind!=='workflow-lab')throw Error('Expected admitted workflow');expect(workflowLab.observe(data,saved.session!.moduleStates[0].state).result?.finalStateLabel).toBe('Ready');await record(entry,'reviewed-fixture-ledger');
 }finally{await fixture.close();}
});
