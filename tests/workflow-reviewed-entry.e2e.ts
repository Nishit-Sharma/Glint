import {test,expect,type Page,type Locator} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {reviewedWorkflowEntry} from './workflow-reviewed-entry.fixture';
import {MODULE_MIME} from '../src/shared/module-contract';
import {readTaskArtifactText} from '../src/core/task-dialogue';
import {parseModuleAnswer} from '../src/core/interactive-modules';

const evidence='evidence/workflow-reviewed-entry';
type Entry=Awaited<ReturnType<typeof reviewedWorkflowEntry>>;
const review=(page:Page)=>page.getByRole('region',{name:'Review workflow rules',exact:true});
const experiment=(page:Page)=>page.getByRole('region',{name:'Workflow experiment',exact:true});
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true});});
async function menu(page:Page,name:'Files'|'Activity'){
 await page.locator('.workspace').getByRole('button',{name:'Task options',exact:true}).click();await page.locator('.workspace').getByRole('button',{name,exact:true}).click();
}
async function beginReview(page:Page,entry:Entry){
 await menu(page,'Files');const files=page.getByRole('dialog',{name:'Files',exact:true});await files.locator('.artifact-row').filter({hasText:entry.documentTitle}).click();
 const savedDocument=page.getByRole('dialog',{name:'Document',exact:true});await savedDocument.getByRole('button',{name:'Document options',exact:true}).click();await savedDocument.getByRole('button',{name:'Review workflow rules',exact:true}).click();
 await expect(review(page).getByRole('checkbox',{name:'Use passage 1',exact:true})).toBeVisible();
}
async function includePassages(scope:Locator,numbers:number[]){for(const number of numbers)await scope.getByRole('checkbox',{name:'Use passage '+number,exact:true}).check();}
async function choices(scope:Locator,initial='Draft',events=['Submit','Approve','Edit','Approve']){
 await scope.getByRole('combobox',{name:'Experiment starting state',exact:true}).selectOption({label:initial});
 for(let index=0;index<events.length;index++){
  if(index)await scope.getByRole('button',{name:'Add event',exact:true}).click();
  await scope.getByRole('combobox',{name:'Experiment event '+(index+1),exact:true}).selectOption({label:events[index]});
 }
}
async function create(page:Page){
 const scope=review(page);await scope.getByRole('checkbox',{name:'I reviewed these rules and experiment choices.',exact:true}).check();
 await expect(scope.getByRole('button',{name:'Create workflow experiment',exact:true})).toBeEnabled();await scope.getByRole('button',{name:'Create workflow experiment',exact:true}).click();
 await expect(experiment(page)).toBeVisible();await expect(review(page)).toHaveCount(0);
}
async function predict(scope:Locator,state:string,blocked:string){
 await scope.getByRole('combobox',{name:'Final state',exact:true}).selectOption({label:state});await scope.getByLabel('Blocked events',{exact:true}).fill(blocked);await scope.getByRole('button',{name:'Check prediction',exact:true}).click();await expect(scope.getByRole('region',{name:'Computed workflow result',exact:true})).toBeVisible();
}
async function changeReady(scope:Locator,to='In review'){
 await scope.getByText('Change Edit from Ready',{exact:true}).click();await scope.getByLabel('Edit from Ready destination',{exact:true}).selectOption({label:to});await scope.getByLabel('Edit from Ready reason',{exact:true}).fill('Explore the effect of sending edited work back to review.');
 await scope.getByText('Change Edit from Ready',{exact:true}).locator('..').getByRole('button',{name:'Apply rule',exact:true}).click();await expect(scope.getByRole('combobox',{name:'Final state',exact:true})).toBeVisible();
}
async function shot(page:Page,anchor:Locator,name:string){await anchor.evaluate(element=>element.scrollIntoView({block:'start'}));await page.screenshot({path:evidence+'/'+name+'.png'});}
async function offline(entry:Entry,requests:number){
 const task=await entry.fixture.core.getTask(entry.task.id);expect(entry.fixture.configured).toBe(false);expect(entry.fixture.external).toEqual([]);
 expect(entry.fixture.commands.filter(command=>command.type==='model.run'||command.type==='browser.run'||/^(?:windows\.capture|context\.(?:start|capture)|export\.)/.test(command.type))).toEqual([]);
 expect(entry.counters.reviewRequests).toHaveLength(requests);expect(entry.counters.createdArtifactIds).toHaveLength(requests);expect(task.requests).toHaveLength(requests);
 if(requests)expect(task.requests[0].id).toBe(entry.counters.reviewRequests[0].requestId);
 return task;
}
async function record(entry:Entry,name:string){await writeFile(evidence+'/'+name+'.json',JSON.stringify({commands:entry.fixture.commands,counters:entry.counters,task:await entry.fixture.core.getTask(entry.task.id)},null,2));}

