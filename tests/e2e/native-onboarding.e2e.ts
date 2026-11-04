import {test,expect,_electron as electron,type ElectronApplication,type Page} from '@playwright/test';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir,platform,arch} from 'node:os';
import {join,resolve} from 'node:path';
import type {Task} from '../../src/shared/bridge';
import type {OtherCommand} from '../../src/shared/export-contract';
import type {CaptureState} from '../../src/shared/capture-policy';
import type {BotState} from '../../src/shared/bot-catalog';
const root=resolve('..');
const invoke=<T,>(page:Page,command:OtherCommand)=>page.evaluate(command=>window.companion.invoke(command),command) as Promise<T>;
async function open(directory:string){
 const app=await electron.launch({args:[root],env:{...process.env,WINDOW_COMPANION_DATA_DIR:directory,WINDOW_COMPANION_TEST_NO_GLOBAL_INPUT:'1'}});
 return {app,page:await app.firstWindow()};
}
async function quit(app:ElectronApplication){const closed=app.waitForEvent('close');await app.evaluate(({app})=>{setTimeout(()=>app.quit(),0);});await closed;}
test('fresh native character choice reaches local value and preserves bot, selected task, choices and draft after normal quit',async()=>{
 test.setTimeout(90000);await mkdir('evidence',{recursive:true});const directory=await mkdtemp(join(tmpdir(),'companion-native-first-run-'));let current=await open(directory);
 try{
  await expect(current.page.getByRole('heading',{name:'Choose your companion',exact:true})).toBeVisible();
  await current.page.emulateMedia({reducedMotion:'reduce'});
  await current.page.getByRole('radio',{name:'Star',exact:true}).click();
  await current.page.getByRole('radio',{name:'Sage',exact:true}).click();
  await current.page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(current.page.getByText('Local example · Bundled on this device')).toBeVisible();
  const tasks=await invoke<Task[]>(current.page,{type:'tasks.list'});expect(tasks).toHaveLength(1);const id=tasks[0].id;
  const checkbox=current.page.locator('#main').getByRole('checkbox',{name:/Arrive by 17:50/});await checkbox.click();await expect(checkbox).toBeChecked();
  await current.page.getByRole('textbox',{name:'Ask about this task',exact:true}).fill('Keep this question through normal quit.');
  await expect.poll(async()=>(await invoke<Task>(current.page,{type:'tasks.get',taskId:id})).session?.draft).toBe('Keep this question through normal quit.');
  const catalog=await invoke<BotState>(current.page,{type:'bots.get'});expect(catalog.kind).toBe('available');
  const saved=await invoke<Task>(current.page,{type:'tasks.get',taskId:id});expect(saved.requests).toEqual([]);expect(saved.actions).toEqual([]);expect(saved.sources.every(source=>source.versions.every(version=>version.kind==='text'))).toBe(true);
  const settings=await invoke<CaptureState>(current.page,{type:'capture.settings.get'});expect(settings).toMatchObject({kind:'available',current:{policy:{setupApproval:'not-approved'}}});
  await quit(current.app);current=await open(directory);await current.page.emulateMedia({reducedMotion:'reduce'});
  await expect(current.page.getByText('Local example · Bundled on this device')).toBeVisible();await expect(current.page.getByRole('textbox',{name:'Ask about this task',exact:true})).toHaveValue('Keep this question through normal quit.');
  await expect(current.page.locator('#main').getByRole('checkbox',{name:/Arrive by 17:50/})).toBeChecked();expect(await invoke<BotState>(current.page,{type:'bots.get'})).toEqual(catalog);
  const restored=await invoke<Task>(current.page,{type:'tasks.get',taskId:id});expect(restored.assignedBotId).toBe(saved.assignedBotId);expect(restored.requests).toEqual([]);expect(restored.actions).toEqual([]);expect(restored.sources).toEqual(saved.sources);
  await expect(current.page.locator('.workspace:not([hidden])')).toHaveAttribute('data-surface-reveal',/^(settled|cancelled)$/);
  const png=await current.app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows().find(window=>window.getTitle()==='Glint')!.webContents.capturePage()).toPNG().toString('base64'));
  await writeFile('evidence/native-onboarding.png',Buffer.from(png,'base64'));
  await writeFile('evidence/native-onboarding.json',JSON.stringify({utc:new Date().toISOString(),scope:'Actual Electron first-run UI/IPC/stores/normal quit and relaunch; local bundled example. No native input chord, external target capture, provider call or browser action.',platform:platform(),arch:arch(),botIdentityRestored:true,taskRestored:true,draftRestored:true,moduleChoiceRestored:true,automaticWindowSources:0,requests:0,actions:0},null,2));
 }finally{await current.app.close().catch(()=>{});await rm(directory,{recursive:true,force:true});}
});
