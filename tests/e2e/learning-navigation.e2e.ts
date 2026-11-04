import {test,expect,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {workflowEntry} from '../support/workflow-entry.fixture';
import {sourceJoinEntry} from '../support/source-join-entry.fixture';

const evidence=process.env.LEARNING_DRAFT_EVIDENCE??'evidence/learning-drafts/navigation-current';
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true});});
async function openWorkflow(page:Page){
 const entry=await workflowEntry(page),workspace=page.locator('.workspace');
 await workspace.getByRole('button',{name:'Task options',exact:true}).click();await workspace.getByRole('button',{name:'Files',exact:true}).click();
 const files=page.getByRole('dialog',{name:'Files',exact:true});await files.getByRole('button',{name:'New file',exact:true}).click();await files.getByRole('button',{name:'Workflow example',exact:true}).click();
 const scope=page.getByRole('dialog',{name:'Document',exact:true});await expect(scope.getByRole('region',{name:'Workflow experiment',exact:true})).toBeVisible();return {...entry,scope};
}
for(const surface of ['full','compact'] as const){
 test(`workflow ${surface} restores an unapplied rule after task navigation`,async({page})=>{
  const entry=await openWorkflow(page),{fixture}=entry;
  try{
   let scope=entry.scope;
   if(surface==='compact'){await scope.getByRole('button',{name:'Back to task',exact:true}).click();await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:640});scope=page.locator('.compact-companion');}
   await scope.getByText('Change Edit from Ready',{exact:true}).click();await scope.getByLabel('Edit from Ready destination',{exact:true}).selectOption({label:'In review'});
   const text='  Keep this unapplied explanation.  ';await scope.getByLabel('Edit from Ready reason',{exact:true}).fill(text);const before=await fixture.core.getTask(entry.task.id);
   if(surface==='full')await page.getByRole('complementary',{name:'Task navigation',exact:true}).getByRole('button',{name:'Observatory visit',exact:true}).click();
   else{await scope.getByRole('button',{name:'Choose task: '+entry.task.title,exact:true}).click();await page.getByRole('dialog',{name:'Tasks',exact:true}).getByRole('button').filter({hasText:'Observatory visit'}).click();}
   await expect(page.getByRole('dialog',{name:'Keep your unsaved edits?',exact:true})).toHaveCount(0);
   if(surface==='full')await page.getByRole('complementary',{name:'Task navigation',exact:true}).getByRole('button',{name:entry.task.title,exact:true}).click();
   else{const workspace=page.locator('.workspace');await workspace.getByRole('button',{name:'Choose task',exact:true}).click();await page.getByRole('dialog',{name:'Tasks',exact:true}).getByRole('button').filter({hasText:entry.task.title}).click();await workspace.getByRole('button',{name:'Switch to compact companion',exact:true}).click();}
   const reopened=surface==='full'?page.locator('.workspace').getByRole('region',{name:'Workflow experiment',exact:true}):scope;
   await reopened.getByText('Change Edit from Ready',{exact:true}).click();await expect(reopened.getByLabel('Edit from Ready reason',{exact:true})).toHaveValue(text);await expect(reopened.getByLabel('Edit from Ready destination',{exact:true}).locator('option:checked')).toHaveText('In review');
   expect((await fixture.core.getTask(entry.task.id)).session?.moduleStates??[]).toEqual(before.session?.moduleStates??[]);
   await fixture.flushDrafts();await fixture.restart();await page.setViewportSize({width:1080,height:800});
   const restored=page.locator('.workspace').getByRole('region',{name:'Workflow experiment',exact:true});await restored.getByText('Change Edit from Ready',{exact:true}).click();await expect(restored.getByLabel('Edit from Ready reason',{exact:true})).toHaveValue(text);
   await writeFile(`${evidence}/workflow-${surface}-green.json`,JSON.stringify({before,after:await fixture.core.getTask(entry.task.id),commands:fixture.commands},null,2));
  }finally{await fixture.close();}
 });
}

