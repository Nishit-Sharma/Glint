import {expect,test,type Page} from '@playwright/test';
import {localTaskDurableEntry} from './local-task-durable-app.fixture';
import {pickingPublicFrame as frame} from './saved-text-source-frame';
import {taskTool} from './ui-tools';

test.use({viewport:{width:1080,height:800}});

const workspace=(page:Page)=>page.locator('.workspace:visible');
const context=(page:Page)=>workspace(page).getByRole('dialog',{name:'Context',exact:true});
const snapshot=(page:Page)=>context(page).getByRole('region',{name:'Source snapshot',exact:true});
const files=(page:Page)=>workspace(page).getByRole('dialog',{name:'Files',exact:true});
const document=(page:Page)=>workspace(page).getByRole('dialog',{name:'Document',exact:true});

test('find saved work for a changed source and reopen it without changing its basis',async({page},info)=>{
 const entry=await localTaskDurableEntry(page,Number(process.env.WINDOW_COMPANION_TEST_PORT??4180)),frames:unknown[]=[];
 try{
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await workspace(page).getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'New task',exact:true}).click();
  await workspace(page).getByRole('button',{name:'Paste text',exact:true}).click();
  const start=workspace(page).getByRole('region',{name:'Start with text',exact:true});await start.getByRole('textbox',{name:'Title (optional)',exact:true}).fill('Owned source continuity');await start.getByRole('textbox',{name:'Source text',exact:true}).fill('Original source A.');await start.getByRole('button',{name:'Create task',exact:true}).click();
  await expect(snapshot(page)).toContainText('Original source A.');const created=(await entry.fixture.core.listTasks()).find(t=>t.title==='Owned source continuity')!;const a=created.sources[0],a1={sourceId:a.id,version:1,digest:a.versions[0].digest};
  await taskTool(page,'Files');await files(page).getByRole('button',{name:'New file',exact:true}).click();await files(page).getByRole('button',{name:'Draft',exact:true}).click();
  await document(page).getByRole('textbox',{name:'Draft title',exact:true}).fill('Source A notes');
  const body=document(page).getByRole('textbox',{name:'Draft content',exact:true});if(await body.evaluate(el=>el.tagName)!=='TEXTAREA'){await document(page).getByRole('button',{name:'Document options',exact:true}).click();await document(page).getByRole('button',{name:'Edit Markdown',exact:true}).click();}
  await body.fill('Preserve this original answer.');await document(page).getByRole('button',{name:'Save draft',exact:true}).click();await expect(document(page)).toHaveCount(0);
  const saved=await entry.fixture.core.getTask(created.id),artifact=structuredClone(saved.artifacts[0]);expect(artifact.revisions[0].sourceRefs).toEqual([a1]);
  await taskTool(page,'Sources');await context(page).getByRole('button',{name:'Add source',exact:true}).click();await context(page).getByRole('button',{name:'Paste text',exact:true}).click();await context(page).getByLabel('Source name (optional)',{exact:true}).fill('Unrelated B');await context(page).getByLabel('Source text',{exact:true}).fill('Independent source B.');await context(page).getByRole('button',{name:'Add text',exact:true}).click();await expect(snapshot(page)).toContainText('Independent source B.');await expect(snapshot(page).getByRole('region',{name:'Saved work to review'})).toHaveCount(0);
  await snapshot(page).getByRole('button',{name:'All context',exact:true}).click();await context(page).getByRole('button',{name:'Owned source continuity Source material',exact:true}).click();await snapshot(page).getByRole('button',{name:'Source options',exact:true}).click();await snapshot(page).getByRole('button',{name:'Edit / refresh',exact:true}).click();await context(page).getByLabel('Source text',{exact:true}).fill('Changed source A.');await context(page).getByRole('button',{name:'Save new version',exact:true}).click();
  const affected=snapshot(page).getByRole('region',{name:'Saved work to review',exact:true});await expect(affected).toContainText('Source A notes');await expect(affected).toContainText('Version 1');frames.push(await frame(page,affected.getByRole('heading',{name:'Saved work to review',exact:true}),'01-changed-source-work'));
  const changed=await entry.fixture.core.getTask(created.id);expect(changed.sources[0].currentVersion).toBe(2);expect(changed.artifacts[0]).toEqual(artifact);
  await affected.getByRole('button',{name:/Source A notes/}).click();await expect(document(page)).toBeVisible();await expect(document(page)).toContainText('Preserve this original answer.');frames.push(await frame(page,document(page).getByRole('heading',{name:'Source A notes',exact:true}),'02-open-earlier-result'));expect((await entry.fixture.core.getTask(created.id)).artifacts[0]).toEqual(artifact);
  await entry.recreateCoreAndStore();await taskTool(page,'Sources');await context(page).getByRole('button',{name:'Owned source continuity Source material',exact:true}).click();const reopened=snapshot(page).getByRole('region',{name:'Saved work to review',exact:true});await expect(reopened).toContainText('Version 1');frames.push(await frame(page,reopened.getByRole('heading',{name:'Saved work to review',exact:true}),'03-reopened-work'));await reopened.getByRole('button',{name:/Source A notes/}).click();await expect(document(page)).toContainText('Preserve this original answer.');expect((await entry.fixture.core.getTask(created.id)).artifacts[0]).toEqual(artifact);
  expect(entry.fixture.commands.filter(c=>/^(windows\.capture|context\.(start|capture)|source\.follow|model\.run|browser\.run|export\.)/.test(c.type))).toEqual([]);
  await info.attach('source-continuity-boundary',{body:JSON.stringify({scope:'Public text source, saved document, source edit and source-specific navigation; actual disposable core/store and synthetic renderer/core recreation. No native capture, follow, provider or live freshness claim.',source:a1,artifact,frames,commands:entry.fixture.commands,external:entry.fixture.external},null,2),contentType:'application/json'});
 }finally{await entry.close();}
});
