import {seedReturningProfile} from '../support/native-profile';
import {test,expect,_electron as electron,type ElectronApplication,type Page} from '@playwright/test';
import {mkdtemp,mkdir,writeFile,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import type {Task} from '../../src/shared/bridge';
import type {OtherCommand} from '../../src/shared/export-contract';

const root=resolve('..');
async function invoke<T=unknown>(page:Page,command:OtherCommand){return page.evaluate(command=>window.companion.invoke(command),command) as Promise<T>;}
async function launch(dir:string){
 await seedReturningProfile(dir);
 await mkdir(dir,{recursive:true});await writeFile(join(dir,'provider.json'),JSON.stringify({provider:'meta'}));
 const app=await electron.launch({args:[root],env:{...process.env,WINDOW_COMPANION_DATA_DIR:dir,WINDOW_COMPANION_TEST_NO_GLOBAL_INPUT:'1',MODEL_API_KEY:'synthetic-unused-draft-test',META_API_KEY:''}});
 const page=await app.firstWindow();await expect(page.locator('.workspace')).toBeVisible({timeout:20000});await invoke(page,{type:'surface.standalone'});await page.emulateMedia({reducedMotion:'reduce'});return {app,page};
}
async function quit(app:ElectronApplication){const closed=app.waitForEvent('close');await app.evaluate(({app})=>{setTimeout(()=>app.quit(),0);});await closed;}
const taskButton=(page:Page,title:string)=>page.getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:title,exact:true});

test('normal native Quit immediately after typing retains exact per-task drafts and mode, including anchor Quit',async()=>{
 test.setTimeout(90000);const dir=await mkdtemp(join(tmpdir(),'companion-native-drafts-'));let current=await launch(dir);
 try{
  const a=await invoke<Task>(current.page,{type:'tasks.create',title:'Owned draft Alpha'});await invoke(current.page,{type:'tasks.create',title:'Owned draft Beta'});await taskButton(current.page,'Owned draft Alpha').click();await expect(current.page.locator('.workspace h1')).toHaveText(a.title);
  const alpha='  Exact native draft — α 👋\nkeep the spacing.  ',beta='Independent Beta draft.';
  await current.page.getByLabel('Ask about this task',{exact:true}).fill(alpha);await current.page.getByRole('button',{name:'Request options',exact:true}).click();await current.page.getByLabel('Request type',{exact:true}).selectOption('create');
  await taskButton(current.page,'Owned draft Beta').click();await current.page.getByLabel('Ask about this task',{exact:true}).fill(beta);await quit(current.app);
  current=await launch(dir);await expect(current.page.locator('.workspace h1')).toHaveText('Owned draft Beta');await expect(current.page.getByLabel('Ask about this task',{exact:true})).toHaveValue(beta);await taskButton(current.page,'Owned draft Alpha').click();await expect(current.page.getByLabel('Ask about this task',{exact:true})).toHaveValue(alpha);await current.page.getByRole('button',{name:'Request options',exact:true}).click();await expect(current.page.getByLabel('Request type',{exact:true})).toHaveValue('create');
  await taskButton(current.page,'Owned draft Beta').click();await expect(current.page.getByLabel('Ask about this task',{exact:true})).toHaveValue(beta);
  await current.page.getByLabel('Ask about this task',{exact:true}).fill(beta+' Kept after anchor.');await invoke(current.page,{type:'surface.collapse'});await expect(current.page.locator('.anchor-wrap')).toBeVisible();await quit(current.app);
  current=await launch(dir);await taskButton(current.page,'Owned draft Beta').click();await expect(current.page.getByLabel('Ask about this task',{exact:true})).toHaveValue(beta+' Kept after anchor.');await taskButton(current.page,'Owned draft Alpha').click();await expect(current.page.getByLabel('Ask about this task',{exact:true})).toHaveValue(alpha);
  await mkdir('evidence/native-drafts',{recursive:true});await current.page.screenshot({path:'evidence/native-drafts/restored-alpha.png'});await writeFile('evidence/native-drafts/result.json',JSON.stringify({status:'passed',utc:new Date().toISOString(),scope:'Actual owned Electron/main IPC/atomic store and native app.quit lifecycle. Synthetic text, fake unused Meta key; zero model requests/capture. Global input disabled. Visible Quit and anchor Quit across three launches. Physical Command-Q not simulated.',dataDir:dir,exactTwoTaskText:true,modeRetained:true,anchorQuit:true},null,2));
 }finally{await current.app.close().catch(()=>{});}
});

test('a real native store failure preserves local text on Keep open and permits only explicit discard',async()=>{
 test.setTimeout(45000);const dir=await mkdtemp(join(tmpdir(),'companion-native-draft-failure-'));const {app,page}=await launch(dir);
 try{
  await invoke(page,{type:'tasks.create',title:'Owned failed draft'});await taskButton(page,'Owned failed draft').click();await expect(page.locator('.workspace h1')).toHaveText('Owned failed draft');
  await rename(join(dir,'tasks.json'),join(dir,'acknowledged-before-failure.json'));await mkdir(join(dir,'tasks.json'));
  await page.getByLabel('Ask about this task',{exact:true}).fill('Keep this local message after disk failure.');await expect(page.locator('.workspace')).toContainText('Your message could not be saved');
  await app.evaluate(({dialog})=>{Reflect.set(globalThis,'__draftDiscardChoice',0);Reflect.set(globalThis,'__draftDiscardQuestions',0);dialog.showMessageBox=async(...args:any[])=>{const options=args.at(-1);if(options.message==='Quit without saving messages?'){Reflect.set(globalThis,'__draftDiscardQuestions',Reflect.get(globalThis,'__draftDiscardQuestions')+1);return {response:Reflect.get(globalThis,'__draftDiscardChoice'),checkboxChecked:false};}return {response:0,checkboxChecked:false};};});
  await app.evaluate(({app})=>{setTimeout(()=>app.quit(),0);});await expect.poll(()=>app.evaluate(()=>Reflect.get(globalThis,'__draftDiscardQuestions'))).toBe(1);await expect(page.getByLabel('Ask about this task',{exact:true})).toHaveValue('Keep this local message after disk failure.');await expect(page.getByLabel('Ask about this task',{exact:true})).toBeEnabled();
  await app.evaluate(()=>Reflect.set(globalThis,'__draftDiscardChoice',1));await quit(app);
 }finally{await app.close().catch(()=>{});}
});