test('workflow changed inputs require prediction review; refused submission and transfer preserve drafts',async({page})=>{
 const entry=await openWorkflow(page),{fixture,scope}=entry;
 try{
  await scope.getByRole('combobox',{name:'Final state',exact:true}).selectOption({label:'Ready'});await scope.getByLabel('Blocked events',{exact:true}).fill('0');await scope.getByLabel('Prediction reasoning',{exact:true}).fill('Prediction for the earlier inputs.');
  await scope.getByText('Change the starting state or event sequence',{exact:true}).click();await scope.getByLabel('Edited starting state',{exact:true}).selectOption({label:'Ready'});await scope.getByLabel('Starting-state change reason',{exact:true}).fill('Apply only this starting state.');
  await scope.getByLabel('Edited event 4',{exact:true}).selectOption({label:'Submit'});await scope.getByLabel('Sequence change reason',{exact:true}).fill('An independent event draft.');await scope.getByRole('button',{name:'Apply starting state',exact:true}).click();
  await expect(scope.getByLabel('Starting-state change reason',{exact:true})).toHaveValue('');await expect(scope.getByLabel('Sequence change reason',{exact:true})).toHaveValue('An independent event draft.');
  let recovery=scope.locator('.learning-draft-recovery');await recovery.getByText('Earlier unapplied edits need review',{exact:true}).click();await expect(recovery).toContainText('Prediction for the earlier inputs.');await expect(scope.getByLabel('Blocked events',{exact:true})).toHaveValue('');
  await scope.getByRole('button',{name:'Apply event sequence',exact:true}).click();await expect(scope.getByLabel('Sequence change reason',{exact:true})).toHaveValue('');
  recovery=scope.locator('.learning-draft-recovery');await recovery.getByRole('button',{name:'Discard earlier unapplied edits',exact:true}).click();
  await scope.getByRole('combobox',{name:'Final state',exact:true}).selectOption({label:'Ready'});await scope.getByLabel('Blocked events',{exact:true}).fill('0');await scope.getByLabel('Prediction reasoning',{exact:true}).fill('Explicit prediction for changed inputs.');
  const invoke=fixture.invoke.bind(fixture);let refused=0;fixture.invoke=async command=>{if(command.type==='module.edit'&&command.action.kind==='predict'&&!refused++){fixture.commands.push(structuredClone(command));throw Error('Synthetic mutation refusal.');}return invoke(command);};
  const before=await fixture.core.getTask(entry.task.id);await scope.getByRole('button',{name:'Check prediction',exact:true}).click();await expect(scope.getByRole('alert')).toBeVisible();await expect(scope.getByLabel('Blocked events',{exact:true})).toHaveValue('0');await expect(scope.getByLabel('Prediction reasoning',{exact:true})).toHaveValue('Explicit prediction for changed inputs.');expect((await fixture.core.getTask(entry.task.id)).session?.moduleStates).toEqual(before.session?.moduleStates);
  await scope.getByRole('button',{name:'Check prediction',exact:true}).click();await expect(scope.getByRole('heading',{name:'Final state: In review',exact:true})).toBeVisible();
  await scope.getByText('Change Edit from Ready',{exact:true}).click();await scope.getByLabel('Edit from Ready reason',{exact:true}).fill('Unapplied reason must not enter transfer.');await scope.getByRole('button',{name:'Try unseen transfer',exact:true}).click();
  const review=page.getByRole('dialog',{name:'Keep your unsaved edits?',exact:true});await expect(review).toHaveCount(0);await expect(scope).toContainText('Unseen synthetic transfer');expect(fixture.commands.filter(c=>c.type==='module.edit'&&c.action.kind==='start-transfer')).toHaveLength(1);
  await scope.getByLabel('Blocked events',{exact:true}).fill('0');await scope.getByLabel('Prediction reasoning',{exact:true}).fill('Unsubmitted transfer explanation.');await scope.getByRole('button',{name:'Return to practice',exact:true}).click();await expect(review).toHaveCount(0);
  await scope.getByText('Change Edit from Ready',{exact:true}).click();await expect(scope.getByLabel('Edit from Ready reason',{exact:true})).toHaveValue('Unapplied reason must not enter transfer.');await scope.getByRole('button',{name:'Open saved transfer',exact:true}).click();await expect(scope.getByLabel('Blocked events',{exact:true})).toHaveValue('0');await expect(scope.getByLabel('Prediction reasoning',{exact:true})).toHaveValue('Unsubmitted transfer explanation.');
  await scope.getByRole('combobox',{name:'Final state',exact:true}).selectOption({label:'Reserved'});await scope.getByLabel('Blocked events',{exact:true}).fill('1');await scope.getByRole('button',{name:'Check prediction',exact:true}).click();await expect(scope.getByRole('heading',{name:'Final state: Available',exact:true})).toBeVisible();
  const saved=await fixture.core.getTask(entry.task.id);await fixture.restart();await expect(page.locator('.workspace').getByRole('heading',{name:'Final state: Available',exact:true})).toBeVisible();expect((await fixture.core.getTask(entry.task.id)).session?.moduleStates).toEqual(saved.session?.moduleStates);
  await writeFile(`${evidence}/workflow-ack-ledger.json`,JSON.stringify({before,saved,afterRestart:await fixture.core.getTask(entry.task.id),commands:fixture.commands},null,2));
 }finally{await fixture.close();}
});

