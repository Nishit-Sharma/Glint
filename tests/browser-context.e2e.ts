import {test,expect} from '@playwright/test';
import {BrowserFixture} from './browser-fixture';
import {emptyTaskSession} from '../src/core/task-session';

let fixture:BrowserFixture;
let releaseBrowser=()=>{};
test.afterEach(async()=>{releaseBrowser();releaseBrowser=()=>{};await fixture?.close();});
test.use({viewport:{width:1080,height:760},reducedMotion:'reduce'});
async function bind(){const current=await fixture.core.getTask(fixture.taskA.id);await fixture.core.replaceSession(fixture.taskA.id,current.session?.revision??0,{...emptyTaskSession(),browserContext:{origin:'http://127.0.0.1:1234',url:'http://127.0.0.1:1234/catalogue',requestId:'earlier-browser'}});await fixture.changed(fixture.taskA.id);}

test('a delayed no-task shortcut cannot create or select a new task after another task is selected',async({page})=>{
 fixture=await BrowserFixture.open(page);await expect(page.locator('.workspace h1')).toHaveText('Task Alpha');await expect.poll(()=>fixture.commands.some(command=>command.type==='context.view'&&command.taskId===fixture.taskA.id)).toBe(true);const before=await fixture.core.listTasks(),activationId=crypto.randomUUID();
 await fixture.emit({type:'context.activate',activation:{activationId,tucked:false,trigger:'shortcut',newTask:true,target:{id:'window:99',title:'Owned delayed guide',owner:{name:'Owned viewer'},bounds:{x:0,y:0,width:600,height:400}},choices:[]}});
 await expect.poll(()=>fixture.commands.some(command=>command.type==='context.cancel'&&command.activationId===activationId)).toBe(true);
 expect(await fixture.core.listTasks()).toEqual(before);expect(fixture.commands.some(command=>command.type==='context.capture')).toBe(false);await expect(page.locator('.workspace h1')).toHaveText('Task Alpha');
});

test('active browser context is visible and removable without losing the current draft',async({page})=>{
 fixture=await BrowserFixture.open(page);await bind();const input=page.getByLabel('Ask about this task',{exact:true});await input.fill('Keep this unsent question.');
 await expect(page.locator('.workspace').getByLabel('Current browser context')).toContainText('Using 127.0.0.1');
 await page.locator('.workspace').getByRole('button',{name:'Stop using browser context',exact:true}).click();
 await expect(page.locator('.workspace').getByLabel('Current browser context')).toHaveCount(0);await expect(input).toHaveValue('Keep this unsent question.');expect((await fixture.core.getTask(fixture.taskA.id)).session?.browserContext).toBeUndefined();
 await page.reload();await expect(page.getByLabel('Ask about this task',{exact:true})).toBeVisible();await expect(page.locator('.workspace').getByLabel('Current browser context')).toHaveCount(0);expect(fixture.externalRequests).toEqual([]);
});

test('explicit source selection retires browser routing durably before the next request',async({page})=>{
 fixture=await BrowserFixture.open(page);await bind();await page.getByRole('button',{name:'Request options',exact:true}).click();await page.locator('.workspace').getByText('Choose sources',{exact:true}).click();
 await expect(page.locator('.workspace .request-source-options input[type=checkbox]').first()).not.toBeChecked();
 await page.getByRole('button',{name:'Select all',exact:true}).click();await expect(page.locator('.workspace').getByLabel('Current browser context')).toHaveCount(0);
 expect((await fixture.core.getTask(fixture.taskA.id)).session?.browserContext).toBeUndefined();await page.reload();await expect(page.locator('.workspace').getByLabel('Current browser context')).toHaveCount(0);expect(fixture.commands.some(command=>command.type==='browser.run'||command.type==='model.run')).toBe(false);
});

test('terminal browser failure removes obsolete reading progress while retaining the failure',async({page})=>{
 fixture=await BrowserFixture.open(page);await bind();fixture.browserError='Invalid model draft schemaVersion: fixture failure';
 await page.getByLabel('Ask about this task',{exact:true}).fill('Use my saved choice.');await page.getByRole('button',{name:'Ask',exact:true}).click();
 await expect.poll(async()=>(await fixture.core.getTask(fixture.taskA.id)).requests.at(-1)?.status).toBe('failed');
 await expect(page.locator('.workspace')).not.toContainText('Reading the selected page…');await expect(page.locator('.workspace')).toContainText('could not be turned into a usable draft');await expect(page.locator('.workspace')).not.toContainText('0 browser steps');
});

for(const newer of ['none','different','edited-back-to-same'] as const)test('browser completion clears only its submitted draft: '+newer,async({page})=>{
 fixture=await BrowserFixture.open(page);await bind();fixture.browserCompletion=new Promise<void>(resolve=>releaseBrowser=resolve);
 const input=page.getByLabel('Ask about this task',{exact:true}),submitted='Use my saved choice.';await input.fill(submitted);await page.getByRole('button',{name:'Ask',exact:true}).click();
 await expect.poll(async()=>(await fixture.core.getTask(fixture.taskA.id)).requests.at(-1)?.status).toBe('running');
 if(newer!=='none'){await input.fill('A newer unsent draft.');if(newer==='edited-back-to-same')await input.fill(submitted);}
 releaseBrowser();await expect.poll(async()=>(await fixture.core.getTask(fixture.taskA.id)).requests.at(-1)?.status).toBe('completed');
 await expect(input).toHaveValue(newer==='none'?'':newer==='different'?'A newer unsent draft.':submitted);
});

for(const observed of [false,true])test('plain browser answers show only real available observation disclosure: '+observed,async({page})=>{
 fixture=await BrowserFixture.open(page);const taskId=fixture.taskA.id;
 await fixture.core.runRequest({taskId,requestId:'plain-browser',kind:'browser',prompt:'Read a page',sourceIds:[]},async()=>({title:'Browser findings',content:JSON.stringify({schemaVersion:1,markdown:'A readable plain answer.',modules:[]}),mimeType:'application/vnd.window-companion.modules+json'}));
 if(observed){const session=(await fixture.core.getTask(taskId)).session??emptyTaskSession();await fixture.core.replaceSession(taskId,session.revision,{...session,runs:[{id:'plain-browser',endpointKey:'fixture',origin:'https://observed.example',browserId:'owned-browser',initialObservation:{id:'observation',taskId,browserId:'owned-browser',documentId:'document',url:'https://observed.example/page',title:'Observed page',text:'Owned fixture observation',digest:'digest',targets:[]},operations:[]}]});}
 await fixture.changed(taskId);const disclosure=page.locator('.workspace .module-answer-sources');await expect(page.locator('.workspace')).toContainText('A readable plain answer.');
 if(observed){await disclosure.locator('summary').click();await expect(disclosure).toContainText('https://observed.example/page');}else await expect(disclosure).toHaveCount(0);
});
