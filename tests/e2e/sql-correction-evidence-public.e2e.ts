import {expect,test,type Locator} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {sourceJoinEntry} from '../support/source-join-entry.fixture';
import {pickingPublicFrame as frame} from '../support/picking-public-frame';
import {MODULE_MIME} from '../../src/shared/module-contract';

test.use({viewport:{width:1080,height:800}});

// Same public source-action/review seam as source-join-entry.e2e.ts. Sources and
// provider replies are declared synthetic; the App, core and saved state are real.
async function review(scope:Locator){
 for(const name of ['Members.Team','Invitations.Team']){
  await scope.getByRole('combobox',{name:name+' column type',exact:true}).selectOption('string');
  const reason=scope.getByRole('textbox',{name:name+' type reason',exact:true});await reason.fill('Reviewed as text in this synthetic source.');
  await reason.locator('xpath=ancestor::form').getByRole('button',{name:'Confirm type',exact:true}).click();
 }
 await scope.getByRole('textbox',{name:'Members row 2, Team corrected value',exact:true}).fill('x');
 const reason=scope.getByRole('textbox',{name:'Members row 2, Team correction reason',exact:true});await reason.fill('User supplies x for the unreadable Team value.');
 await reason.locator('xpath=ancestor::form').getByRole('button',{name:'Apply correction',exact:true}).click();
 // Prefix-scoped native selects: these wrapping labels include their options in
 // accessible names. Require exactly one enabled select; never choose first().
 for(const [label,value] of [['Reviewed join type','INNER'],['Reviewed left key','p-key'],['Reviewed right key','p-rkey']]){
  const select=scope.locator('label').filter({hasText:new RegExp('^'+label)}).locator('select');
  await expect(select).toHaveCount(1);await expect(select).toBeVisible();await expect(select).toBeEnabled();await select.selectOption(value);
 }
 await scope.getByRole('textbox',{name:'Why these keys?',exact:true}).fill('User chooses equality on the Team columns.');
 await scope.getByRole('button',{name:'Confirm join condition',exact:true}).click();

}
async function predict(scope:Locator,count:string,actual:string,reason?:string){
 await scope.getByLabel('Predict the output row count',{exact:true}).fill(count);
 if(reason)await scope.getByRole('textbox',{name:'Why? (recorded, not graded)',exact:true}).fill(reason);
 await scope.getByRole('button',{name:'Check prediction',exact:true}).click();
 await expect(scope.getByRole('heading',{name:actual+' output rows',exact:true})).toBeVisible();
}
test('inspect a corrected cell against its saved source evidence through a join change and reopen',async({page})=>{
 const entry=await sourceJoinEntry(page,'sql',Number(process.env.WINDOW_COMPANION_TEST_PORT??4180)),{fixture}=entry,frames:Awaited<ReturnType<typeof frame>>[]=[];let scope=page.locator('.workspace');const evidence=()=>scope.getByRole('region',{name:'Saved cell corrections and evidence',exact:true});
 try{
  await scope.getByRole('button',{name:entry.label,exact:true}).click();await expect.poll(()=>entry.proposalPending()).toBe(true);entry.completeProposal();await expect(scope.getByRole('heading',{name:'Review the cited tables',exact:true})).toBeVisible();await review(scope);
  // Retraction uses the real module.edit/store path; original unresolved data returns.
  await scope.getByText('Review saved cell corrections (1)',{exact:true}).click();
  const restoreValue=scope.getByRole('button',{name:'Restore original value for Members row 2, Team',exact:true});
  await expect(restoreValue).toBeVisible();frames.push(await frame(page,restoreValue,'00-restore-value'));
  await page.setViewportSize({width:360,height:640});frames.push(await frame(page,restoreValue,'00-restore-value-narrow'));await page.setViewportSize({width:1080,height:800});
  await restoreValue.click();await expect(scope.getByRole('button',{name:'Accept reviewed extraction and experiment',exact:true})).toBeDisabled();
  for(const name of ['Members.Team','Invitations.Team']){
   const type=scope.getByRole('combobox',{name:name+' column type',exact:true,includeHidden:true});
   await type.locator('xpath=ancestor::details').locator('summary').click();
   await scope.getByRole('button',{name:'Restore original type for '+name,exact:true}).click();
   await expect(type).toHaveValue('');
  }
  const restoreKeys=scope.getByRole('button',{name:'Restore original join condition',exact:true,includeHidden:true});
  await restoreKeys.locator('xpath=ancestor::details').locator('summary').click();await restoreKeys.click();
  const retracted=await fixture.core.getTask(entry.task.id),reviewState=retracted.session!.moduleStates[0].state;
  expect(reviewState).toMatchObject({cellCorrections:[],typeCorrections:[],keyCorrection:null,lab:null});
  await fixture.restart();scope=page.locator('.workspace');
  expect((await fixture.core.getTask(entry.task.id)).session!.moduleStates[0].state).toEqual(reviewState);
  await review(scope);await scope.getByText('Review saved cell corrections (1)',{exact:true}).click();await expect(evidence()).toContainText('Original extraction: unreadable');await expect(evidence()).toContainText('Synthetic supplied Members and invitations, version 1');await expect(evidence()).toContainText('User supplies x for the unreadable Team value.');await expect(evidence().locator('q')).toHaveText('?');frames.push(await frame(page,evidence().getByRole('heading',{name:'Members row 2, Team',exact:true}),'01-correction-heading'));frames.push(await frame(page,evidence().getByText('User supplies x for the unreadable Team value.',{exact:false}),'02-correction-reason'));
  await page.setViewportSize({width:360,height:640});frames.push(await frame(page,evidence().getByText('User supplies x for the unreadable Team value.',{exact:false}),'03-correction-narrow'));await page.setViewportSize({width:1080,height:800});await scope.getByRole('button',{name:'Accept reviewed extraction and experiment',exact:true}).click();await predict(scope,'4','4','My source-bound prediction.');await scope.getByRole('combobox',{name:'Join type',exact:true}).selectOption('LEFT');await predict(scope,'4','5','Changing join retains unmatched rows.');await expect(scope.getByRole('region',{name:'Last applied join change',exact:true})).toBeVisible();const before=await fixture.core.getTask(entry.task.id),module=before.artifacts.find(a=>a.revisions.at(-1)?.mimeType===MODULE_MIME)!,states=structuredClone(before.session!.moduleStates);expect(module.revisions[0].sourceRefs).toEqual(entry.refs);
  await fixture.restart();scope=page.locator('.workspace');await scope.getByText('Review saved cell corrections (1)',{exact:true}).click();await expect(evidence()).toContainText('Original extraction: unreadable');await expect(evidence()).toContainText('Synthetic supplied Members and invitations, version 1');await expect(evidence()).toContainText('User supplies x for the unreadable Team value.');frames.push(await frame(page,evidence().getByText('User supplies x for the unreadable Team value.',{exact:false}),'04-reopened-correction'));const reopened=await fixture.core.getTask(entry.task.id);expect(reopened.session!.moduleStates).toEqual(states);expect(reopened.artifacts.find(a=>a.id===module.id)).toEqual(module);
  await entry.changedSource();await expect(scope.getByRole('region',{name:'Source-grounded join',exact:true}).getByRole('alert')).toContainText(/source|changed/i);await expect(evidence()).toContainText('version 1');await expect(evidence()).toContainText('User supplies x for the unreadable Team value.');frames.push(await frame(page,scope.getByRole('region',{name:'Source-grounded join',exact:true}).getByRole('alert'),'05-historical'));expect((await fixture.core.getTask(entry.task.id)).session!.moduleStates).toEqual(states);expect(entry.counters.modelRequests).toHaveLength(1);expect(fixture.external).toEqual([]);
 }finally{try{const path=test.info().outputPath('sql-correction-evidence.json');await writeFile(path,JSON.stringify({scope:'Synthetic source and provider proposal with actual App/core and controlled recreation. Saved citations and corrections only; no live source, native OCR, SQL database, unseen transfer or mastery claim.',frames,commands:fixture.commands},null,2));await test.info().attach('sql-correction-evidence',{path,contentType:'application/json'});}finally{await fixture.close();}}
});