test('SQL type and problem changes require draft review; refused zero prediction stays unapplied',async({page})=>{
 const entry=await sourceJoinEntry(page),{fixture}=entry,scope=page.locator('.workspace');
 try{
  await scope.getByRole('button',{name:entry.label,exact:true}).click();await expect.poll(()=>entry.proposalPending()).toBe(true);entry.completeProposal();await expect(scope.getByRole('heading',{name:'Review the cited tables',exact:true})).toBeVisible();
  const value=scope.getByLabel('Members row 2, Team corrected value',{exact:true}),reason=scope.getByLabel('Members row 2, Team correction reason',{exact:true});await value.fill('x');await reason.fill('Correction for the unknown type.');
  for(const name of ['Members.Team','Invitations.Team']){
   await scope.getByRole('combobox',{name:name+' column type',exact:true}).selectOption('string');const why=scope.getByLabel(name+' type reason',{exact:true});await why.fill('Reviewed as text.');await why.locator('xpath=ancestor::form').getByRole('button',{name:'Confirm type',exact:true}).click();await expect(why).toHaveValue('');
  }
  const correction=reason.locator('xpath=ancestor::form').locator('.learning-draft-recovery');await correction.getByText('Earlier unapplied edits need review',{exact:true}).click();await expect(correction).toContainText('Correction for the unknown type.');await expect(value).toHaveValue('');await correction.getByRole('button',{name:'Discard earlier unapplied edits',exact:true}).click();
  await value.fill('x');await reason.fill('Correction reviewed for text.');await reason.locator('xpath=ancestor::form').getByRole('button',{name:'Apply correction',exact:true}).click();await expect(reason).toHaveValue('');
  await scope.getByRole('combobox',{name:'Reviewed join type',exact:true}).selectOption('INNER');await scope.getByRole('combobox',{name:'Reviewed left key',exact:true}).selectOption('p-key');await scope.getByRole('combobox',{name:'Reviewed right key',exact:true}).selectOption('p-rkey');await scope.getByRole('textbox',{name:'Why these keys?',exact:true}).fill('Use the displayed Team columns.');await scope.getByRole('button',{name:'Confirm join condition',exact:true}).click();await expect(scope.getByLabel('Why these keys?',{exact:true})).toHaveValue('');
  await scope.getByRole('button',{name:'Accept reviewed extraction and experiment',exact:true}).click();const review=page.getByRole('dialog',{name:'Keep your unsaved edits?',exact:true});await expect(review).toHaveCount(0);await expect(scope.getByRole('textbox',{name:'Members row 2 Team',exact:true})).toHaveValue('x');
  const row=scope.getByRole('textbox',{name:'Members row 1 Team',exact:true});await row.fill('z');await scope.getByLabel('Predict the output row count',{exact:true}).fill('0');await scope.getByRole('textbox',{name:'Why? (recorded, not graded)',exact:true}).fill('Prediction for the earlier join.');
  await scope.getByRole('combobox',{name:'Join type',exact:true}).selectOption('LEFT');await expect(row).toHaveValue('z');const prediction=scope.locator('.learning-draft-recovery');await prediction.getByText('Earlier unapplied edits need review',{exact:true}).click();await expect(prediction).toContainText('Prediction for the earlier join.');await expect(scope.getByLabel('Predict the output row count',{exact:true})).toHaveValue('');
  await row.locator('xpath=ancestor::tr').getByRole('button',{name:'Apply row',exact:true}).click();await expect(row.locator('xpath=ancestor::tr').getByRole('button',{name:'Apply row',exact:true})).toBeDisabled();await prediction.getByRole('button',{name:'Discard earlier unapplied edits',exact:true}).click();
  await scope.getByLabel('Predict the output row count',{exact:true}).fill('0');await scope.getByRole('textbox',{name:'Why? (recorded, not graded)',exact:true}).fill('Explicit prediction for changed inputs.');
  const invoke=fixture.invoke.bind(fixture);let refused=0;fixture.invoke=async command=>{if(command.type==='module.edit'&&command.action.kind==='lab'&&command.action.action.kind==='predict'&&!refused++){fixture.commands.push(structuredClone(command));throw Error('Synthetic mutation refusal.');}return invoke(command);};
  const before=await fixture.core.getTask(entry.task.id);await scope.getByRole('button',{name:'Check prediction',exact:true}).click();await expect(scope.getByRole('alert')).toBeVisible();await expect(scope.getByLabel('Predict the output row count',{exact:true})).toHaveValue('0');expect((await fixture.core.getTask(entry.task.id)).session?.moduleStates).toEqual(before.session?.moduleStates);
  await page.getByRole('button',{name:'Observatory visit',exact:true}).click();await expect(review).toHaveCount(0);await page.getByRole('button',{name:entry.task.title,exact:true}).click();await expect(scope.getByLabel('Predict the output row count',{exact:true})).toHaveValue('0');
  await scope.getByRole('button',{name:'Check prediction',exact:true}).click();await expect(scope.getByRole('region',{name:'Computed result',exact:true})).toBeVisible();
  await writeFile(`${evidence}/sql-ack-ledger.json`,JSON.stringify({before,after:await fixture.core.getTask(entry.task.id),commands:fixture.commands,counters:entry.counters},null,2));
 }finally{await fixture.close();}
});

