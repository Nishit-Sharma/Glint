import {expect,test,type Locator} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {sourceJoinEntry} from './source-join-entry.fixture';
import {pickingPublicFrame as frame} from './picking-public-frame';

async function review(scope:Locator){
 for(const name of ['Members.Team','Invitations.Team']){
  await scope.getByRole('combobox',{name:name+' column type',exact:true}).selectOption('string');
  const reason=scope.getByRole('textbox',{name:name+' type reason',exact:true});await reason.fill('Reviewed as text in this synthetic source.');
  await reason.locator('xpath=ancestor::form').getByRole('button',{name:'Confirm type',exact:true}).click();
 }
 await scope.getByRole('textbox',{name:'Members row 2, Team corrected value',exact:true}).fill('x');
 const reason=scope.getByRole('textbox',{name:'Members row 2, Team correction reason',exact:true});await reason.fill('User supplies x for the unreadable Team value.');
 await reason.locator('xpath=ancestor::form').getByRole('button',{name:'Apply correction',exact:true}).click();
 for(const [label,value] of [['Reviewed join type','INNER'],['Reviewed left key','p-key'],['Reviewed right key','p-rkey']]){
  const select=scope.locator('label').filter({hasText:new RegExp('^'+label)}).locator('select');await expect(select).toHaveCount(1);await select.selectOption(value);
 }
 await scope.getByRole('textbox',{name:'Why these keys?',exact:true}).fill('User chooses equality on the Team columns.');
 await scope.getByRole('button',{name:'Confirm join condition',exact:true}).click();
 await scope.getByRole('button',{name:'Accept reviewed extraction and experiment',exact:true}).click();
}
async function predict(scope:Locator,count:string,actual:string){
 await scope.getByLabel('Predict the output row count',{exact:true}).fill(count);
 await scope.getByRole('button',{name:'Check prediction',exact:true}).click();
 await expect(scope.getByRole('heading',{name:actual+' output rows',exact:true})).toBeVisible();
}

