import {test,expect,type Page,type Locator} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {textHelperEntry} from './text-helper-entry.fixture';
import {settleCapture} from './settled-capture';
import {parseModuleAnswer} from '../src/core/interactive-modules';
import {helperStudio} from '../src/learning/reusable-helper';
import {MODULE_MIME} from '../src/shared/module-contract';

type Entry=Awaited<ReturnType<typeof textHelperEntry>>;
const evidence='evidence/text-helper-entry';
const workspace=(page:Page)=>page.locator('.workspace:visible');
const document=(page:Page)=>page.getByRole('dialog',{name:'Document',exact:true});
const helper=(page:Page)=>document(page).locator('.helper-studio');
const library=(page:Page)=>page.getByRole('dialog',{name:'Saved helpers',exact:true});
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true});});

async function onboard(page:Page,entry:Entry){
 expect(await entry.fixture.core.listTasks()).toHaveLength(0);
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByText('Local example · Bundled on this device',{exact:true})).toBeVisible();
 expect(await entry.fixture.core.listTasks()).toHaveLength(1);
}
async function startDraft(page:Page,title:string){
 await workspace(page).getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'New task',exact:true}).click();
 await workspace(page).getByRole('button',{name:'Write a draft',exact:true}).click();
 const form=page.getByRole('region',{name:'Start with a draft',exact:true});
 await form.getByLabel('Title (optional)',{exact:true}).fill(title);await form.getByLabel('Draft content',{exact:true}).fill('Owned local text-helper practice. No source inference or provider.');
 await form.getByRole('button',{name:'Create task',exact:true}).click();
 await expect(document(page).getByRole('heading',{name:title,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Back to task',exact:true}).click();
}
async function menu(page:Page,name:'Files'|'Activity'){
 await workspace(page).getByRole('button',{name:'Task options',exact:true}).click();
 await workspace(page).getByRole('button',{name,exact:true}).click();
}
async function createHelper(page:Page){
 await menu(page,'Files');const files=page.getByRole('dialog',{name:'Files',exact:true});
 await files.getByRole('button',{name:'New file',exact:true}).click();await files.getByRole('button',{name:'Text helper',exact:true}).click();
 await expect(helper(page).getByRole('heading',{name:'Text helper',exact:true})).toBeVisible();
 await expect(helper(page)).toContainText('No operations yet');
}
async function showDetails(scope:Locator,name:string){
 const summary=scope.locator('summary').filter({hasText:name});
 if(await summary.locator('..').getAttribute('open')===null)await summary.click();
}
async function rename(scope:Locator,name:string){
 await showDetails(scope,'Name and discovery label');await scope.getByLabel('Helper name',{exact:true}).fill(name);await scope.getByLabel('Discovery label',{exact:true}).fill(name+' cleanup');await scope.getByRole('button',{name:'Apply details',exact:true}).click();await expect(scope.getByRole('heading',{name,exact:true})).toBeVisible();
}
async function run(scope:Locator,input:string,output:string){
 await scope.getByLabel('Fresh text',{exact:true}).fill(input);await scope.getByRole('button',{name:'Run active helper',exact:true}).click();await expect(scope.getByLabel('Helper result',{exact:true})).toHaveJSProperty('textContent',output);
}
async function shot(page:Page,anchor:Locator,name:string){await anchor.scrollIntoViewIfNeeded();await settleCapture(page);await page.screenshot({path:evidence+'/'+name+'.png'});}
async function back(page:Page){await page.getByRole('button',{name:'Back to task',exact:true}).click();}
async function openLibrary(page:Page){await menu(page,'Files');await page.getByRole('dialog',{name:'Files',exact:true}).getByRole('button',{name:'Saved helpers',exact:true}).click();await expect(library(page)).toBeVisible();}
async function selectTask(page:Page,title:string){await workspace(page).getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:title,exact:true}).click();await expect(workspace(page).getByRole('heading',{name:title,exact:true})).toBeVisible();}
async function nextPaint(page:Page){await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));}
async function onlyLocal(entry:Entry,helperCount:number,taskStarts:number){
 expect(entry.fixture.configured).toBe(false);expect(entry.fixture.external).toEqual([]);expect(entry.helperCreations).toHaveLength(helperCount);expect(entry.creations).toHaveLength(taskStarts);
 expect(entry.fixture.commands.filter(command=>command.type==='model.run'||command.type==='tasks.create'||command.type==='connection.configure'||command.type==='browser.run'||/^(?:windows\.capture|context\.(?:start|capture)|export\.)/.test(command.type))).toEqual([]);
 const tasks=await entry.fixture.core.listTasks(),requests=tasks.flatMap(task=>task.requests);
 expect(requests).toHaveLength(helperCount);expect(requests.every(request=>request.kind==='create'&&request.status==='completed'&&request.sourceRefs.length===0)).toBe(true);
 expect(tasks.every(task=>task.actions.length===0&&task.procedures.length===0)).toBe(true);return tasks;
}
async function record(entry:Entry,name:string){await writeFile(evidence+'/'+name+'.json',JSON.stringify({boundary:'Actual App and local stores. Every task/helper created through visible product controls. OS/transport only substituted; no provider, capture or external procedure.',phases:entry.phases,barriers:entry.boundaries,commands:entry.fixture.commands,tasks:await entry.fixture.core.listTasks()},null,2));}

