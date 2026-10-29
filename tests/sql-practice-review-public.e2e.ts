import {expect,test,type Locator} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {sourceJoinEntry} from './source-join-entry.fixture';
import {pickingPublicFrame as frame} from './picking-public-frame';
import {MODULE_MIME} from '../src/shared/module-contract';

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
 await scope.getByRole('button',{name:'Accept reviewed extraction and experiment',exact:true}).click();
 await expect(scope.getByRole('textbox',{name:'Members row 2 Team',exact:true})).toHaveValue('x');
}
async function predict(scope:Locator,count:string,actual:string,reason?:string){
 await scope.getByLabel('Predict the output row count',{exact:true}).fill(count);
 if(reason)await scope.getByRole('textbox',{name:'Why? (recorded, not graded)',exact:true}).fill(reason);
 await scope.getByRole('button',{name:'Check prediction',exact:true}).click();
 await expect(scope.getByRole('heading',{name:actual+' output rows',exact:true})).toBeVisible();
}
test('review the saved source-bound practice while a separate challenge awaits an answer',async({page})=>{
 const entry=await sourceJoinEntry(page,'sql',Number(process.env.WINDOW_COMPANION_TEST_PORT??4180)),{fixture}=entry,frames:Awaited<ReturnType<typeof frame>>[]=[];let scope=page.locator('.workspace');
 const capture=async(anchor:Locator,name:string,expected?:string)=>frames.push(await frame(page,anchor,name,expected?[{locator:anchor,kind:'text',expected,name}]:[]));
 const prior=()=>scope.getByRole('region',{name:'Saved practice before challenge',exact:true});
 try{
  await scope.getByRole('button',{name:entry.label,exact:true}).click();await expect.poll(()=>entry.proposalPending()).toBe(true);entry.completeProposal();await expect(scope.getByRole('heading',{name:'Review the cited tables',exact:true})).toBeVisible();await review(scope);await predict(scope,'4','4');
  await scope.getByRole('combobox',{name:'Join type',exact:true}).selectOption('LEFT');await predict(scope,'4','5');const team=scope.getByRole('textbox',{name:'Members row 2 Team',exact:true});await team.fill('y');await team.locator('xpath=ancestor::tr').getByRole('button',{name:'Apply row',exact:true}).click();await predict(scope,'5','4','My saved practice reason.');
  await scope.getByRole('button',{name:'Try separate challenge',exact:true}).click();await expect(scope.getByRole('heading',{name:'Separate synthetic challenge',exact:true})).toBeVisible();await expect(scope).toContainText('Earlier exposure is not tracked.');await expect(scope.getByRole('region',{name:'Computed result',exact:true})).toHaveCount(0);await expect(scope).not.toContainText('6 output rows');await expect(scope).not.toContainText('Transfer score:');await capture(scope.getByRole('heading',{name:'Separate synthetic challenge',exact:true}),'01-separate-challenge','Separate synthetic challenge');
  const summary=scope.getByText('Review saved practice',{exact:true});await summary.click();await expect(prior()).toBeVisible();const result='Practice prediction: 5. Checked practice result: 4 rows.';await expect(prior()).toContainText(result);await expect(prior()).toContainText('My saved practice reason.');await expect(prior()).toContainText('LEFT equality on Members.Team = Invitations.Team.');await expect(prior()).toContainText('Members row 2: no equal non-NULL right key; contributes 1 row.');await capture(prior().getByText(result,{exact:true}),'02-practice-result',result);
  const members=prior().getByRole('region',{name:'Saved practice Members table',exact:true});await expect(members.getByRole('row').nth(2)).toContainText('"y"');await capture(members.getByRole('row').nth(2),'03-applied-practice-row');await expect(scope.getByRole('region',{name:'Computed result',exact:true})).toHaveCount(0);await expect(scope).not.toContainText('6 output rows');
  const before=await fixture.core.getTask(entry.task.id),module=before.artifacts.find(a=>a.revisions.at(-1)?.mimeType===MODULE_MIME)!,pending=structuredClone(before.session?.moduleStates);expect(module.revisions[0].sourceRefs).toEqual(entry.refs);
  await fixture.restart();scope=page.locator('.workspace');await expect(scope.getByRole('heading',{name:'Separate synthetic challenge',exact:true})).toBeVisible();await expect(scope.getByRole('region',{name:'Computed result',exact:true})).toHaveCount(0);await scope.getByText('Review saved practice',{exact:true}).click();await expect(prior()).toContainText(result);expect((await fixture.core.getTask(entry.task.id)).session?.moduleStates).toEqual(pending);
  await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:640});scope=page.locator('.compact-companion');await scope.getByText('Review saved practice',{exact:true}).click();await expect(prior()).toContainText(result);const row=prior().getByRole('list',{name:'Saved practice row contributions',exact:true}).getByRole('listitem').filter({hasText:'Members row 2:'});await capture(row,'04-compact-practice-contribution');await expect(scope).not.toContainText('6 output rows');
  await predict(scope,'5','6','My separate challenge reason.');await expect(scope).toContainText('Transfer score: 0 / 1');await capture(scope.getByText('Transfer score: 0 / 1 for the first row-count prediction. Reasoning is ungraded. This is an observed attempt, not a claim of lasting learning.',{exact:true}),'05-checked-challenge');
  await scope.getByRole('button',{name:'Save as document',exact:true}).click();const notes=page.getByRole('dialog',{name:'Document',exact:true});await expect(notes).toContainText('My separate challenge reason.');await expect(notes).toContainText('My saved practice reason.');const saved=await fixture.core.getTask(entry.task.id),checked=structuredClone(saved.session?.moduleStates),document=saved.artifacts.find(a=>a.revisions.at(-1)?.mimeType==='text/markdown')!;expect(document.revisions.at(-1)!.sourceRefs).toEqual(entry.refs);await notes.getByRole('button',{name:'Back to task',exact:true}).click();
  await fixture.restart();scope=page.locator('.workspace');await expect(scope).toContainText('Transfer score: 0 / 1');await scope.getByText('Review saved practice',{exact:true}).click();await expect(prior()).toContainText(result);await capture(prior().getByText(result,{exact:true}),'06-reopened-practice',result);const reopened=await fixture.core.getTask(entry.task.id);expect(reopened.session?.moduleStates).toEqual(checked);expect(reopened.artifacts.find(a=>a.id===module.id)!.revisions).toEqual(module.revisions);
  await entry.changedSource();await expect(scope.getByRole('alert')).toContainText(/source|changed/i);await expect(scope.getByRole('button',{name:'Quick',exact:true})).toBeDisabled();await expect(prior()).toContainText(result);await capture(scope.getByRole('alert'),'07-stale-source');expect((await fixture.core.getTask(entry.task.id)).session?.moduleStates).toEqual(checked);expect(entry.counters.modelRequests).toHaveLength(1);expect(fixture.external).toEqual([]);
 }finally{
  try{const snapshot=await fixture.core.getTask(entry.task.id),path=test.info().outputPath('sql-practice-review-boundary.json');await writeFile(path,JSON.stringify({scope:'Controlled synthetic source/provider response, actual App/core and core recreation plus renderer reload. No native capture, live provider, unseen-exposure or mastery claim.',snapshot,commands:fixture.commands,counters:entry.counters,frames},null,2));await test.info().attach('sql-practice-review-boundary',{path,contentType:'application/json'});}finally{await fixture.close();}
 }
});
