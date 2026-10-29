import {expect,test,type Locator} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {sourceJoinEntry} from './source-join-entry.fixture';
import {pickingPublicFrame as frame} from './picking-public-frame';
import {MODULE_MIME} from '../src/shared/module-contract';

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
const summary='Last applied practice change: 5 → 4 output rows.';
const edited='Members row 2, Team: "x" → "y".';
const effects='Added 1, removed 2, changed displayed values in 0 pair(s).';

test('source join explains the last applied edit, saves and resumes it without revealing the first transfer answer',async({page})=>{
 const entry=await sourceJoinEntry(page),{fixture}=entry;
 const frames:Awaited<ReturnType<typeof frame>>[]=[];
 let scope=page.locator('.workspace');
 const comparison=()=>scope.getByRole('region',{name:'Last applied join change',exact:true});
 const capture=async(anchor:Locator,name:string,expected?:string)=>frames.push(await frame(page,anchor,name,expected?[{locator:anchor,kind:'text',expected,name}]:[]));
 try{
  await scope.getByRole('button',{name:entry.label,exact:true}).click();
  await expect.poll(()=>entry.proposalPending()).toBe(true);entry.completeProposal();
  await expect(scope.getByRole('heading',{name:'Review the cited tables',exact:true})).toBeVisible();
  await review(scope);await predict(scope,'4','4');
  await scope.getByRole('combobox',{name:'Join type',exact:true}).selectOption('LEFT');await predict(scope,'4','5');
  const team=scope.getByRole('textbox',{name:'Members row 2 Team',exact:true});await team.fill('y');
  await team.locator('xpath=ancestor::tr').getByRole('button',{name:'Apply row',exact:true}).click();
  await expect(scope.getByRole('region',{name:'Computed result',exact:true})).toHaveCount(0);await expect(comparison()).toHaveCount(0);
  await predict(scope,'5','4');
  await expect(scope.getByLabel('Computed change summary',{exact:true})).toContainText('Compared with reviewed practice: 4 → 4 rows');
  await expect(comparison().getByRole('list',{name:'Changed join inputs',exact:true})).toHaveText(edited);
  await expect(comparison()).toContainText(effects);await expect(comparison()).toContainText('hypothetical local practice edits');
  await capture(comparison().getByText(summary,{exact:true}),'01-full-quick-last-change',summary);
  await comparison().getByText('Changed result pairs',{exact:true}).click();
  for(const text of ['Added: Members row 2 → No matching right row (NULL-extended)','Removed: Members row 2 → Invitations row 1','Removed: Members row 2 → Invitations row 2'])await expect(comparison().getByRole('listitem').filter({hasText:text})).toHaveText(text);
  await scope.getByRole('button',{name:'Deep',exact:true}).click();
  const why=comparison().getByRole('list',{name:'Why the join rows changed',exact:true});await expect(why.getByRole('listitem')).toHaveCount(1);
  await expect(why).toContainText('before "x" matches Invitations row 1, Invitations row 2; 2 output row(s); after "y" has no equal non-NULL right key; 1 output row(s) because LEFT preserves the unmatched left row');
  await expect(comparison()).toContainText('Unchanged output contributions: Members row 1, Members row 3.');
  await capture(why.getByRole('listitem'),'02-full-deep-row-cause');
  await scope.getByRole('button',{name:'Visual',exact:true}).click();
  await capture(comparison().getByRole('region',{name:'Members row 2 pair comparison',exact:true}),'03-full-visual-pairs');
  const beforeSave=await fixture.core.getTask(entry.task.id),module=beforeSave.artifacts.find(artifact=>artifact.revisions.at(-1)?.mimeType===MODULE_MIME)!;
  expect(module).toBeDefined();const practiceState=structuredClone(beforeSave.session?.moduleStates);
  await scope.getByRole('button',{name:'Save as document',exact:true}).click();
  const notesDialog=page.getByRole('dialog',{name:'Document',exact:true});await expect(notesDialog).toBeVisible();
  const saved=await fixture.core.getTask(entry.task.id),notes=saved.artifacts.find(artifact=>artifact.revisions.at(-1)?.mimeType==='text/markdown')!.revisions.at(-1)!.content;
  for(const text of [summary,edited,effects,'Compared with reviewed practice: 4 → 4 rows','Hypothetical local practice edits','Cited excerpts:'])expect(notes).toContain(text);
  expect(notes).not.toMatch(/Shipments|transfer-a|Transfer score:|p-rkey/);
  await capture(notesDialog.getByText(summary,{exact:true}),'04-saved-notes-last-change',summary);
  await notesDialog.getByRole('button',{name:'Back to task',exact:true}).click();
  const modelCount=entry.counters.modelRequests.length;await fixture.restart();
  await expect(comparison().getByText(summary,{exact:true})).toBeVisible();expect((await fixture.core.getTask(entry.task.id)).session?.moduleStates).toEqual(practiceState);
  expect(entry.counters.modelRequests).toHaveLength(modelCount);
  await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:640});scope=page.locator('.compact-companion');
  await scope.getByRole('button',{name:'Deep',exact:true}).click();await capture(comparison().getByRole('list',{name:'Why the join rows changed',exact:true}).getByRole('listitem'),'05-compact-deep-row-cause');
  await scope.getByRole('button',{name:'Visual',exact:true}).click();await capture(comparison().getByRole('region',{name:'Members row 2 pair comparison',exact:true}),'06-compact-visual-pairs');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await scope.getByRole('button',{name:'Try separate challenge',exact:true}).click();
  await expect(scope.getByRole('region',{name:'Computed result',exact:true})).toHaveCount(0);await expect(scope.getByRole('heading',{name:'6 output rows',exact:true})).toHaveCount(0);
  await expect(scope).not.toContainText('Transfer score:');await expect(scope.getByRole('list',{name:'Pair map',exact:true})).toHaveCount(0);
  await expect(comparison()).not.toContainText('Shipments');await expect(comparison().getByText(summary,{exact:true})).toBeVisible();
  const priorHeading=comparison().getByRole('heading',{name:'Practice comparison saved before transfer',exact:true});
  await capture(priorHeading,'07-compact-transfer-pending-known-practice','Practice comparison saved before transfer');
  await predict(scope,'5','6','First attempt: duplicates may leave five rows.');
  const score='Transfer score: 0 / 1 for the first row-count prediction. Reasoning is ungraded. This is an observed attempt, not a claim of lasting learning.';
  await expect(scope.getByRole('button',{name:'Check prediction',exact:true})).toHaveCount(0);await capture(scope.getByText(score,{exact:true}),'08-compact-first-transfer-checked',score);
  await fixture.restart();scope=page.locator('.workspace');
  await expect(scope.getByText(score,{exact:true})).toBeVisible();await expect(comparison().getByText(summary,{exact:true})).toBeVisible();
  const final=await fixture.core.getTask(entry.task.id);expect(final.sources).toEqual(beforeSave.sources);expect(final.artifacts.find(artifact=>artifact.id===module.id)?.revisions).toEqual(module.revisions);
  expect(final.requests).toHaveLength(2);expect(entry.counters.modelRequests).toHaveLength(1);expect(entry.counters.bindings).toEqual([{commandId:entry.counters.modelRequests[0].requestId,planId:entry.counters.modelRequests[0].requestId,sourceRefs:entry.refs}]);
  expect(fixture.external).toEqual([]);expect(fixture.commands.filter(command=>command.type==='browser.run'||command.type==='connection.configure'||/^(?:windows\.capture|context\.(?:start|capture)|export\.)/.test(command.type))).toEqual([]);
 }finally{
  try{
   const observed=(await Promise.allSettled([fixture.core.getTask(entry.task.id),fixture.learningDrafts.read()])).map(result=>result.status==='fulfilled'?result:{status:'rejected',message:String(result.reason)});
   const snapshot={scope:'Actual partial task and sidecar before owned fixture close. Synthetic source/provider transport; controlled core recreation and renderer reload, not native restart.',task:observed[0],sidecar:observed[1],commands:fixture.commands,counters:entry.counters,frames};
   const text=JSON.stringify(snapshot,null,2)+'\n',bytes=Buffer.byteLength(text),path=test.info().outputPath('sql-last-change-before-close.json');
   await writeFile(path,bytes<=512*1024?text:JSON.stringify({scope:snapshot.scope,kind:'not-retained-size-limit',bytes,limit:512*1024})+'\n');
   await test.info().attach('sql-last-change-before-close',{path,contentType:'application/json'});
  }finally{await fixture.close();}
 }
});