test('deliberate context intake preserves a mounted workflow draft',async({page})=>{
 const entry=await openWorkflow(page),{fixture}=entry,workspace=page.locator('.workspace');
 try{
  await entry.scope.getByRole('button',{name:'Back to task',exact:true}).click();const lab=workspace.getByRole('region',{name:'Workflow experiment',exact:true});await lab.getByText('Change Edit from Ready',{exact:true}).click();await lab.getByLabel('Edit from Ready reason',{exact:true}).fill('Keep this through context intake.');
  const before=await fixture.core.getTask(entry.task.id);await workspace.getByRole('button',{name:'Request options',exact:true}).click();await workspace.getByRole('button',{name:'Use screen context',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Keep your unsaved edits?',exact:true})).toHaveCount(0);await expect.poll(()=>fixture.commands.filter(c=>c.type==='context.start').length).toBe(1);
  await workspace.getByRole('button',{name:'Cancel',exact:true}).click();await expect(lab.getByLabel('Edit from Ready reason',{exact:true})).toHaveValue('Keep this through context intake.');expect((await fixture.core.getTask(entry.task.id)).session?.moduleStates??[]).toEqual(before.session?.moduleStates??[]);
  await writeFile(`${evidence}/workflow-context-ledger.json`,JSON.stringify({task:await fixture.core.getTask(entry.task.id),commands:fixture.commands},null,2));
 }finally{await fixture.close();}
});

test('compact refused follow-up preserves an unapplied workflow and composer',async({page})=>{
 const entry=await openWorkflow(page),{fixture}=entry;let fail:(()=>void)|undefined;
 try{
  fixture.configured=true;await fixture.restart();await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:640});const scope=page.locator('.compact-companion');
  const invoke=fixture.invoke.bind(fixture);fixture.invoke=async command=>{if(command.type==='model.run'){fixture.commands.push(structuredClone(command));await new Promise<void>(resolve=>{fail=resolve;});throw Error('Synthetic provider boundary refusal.');}return invoke(command);};
  await scope.getByText('Change Edit from Ready',{exact:true}).click();await scope.getByLabel('Edit from Ready reason',{exact:true}).fill('Compare the unapplied rule before a follow-up.');await scope.getByRole('textbox',{name:'Ask companion',exact:true}).fill('An unsent message owned by this task.');
  const before=await fixture.core.getTask(entry.task.id);await scope.getByRole('button',{name:'Ask',exact:true}).click();await expect(page.getByRole('dialog',{name:'Keep your unsaved edits?',exact:true})).toHaveCount(0);await expect.poll(()=>!!fail).toBe(true);fail!();await expect(scope.getByRole('alert')).toBeVisible();
  await expect(scope.getByRole('textbox',{name:'Ask companion',exact:true})).toHaveValue('An unsent message owned by this task.');await expect(scope.getByLabel('Edit from Ready reason',{exact:true})).toHaveValue('Compare the unapplied rule before a follow-up.');expect((await fixture.core.getTask(entry.task.id)).session?.moduleStates??[]).toEqual(before.session?.moduleStates??[]);
  await writeFile(`${evidence}/workflow-send-ledger.json`,JSON.stringify({task:await fixture.core.getTask(entry.task.id),commands:fixture.commands},null,2));
 }finally{fail?.();await fixture.close();}
});

