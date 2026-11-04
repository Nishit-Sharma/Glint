import {expect,test} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {sourceJoinEntry} from '../support/source-join-entry.fixture';
import {workflowEntry} from '../support/workflow-entry.fixture';

const evidence=process.env.LEARNING_DRAFT_EVIDENCE??'evidence/learning-draft-basis-blocked';
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true});});

test('SQL prediction is held visibly until the earlier basis is discarded',async({page})=>{
 const entry=await sourceJoinEntry(page),{fixture}=entry,scope=page.locator('.workspace');
 try{
  // Existing synthetic source/provider fixture; review and mutation use the real UI.
  await scope.getByRole('button',{name:entry.label,exact:true}).click();await expect.poll(()=>entry.proposalPending()).toBe(true);entry.completeProposal();
  for(const name of ['Members.Team','Invitations.Team']){
   await scope.getByRole('combobox',{name:name+' column type',exact:true}).selectOption('string');
   const reason=scope.getByLabel(name+' type reason',{exact:true});await reason.fill('Reviewed as text.');await reason.locator('xpath=ancestor::form').getByRole('button',{name:'Confirm type',exact:true}).click();
  }
  await scope.getByLabel('Members row 2, Team corrected value',{exact:true}).fill('x');
  const correction=scope.getByLabel('Members row 2, Team correction reason',{exact:true});await correction.fill('Reviewed synthetic value.');await correction.locator('xpath=ancestor::form').getByRole('button',{name:'Apply correction',exact:true}).click();
  await scope.getByRole('combobox',{name:'Reviewed join type',exact:true}).selectOption('INNER');await scope.getByRole('combobox',{name:'Reviewed left key',exact:true}).selectOption('p-key');await scope.getByRole('combobox',{name:'Reviewed right key',exact:true}).selectOption('p-rkey');
  await scope.getByLabel('Why these keys?',{exact:true}).fill('Use the displayed keys.');await scope.getByRole('button',{name:'Confirm join condition',exact:true}).click();
  await scope.getByRole('button',{name:'Accept reviewed extraction and experiment',exact:true}).click();
  const count=scope.getByLabel('Predict the output row count',{exact:true}),why=scope.getByRole('textbox',{name:'Why? (recorded, not graded)',exact:true});
  await count.fill('0');await why.fill('Earlier prediction on the original rows.');await fixture.flushDrafts();
  const row=scope.getByRole('textbox',{name:'Members row 1 Team',exact:true});await row.fill('z');await row.locator('xpath=ancestor::tr').getByRole('button',{name:'Apply row',exact:true}).click();
  const recovery=scope.locator('.learning-draft-recovery');await expect(recovery).toBeVisible();
  await recovery.scrollIntoViewIfNeeded();await page.screenshot({path:join(evidence,'sql-before-resolution.png')});
  const enabled=await count.isEnabled();let attempted:string|null=null;
  if(enabled){attempted='7';await count.fill(attempted);await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));}
  await writeFile(join(evidence,'sql-inert-input.json'),JSON.stringify({enabled,attempted,readBack:await count.inputValue()},null,2));
  await expect(count).toHaveValue('');await expect(count).toBeDisabled();await expect(why).toBeDisabled();
  await expect(scope.getByRole('button',{name:'Check prediction',exact:true})).toBeDisabled();
  await expect(count.locator('xpath=ancestor::form').getByText(/(review|resolv).*(before|first)|(before|first).*(review|resolv)|held.*(review|resolv)/i)).toBeVisible();
  expect(fixture.commands.filter(command=>command.type==='module.edit'&&command.action.kind==='lab'&&command.action.action.kind==='predict')).toHaveLength(0);
  await recovery.locator('summary').click();await expect(recovery).toContainText('Earlier prediction on the original rows.');
  await recovery.getByRole('button',{name:'Discard earlier unapplied edits',exact:true}).click();
  await expect(count).toBeEnabled();await expect(count).toHaveValue('');await expect(why).toHaveValue('');
  await count.fill('1');await why.fill('New prediction on the changed rows.');await scope.getByRole('button',{name:'Check prediction',exact:true}).click();
  await expect(scope.getByRole('region',{name:'Computed result',exact:true})).toBeVisible();
  const predictions=fixture.commands.filter(command=>command.type==='module.edit'&&command.action.kind==='lab'&&command.action.action.kind==='predict');
  expect(predictions).toHaveLength(1);
  const action=predictions[0];if(action.type!=='module.edit'||action.action.kind!=='lab'||action.action.action.kind!=='predict')throw Error('Expected the SQL prediction action.');
  expect(action.action.action.count).toBe(1);expect(action.action.action.reasoning).toBe('New prediction on the changed rows.');
 }finally{await fixture.close();}
});