test('real offline entry teaches checked versions, runs fresh text, rolls back and reopens readable notes and Activity',async({page})=>{
 const entry=await textHelperEntry(page);
 try{
  await onboard(page,entry);await startDraft(page,'Label workshop');await createHelper(page);
  let scope=helper(page);await rename(scope,'Clean dock labels');
  await scope.getByLabel('Demonstration input',{exact:true}).fill('  River   Dock  ');await scope.getByRole('button',{name:'Start demonstration',exact:true}).click();await scope.getByRole('button',{name:'Demonstrate operation',exact:true}).click();
  await expect(scope.getByLabel('Current demonstration result',{exact:true})).toHaveJSProperty('textContent','River   Dock');
  await scope.getByLabel('Text operation',{exact:true}).selectOption('collapse-spaces');await scope.getByRole('button',{name:'Demonstrate operation',exact:true}).click();await expect(scope.getByLabel('Current demonstration result',{exact:true})).toHaveJSProperty('textContent','River Dock');
  await scope.getByRole('button',{name:'Stop and use demonstration',exact:true}).click();
  await scope.getByRole('button',{name:'Add check',exact:true}).click();await expect(scope.getByRole('region',{name:'Exact test results',exact:true})).toContainText('Fail');await expect(scope.getByRole('button',{name:'Save tested version',exact:true})).toBeDisabled();
  await scope.getByRole('button',{name:'Add exception',exact:true}).click();await expect(scope).toContainText('Draft checks: 2 / 2 passing.');
  await scope.getByRole('button',{name:'Save tested version',exact:true}).click();await expect(scope.getByRole('button',{name:'Run active helper',exact:true})).toBeDisabled();await expect(scope.getByRole('region',{name:'Versions',exact:true})).toContainText('Active version: none.');
  await scope.getByRole('button',{name:'Activate version 1',exact:true}).click();await run(scope,'  New   Dock  ','New Dock');await shot(page,scope.getByLabel('Helper result',{exact:true}),'full-version1-fresh-result');
  await showDetails(scope,'Teach or change this helper');await scope.getByLabel('Text operation',{exact:true}).selectOption('uppercase');await scope.getByRole('button',{name:'Add as correction',exact:true}).click();await showDetails(scope,'Exceptions and checks');
  const example=scope.getByRole('row').filter({hasText:'Recorded local demonstration (example)'});await example.getByRole('button',{name:'Edit check',exact:true}).click();await scope.getByLabel('Expected text',{exact:true}).fill('RIVER DOCK');await scope.getByRole('button',{name:'Save check correction',exact:true}).click();await expect(scope).toContainText('Draft checks: 2 / 2 passing.');
  await showDetails(scope,'Saved versions');await scope.getByLabel('What changed?',{exact:true}).fill('Uppercase ordinary labels; preserve protected labels.');await scope.getByRole('button',{name:'Save tested version',exact:true}).click();await expect(scope.getByRole('region',{name:'Versions',exact:true})).toContainText('Active version: 1.');
  await run(scope,'  West   Pier  ','West Pier');await scope.getByRole('button',{name:'Activate version 2',exact:true}).click();await run(scope,'  West   Pier  ','WEST PIER');await shot(page,scope.getByRole('region',{name:'Versions',exact:true}).getByRole('heading'),'full-tested-version-history');
  await scope.getByRole('button',{name:'Roll back to version 1',exact:true}).click();await run(scope,'  Cedar   Quay  ','Cedar Quay');await shot(page,scope.getByLabel('Helper result',{exact:true}),'full-rollback-fresh-result');await run(scope,'KEEP:   Dock  ','KEEP:   Dock  ');
  const tasks=await onlyLocal(entry,1,1),owner=tasks.find(task=>task.title==='Label workshop')!,artifact=owner.artifacts.find(item=>item.revisions.at(-1)!.mimeType===MODULE_MIME)!,module=parseModuleAnswer(JSON.parse(artifact.revisions[0].content)).modules[0],state=helperStudio.parseState(module.data,owner.session!.moduleStates[0].state);
  expect(state).toMatchObject({activeVersion:1,versions:[{version:1},{version:2}],lastRun:{version:1,input:'KEEP:   Dock  ',result:{kind:'output',text:'KEEP:   Dock  '}}});
  await document(page).getByRole('button',{name:'Save as document',exact:true}).click();await expect(document(page).getByRole('heading',{name:'Text helper notes',exact:true})).toBeVisible();
  await expect(document(page)).toContainText('Recorded demonstration for check 2');await expect(document(page)).toContainText('Current draft checks');await expect(document(page)).toContainText('Last run used version 1.');await expect(document(page)).not.toContainText('helperId');await expect(document(page)).not.toContainText('expectedRevision');
  await shot(page,document(page).getByRole('heading',{name:'Saved versions',exact:true}),'full-readable-saved-notes');
  const withNotes=await entry.fixture.core.getTask(owner.id),notes=withNotes.artifacts.find(item=>item.revisions.at(-1)!.title==='Text helper notes')!.revisions.at(-1)!;
  expect(notes.sourceRefs).toEqual([]);for(const internal of [owner.id,artifact.id,module.id,state.helperId])expect(notes.content).not.toContain(internal);
  await back(page);await menu(page,'Activity');await page.getByRole('dialog',{name:'Activity',exact:true}).getByRole('button',{name:'Text helper · Revision 1',exact:true}).click();const reviewed=page.getByRole('region',{name:'Saved revision',exact:true});await expect(reviewed).toContainText('Last run used version 1.');await expect(reviewed).not.toContainText('helperId');await shot(page,reviewed.getByRole('heading',{name:'Latest run — version 1',exact:true}),'full-readable-activity-projection');
  const beforeRestart=(await entry.fixture.core.getTask(owner.id)).session!.moduleStates;await entry.fixture.restart();await expect(workspace(page).getByRole('heading',{name:'Label workshop',exact:true})).toBeVisible();await menu(page,'Files');await page.getByRole('dialog',{name:'Files',exact:true}).getByRole('button',{name:/^Text helper notes Document/}).click();await expect(document(page)).toContainText('Recorded demonstration for check 2');await expect(document(page)).toContainText('Last run used version 1.');await back(page);await menu(page,'Files');await page.getByRole('dialog',{name:'Files',exact:true}).getByRole('button',{name:/^Text helper Document/}).click();scope=helper(page);await expect(scope.getByLabel('Helper result',{exact:true})).toHaveJSProperty('textContent','KEEP:   Dock  ');expect((await entry.fixture.core.getTask(owner.id)).session!.moduleStates).toEqual(beforeRestart);
  await onlyLocal(entry,1,1);await record(entry,'teaching-versions-restart-ledger');
 }finally{await entry.close();}
});