test('a workflow phase change preserves an unrelated mounted lesson draft without prompting',async({page})=>{
 const entry=await openWorkflow(page),{fixture}=entry,workspace=page.locator('.workspace');
 try{
  await entry.scope.getByRole('button',{name:'Back to task',exact:true}).click();await workspace.getByRole('button',{name:'Task options',exact:true}).click();await workspace.getByRole('button',{name:'Files',exact:true}).click();const files=page.getByRole('dialog',{name:'Files',exact:true});await files.getByRole('button',{name:'New file',exact:true}).click();await files.getByRole('button',{name:'Workflow example',exact:true}).click();await page.getByRole('dialog',{name:'Document',exact:true}).getByRole('button',{name:'Back to task',exact:true}).click();
  const labs=workspace.getByRole('region',{name:'Workflow experiment',exact:true});await expect(labs).toHaveCount(2);const first=labs.nth(0),second=labs.nth(1);
  await first.getByText('Change Edit from Ready',{exact:true}).click();await first.getByLabel('Edit from Ready destination',{exact:true}).selectOption({label:'In review'});await first.getByLabel('Edit from Ready reason',{exact:true}).fill('Change only the first lesson.');await first.getByText('Change Edit from Ready',{exact:true}).locator('../..').getByRole('button',{name:'Apply rule',exact:true}).click();await first.getByRole('combobox',{name:'Final state',exact:true}).selectOption({label:'Ready'});await first.getByLabel('Blocked events',{exact:true}).fill('0');await first.getByRole('button',{name:'Check prediction',exact:true}).click();await expect(first.getByRole('heading',{name:'Final state: Ready',exact:true})).toBeVisible();
  await second.getByText('Change Edit from Ready',{exact:true}).click();await second.getByLabel('Edit from Ready reason',{exact:true}).fill('This separate lesson is still being edited.');const before=await fixture.core.getTask(entry.task.id);
  await first.getByRole('button',{name:'Try unseen transfer',exact:true}).click();await expect(first).toContainText('Unseen synthetic transfer');await expect(page.getByRole('dialog',{name:'Keep your unsaved edits?',exact:true})).toHaveCount(0);await expect(second.getByLabel('Edit from Ready reason',{exact:true})).toHaveValue('This separate lesson is still being edited.');
  await first.getByRole('button',{name:'Return to practice',exact:true}).click();await first.getByText('Change Edit from Ready',{exact:true}).click();await first.getByLabel('Edit from Ready reason',{exact:true}).fill('Keep only this lesson draft.');await first.getByRole('button',{name:'Open saved transfer',exact:true}).click();await expect(page.getByRole('dialog',{name:'Keep your unsaved edits?',exact:true})).toHaveCount(0);await expect(first).toContainText('Unseen synthetic transfer');await expect(second.getByLabel('Edit from Ready reason',{exact:true})).toHaveValue('This separate lesson is still being edited.');await first.getByRole('button',{name:'Return to practice',exact:true}).click();await first.getByText('Change Edit from Ready',{exact:true}).click();await expect(first.getByLabel('Edit from Ready reason',{exact:true})).toHaveValue('Keep only this lesson draft.');
  await workspace.getByRole('button',{name:'Task options',exact:true}).click();await workspace.getByRole('button',{name:'Files',exact:true}).click();await expect(page.getByRole('dialog',{name:'Keep your unsaved edits?',exact:true})).toHaveCount(0);const saved=page.getByRole('dialog',{name:'Files',exact:true});await saved.getByText('Unfinished practice',{exact:true}).click();await expect(saved.locator('article').filter({hasText:'Keep only this lesson draft.'})).toBeVisible();await expect(saved.locator('article').filter({hasText:'This separate lesson is still being edited.'})).toBeVisible();
  await writeFile(`${evidence}/workflow-unrelated-owner.json`,JSON.stringify({before,after:await fixture.core.getTask(entry.task.id),commands:fixture.commands},null,2));
 }finally{await fixture.close();}
});