test('saved-document review creates a grounded workflow offline, then computes edits, saves, restarts and retains first transfer answer',async({page})=>{
 const entry=await reviewedWorkflowEntry(page);const {fixture}=entry;
 try{
  const seeded=await offline(entry,0);expect(seeded.artifacts).toHaveLength(1);expect(seeded.artifacts[0].revisions[0].mimeType).toBe('text/markdown');
  await beginReview(page,entry);const scope=review(page);await expect(scope).toContainText('linked text sources');await expect(scope).toContainText(entry.sourceLabels[0]);await expect(scope).toContainText('Ready + Edit -> Draft');for(const id of entry.sourceIds)expect(await scope.innerText()).not.toContain(id);
  expect(JSON.stringify(entry.counters.preparations)).not.toContain('equipment-checkout');expect(JSON.stringify(entry.counters.preparations)).not.toContain('Available');
  await expect(scope.getByRole('combobox',{name:'Experiment starting state',exact:true})).toHaveValue('');await expect(scope.getByRole('button',{name:'Create workflow experiment',exact:true})).toBeDisabled();
  await includePassages(scope,[1,2,3,4,5,6]);await choices(scope);await shot(page,scope.getByRole('heading',{name:'Review workflow rules',exact:true}),'full-source-review');await create(page);
  let lab=experiment(page);await expect(lab).toContainText('Reviewed source interpretation');await expect(lab.getByRole('region',{name:'Computed workflow result',exact:true})).toHaveCount(0);
  await predict(lab,'Ready','0');await expect(lab.getByRole('heading',{name:'Final state: Draft',exact:true})).toBeVisible();await expect(lab).toContainText('Prediction score: 0 / 2');await shot(page,lab.getByRole('heading',{name:'Final state: Draft',exact:true}),'full-wrong-prediction');
  await changeReady(lab);await predict(lab,'Ready','0');await expect(lab).toContainText('Prediction score: 2 / 2');await expect(lab.getByLabel('Computed workflow change',{exact:true})).toContainText('Final state: Draft → Ready');await expect(lab.getByLabel('Computed workflow change',{exact:true})).toContainText('Blocked events: 1 → 0');
  await lab.getByRole('button',{name:'Deep',exact:true}).click();await expect(lab).toContainText('no hidden conditions');await lab.getByRole('button',{name:'Visual',exact:true}).click();await shot(page,lab.getByRole('heading',{name:'Final state: Ready',exact:true}),'full-computed-change');
  await lab.getByText('Original rule interpretations, source and changes',{exact:true}).click();await expect(lab).toContainText('Source-stated rule');await expect(lab).toContainText(entry.sourceLabels[0]);await shot(page,lab.getByRole('heading',{name:'Frozen source citations',exact:true}),'full-human-citations');
  const created=await offline(entry,1),module=created.artifacts.find(artifact=>artifact.revisions.at(-1)!.mimeType===MODULE_MIME)!,title=module.revisions.at(-1)!.title;
  await page.getByRole('button',{name:'Save as document',exact:true}).click();const savedDocument=page.getByRole('dialog',{name:'Document',exact:true});await expect(savedDocument.getByRole('heading',{name:title+' notes',exact:true})).toBeVisible();await expect(savedDocument).toContainText('Source-stated rule');await expect(savedDocument).not.toContainText('Unseen equipment');await shot(page,savedDocument.getByRole('heading',{name:title+' notes',exact:true}),'saved-readable-notes');
  const saved=await offline(entry,1),notes=saved.artifacts.find(artifact=>artifact.revisions.at(-1)!.title===title+' notes')!.revisions.at(-1)!;
  expect(notes.sourceRefs).toEqual(module.revisions.at(-1)!.sourceRefs);expect(notes.content).toContain('Original rule Ready + Edit → Draft');expect(notes.content).not.toContain('contextDigest');expect(notes.content).not.toContain('equipment-checkout');for(const id of entry.sourceIds)expect(notes.content).not.toContain(id);
  const projected=readTaskArtifactText(saved,module.id,1);expect(projected.available).toBe(true);if(projected.available){expect(projected.text).toContain('Source-stated rule');expect(projected.text).not.toContain('Available');}
  await page.getByRole('button',{name:'Back to task',exact:true}).click();await menu(page,'Activity');await page.getByRole('dialog',{name:'Activity',exact:true}).getByRole('button',{name:title+' · Revision 1',exact:true}).click();const revision=page.getByRole('dialog',{name:'Saved revision',exact:true});await expect(revision).toContainText('Source-stated rule');await expect(revision).not.toContainText('equipment-checkout');await shot(page,revision.getByRole('heading',{name:title,exact:true}),'readable-activity');await page.getByRole('button',{name:'Back to task',exact:true}).click();
  const beforeRestart=(await fixture.core.getTask(entry.task.id)).session!.moduleStates[0].state;await fixture.restart();lab=experiment(page);await expect(lab.getByRole('heading',{name:'Final state: Ready',exact:true})).toBeVisible();expect((await fixture.core.getTask(entry.task.id)).session!.moduleStates[0].state).toEqual(beforeRestart);
  await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:640});lab=experiment(page);await expect(page.locator('.compact-companion')).toBeVisible();await expect(lab.getByLabel('Computed state path',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await shot(page,lab.getByLabel('Computed state path',{exact:true}),'compact-computed-path');
  await fixture.emit({type:'surface',mode:'workspace'});await page.setViewportSize({width:1080,height:800});lab=experiment(page);await lab.getByRole('button',{name:'Try unseen transfer',exact:true}).click();await expect(lab).toContainText('Unseen synthetic transfer');await expect(lab.getByRole('region',{name:'Computed workflow result',exact:true})).toHaveCount(0);await predict(lab,'Reserved','1');await expect(lab.getByRole('heading',{name:'Final state: Available',exact:true})).toBeVisible();await expect(lab).toContainText('First transfer prediction score: 0 / 2');await shot(page,lab.getByRole('heading',{name:'Final state: Available',exact:true}),'transfer-first-result');
  const first=(await fixture.core.getTask(entry.task.id)).session!.moduleStates[0].state;await fixture.restart();lab=experiment(page);await expect(lab.getByRole('heading',{name:'Final state: Available',exact:true})).toBeVisible();expect((await fixture.core.getTask(entry.task.id)).session!.moduleStates[0].state).toEqual(first);
  await lab.getByRole('button',{name:'Return to practice',exact:true}).click();await changeReady(lab,'Draft');await predict(lab,'Draft','1');await lab.getByRole('button',{name:'Open saved transfer',exact:true}).click();await expect(lab).toContainText('First transfer prediction score: 0 / 2');await expect(lab.getByRole('combobox',{name:'Final state',exact:true})).toHaveCount(0);await offline(entry,1);await record(entry,'full-ledger');
 }finally{await fixture.close();}
});

