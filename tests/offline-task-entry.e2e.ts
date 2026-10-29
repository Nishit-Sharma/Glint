import {test,expect,type Page,type Locator} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {offlineTaskEntry} from './offline-task-entry.fixture';
import {settleCapture} from './settled-capture';

type Entry=Awaited<ReturnType<typeof offlineTaskEntry>>;
const evidence='evidence/offline-task-entry';
const rules='Draft + Submit -> In review\nIn review + Approve -> Ready\nReady + Edit -> Draft';
const workspace=(page:Page)=>page.locator('.workspace:visible');
const form=(page:Page)=>page.getByRole('region',{name:/^Start with (text|a draft)$/});
const doc=(page:Page)=>page.getByRole('dialog',{name:'Document',exact:true});
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true});});
async function onboard(page:Page,entry:Entry){
 expect(await entry.fixture.core.listTasks()).toHaveLength(0);
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByText('Local example · Bundled on this device',{exact:true})).toBeVisible();
 expect(await entry.fixture.core.listTasks()).toHaveLength(1);
 expect(entry.fixture.commands.filter(command=>command.type==='tasks.create')).toEqual([]);
}
async function begin(page:Page,kind:'text'|'draft'){
 await workspace(page).getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'New task',exact:true}).click();
 await workspace(page).getByRole('button',{name:kind==='text'?'Paste text':'Write a draft',exact:true}).click();
 await expect(form(page)).toBeVisible();
}
async function fill(page:Page,title:string,content:string){
 await form(page).getByLabel('Title (optional)',{exact:true}).fill(title);
 const label=await form(page).getByLabel('Source text',{exact:true}).count()?'Source text':'Draft content';await form(page).getByLabel(label,{exact:true}).fill(content);
}
async function shot(page:Page,anchor:Locator,name:string){await anchor.scrollIntoViewIfNeeded();await settleCapture(page);await page.screenshot({path:evidence+'/'+name+'.png'});}
async function onlyLocal(entry:Entry,expectedStarts:number){
 expect(entry.creations).toHaveLength(expectedStarts);expect(entry.fixture.configured).toBe(false);expect(entry.fixture.external).toEqual([]);
 expect(entry.fixture.commands.filter(command=>command.type==='model.run'||command.type==='tasks.create'||command.type==='connection.configure'||command.type==='browser.run'||/^(?:windows\.capture|context\.(?:start|capture)|export\.)/.test(command.type))).toEqual([]);
 const tasks=await entry.fixture.core.listTasks();expect(tasks.every(task=>task.requests.length===0)).toBe(true);return tasks;
}
async function record(entry:Entry,name:string){await writeFile(evidence+'/'+name+'.json',JSON.stringify({boundary:'Actual App + local stores; substituted OS/transport, no provider. All creation through visible product controls.',phases:entry.phases,commands:entry.fixture.commands,tasks:await entry.fixture.core.listTasks(),state:JSON.parse(await readFile(join(entry.fixture.directory,'tasks.json'),'utf8'))},null,2));}
async function openSavedDocument(page:Page,title:string){await workspace(page).locator('.conversation-manual-files').getByRole('button',{name:title,exact:true}).click();await expect(doc(page).getByRole('heading',{name:title,exact:true})).toBeVisible();}

