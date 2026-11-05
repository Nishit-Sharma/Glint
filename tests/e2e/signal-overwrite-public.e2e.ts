import {expect,test,type Page,type Locator} from '@playwright/test';
import {offlineTaskEntry} from '../support/offline-task-entry.fixture';
import {taskTool} from '../support/ui-tools';
import {pickingPublicFrame as frame} from '../support/picking-public-frame';
import {prepareWorkflowReview} from '../../src/core/workflow-review-host';
import {createSignalOverwrite,inspectSignalOverwrite} from '../../src/core/signal-overwrite-host';

const title='Owned source-grounded signal replacement';
const source='stored <= incoming;\nstored <= fallback;';
const ws=(page:Page)=>page.locator('.workspace:visible');
const doc=(page:Page)=>ws(page).getByRole('dialog',{name:'Document',exact:true});
const pairReview=(page:Page)=>doc(page).getByRole('region',{name:'Two assignments to one signal',exact:true});
async function open(page:Page,id:string){
 await taskTool(page,'Files');
 await ws(page).getByRole('dialog',{name:'Files',exact:true}).locator(`.artifact-row[data-view-focus="artifact:${id}"]`).click();
 await expect(doc(page)).toBeVisible();
}
async function reviewPair(page:Page,basisId:string){
 await open(page,basisId);
 await doc(page).getByRole('button',{name:'Document options',exact:true}).click();
 await doc(page).getByRole('button',{name:'Explain a signal assignment',exact:true}).click();
 await doc(page).getByRole('region',{name:'Review a signal assignment',exact:true}).getByLabel('Source line',{exact:true}).selectOption('0');
 await doc(page).getByRole('button',{name:'Explore these two assignments to one signal',exact:true}).click();
 await expect(pairReview(page)).toBeVisible();
}