test('conflicting literal rules and unparsed prose require an explicit user interpretation before product creation',async({page})=>{
 const entry=await reviewedWorkflowEntry(page,'ambiguous');
 try{
  await beginReview(page,entry);const scope=review(page);await expect(scope).toContainText('different destinations');await includePassages(scope,[1,2,3,5]);await choices(scope);await scope.getByRole('checkbox',{name:'I reviewed these rules and experiment choices.',exact:true}).check();await expect(scope.getByRole('button',{name:'Create workflow experiment',exact:true})).toBeDisabled();await offline(entry,0);
  await scope.getByRole('checkbox',{name:'Use passage 3',exact:true}).uncheck();await scope.getByRole('checkbox',{name:'Use passage 5',exact:true}).uncheck();await scope.getByRole('checkbox',{name:'Use passage 4',exact:true}).check();await expect(scope.getByLabel('Rule 4 from',{exact:true})).toHaveValue('');await expect(scope.getByLabel('Rule 4 event',{exact:true})).toHaveValue('');await expect(scope.getByLabel('Rule 4 to',{exact:true})).toHaveValue('');
  await scope.getByLabel('Rule 4 from',{exact:true}).fill('Ready');await scope.getByLabel('Rule 4 event',{exact:true}).fill('Edit');await scope.getByLabel('Rule 4 to',{exact:true}).fill('In review');await expect(scope.getByRole('button',{name:'Create workflow experiment',exact:true})).toBeDisabled();await scope.getByLabel('Rule 4 interpretation reason',{exact:true}).fill('I choose the prose policy over the conflicting literal line for this hypothetical experiment.');await shot(page,scope.getByLabel('Rule 4 from',{exact:true}),'explicit-prose-interpretation');await create(page);
  const lab=experiment(page);await predict(lab,'Ready','0');await expect(lab).toContainText('Prediction score: 2 / 2');await lab.getByText('Original rule interpretations, source and changes',{exact:true}).click();await expect(lab).toContainText('Your interpretation');await expect(lab).toContainText('I choose the prose policy');await expect(lab).toContainText('Editing a ready document returns it to review');await shot(page,lab.getByRole('heading',{name:'Original interpretations',exact:true}),'interpreted-rule-provenance');
  const saved=await offline(entry,1),module=saved.artifacts.find(artifact=>artifact.revisions.at(-1)!.mimeType===MODULE_MIME)!;const data=parseModuleAnswer(JSON.parse(module.revisions.at(-1)!.content)).modules[0].data;if(data.kind!=='workflow-lab')throw Error('Expected reviewed workflow');expect(data.ruleOrigins.filter(origin=>origin.interpretation==='user-interpreted')).toHaveLength(1);expect(data.ruleOrigins.filter(origin=>origin.interpretation==='source-stated')).toHaveLength(2);expect(entry.counters.reviewRequests[0].review.rules).toHaveLength(3);await record(entry,'interpretation-ledger');
 }finally{await entry.fixture.close();}
});

