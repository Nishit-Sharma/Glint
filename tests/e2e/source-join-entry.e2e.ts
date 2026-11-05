import {test,expect,type Page,type Locator} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {OnboardingFixture} from '../support/onboarding-fixture';
import {sourceJoinEntry} from '../support/source-join-entry.fixture';
import {MODULE_MIME} from '../../src/shared/module-contract';
import {readTaskArtifactText} from '../../src/core/task-dialogue';

declare global {interface Window {__sourceEntryMotion:{id:string;state:string;runtime:boolean}[]}}
const evidence='evidence/source-entry';
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true});});
async function watchMotion(page:Page){await page.evaluate(()=>{
 window.__sourceEntryMotion=[];const last=new Map<string,string>();
 const record=(node:HTMLElement)=>{const id=node.dataset.artifactMotion??'',state=node.dataset.artifactReveal??'';if(id.includes(':grounded-')&&last.get(id)!==state){last.set(id,state);window.__sourceEntryMotion.push({id,state,runtime:!!document.querySelector('.t-gen,.t-tig')});}};
 new MutationObserver(records=>{for(const change of records){if(change.type==='attributes'&&change.target instanceof HTMLElement)record(change.target);for(const added of change.addedNodes)if(added instanceof HTMLElement){if(added.matches('[data-artifact-motion]'))record(added);added.querySelectorAll<HTMLElement>('[data-artifact-motion]').forEach(record);}}}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-artifact-reveal']});
});}
async function motionSettled(page:Page){await expect(page.locator('[data-artifact-reveal="pending"],[data-artifact-reveal="running"]')).toHaveCount(0);}
async function enter(page:Page,entry:Awaited<ReturnType<typeof sourceJoinEntry>>,scope:Locator){
 await scope.getByRole('button',{name:entry.label,exact:true}).click();
 await expect.poll(()=>entry.counters.safeChunks.length).toBe(1);
 await expect(scope).toContainText('Preparing the cited tables for your review…');
 await expect(scope).not.toContainText('schemaVersion');
 await expect(scope.getByRole('region',{name:'Source-grounded join',exact:true})).toHaveCount(0);
 entry.completeProposal();
 await expect(scope.getByRole('heading',{name:'Review the cited tables',exact:true})).toBeVisible();
 await expect(scope.getByRole('button',{name:'Accept reviewed extraction and experiment',exact:true})).toBeDisabled();
}
async function review(scope:Locator){
 for(const name of ['Members.Team','Invitations.Team']){
  await scope.getByRole('combobox',{name:name+' column type',exact:true}).selectOption('string');
  const reason=scope.getByRole('textbox',{name:name+' type reason',exact:true});await reason.fill('Reviewed as text in this synthetic source.');
  await reason.locator('xpath=ancestor::form').getByRole('button',{name:'Confirm type',exact:true}).click();
 }
 const value=scope.getByRole('textbox',{name:'Members row 2, Team corrected value',exact:true});await value.fill('x');
 const reason=scope.getByRole('textbox',{name:'Members row 2, Team correction reason',exact:true});await reason.fill('User explicitly supplies x for the unreadable key.');
 await reason.locator('xpath=ancestor::form').getByRole('button',{name:'Apply correction',exact:true}).click();
 await scope.getByRole('combobox',{name:'Reviewed join type',exact:true}).selectOption('INNER');
 await scope.getByRole('combobox',{name:'Reviewed left key',exact:true}).selectOption('p-key');
 await scope.getByRole('combobox',{name:'Reviewed right key',exact:true}).selectOption('p-rkey');
 await scope.getByRole('textbox',{name:'Why these keys?',exact:true}).fill('User chooses equality on the two Team columns.');
 await scope.getByRole('button',{name:'Confirm join condition',exact:true}).click();
 await expect(scope.getByRole('region',{name:'Original join mapping',exact:true})).toContainText('No join condition is visible');
 await expect(scope.getByLabel('User join correction',{exact:true})).toContainText('User chooses equality');
 await expect(scope.getByRole('region',{name:'Review assumptions',exact:true})).toContainText('no hidden rows');
 await scope.getByRole('button',{name:'Accept reviewed extraction and experiment',exact:true}).click();
 await expect(scope.getByRole('textbox',{name:'Members row 2 Team',exact:true})).toHaveValue('x');
}
async function predict(scope:Locator,count:string,actual:string){
 await scope.getByLabel('Predict the output row count',{exact:true}).fill(count);await scope.getByRole('button',{name:'Check prediction',exact:true}).click();
 await expect(scope.getByRole('heading',{name:actual+' output rows',exact:true})).toBeVisible();
}
async function assertLedger(entry:Awaited<ReturnType<typeof sourceJoinEntry>>,expected:number){
 const saved=await entry.fixture.core.getTask(entry.task.id);
 expect(saved.requests).toHaveLength(expected);
 expect(entry.counters.modelRequests).toHaveLength(expected-1);
 expect(entry.counters.bindings.every(binding=>binding.commandId===binding.planId&&JSON.stringify(binding.sourceRefs)===JSON.stringify(entry.refs))).toBe(true);
 expect(entry.fixture.external).toEqual([]);return saved;
}

test('full App source action admits reviewed tables, computes changes, saves and restarts before distinct transfer',async({page})=>{
 const entry=await sourceJoinEntry(page);const {fixture}=entry;const scope=page.locator('.workspace');
 try{
  await motionSettled(page);await watchMotion(page);await enter(page,entry,scope);
  const initialPiece=scope.locator('[data-artifact-motion$=":grounded-heading"]');await initialPiece.scrollIntoViewIfNeeded();
  await expect.poll(()=>page.locator('.t-gen,.t-tig').count()).toBeGreaterThan(0);
  const running=await page.locator('.t-gen,.t-tig').count();
  if(running)await page.screenshot({path:evidence+'/desktop-runtime-running.png'});
  const initialRuntime={piece:await initialPiece.getAttribute('data-artifact-reveal'),runtime:running,surface:await scope.getAttribute('data-surface-reveal')};
  await motionSettled(page);
  const initialMotion=await page.evaluate(()=>window.__sourceEntryMotion);
  expect(initialMotion.some(event=>event.state==='running'&&event.runtime)||initialRuntime.runtime>0).toBe(true);
  await page.screenshot({path:evidence+'/desktop-review.png'});
  await review(scope);await predict(scope,'4','4');
  await scope.getByRole('combobox',{name:'Join type',exact:true}).selectOption('LEFT');
  await expect(scope.getByRole('region',{name:'Computed result',exact:true})).toHaveCount(0);
  await predict(scope,'4','5');
  await expect(scope.getByRole('region',{name:'Computed result',exact:true})).toContainText('You predicted 4; the actual count is 5');
  await scope.getByRole('button',{name:'Deep',exact:true}).click();await expect(scope).toContainText('Members row 3 has a NULL key');
  await scope.getByRole('button',{name:'Visual',exact:true}).click();await expect(scope.getByRole('list',{name:'Pair map',exact:true}).locator('li')).toHaveCount(5);
  await expect(scope.getByLabel('Computed change summary',{exact:true})).toContainText('4 → 5 rows');
  expect(await scope.getByRole('region',{name:'Source-grounded join',exact:true}).innerText()).not.toMatch(/practice-[a-z]|p-rkey|source-join-[a-f0-9]|[a-f0-9]{8}-[a-f0-9]{4}-/);
  await page.screenshot({path:evidence+'/desktop-computed.png'});
  await scope.getByRole('region',{name:'Exact result and provenance',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:evidence+'/desktop-computed-pairs.png'});
  await page.getByRole('button',{name:'Observatory visit',exact:true}).click();await page.getByRole('button',{name:entry.task.title,exact:true}).click();await expect(scope.getByRole('heading',{name:'5 output rows',exact:true})).toBeVisible();
  const beforeRestartMotion=await page.evaluate(()=>window.__sourceEntryMotion);expect(beforeRestartMotion.filter(event=>event.state==='running')).toEqual(initialMotion.filter(event=>event.state==='running'));
  await scope.getByRole('button',{name:'Save as document',exact:true}).click();
  await expect.poll(async()=> (await fixture.core.getTask(entry.task.id)).artifacts.filter(a=>a.revisions.at(-1)?.mimeType==='text/markdown').length).toBe(1);
  const saved=await assertLedger(entry,2),notes=saved.artifacts.find(a=>a.revisions.at(-1)?.mimeType==='text/markdown')!.revisions.at(-1)!.content;
  expect(notes).toContain('5');expect(notes).not.toContain('Shipments');expect(notes).not.toContain('transfer-a');
  expect(notes).toContain('Current join: LEFT equality on Members.Team = Invitations.Team');expect(notes).not.toContain(entry.refs[0].digest);expect(notes).not.toContain('contextDigest');expect(notes).not.toContain('p-key');
  const document=page.getByRole('dialog',{name:'Document',exact:true});await expect(document).toBeVisible();await expect(document).toContainText('Original join mapping: Unresolved.');
  await page.screenshot({path:evidence+'/saved-document.png'});
  await document.getByText('Current join: LEFT equality on Members.Team = Invitations.Team.',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:evidence+'/saved-document-results.png'});
  await document.getByRole('button',{name:'Back to task',exact:true}).click();
  const module=saved.artifacts.find(a=>a.revisions.at(-1)?.mimeType===MODULE_MIME)!;
  const history=readTaskArtifactText(saved,module.id,module.revisions.at(-1)!.revision);expect(history.available).toBe(true);if(history.available){expect(history.text).not.toContain('Shipments');expect(history.text).not.toContain('transfer-a');}
  const requests=fixture.commands.filter(c=>c.type==='model.run').length;
  await fixture.restart();await expect(scope.getByRole('heading',{name:'5 output rows',exact:true})).toBeVisible();
  expect(fixture.commands.filter(c=>c.type==='model.run')).toHaveLength(requests);
  await scope.getByRole('button',{name:'Task options',exact:true}).click();await scope.getByRole('button',{name:'Files',exact:true}).click();
  await page.getByRole('dialog',{name:'Files',exact:true}).getByRole('button').filter({hasText:'Review the cited tables notes'}).click();
  await expect(document).toContainText('Current join: LEFT equality on Members.Team = Invitations.Team');await page.screenshot({path:evidence+'/reopened-document.png'});
  await document.getByRole('button',{name:'Back to task',exact:true}).click();
  await scope.getByRole('button',{name:'Task options',exact:true}).click();await scope.getByRole('button',{name:'History',exact:true}).click();
  await page.getByRole('dialog',{name:'History',exact:true}).getByRole('button',{name:'Review the cited tables · Revision 1',exact:true}).click();
  const activity=page.getByRole('region',{name:'Saved revision',exact:true});await expect(activity).toContainText('Current join: LEFT equality on Members.Team = Invitations.Team');
  expect(await activity.innerText()).not.toMatch(/contextDigest|source-join-[a-f0-9]|p-key|Shipments/);await page.screenshot({path:evidence+'/activity-practice.png'});
  await page.getByRole('dialog',{name:'Saved revision',exact:true}).getByRole('button',{name:'Back to task',exact:true}).click();
  await scope.getByRole('button',{name:'Try separate challenge',exact:true}).click();
  await expect(scope.getByRole('region',{name:'Computed result',exact:true})).toHaveCount(0);await expect(scope).toContainText('separate synthetic problem');
  await scope.getByRole('button',{name:'Task options',exact:true}).click();await scope.getByRole('button',{name:'History',exact:true}).click();
  await page.getByRole('dialog',{name:'History',exact:true}).getByRole('button',{name:'Review the cited tables · Revision 1',exact:true}).click();
  await expect(activity).toContainText('Current join: LEFT equality on Shipments.Dock = Scans.Dock');await expect(activity).toContainText('Prior practice prediction: 4; computed result: 5 rows. Incorrect.');
  expect(await activity.innerText()).not.toMatch(/6 output rows|Transfer score:|transfer-a|contextDigest/);
  await activity.getByText('Current join: LEFT equality on Shipments.Dock = Scans.Dock.',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:evidence+'/activity-transfer-pending.png'});
  await page.getByRole('dialog',{name:'Saved revision',exact:true}).getByRole('button',{name:'Back to task',exact:true}).click();
  await predict(scope,'6','6');await expect(scope).toContainText('Transfer score: 1 / 1');
  await scope.getByRole('region',{name:'Computed result',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:evidence+'/transfer-reviewed.png'});
  await expect(scope.getByRole('textbox',{name:'Members row 2 Team',exact:true})).toHaveCount(0);
  await motionSettled(page);await expect(page.locator('.t-gen,.t-tig')).toHaveCount(0);
  await writeFile(evidence+'/desktop-ledger.json',JSON.stringify({counters:entry.counters,requests:(await fixture.core.getTask(entry.task.id)).requests,initialRuntime,initialMotion,beforeRestartMotion,afterRestartMotion:await page.evaluate(()=>window.__sourceEntryMotion??[])},null,2));
 }finally{await fixture.close();}
});