test('New task Paste text works offline, locks duplicate clicks, opens the exact source and keeps its edited version',async({page})=>{
 const entry=await offlineTaskEntry(page);
 try{
  await onboard(page,entry);await begin(page,'text');await fill(page,'Owned workflow notes',rules);await shot(page,form(page).getByRole('heading'),'full-paste-form');
  entry.holdNextSave();await form(page).getByRole('button',{name:'Create task',exact:true}).click({clickCount:2});
  await expect(form(page).getByRole('button',{name:'Saving…',exact:true})).toBeDisabled();await expect(form(page).getByRole('button',{name:'Cancel',exact:true})).toBeDisabled();await expect.poll(()=>entry.creations.length).toBe(1);entry.releaseSave();
  const snapshot=page.getByRole('region',{name:'Source snapshot',exact:true});await expect(snapshot).toContainText(rules);await expect(snapshot.getByRole('heading',{name:'Owned workflow notes',exact:true})).toBeVisible();await shot(page,snapshot.getByRole('heading'),'full-saved-source');
  let tasks=await onlyLocal(entry,1);expect(tasks).toHaveLength(2);const created=tasks.find(task=>task.title==='Owned workflow notes')!;expect(created.sources).toHaveLength(1);expect(created.artifacts).toHaveLength(0);
  await snapshot.getByRole('button',{name:'Source options',exact:true}).click();await snapshot.getByRole('button',{name:'Edit / refresh',exact:true}).click();await page.getByLabel('Source text',{exact:true}).fill(rules+'\nDraft + Edit -> Draft');await page.getByRole('button',{name:'Save new version',exact:true}).click();await expect(snapshot).toContainText('Draft + Edit -> Draft');
  await page.getByRole('button',{name:'Back to task',exact:true}).click();await workspace(page).getByRole('textbox',{name:'Ask about this task',exact:true}).fill('Keep this question unsent.');await expect(workspace(page).getByRole('button',{name:'Connect to ask',exact:true})).toBeDisabled();
  await expect.poll(async()=>(await entry.fixture.core.getTask(created.id)).session?.draft).toBe('Keep this question unsent.');await entry.fixture.restart();await expect(workspace(page).getByRole('textbox',{name:'Ask about this task',exact:true})).toHaveValue('Keep this question unsent.');
  tasks=await onlyLocal(entry,1);expect(tasks.find(task=>task.id===created.id)!.sources[0].versions).toHaveLength(2);await record(entry,'paste-ledger');
 }finally{await entry.close();}
});

test('cancel creates no task; a local draft and per-task unsent drafts remain reachable in full and compact views',async({page})=>{
 const entry=await offlineTaskEntry(page);
 try{
  await onboard(page,entry);const original=(await entry.fixture.core.listTasks())[0];await begin(page,'draft');await expect(form(page).getByRole('button',{name:'Create task',exact:true})).toBeDisabled();await fill(page,'Discarded form','This form will be cancelled.');
  await expect(form(page)).toContainText('Cancel discards this input without creating or deleting a task.');
  await form(page).getByRole('button',{name:'Cancel',exact:true}).click();await expect(form(page)).toHaveCount(0);expect(await onlyLocal(entry,0)).toHaveLength(1);
  const rawAfterCancel=await entry.fixture.learningDrafts.read();if(rawAfterCancel.kind!=='available')throw Error('Expected confirmed local draft storage.');const discardedRaw=rawAfterCancel.records.filter(record=>'kind' in record.owner&&record.owner.kind==='local-task-form'&&record.owner.form==='draft');expect(discardedRaw).toHaveLength(1);expect(discardedRaw[0].value).toBeNull();
  await workspace(page).getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:640});const compact=page.locator('.compact-companion');await expect(compact).toBeVisible();await shot(page,compact.getByRole('button',{name:'Start a task',exact:true}),'compact-new-task-entry');
  await compact.getByRole('button',{name:'Start a task',exact:true}).click();await page.setViewportSize({width:1080,height:800});await workspace(page).getByRole('button',{name:'Write a draft',exact:true}).click();await fill(page,'Owned local draft','A document saved without an AI connection.');await form(page).getByRole('button',{name:'Create task',exact:true}).click();await expect(doc(page)).toContainText('A document saved without an AI connection.');await shot(page,doc(page).getByRole('heading',{name:'Owned local draft',exact:true}),'full-saved-draft');
  await page.getByRole('button',{name:'Back to task',exact:true}).click();await workspace(page).getByRole('textbox',{name:'Ask about this task',exact:true}).fill('Unsent question for my draft.');await workspace(page).getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:original.title,exact:true}).click();await workspace(page).getByRole('textbox',{name:'Ask about this task',exact:true}).fill('Unsent question for the original example.');
  await workspace(page).getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'Owned local draft',exact:true}).click();await expect(workspace(page).getByRole('textbox',{name:'Ask about this task',exact:true})).toHaveValue('Unsent question for my draft.');await workspace(page).getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:640});await expect(compact.getByRole('textbox',{name:'Ask companion',exact:true})).toHaveValue('Unsent question for my draft.');await expect(compact.getByRole('button',{name:'Connect to ask',exact:true})).toBeDisabled();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await shot(page,compact.getByRole('textbox',{name:'Ask companion',exact:true}),'compact-local-draft');
  const tasks=await onlyLocal(entry,1);expect(tasks).toHaveLength(2);await expect.poll(async()=>(await entry.fixture.core.getTask(original.id)).session?.draft).toBe('Unsent question for the original example.');await record(entry,'cancel-draft-switch-ledger');
 }finally{await entry.close();}
});