test('source and saved-basis changes retain durable earlier raw and require fresh preparation without applying it',async({page})=>{
 const entry=await reviewedWorkflowEntry(page);
 try{
  await beginReview(page,entry);let scope=review(page);await includePassages(scope,[1,2,3,4,5,6]);await choices(scope);await scope.getByRole('checkbox',{name:'I reviewed these rules and experiment choices.',exact:true}).check();await expect(scope.getByRole('button',{name:'Create workflow experiment',exact:true})).toBeEnabled();expect(entry.counters.preparations).toHaveLength(1);
  await entry.changeSourceAndRebind();await expect(scope.getByRole('alert').filter({hasText:/changed|stale/i}).first()).toBeVisible();await expect(scope.getByRole('button',{name:'Create workflow experiment',exact:true})).toBeDisabled();await expect(scope.getByRole('combobox',{name:'Experiment starting state',exact:true})).toHaveValue('Draft');await expect(scope.getByRole('combobox',{name:'Experiment event 4',exact:true})).toHaveValue('Approve');expect(entry.counters.preparations).toHaveLength(1);await shot(page,scope.getByRole('alert').filter({hasText:/changed|stale/i}).first(),'stale-review-preserved');await offline(entry,0);
  await scope.getByRole('button',{name:'Back to document',exact:true}).click();await expect(page.getByRole('dialog',{name:'Keep your unsaved edits?',exact:true})).toHaveCount(0);
  const savedDocument=page.getByRole('dialog',{name:'Document',exact:true});await savedDocument.getByRole('button',{name:'Document options',exact:true}).click();await savedDocument.getByRole('button',{name:'Review workflow rules',exact:true}).click();scope=review(page);await expect(scope.getByRole('checkbox',{name:'Use passage 1',exact:true})).toBeVisible();expect(entry.counters.preparations).toHaveLength(2);expect(entry.counters.preparations[1].basis.revision).toBe(2);expect(entry.counters.preparations[1].sourceRefs[0].version).toBe(2);await expect(scope.getByRole('combobox',{name:'Experiment starting state',exact:true})).toHaveValue('');
  await includePassages(scope,[1,2,3,4,5,6]);await choices(scope);await create(page);await predict(experiment(page),'Draft','1');await expect(experiment(page)).toContainText('Prediction score: 2 / 2');await shot(page,experiment(page).getByRole('heading',{name:'Final state: Draft',exact:true}),'freshly-reviewed-result');const task=await offline(entry,1),module=task.artifacts.find(artifact=>artifact.revisions.at(-1)!.mimeType===MODULE_MIME)!;expect(module.revisions.at(-1)!.sourceRefs[0].version).toBe(2);await record(entry,'stale-recovery-ledger');
 }finally{await entry.fixture.close();}
});