test('mirrored phase change preserves the same lesson draft across surfaces',async({page})=>{
 const entry=await openWorkflow(page),{fixture}=entry;
 try{
  const doc=entry.scope;await doc.getByText('Change Edit from Ready',{exact:true}).click();await doc.getByLabel('Edit from Ready destination',{exact:true}).selectOption({label:'In review'});await doc.getByLabel('Edit from Ready reason',{exact:true}).fill('Unlock the separate transfer.');await doc.getByText('Change Edit from Ready',{exact:true}).locator('../..').getByRole('button',{name:'Apply rule',exact:true}).click();await doc.getByRole('combobox',{name:'Final state',exact:true}).selectOption({label:'Ready'});await doc.getByLabel('Blocked events',{exact:true}).fill('0');await doc.getByRole('button',{name:'Check prediction',exact:true}).click();await expect(doc.getByRole('heading',{name:'Final state: Ready',exact:true})).toBeVisible();await doc.getByRole('button',{name:'Back to task',exact:true}).click();
  const full=page.locator('.workspace').getByRole('region',{name:'Workflow experiment',exact:true});await full.getByText('Change Edit from Ready',{exact:true}).click();await full.getByLabel('Edit from Ready reason',{exact:true}).fill('An unsaved full-view note for the same lesson.');await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();const compact=page.locator('.compact-companion');
  await compact.getByRole('button',{name:'Try unseen transfer',exact:true}).click();await expect(page.getByRole('dialog',{name:'Keep your unsaved edits?',exact:true})).toHaveCount(0);await expect(compact).toContainText('Unseen synthetic transfer');await compact.getByRole('button',{name:'Return to practice',exact:true}).click();await compact.getByRole('button',{name:'Open task workspace',exact:true}).click();await full.getByText('Change Edit from Ready',{exact:true}).click();await expect(full.getByLabel('Edit from Ready reason',{exact:true})).toHaveValue('An unsaved full-view note for the same lesson.');
  expect(fixture.commands.filter(c=>c.type==='module.edit'&&c.action.kind==='start-transfer')).toHaveLength(1);await writeFile(`${evidence}/workflow-mirrored-owner.json`,JSON.stringify({task:await fixture.core.getTask(entry.task.id),commands:fixture.commands},null,2));
 }finally{await fixture.close();}
});