test('review a source signal pair, change hypothetical execution, save a distinct first practice and reopen with source provenance and stale hold',async({page},info)=>{
 const entry=await offlineTaskEntry(page,Number(process.env.WINDOW_COMPANION_TEST_PORT??4180),{ready:true});
 const invoke=entry.fixture.invoke.bind(entry.fixture),frames:Awaited<ReturnType<typeof frame>>[]=[];
 let lessonId='',practiceId='';
 entry.fixture.invoke=async command=>{
  if(command.type==='workflow.prepare'){
   entry.fixture.commands.push(structuredClone(command));const {type,...input}=command;
   return prepareWorkflowReview(entry.fixture.core,input);
  }
  if(command.type==='signal.overwrite.inspect'){
   entry.fixture.commands.push(structuredClone(command));const {type,...input}=command;
   return inspectSignalOverwrite(entry.fixture.core,input);
  }
  if(command.type==='signal.overwrite'){
   entry.fixture.commands.push(structuredClone(command));const {type,...input}=command,result=await createSignalOverwrite(entry.fixture.core,input);
   if(command.mode==='lesson')lessonId=result.artifactId;else practiceId=result.artifactId;
   await entry.fixture.emit({type:'changed',taskId:command.taskId});return result;
  }
  return invoke(command);
 };
 const task=async()=>{
  const found=(await entry.fixture.core.listTasks()).find(item=>item.title===title);
  if(!found)throw Error('Owned task is not committed.');return entry.fixture.core.getTask(found.id);
 };
 const capture=async(anchor:Locator,name:string)=>frames.push(await frame(page,anchor,name));
 try{
  await ws(page).getByRole('complementary',{name:'Task navigation',exact:true}).getByRole('button',{name:'New task',exact:true}).click();
  await ws(page).getByRole('button',{name:'Paste text',exact:true}).click();
  const start=ws(page).getByRole('region',{name:'Start with text',exact:true});
  await start.getByLabel('Title (optional)',{exact:true}).fill(title);
  await start.getByLabel('Source text',{exact:true}).fill(source);
  await start.getByRole('button',{name:'Create task',exact:true}).click();
  await expect.poll(async()=>{
   const found=(await entry.fixture.core.listTasks()).find(item=>item.title===title);if(!found)return undefined;
   const saved=await entry.fixture.core.getTask(found.id);return saved.sources[0]?.versions.at(-1)?.content;
  }).toBe(source);
  await expect(ws(page).getByRole('heading',{level:1,name:title,exact:true})).toBeVisible();
  const context=ws(page).getByRole('dialog',{name:'Attachments',exact:true});await expect(context).toBeVisible();
  await context.getByRole('button',{name:'Back to task',exact:true}).click();await expect(context).toBeHidden();
  await taskTool(page,'Files');const files=ws(page).getByRole('dialog',{name:'Files',exact:true});
  await files.getByRole('button',{name:'New file',exact:true}).click();await files.getByRole('button',{name:'Draft',exact:true}).click();
  await doc(page).getByLabel('Draft title',{exact:true}).fill('Reviewed signal pair notes');
  await doc(page).getByRole('textbox',{name:'Draft content',exact:true}).fill('Study the two complete assignments in the linked source.');
  await doc(page).getByRole('button',{name:'Save draft',exact:true}).click();await expect(doc(page)).toHaveCount(0);
  const initial=await task(),basis=initial.artifacts.find(a=>a.revisions[0].title==='Reviewed signal pair notes')!;
  expect(basis.revisions[0].sourceRefs).toHaveLength(1);const refs=basis.revisions[0].sourceRefs;
  await reviewPair(page,basis.id);let review=pairReview(page);
  await expect(review.getByRole('button',{name:'Save source-linked explanation and change',exact:true})).toBeDisabled();
  await expect(review).toContainText('version 1');await expect(review.locator('pre')).toHaveText(source);
  await capture(review.locator('pre'),'01-two-exact-source-lines-full');
  await review.getByText('Required process and driver assumptions',{exact:true}).click();
  await expect(review).toContainText('without an intervening wait or delay');await expect(review).toContainText('Both assignments affect the same driver');
  await review.getByLabel('I reviewed both exact source lines and the same-process, same-driver assumptions.',{exact:true}).check();
  await capture(review.getByText('If both statements execute in this same process, the second replaces the first pending transaction for stored. The signal does not update between these statements.',{exact:true}),'02-quick-replacement-rule-full');
  await review.getByText('Deep — why the first value is replaced',{exact:true}).click();
  await capture(review.getByText(/^No explicit delay means both transactions have the same simulation time\./),'03-deep-same-driver-cause-full');
  await capture(review.getByRole('listitem').filter({hasText:'Second line: replace that transaction with 0; stored still reads 0.'}),'04-visual-pending-versus-current-full');
  await review.getByLabel('Execute the second statement in the changed example',{exact:true}).uncheck();
  const comparison=review.getByRole('status');await expect(comparison).toContainText('final value changes from 0 to 1');
  await capture(comparison,'05-skip-second-comparison-full');
  await page.setViewportSize({width:360,height:640});await capture(comparison,'06-skip-second-comparison-narrow');
  await page.setViewportSize({width:1080,height:800});
  await review.getByRole('button',{name:'Save source-linked explanation and change',exact:true}).click();
  await expect(doc(page).getByRole('heading',{name:'Two assignments to one signal',exact:true})).toBeVisible();
  await expect.poll(()=>lessonId).not.toBe('');await expect(doc(page)).toContainText(source);
  for(const name of ['Quick','Deep','Visual — chosen hypothetical values'])await expect(doc(page).getByRole('heading',{name,exact:true})).toBeVisible();
  await expect(doc(page)).toContainText('not a VHDL simulation');
  await capture(doc(page).getByText(/^Changed hypothetical: the second statement is skipped\./),'07-saved-source-linked-change-full');
  let snapshot=await task();const lesson=structuredClone(snapshot.artifacts.find(a=>a.id===lessonId)!);
  expect(lesson.revisions[0].sourceRefs).toEqual(refs);expect(lesson.revisions[0].content).toContain(source);
  await reviewPair(page,basis.id);review=pairReview(page);
  await review.getByLabel('I reviewed both exact source lines and the same-process, same-driver assumptions.',{exact:true}).check();
  await review.getByRole('button',{name:'Try separate replacement practice',exact:true}).click();
  await expect(review.getByRole('button',{name:'Save first answer and reveal explanation',exact:true})).toBeDisabled();
  await expect(review).toContainText('Earlier exposure is unknown');await expect(review).not.toContainText('The result is (0, 1)');
  await capture(review.locator('pre').filter({hasText:'audit <= lamp;'}),'08-separate-three-statement-practice-full');
  const choices=review.getByRole('group',{name:'Your predicted pair (lamp, audit)',exact:true});
  await choices.getByRole('radio',{name:'(1, 0)',exact:true}).check();await page.setViewportSize({width:360,height:640});
  await capture(choices,'09-first-practice-choice-narrow');await page.setViewportSize({width:1080,height:800});
  await review.getByRole('button',{name:'Save first answer and reveal explanation',exact:true}).click();
  await expect(doc(page).getByRole('heading',{name:'Signal replacement practice',exact:true})).toBeVisible();
  await expect.poll(()=>practiceId).not.toBe('');await expect(doc(page)).toContainText('Your saved answer: (1, 0).');
  const feedback=doc(page).getByText(/^The result is \(0, 1\); your answer does not match/);await expect(feedback).toBeVisible();
  await expect(feedback).toContainText('second reads the current lamp value 1');await capture(feedback,'10-first-answer-and-causal-feedback-full');
  snapshot=await task();const practice=structuredClone(snapshot.artifacts.find(a=>a.id===practiceId)!);
  expect(practice.revisions[0].sourceRefs).toEqual(refs);expect(snapshot.requests).toHaveLength(2);
  await entry.fixture.flushDrafts();await entry.restartNewCore();await open(page,lessonId);
  await expect(doc(page)).toContainText(source);await expect(doc(page)).toContainText('final scheduled value changes from 0 to 1');
  expect((await task()).artifacts.find(a=>a.id===lessonId)).toEqual(lesson);
  await open(page,practiceId);await expect(doc(page)).toContainText('Your saved answer: (1, 0).');
  await page.setViewportSize({width:360,height:640});await capture(doc(page).getByText('Your saved answer: (1, 0).',{exact:true}),'11-reopened-first-answer-narrow');
  await page.setViewportSize({width:1080,height:800});expect((await task()).artifacts.find(a=>a.id===practiceId)).toEqual(practice);
  await taskTool(page,'Sources');await context.locator('.source-list-row').filter({hasText:title}).click();
  const sourceSnapshot=context.getByRole('region',{name:'Source snapshot',exact:true});
  await sourceSnapshot.getByRole('button',{name:'Source options',exact:true}).click();await sourceSnapshot.getByRole('button',{name:'Edit / refresh',exact:true}).click();
  await context.getByLabel('Source text',{exact:true}).fill('stored <= incoming;\nstored <= alternative;');
  await context.getByRole('button',{name:'Save new version',exact:true}).click();await context.getByRole('button',{name:'Back to task',exact:true}).click();
  await open(page,practiceId);const stale=doc(page).getByText('Sources changed. Review them before saving or exporting.',{exact:true});
  await expect(stale).toBeVisible();await expect(doc(page)).toContainText(source);await expect(doc(page)).toContainText('Your saved answer: (1, 0).');
  await expect(doc(page).getByRole('button',{name:'Export',exact:true})).toBeDisabled();
  await capture(stale,'12-source-change-holds-original-answer-full');
  snapshot=await task();expect(snapshot.artifacts.find(a=>a.id===practiceId)).toEqual(practice);expect(snapshot.artifacts.find(a=>a.id===lessonId)).toEqual(lesson);
  expect(snapshot.sources[0].currentVersion).toBe(2);expect(snapshot.requests).toHaveLength(2);
  expect(entry.fixture.commands.filter(c=>c.type==='signal.overwrite')).toHaveLength(2);
  expect(entry.fixture.commands.filter(c=>c.type==='model.run'||c.type==='browser.run'||/^(windows\.capture|context\.(start|capture)|export\.)/.test(c.type))).toEqual([]);
  expect(entry.fixture.external).toEqual([]);expect(frames).toHaveLength(12);
  await info.attach('signal-overwrite-boundary',{body:JSON.stringify({scope:'Initialized identity/example only; journey task, source, basis document, exact pair review, Quick/Deep/Visual, changed execution, distinct practice, explicit saves and source correction use public App controls. Real core/store/request checks; transport/OS/provider substituted. Fixed illustrative scheduling model, not HDL simulation. Earlier exposure unknown; no mastery, native restart or live inference claim. Core recreation retains the existing sidecar instance. Twelve actual viewport anchors do not establish every surrounding paragraph is visible at once.',refs,lesson,practice,frames,phases:entry.phases,commands:entry.fixture.commands},null,2),contentType:'application/json'});
 }finally{await entry.close();}
});