test('compact source entry preserves human citations, records actual arrival once and blocks stale editing',async({page})=>{
 const entry=await sourceJoinEntry(page);const {fixture}=entry;
 try{
  await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:640});const scope=page.locator('.compact-companion');
  await motionSettled(page);await watchMotion(page);await enter(page,entry,scope);await motionSettled(page);
  const arrivals=await page.evaluate(()=>window.__sourceEntryMotion);
  for(const suffix of ['grounded-heading','grounded-mapping','grounded-review']){
   const states=arrivals.filter(event=>event.id.endsWith(':'+suffix));expect(states.length).toBeGreaterThan(0);
   expect(states.filter(event=>event.state==='running').length).toBeLessThanOrEqual(1);
  }
  await scope.getByText('Source citations, assumptions and corrections',{exact:true}).click();await expect(scope).toContainText(entry.sourceLabel+', version 1');
  await expect(scope.getByRole('table',{name:'Extracted Members',exact:true}).getByRole('row')).toHaveCount(4);
  await page.screenshot({path:evidence+'/compact-review.png'});
  await review(scope);await predict(scope,'4','4');await scope.getByRole('button',{name:'Deep',exact:true}).click();await scope.getByRole('button',{name:'Visual',exact:true}).click();
  const motionAfterControls=await page.evaluate(()=>window.__sourceEntryMotion);expect(motionAfterControls.filter(event=>event.state==='running')).toEqual(arrivals.filter(event=>event.state==='running'));
  const before=await fixture.core.getTask(entry.task.id),state=before.session?.moduleStates;
  await entry.changedSource();await expect(scope.getByRole('alert')).toContainText('current-source editing is unavailable');
  await expect(scope.getByRole('combobox',{name:'Join type',exact:true})).toBeDisabled();await expect(scope.getByRole('heading',{name:'4 output rows',exact:true})).toBeVisible();
  expect((await fixture.core.getTask(entry.task.id)).session?.moduleStates).toEqual(state);
  await fixture.restart();await page.locator('.workspace').getByRole('heading',{name:entry.task.title,exact:true}).waitFor();await fixture.emit({type:'surface',mode:'companion'});await expect(scope.getByRole('heading',{name:'4 output rows',exact:true})).toBeVisible();
  await expect(scope).toContainText(entry.sourceLabel+', version 1');await expect(page.locator('.t-gen,.t-tig')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:evidence+'/compact-stale-saved.png'});
  const after=await page.evaluate(()=>window.__sourceEntryMotion??[]);
  // Reload resets the page observer; all pre-reload events are retained separately.
  expect(after.filter(event=>event.state==='running')).toEqual([]);
  await assertLedger(entry,2);await writeFile(evidence+'/compact-motion.json',JSON.stringify({initial:arrivals,afterControls:motionAfterControls,afterRestart:after},null,2));
 }finally{await fixture.close();}
});

