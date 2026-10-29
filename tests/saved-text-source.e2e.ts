import {expect,test,type Page} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {savedTextSourceEntry} from './saved-text-source.fixture';
import {pickingPublicFrame as frame} from './saved-text-source-frame';
import {taskTool} from './ui-tools';

const title='Saved source continuity';
const applied='Original saved source.\nThis committed version stays unchanged.';
const raw={label:'Raw source name Ω',content:'Unsubmitted line one.\nUnsubmitted line two: keep exactly.',role:'inspiration'};
const workspace=(page:Page)=>page.locator('.workspace:visible');
const editor=(page:Page)=>page.getByRole('dialog',{name:'Context',exact:true});
const content=(page:Page)=>editor(page).getByRole('textbox',{name:'Source text',exact:true});
const label=(page:Page)=>editor(page).getByRole('textbox',{name:'Source name (optional)',exact:true});
const role=(page:Page)=>editor(page).getByRole('combobox',{name:'Use as',exact:true});
async function openSavedEditor(page:Page){
 await taskTool(page,'Sources');
 const source=editor(page).getByRole('button',{name:title+' Source material',exact:true});
 await expect(source).toHaveCount(1);await expect(source).toBeEnabled();await source.click();
 const snapshot=editor(page).getByRole('region',{name:'Source snapshot',exact:true});
 await expect(snapshot.getByRole('heading',{name:title,exact:true})).toBeVisible();
 await snapshot.getByRole('button',{name:'Source options',exact:true}).click();
 await snapshot.getByRole('button',{name:'Edit / refresh',exact:true}).click();
 await expect(content(page)).toBeEnabled();await expect(label(page)).toBeEnabled();await expect(role(page)).toBeEnabled();
 await expect(role(page)).toHaveCount(1);expect(await role(page).evaluate(element=>element.tagName)).toBe('SELECT');
}

test('ordinary saved text source keeps exact unapplied name content and role after controlled quit and fresh core/store reopen',async({page})=>{
 const entry=await savedTextSourceEntry(page),frames:unknown[]=[];
 try{
  expect(await entry.fixture.core.listTasks()).toEqual([]);
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByText('Local example · Bundled on this device',{exact:true})).toBeVisible();
  await workspace(page).getByRole('complementary',{name:'Task navigation',exact:true}).getByRole('button',{name:'New task',exact:true}).click();
  await workspace(page).getByRole('button',{name:'Paste text',exact:true}).click();
  const local=workspace(page).getByRole('region',{name:'Start with text',exact:true});
  await local.getByRole('textbox',{name:'Title (optional)',exact:true}).fill(title);
  await local.getByRole('textbox',{name:'Source text',exact:true}).fill(applied);
  await local.getByRole('button',{name:'Create task',exact:true}).click();
  await expect(editor(page).getByRole('region',{name:'Source snapshot',exact:true})).toContainText(applied);
  const task=(await entry.fixture.core.listTasks()).find(task=>task.title===title);expect(task).toBeDefined();
  if(!task)throw Error('Public saved source creation was not confirmed.');
  expect(task.sources).toHaveLength(1);const original=structuredClone(task.sources[0]);expect(original.versions).toHaveLength(1);
  await openSavedEditor(page);
  await label(page).fill(raw.label);await content(page).fill(raw.content);await role(page).selectOption(raw.role);
  await expect(editor(page).getByRole('button',{name:'Save new version',exact:true})).toBeEnabled();
  frames.push(await frame(page,content(page),'01-unapplied-source-before-quit',[
   {locator:content(page),kind:'value',expected:raw.content,name:'Exact unapplied source text'},
   {locator:label(page),kind:'value',expected:raw.label,name:'Exact unapplied source name'},
   {locator:role(page),kind:'value',expected:raw.role,name:'Exact unapplied source role'},
  ]));
  expect((await entry.fixture.core.getTask(task.id)).sources).toEqual([original]);
  await entry.quitAndRecreate();
  await expect(workspace(page).locator('.workspace-task h1')).toHaveText(title);
  await openSavedEditor(page);
  frames.push(await frame(page,content(page),'02-source-editor-after-reopen'));
  await page.setViewportSize({width:360,height:640});frames.push(await frame(page,content(page),'03-source-editor-after-reopen-compact'));await page.setViewportSize({width:1080,height:800});
  const restored={label:await label(page).inputValue(),content:await content(page).inputValue(),role:await role(page).inputValue()};
  const after=await entry.fixture.core.getTask(task.id);
  const ledger={boundary:'Actual App and actual core/sidecar; synthetic host flush and controlled recreation. No native quit claim.',raw,restored,original,after,events:entry.events,commands:entry.fixture.commands,sidecar:await entry.fixture.learningDrafts.read(),frames};
  const path=test.info().outputPath('saved-source-journey.json');await writeFile(path,JSON.stringify(ledger,null,2)+'\n');await test.info().attach('saved-source-journey',{path,contentType:'application/json'});
  expect(after.sources).toEqual([original]);expect(entry.creations).toHaveLength(1);
  expect(entry.fixture.configured).toBe(false);expect(entry.fixture.external).toEqual([]);
  expect(entry.fixture.commands.filter(command=>command.type==='source.text'||command.type==='model.run'||command.type==='browser.run'||command.type==='tasks.create'||command.type==='connection.configure'||/^(?:windows\.capture|context\.(?:start|capture)|export\.)/.test(command.type))).toEqual([]);
  expect(restored).toEqual(raw);
 }finally{await entry.close();}
});