test('compact request preserves a hidden full-only draft without an unnecessary discard prompt',async({page})=>{
 const entry=await openWorkflow(page),{fixture}=entry;let fail:(()=>void)|undefined;
 try{
  fixture.configured=true;await fixture.restart();const full=page.locator('.workspace').getByRole('region',{name:'Workflow experiment',exact:true});await full.getByText('Change Edit from Ready',{exact:true}).click();await full.getByLabel('Edit from Ready reason',{exact:true}).fill('The full-view draft remains mounted through a compact request.');await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();const compact=page.locator('.compact-companion');
  const invoke=fixture.invoke.bind(fixture);fixture.invoke=async c=>{if(c.type==='model.run'){fixture.commands.push(structuredClone(c));await new Promise<void>(resolve=>{fail=resolve;});throw Error('Synthetic provider boundary refusal.');}return invoke(c);};
  await compact.getByRole('textbox',{name:'Ask companion',exact:true}).fill('Keep this owner message.');await compact.getByRole('button',{name:'Ask',exact:true}).click();await expect.poll(()=>!!fail).toBe(true);await expect(page.getByRole('dialog',{name:'Keep your unsaved edits?',exact:true})).toHaveCount(0);fail!();await expect(compact.getByRole('alert')).toBeVisible();await compact.getByRole('button',{name:'Open task workspace',exact:true}).click();await expect(full.getByLabel('Edit from Ready reason',{exact:true})).toHaveValue('The full-view draft remains mounted through a compact request.');
 }finally{fail?.();await fixture.close();}
});

test('compact browser refusal preserves its unapplied lesson draft',async({page})=>{
 const entry=await openWorkflow(page),{fixture}=entry;let fail:(()=>void)|undefined;
 try{
  await entry.scope.getByRole('button',{name:'Back to task',exact:true}).click();await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();const scope=page.locator('.compact-companion');await scope.getByText('Change Edit from Ready',{exact:true}).click();await scope.getByLabel('Edit from Ready reason',{exact:true}).fill('Keep this through a browser request.');
  const invoke=fixture.invoke.bind(fixture);fixture.invoke=async c=>{if(c.type==='browser.run'){fixture.commands.push(structuredClone(c));await new Promise<void>(resolve=>{fail=resolve;});throw Error('Synthetic browser transport disabled.');}return invoke(c);};
  const before=await fixture.core.getTask(entry.task.id);await scope.getByRole('button',{name:'Request options',exact:true}).click();await scope.getByRole('button',{name:'Use a browser',exact:true}).click();const start=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Which page should I use?',exact:true})});await start.getByLabel('Page address',{exact:true}).fill('https://example.com/owned-fixture');await start.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Keep your unsaved edits?',exact:true})).toHaveCount(0);await expect.poll(()=>!!fail).toBe(true);fail!();await expect(scope.getByRole('alert')).toBeVisible();await expect(scope.getByLabel('Edit from Ready reason',{exact:true})).toHaveValue('Keep this through a browser request.');expect((await fixture.core.getTask(entry.task.id)).session?.moduleStates??[]).toEqual(before.session?.moduleStates??[]);expect(fixture.commands.filter(c=>c.type==='browser.run')).toHaveLength(1);
 }finally{fail?.();await fixture.close();}
});