test('hardware brief uses ordinary model.run explanation without fabricating a SQL or HDL capability',async({page})=>{
 const entry=await sourceJoinEntry(page,'hardware');const {fixture}=entry;const scope=page.locator('.workspace');
 try{
  await expect(scope.getByRole('button',{name:'Review the join',exact:true})).toHaveCount(0);
  await scope.getByRole('button',{name:entry.label,exact:true}).click();
  await expect(scope).toContainText('No HDL simulation or evaluated hardware experiment was run.');
  await expect(scope.getByRole('region',{name:'Source-grounded join',exact:true})).toHaveCount(0);
  const saved=await assertLedger(entry,2);expect(entry.counters.ordinary).toBe(1);expect(saved.artifacts.some(a=>a.revisions.some(r=>r.mimeType===MODULE_MIME))).toBe(false);
  await page.screenshot({path:evidence+'/hardware-explanation.png'});
  await fixture.restart();await expect(scope).toContainText('No HDL simulation or evaluated hardware experiment was run.');expect(entry.counters.modelRequests).toHaveLength(1);
  await writeFile(evidence+'/hardware-ledger.json',JSON.stringify(entry.counters,null,2));
 }finally{await fixture.close();}
});


test('first pending answer hides only its own empty-task intake before hydration',async({page})=>{
 const fixture=await OnboardingFixture.open(page,{ready:true,port:4180});fixture.configured=true;
 let finish:((value:{title:string;mimeType:string;content:string})=>void)|undefined,requestId:string|undefined,running:Promise<unknown>|undefined;
 try{
  const catalog=await fixture.ready();
  const alpha=await fixture.core.createTask({title:'Fresh task Alpha',assignedBotId:catalog.defaultBotId});
  const beta=await fixture.core.createTask({title:'Fresh task Beta',assignedBotId:catalog.defaultBotId});
  await fixture.core.putSource(alpha.id,{kind:'text',role:'fact',label:'Owned fixture text',content:'Alpha describes a clock reset.'});
  await fixture.viewPreferences.select(alpha.id);await fixture.restart();
  await page.getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:alpha.title,exact:true}).click();
  const invoke=fixture.invoke.bind(fixture);
  fixture.invoke=async command=>{
   if(command.type!=='model.run')return invoke(command);
   requestId=command.requestId;
   running=fixture.core.runRequest({taskId:command.taskId,requestId:command.requestId,kind:command.kind,prompt:command.prompt,...(command.submittedDraft?{submittedDraft:command.submittedDraft}:{})},async()=>new Promise(resolve=>{finish=resolve;})).then(async result=>{
    if(result.status!=='completed')throw Error(result.error??'Synthetic response failed');
    await fixture.emit({type:'changed',taskId:command.taskId});return fixture.core.getTask(command.taskId);
   });return running;
  };
  const workspace=page.locator('.workspace');
  const intake=workspace.getByRole('heading',{name:'Bring a window into this task.',exact:true});
  const savedIntake=workspace.getByRole('heading',{name:'Added to this task',exact:true});
  await expect(savedIntake).toBeVisible();await expect(intake).toHaveCount(0);
  await page.getByRole('textbox',{name:'Ask about this task',exact:true}).fill('Explain the reset.');
  await page.getByRole('button',{name:'Ask',exact:true}).click();
  await expect.poll(()=>!!finish).toBe(true);
  // Deliberately withhold changed/tasks hydration while the real core has saved the running request.
  await fixture.emit({type:'stream',taskId:alpha.id,requestId:requestId!,text:'A partial explanation of this reset.'});
  await expect(workspace.getByText('A partial explanation of this reset.',{exact:true})).toBeVisible();
  await expect(intake).toHaveCount(0);await expect(savedIntake).toHaveCount(0);
  await fixture.emit({type:'changed',taskId:alpha.id});
  await page.getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:beta.title,exact:true}).click();
  await expect(intake).toBeVisible();await expect(savedIntake).toHaveCount(0);
  await expect(workspace.getByText('A partial explanation of this reset.',{exact:true})).toHaveCount(0);
  await page.getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:alpha.title,exact:true}).click();
  await expect(workspace.getByText('A partial explanation of this reset.',{exact:true})).toBeVisible();
  await expect(intake).toHaveCount(0);await expect(savedIntake).toHaveCount(0);
  finish!({title:'Reset explanation',mimeType:'text/markdown',content:'The completed explanation uses the saved reset source.'});await running;
  await expect(workspace.getByText('The completed explanation uses the saved reset source.',{exact:true})).toBeVisible();
  await expect(intake).toHaveCount(0);await expect(savedIntake).toHaveCount(0);
 }finally{finish?.({title:'Cleanup answer',mimeType:'text/markdown',content:'Own fixture cleanup.'});await running?.catch(()=>{});await fixture.close();}
});