test('a lost response retries the same save, then old-core UI edits survive reopening with the new core',async({page})=>{
 const entry=await offlineTaskEntry(page);
 try{
  await onboard(page,entry);await begin(page,'draft');await fill(page,'Retry and rollback notes','Original saved text.');entry.loseNextResponse();await form(page).getByRole('button',{name:'Create task',exact:true}).click();await expect(form(page).getByRole('alert')).toContainText('save result is uncertain');await expect(form(page).getByLabel('Draft content',{exact:true})).toBeDisabled();await shot(page,form(page).getByRole('alert'),'uncertain-save-recovery');expect(await entry.fixture.core.listTasks()).toHaveLength(2);
  await form(page).getByRole('button',{name:'Retry same save',exact:true}).click();await expect(doc(page).getByRole('heading',{name:'Retry and rollback notes',exact:true})).toBeVisible();expect(entry.creations).toHaveLength(2);expect(entry.creations[1]).toEqual(entry.creations[0]);let tasks=await onlyLocal(entry,2);expect(tasks).toHaveLength(2);const saved=tasks.find(task=>task.title==='Retry and rollback notes')!;
  const before=JSON.parse(await readFile(join(entry.fixture.directory,'tasks.json'),'utf8'));await entry.usePinnedOldCore();await expect(workspace(page).getByRole('heading',{name:'Retry and rollback notes',exact:true})).toBeVisible();await openSavedDocument(page,'Retry and rollback notes');await doc(page).getByRole('button',{name:'Edit document',exact:true}).click();await doc(page).getByRole('textbox',{name:'Draft content',exact:true}).fill('User edit saved through the pinned old core.');await doc(page).getByRole('button',{name:'Save revision',exact:true}).click();await expect.poll(async()=>(await entry.fixture.core.getTask(saved.id)).artifacts[0].revisions.length).toBe(2);await doc(page).getByRole('button',{name:'Cancel',exact:true}).click();await expect(doc(page)).toContainText('User edit saved through the pinned old core.');await shot(page,doc(page).getByRole('heading',{name:'Retry and rollback notes',exact:true}),'pinned-old-core-saved-edit');
  const afterOld=JSON.parse(await readFile(join(entry.fixture.directory,'tasks.json'),'utf8'));expect(afterOld.usedRequestIds).toEqual(before.usedRequestIds);await entry.restartNewCore();await expect(workspace(page).getByRole('heading',{name:'Retry and rollback notes',exact:true})).toBeVisible();await openSavedDocument(page,'Retry and rollback notes');await expect(doc(page)).toContainText('User edit saved through the pinned old core.');await shot(page,doc(page).getByRole('heading',{name:'Retry and rollback notes',exact:true}),'new-core-reopened-edit');
  tasks=await onlyLocal(entry,2);expect(tasks).toHaveLength(2);expect(tasks.find(task=>task.id===saved.id)!.artifacts[0].revisions).toEqual(afterOld.tasks.find((task:{id:string})=>task.id===saved.id).artifacts[0].revisions);await record(entry,'retry-old-reader-ledger');
 }finally{await entry.close();}
});