test('workflow prediction is held visibly until the earlier basis is discarded',async({page})=>{
 const entry=await workflowEntry(page),{fixture}=entry,workspace=page.locator('.workspace');
 try{
  await workspace.getByRole('button',{name:'Task options',exact:true}).click();await workspace.getByRole('button',{name:'Files',exact:true}).click();
  const files=page.getByRole('dialog',{name:'Files',exact:true});await files.getByRole('button',{name:'New file',exact:true}).click();await files.getByRole('button',{name:'Workflow example',exact:true}).click();
  const scope=page.getByRole('dialog',{name:'Document',exact:true});
  const state=scope.getByRole('combobox',{name:'Final state',exact:true}),blocked=scope.getByLabel('Blocked events',{exact:true}),why=scope.getByLabel('Prediction reasoning',{exact:true});
  await state.selectOption({label:'Ready'});await blocked.fill('0');await why.fill('Earlier prediction on the original rules.');await fixture.flushDrafts();
  await scope.getByText('Change Edit from Ready',{exact:true}).click();await scope.getByLabel('Edit from Ready destination',{exact:true}).selectOption({label:'In review'});
  await scope.getByLabel('Edit from Ready reason',{exact:true}).fill('Change the problem.');await scope.getByRole('button',{name:'Apply rule',exact:true}).click();
  const recovery=scope.locator('.learning-draft-recovery');await expect(recovery).toBeVisible();await recovery.scrollIntoViewIfNeeded();await page.screenshot({path:join(evidence,'workflow-before-resolution.png')});
  const enabled=await state.isEnabled();let attempted:string|null=null;
  if(enabled){[attempted]=await state.selectOption({label:'In review'});await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));}
  await writeFile(join(evidence,'workflow-inert-input.json'),JSON.stringify({enabled,attempted,readBack:await state.inputValue()},null,2));
  await expect(state).toHaveValue('');await expect(state).toBeDisabled();await expect(blocked).toBeDisabled();await expect(why).toBeDisabled();
  await expect(scope.getByRole('button',{name:'Check prediction',exact:true})).toBeDisabled();await expect(state.locator('xpath=ancestor::form').getByText(/(review|resolv).*(before|first)|(before|first).*(review|resolv)|held.*(review|resolv)/i)).toBeVisible();
  expect(fixture.commands.filter(command=>command.type==='module.edit'&&command.action.kind==='predict')).toHaveLength(0);
  await recovery.locator('summary').click();await expect(recovery).toContainText('Earlier prediction on the original rules.');
  await recovery.getByRole('button',{name:'Discard earlier unapplied edits',exact:true}).click();
  await expect(state).toBeEnabled();await expect(state).toHaveValue('');await expect(blocked).toHaveValue('');await expect(why).toHaveValue('');
  await state.selectOption({label:'Ready'});await blocked.fill('1');await why.fill('New prediction on the changed rules.');await scope.getByRole('button',{name:'Check prediction',exact:true}).click();
  await expect(scope.getByRole('region',{name:'Computed workflow result',exact:true})).toBeVisible();
  const predictions=fixture.commands.filter(command=>command.type==='module.edit'&&command.action.kind==='predict');expect(predictions).toHaveLength(1);
  const action=predictions[0];if(action.type!=='module.edit'||action.action.kind!=='predict'||!('blockedCount' in action.action))throw Error('Expected the workflow prediction action.');
  expect(action.action.blockedCount).toBe(1);expect(action.action.reasoning).toBe('New prediction on the changed rules.');
 }finally{await fixture.close();}
});