test('saved-helper discovery reopens the exact owner, protects drafts and yields to a newer context in full and compact views',async({page})=>{
 const entry=await textHelperEntry(page);
 try{
  await onboard(page,entry);await startDraft(page,'Helper owner');await createHelper(page);let scope=helper(page);await rename(scope,'Trim labels');
  await scope.getByRole('button',{name:'Start demonstration',exact:true}).click();await scope.getByRole('button',{name:'Demonstrate operation',exact:true}).click();await scope.getByRole('button',{name:'Stop and use demonstration',exact:true}).click();await scope.getByLabel('Test input',{exact:true}).fill('');await scope.getByLabel('Expected text',{exact:true}).fill('');await scope.getByRole('button',{name:'Add check',exact:true}).click();await scope.getByRole('button',{name:'Save tested version',exact:true}).click();
  await back(page);await openLibrary(page);let item=library(page).getByRole('article',{name:'Trim labels in Helper owner',exact:true});await expect(item).toContainText('Inactive · Saved version 1');await item.getByRole('button',{name:'Open helper',exact:true}).click();scope=helper(page);await showDetails(scope,'Saved versions');await scope.getByRole('button',{name:'Activate version 1',exact:true}).click();
  await back(page);await workspace(page).getByRole('textbox',{name:'Ask about this task',exact:true}).fill('Keep the owner question unsent.');
  await startDraft(page,'Different task');await workspace(page).getByRole('textbox',{name:'Ask about this task',exact:true}).fill('Keep this other task question unsent.');
  let tasks=await onlyLocal(entry,1,2),owner=tasks.find(task=>task.title==='Helper owner')!,other=tasks.find(task=>task.title==='Different task')!,ownerArtifact=owner.artifacts.find(artifact=>artifact.revisions.at(-1)!.mimeType===MODULE_MIME)!;
  await openLibrary(page);item=library(page).getByRole('article',{name:'Trim labels in Helper owner',exact:true});await expect(item).toContainText('Active version 1');await item.getByRole('button',{name:'Open helper',exact:true}).click();await expect(workspace(page).getByRole('heading',{name:'Helper owner',exact:true})).toBeVisible();scope=helper(page);await expect(scope.getByLabel('Fresh text',{exact:true})).toBeVisible();await expect(scope.getByLabel('Demonstration input',{exact:true})).toBeHidden();
  await showDetails(scope,'Name and discovery label');await scope.getByLabel('Helper name',{exact:true}).fill('Unsaved label rename');await workspace(page).getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'New task',exact:true}).click();const guard=page.getByRole('dialog',{name:'Keep your unsaved edits?',exact:true});await expect(guard).toBeVisible();await page.setViewportSize({width:360,height:640});await shot(page,guard.getByRole('heading'),'narrow-workspace-dirty-helper-navigation');await page.setViewportSize({width:1080,height:800});await guard.getByRole('button',{name:'Keep editing',exact:true}).click();await expect(scope.getByLabel('Helper name',{exact:true})).toHaveValue('Unsaved label rename');await expect(workspace(page).getByRole('heading',{name:'Helper owner',exact:true})).toBeVisible();await scope.getByRole('button',{name:'Apply details',exact:true}).click();
  await back(page);await expect(workspace(page).getByRole('textbox',{name:'Ask about this task',exact:true})).toHaveValue('Keep the owner question unsent.');await selectTask(page,'Different task');await expect(workspace(page).getByRole('textbox',{name:'Ask about this task',exact:true})).toHaveValue('Keep this other task question unsent.');await openLibrary(page);await library(page).getByRole('article',{name:'Trim labels in Helper owner',exact:true}).getByRole('button',{name:'Open helper',exact:true}).click();
  await back(page);await workspace(page).getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:640});const compact=page.locator('.compact-companion:visible');await expect(compact).toBeVisible();await run(compact.locator('.helper-studio'),' Birch ','Birch');await shot(page,compact.getByLabel('Helper result',{exact:true}),'compact-original-helper-result');
  await compact.getByRole('button',{name:'Open task workspace',exact:true}).click();await openLibrary(page);item=library(page).getByRole('article',{name:'Trim labels in Helper owner',exact:true});await expect(item).toContainText('Active version 1');await shot(page,item.getByRole('heading'),'narrow-workspace-saved-helper-library');expect(await page.evaluate(()=>window.document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.setViewportSize({width:1080,height:800});await item.getByRole('button',{name:'Open helper',exact:true}).click();
  const navigationNotes=entry.holdNextNotesResponse();await document(page).getByRole('button',{name:'Save as document',exact:true}).click();await navigationNotes.arrived;
  const notesBeforeRelease=(await entry.fixture.core.getTask(owner.id)).artifacts.filter(artifact=>artifact.revisions.at(-1)!.title==='Text helper notes');expect(notesBeforeRelease).toHaveLength(1);const noteId=notesBeforeRelease[0].id;
  await back(page);await menu(page,'Files');await page.getByRole('dialog',{name:'Files',exact:true}).getByRole('button',{name:/^Helper owner Document/}).click();await expect(document(page).getByRole('heading',{name:'Helper owner',exact:true})).toBeVisible();navigationNotes.release();await navigationNotes.delivered;await nextPaint(page);await expect(document(page).getByRole('heading',{name:'Helper owner',exact:true})).toBeVisible();
  await back(page);await menu(page,'Files');await page.getByRole('dialog',{name:'Files',exact:true}).getByRole('button',{name:/^Text helper Document/}).click();const activationNotes=entry.holdNextNotesResponse();await document(page).getByRole('button',{name:'Save as document',exact:true}).click();await activationNotes.arrived;
  const notesActivation='owned-synthetic-context-during-helper-notes';await entry.fixture.emit({type:'context.activate',activation:{activationId:notesActivation,tucked:false,ownerTaskId:owner.id,choices:[]}});await expect(page.getByRole('region',{name:'Screen context',exact:true})).toBeVisible();activationNotes.release();await activationNotes.delivered;await nextPaint(page);
  await expect(page.getByRole('region',{name:'Screen context',exact:true})).toBeVisible();await expect(document(page)).toHaveCount(0);expect(entry.fixture.commands.filter(command=>command.type==='context.cancel'&&command.activationId===notesActivation)).toEqual([]);expect((await entry.fixture.core.getTask(owner.id)).artifacts.filter(artifact=>artifact.revisions.at(-1)!.title==='Text helper notes').map(artifact=>artifact.id)).toEqual([noteId]);expect((await entry.fixture.core.getTask(owner.id)).session?.draft).toBe('Keep the owner question unsent.');expect((await entry.fixture.core.getTask(other.id)).session?.draft).toBe('Keep this other task question unsent.');await page.getByRole('region',{name:'Screen context',exact:true}).getByRole('button',{name:'Cancel',exact:true}).click();
  await selectTask(page,'Different task');await openLibrary(page);const read=entry.holdNextTaskRead(owner.id);await library(page).getByRole('article',{name:'Trim labels in Helper owner',exact:true}).getByRole('button',{name:'Open helper',exact:true}).click();await read.arrived;
  const lookupActivation='owned-synthetic-context-during-helper-lookup';await entry.fixture.emit({type:'context.activate',activation:{activationId:lookupActivation,tucked:false,ownerTaskId:other.id,choices:[]}});await expect(page.getByRole('region',{name:'Screen context',exact:true}).getByRole('heading',{name:'Which window?',exact:true})).toBeVisible();read.release();await read.delivered;await nextPaint(page);
  await expect(workspace(page).getByRole('heading',{name:'Different task',exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Screen context',exact:true})).toBeVisible();expect(entry.fixture.commands.filter(command=>command.type==='context.cancel'&&command.activationId===lookupActivation)).toEqual([]);await page.getByRole('region',{name:'Screen context',exact:true}).getByRole('button',{name:'Cancel',exact:true}).click();
  await menu(page,'Files');const navigationFiles=page.getByRole('dialog',{name:'Files',exact:true}),navigationCreation=entry.holdNextCreationResponse();await navigationFiles.getByRole('button',{name:'New file',exact:true}).click();await navigationFiles.getByRole('button',{name:'Text helper',exact:true}).click();await navigationCreation.arrived;
  await navigationFiles.getByRole('button',{name:/^Different task Document/}).click();await expect(document(page).getByRole('heading',{name:'Different task',exact:true})).toBeVisible();navigationCreation.release();await navigationCreation.delivered;await nextPaint(page);await expect(document(page).getByRole('heading',{name:'Different task',exact:true})).toBeVisible();await expect(helper(page)).toHaveCount(0);await back(page);
  await menu(page,'Files');const files=page.getByRole('dialog',{name:'Files',exact:true}),creation=entry.holdNextCreationResponse();await files.getByRole('button',{name:'New file',exact:true}).click();await files.getByRole('button',{name:'Text helper',exact:true}).click();await creation.arrived;
  const creationActivation='owned-synthetic-context-during-helper-create';await entry.fixture.emit({type:'context.activate',activation:{activationId:creationActivation,tucked:false,ownerTaskId:other.id,choices:[]}});await expect(page.getByRole('region',{name:'Screen context',exact:true})).toBeVisible();creation.release();await creation.delivered;await nextPaint(page);await expect(page.getByRole('region',{name:'Screen context',exact:true})).toBeVisible();await expect(document(page)).toHaveCount(0);expect(entry.fixture.commands.filter(command=>command.type==='context.cancel'&&command.activationId===creationActivation)).toEqual([]);
  tasks=await onlyLocal(entry,3,2);owner=tasks.find(task=>task.id===owner.id)!;other=tasks.find(task=>task.id===other.id)!;expect(owner.artifacts.find(artifact=>artifact.id===ownerArtifact.id)).toBeDefined();expect(owner.artifacts.filter(artifact=>artifact.revisions.at(-1)!.mimeType===MODULE_MIME)).toHaveLength(1);expect(other.artifacts.filter(artifact=>artifact.revisions.at(-1)!.mimeType===MODULE_MIME)).toHaveLength(2);expect(owner.session?.draft).toBe('Keep the owner question unsent.');expect(other.session?.draft).toBe('Keep this other task question unsent.');await record(entry,'discovery-drafts-context-ledger');
 }finally{await entry.close();}
});