test('mirrored prediction shares the latest fields and commits once',async({page})=>{
 const entry=await openWorkflow(page),{fixture}=entry;
 try{
  await entry.scope.getByRole('button',{name:'Back to task',exact:true}).click();const full=page.locator('.workspace').getByRole('region',{name:'Workflow experiment',exact:true});await full.getByRole('combobox',{name:'Final state',exact:true}).selectOption({label:'Ready'});await full.getByLabel('Blocked events',{exact:true}).fill('0');await full.getByLabel('Prediction reasoning',{exact:true}).fill('My full-view prediction.');await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();const compact=page.locator('.compact-companion');
  await expect(compact.getByLabel('Prediction reasoning',{exact:true})).toHaveValue('My full-view prediction.');await compact.getByRole('combobox',{name:'Final state',exact:true}).selectOption({label:'Draft'});await compact.getByLabel('Blocked events',{exact:true}).fill('1');await compact.getByLabel('Prediction reasoning',{exact:true}).fill('The shared prediction I am submitting.');
  await compact.getByRole('button',{name:'Open task workspace',exact:true}).click();await expect(full.getByLabel('Blocked events',{exact:true})).toHaveValue('1');await expect(full.getByLabel('Prediction reasoning',{exact:true})).toHaveValue('The shared prediction I am submitting.');await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();
  await compact.getByRole('button',{name:'Check prediction',exact:true}).click();await expect(page.getByRole('dialog',{name:'Keep your unsaved edits?',exact:true})).toHaveCount(0);await expect(compact.getByRole('heading',{name:'Final state: Draft',exact:true})).toBeVisible();expect(fixture.commands.filter(c=>c.type==='module.edit'&&c.action.kind==='predict')).toHaveLength(1);
  await writeFile(`${evidence}/workflow-mirrored-prediction.json`,JSON.stringify({task:await fixture.core.getTask(entry.task.id),commands:fixture.commands},null,2));
 }finally{await fixture.close();}
});
for(const surface of ['full','compact'] as const){
 test(`SQL ${surface} restores an unapplied source correction and holds it when stale`,async({page})=>{
  const entry=await sourceJoinEntry(page),{fixture}=entry;
  try{
   let scope=page.locator('.workspace');if(surface==='compact'){await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:640});scope=page.locator('.compact-companion');}
   await scope.getByRole('button',{name:entry.label,exact:true}).click();await expect.poll(()=>entry.proposalPending()).toBe(true);entry.completeProposal();await expect(scope.getByRole('heading',{name:'Review the cited tables',exact:true})).toBeVisible();
   const value='Members row 2, Team corrected value',reason='Members row 2, Team correction reason',text='  Compare this correction before I apply it.  ';
   await scope.getByRole('textbox',{name:value,exact:true}).fill('x');await scope.getByRole('textbox',{name:reason,exact:true}).fill(text);const before=await fixture.core.getTask(entry.task.id);
   if(surface==='full')await page.getByRole('complementary',{name:'Task navigation',exact:true}).getByRole('button',{name:'Observatory visit',exact:true}).click();
   else{await scope.getByRole('button',{name:'Choose task: '+entry.task.title,exact:true}).click();await page.getByRole('dialog',{name:'Tasks',exact:true}).getByRole('button').filter({hasText:'Observatory visit'}).click();}
   await expect(page.getByRole('dialog',{name:'Keep your unsaved edits?',exact:true})).toHaveCount(0);
   if(surface==='full')await page.getByRole('complementary',{name:'Task navigation',exact:true}).getByRole('button',{name:entry.task.title,exact:true}).click();
   else{const workspace=page.locator('.workspace');await workspace.getByRole('button',{name:'Choose task',exact:true}).click();await page.getByRole('dialog',{name:'Tasks',exact:true}).getByRole('button').filter({hasText:entry.task.title}).click();await workspace.getByRole('button',{name:'Switch to compact companion',exact:true}).click();}
   await expect(scope.getByRole('textbox',{name:value,exact:true})).toHaveValue('x');await expect(scope.getByRole('textbox',{name:reason,exact:true})).toHaveValue(text);
   await fixture.flushDrafts();await fixture.restart();await page.setViewportSize({width:1080,height:800});scope=page.locator('.workspace');await expect(scope.getByRole('textbox',{name:reason,exact:true})).toHaveValue(text);
   await entry.changedSource();await expect(scope.getByRole('alert')).toContainText('current-source editing is unavailable');await expect(scope.getByRole('textbox',{name:value,exact:true})).toBeDisabled();await expect(scope.getByRole('textbox',{name:value,exact:true})).toHaveValue('x');await expect(scope.getByRole('textbox',{name:reason,exact:true})).toHaveValue(text);
   expect((await fixture.core.getTask(entry.task.id)).session?.moduleStates??[]).toEqual(before.session?.moduleStates??[]);expect(entry.counters.modelRequests).toHaveLength(1);
   await writeFile(`${evidence}/sql-${surface}-green.json`,JSON.stringify({before,after:await fixture.core.getTask(entry.task.id),commands:fixture.commands,counters:entry.counters},null,2));
  }finally{await fixture.close();}
 });
}