test('checked source join traces exact row contributions through edits, compact viewing and saved reopening',async({page})=>{
 const entry=await sourceJoinEntry(page),{fixture}=entry,frames:Awaited<ReturnType<typeof frame>>[]=[];
 let scope=page.locator('.workspace');
 const trace=()=>scope.locator('details.join-row-trace');
 const select=()=>trace().getByLabel('Choose a left input row',{exact:true});
 const capture=async(anchor:Locator,name:string)=>frames.push(await frame(page,anchor,name));
 try{
  await scope.getByRole('button',{name:entry.label,exact:true}).click();await expect.poll(()=>entry.proposalPending()).toBe(true);
  await expect(trace()).toHaveCount(0);entry.completeProposal();await review(scope);
  await expect(trace()).toHaveCount(0);await predict(scope,'3','4');
  await expect(trace()).toHaveAttribute('open','');
  await expect(trace()).toContainText('Members row 1 contributes 2 of the 4 output rows.');
  await expect(trace().getByRole('list',{name:'Key comparisons for Members row 1',exact:true}).getByText('Match · 1 pair',{exact:true})).toHaveCount(2);
  await capture(trace().locator('.join-row-trace-result'),'01-full-duplicate-contribution');
  await capture(trace().getByRole('list',{name:'Key comparisons for Members row 1',exact:true}),'02-full-exact-comparisons');
  const beforeSelection=await fixture.core.getTask(entry.task.id),commandCount=fixture.commands.length;
  await select().selectOption('practice-null');
  await expect(trace()).toContainText('Members row 3 contributes 0 of the 4 output rows.');
  await expect(trace()).toContainText('Equality is unknown, including when the right key is also NULL. INNER leaves this left row out.');
  await expect(trace().getByText('Unknown (NULL)',{exact:true})).toHaveCount(4);
  expect((await fixture.core.getTask(entry.task.id)).session?.moduleStates).toEqual(beforeSelection.session?.moduleStates);expect(fixture.commands).toHaveLength(commandCount);
  await capture(trace().locator('.join-row-trace-result'),'03-full-inner-null');
  await scope.getByRole('combobox',{name:'Join type',exact:true}).selectOption('LEFT');await expect(trace()).toHaveCount(0);await predict(scope,'4','5');
  await select().selectOption('practice-null');await expect(trace()).toContainText('Members row 3 contributes 1 of the 5 output rows.');
  await expect(trace()).toContainText('LEFT keeps this left row once, with NULL values for the right columns.');
  await capture(trace().locator('.join-row-trace-result'),'04-full-left-null');
  const team=scope.getByRole('textbox',{name:'Members row 2 Team',exact:true});await team.fill('y');await team.locator('xpath=ancestor::tr').getByRole('button',{name:'Apply row',exact:true}).click();
  await expect(trace()).toHaveCount(0);await predict(scope,'5','4');await select().selectOption('practice-b');
  await expect(trace()).toContainText('Members row 2 contributes 1 of the 4 output rows.');await expect(trace()).toContainText('No right row has an equal non-NULL key.');
  await expect(trace().getByText('Different key',{exact:true})).toHaveCount(3);await expect(trace().getByText('Unknown (NULL)',{exact:true})).toHaveCount(1);
  await capture(trace().locator('.join-row-trace-result'),'05-full-left-unmatched');
  const checked=await fixture.core.getTask(entry.task.id),modelCount=entry.counters.modelRequests.length;
  await scope.getByRole('button',{name:'Save as document',exact:true}).click();const notes=page.getByRole('dialog',{name:'Document',exact:true});await expect(notes).toBeVisible();
  const saved=await fixture.core.getTask(entry.task.id),text=saved.artifacts.find(artifact=>artifact.revisions.at(-1)?.mimeType==='text/markdown')!.revisions.at(-1)!.content;
  expect(text).toContain('contributes 1 row(s)');expect(text).toContain('NULL');expect(text).not.toContain('Shipments');
  await notes.getByRole('button',{name:'Back to task',exact:true}).click();await fixture.restart();
  await expect(trace()).toContainText('Members row 1 contributes 2 of the 4 output rows.');expect((await fixture.core.getTask(entry.task.id)).session?.moduleStates).toEqual(checked.session?.moduleStates);expect(entry.counters.modelRequests).toHaveLength(modelCount);
  await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:640});scope=page.locator('.compact-companion');
  await expect(select()).toHaveValue('practice-a');await expect(select()).toBeVisible();await expect(select()).toBeEnabled();
  // This distinct case covers controlled selection and the remaining outcome.
  // The preserved native-keyboard failures remain an open acceptance gate.
  const selectionCommands=fixture.commands.length,selectionState=(await fixture.core.getTask(entry.task.id)).session?.moduleStates;
  await select().selectOption('practice-b');await expect(select()).toHaveValue('practice-b');
  expect(fixture.commands).toHaveLength(selectionCommands);expect((await fixture.core.getTask(entry.task.id)).session?.moduleStates).toEqual(selectionState);
  await expect(trace()).toContainText('Members row 2 contributes 1 of the 4 output rows.');await capture(trace().locator('.join-row-trace-result'),'06-compact-unmatched');
  await capture(trace().getByRole('list',{name:'Key comparisons for Members row 2',exact:true}),'07-compact-exact-comparisons');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await scope.getByRole('button',{name:'Try unseen transfer',exact:true}).click();await expect(trace()).toHaveCount(0);await expect(scope).not.toContainText('Transfer score:');
  await predict(scope,'5','6');await expect(trace()).toContainText('Shipments row 1 contributes 2 of the 6 output rows.');await capture(trace().locator('.join-row-trace-result'),'08-compact-first-transfer');
  expect(fixture.external).toEqual([]);expect(entry.counters.modelRequests).toHaveLength(modelCount);
  expect(fixture.commands.filter(command=>command.type==='browser.run'||command.type==='connection.configure'||/^(?:windows\.capture|context\.(?:start|capture)|export\.)/.test(command.type))).toEqual([]);
 }finally{
  try{await writeFile(test.info().outputPath('row-trace-before-close.json'),JSON.stringify({boundary:'Actual App/core/cache/sidecar; synthetic source/provider transport, controlled selection and controlled core recreation. Physical keyboard, native popup selection and native restart are unverified.',task:await fixture.core.getTask(entry.task.id),commands:fixture.commands,counters:entry.counters,frames},null,2)+'\n');}finally{await fixture.close();}
 }
});
