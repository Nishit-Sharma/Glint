import {expect,test,type Page,type Locator} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {savedTextSourceEntry} from '../support/saved-text-source.fixture';
import {pickingPublicFrame as frame} from '../support/saved-text-source-frame';
import {taskTool} from '../support/ui-tools';

const title='Saved source recovery',second='Second saved source';
const dialog=(page:Page)=>page.getByRole('dialog',{name:'Attachments',exact:true});
const field=(page:Page,name:string)=>dialog(page).getByRole('textbox',{name,exact:true});
const body=(page:Page)=>field(page,'Source text');
const save=(page:Page)=>dialog(page).getByRole('button',{name:'Save new version',exact:true});
async function open(page:Page,name:string){
 await taskTool(page,'Sources');
 await dialog(page).getByRole('button',{name:name+' Source material',exact:true}).click();
 await dialog(page).getByRole('region',{name:'Source snapshot',exact:true}).getByRole('button',{name:'Source options',exact:true}).click();
 await dialog(page).getByRole('button',{name:'Edit / refresh',exact:true}).click();
 await expect(body(page)).toBeEditable();
}
async function pair(page:Page,anchor:Locator,name:string,frames:unknown[]){
 for(const [suffix,width,height] of [['full',1080,800],['compact',360,640]] as const){await page.setViewportSize({width,height});frames.push(await frame(page,anchor,name+'-'+suffix));}
 await page.setViewportSize({width:1080,height:800});
}

test('ordinary saved source exposes failed uncertain and stale recovery, preserves newer raw, and fences an actual source retarget',async({page})=>{
 const entry=await savedTextSourceEntry(page),frames:unknown[]=[];let held:ReturnType<typeof entry.holdNextSourceReply>|undefined;
 try{
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  const workspace=page.locator('.workspace:visible');
  await expect(page.getByText('Local example · Bundled on this device',{exact:true})).toBeVisible();
  await workspace.getByRole('complementary',{name:'Task navigation',exact:true}).getByRole('button',{name:'New task',exact:true}).click();
  await workspace.getByRole('button',{name:'Paste text',exact:true}).click();
  const local=workspace.getByRole('region',{name:'Start with text',exact:true});
  await local.getByRole('textbox',{name:'Title (optional)',exact:true}).fill(title);
  await local.getByRole('textbox',{name:'Source text',exact:true}).fill('Initial source A.');
  await local.getByRole('button',{name:'Create task',exact:true}).click();
  await expect(dialog(page).getByRole('region',{name:'Source snapshot',exact:true})).toContainText('Initial source A.');
  // A second source is also created through ordinary public intake before any
  // save transport is held. It supplies an actual React/source retarget later.
  await dialog(page).getByRole('button',{name:'All attachments',exact:true}).click();
  await dialog(page).getByRole('button',{name:'Add source',exact:true}).click();
  await dialog(page).getByRole('button',{name:'Paste text',exact:true}).click();
  await field(page,'Source name (optional)').fill(second);await body(page).fill('Initial source B.');
  await dialog(page).getByRole('button',{name:'Add text',exact:true}).click();
  await expect(dialog(page).getByRole('region',{name:'Source snapshot',exact:true})).toContainText('Initial source B.');
  const task=(await entry.fixture.core.listTasks()).find(task=>task.title===title);if(!task)throw Error('Public source task was not created.');
  expect(task.sources).toHaveLength(2);const sourceA=task.sources[0],sourceB=task.sources[1];
  await open(page,title);await body(page).fill('Original edit retained for explicit retry.');
  entry.rejectNextSourceSave();await save(page).click();
  const check=dialog(page).getByRole('button',{name:'Check saved source',exact:true});await expect(check).toBeVisible();
  await expect(body(page)).toHaveValue('Original edit retained for explicit retry.');
  expect((await entry.fixture.core.getTask(task.id)).sources[0].versions).toHaveLength(1);
  await pair(page,check,'04-save-failure-recovery',frames);
  await body(page).fill('Newer text before explicit retry.');await check.click();
  const retry=dialog(page).getByRole('button',{name:'Retry original source save',exact:true});await expect(retry).toBeEnabled();
  held=entry.holdNextSourceReply(true);await retry.click();await expect.poll(()=>held!.reached).toBe(true);
  await expect(body(page)).toBeEditable();await body(page).fill('Newest raw survives the lost committed reply.');
  held.release();held=undefined;await expect(check).toBeVisible();await expect(save(page)).toBeDisabled();
  await expect(body(page)).toHaveValue('Newest raw survives the lost committed reply.');
  const own=(await entry.fixture.core.getTask(task.id)).sources[0];expect(own.versions).toHaveLength(2);expect(own.versions[1].content).toBe('Original edit retained for explicit retry.');
  await pair(page,check,'05-uncertain-save-recovery',frames);
  await check.click();await expect(save(page)).toBeEnabled();await expect(body(page)).toHaveValue('Newest raw survives the lost committed reply.');
  // An actual core freshness transition plus the real changed event models a
  // second owner changing the saved source while this public form is mounted.
  await entry.fixture.core.invalidateSource(task.id,sourceA.id,'Owned external freshness change while editor mounted.');await entry.fixture.emit({type:'changed',taskId:task.id});
  await expect(save(page)).toBeDisabled();await expect(body(page)).toHaveValue('Newest raw survives the lost committed reply.');
  const stale=dialog(page).getByRole('alert').filter({hasText:'This source changed while the editor was open.'});await expect(stale).toHaveCount(1);
  await pair(page,stale,'06-stale-source-recovery',frames);
  await dialog(page).getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(dialog(page).getByRole('region',{name:'Source snapshot',exact:true})).toBeVisible();
  await dialog(page).getByRole('button',{name:'Source options',exact:true}).click();await dialog(page).getByRole('button',{name:'Edit / refresh',exact:true}).click();
  await body(page).fill('Deliberate refresh from the observed stale source.');await save(page).click();
  await expect(dialog(page).getByRole('region',{name:'Source snapshot',exact:true})).toContainText('Deliberate refresh from the observed stale source.');
  // Actual App navigation unmounts A and keys B while A's committed reply is
  // still pending. An old completion may retire A raw, but cannot present A or
  // acknowledge any raw owned by B.
  await open(page,title);await body(page).fill('A late reply must remain on source A.');held=entry.holdNextSourceReply(true);await save(page).click();await expect.poll(()=>held!.reached).toBe(true);
  await open(page,second);await body(page).fill('Source B raw stays selected and unapplied.');await field(page,'Source name (optional)').fill('Source B raw name Ω');
  held.release();held=undefined;await expect(save(page)).toBeEnabled();await expect(body(page)).toHaveValue('Source B raw stays selected and unapplied.');await expect(field(page,'Source name (optional)')).toHaveValue('Source B raw name Ω');
  const rawAfterLateReply=await entry.fixture.learningDrafts.read();expect(rawAfterLateReply.kind).toBe('available');if(rawAfterLateReply.kind!=='available')throw Error('A original pending raw must remain readable.');const retainedA=rawAfterLateReply.records.find(record=>'kind' in record.owner&&record.owner.kind==='source-text-edit'&&record.owner.taskId===task.id&&record.owner.sourceId===sourceA.id);expect(retainedA?.value).not.toBeNull();expect(JSON.parse(retainedA!.value!.value)).toMatchObject({content:'A late reply must remain on source A.',intentId:expect.stringMatching(/^[a-f0-9-]{36}$/),binding:expect.stringMatching(/^source-text-edit:v1:[a-f0-9]{64}$/)});
  // A failure belongs to A's retained editor attempt. It must not present as
  // a generic error over the now selected source B on the same task.
  await expect.soft(dialog(page).locator('.message.error'),'A delayed source failure must not publish an unrelated error over source B.').toHaveCount(0);
  frames.push(await frame(page,body(page),'07-source-B-after-source-A-late-reply'));
  const after=await entry.fixture.core.getTask(task.id);expect(after.sources.find(source=>source.id===sourceA.id)?.versions).toHaveLength(4);expect(after.sources.find(source=>source.id===sourceB.id)).toEqual(sourceB);
  const edits=entry.fixture.commands.filter(command=>command.type==='source.text'&&command.edit);expect(edits).toHaveLength(4);expect(edits[1]).toEqual(edits[0]);
  expect(entry.fixture.configured).toBe(false);expect(entry.fixture.external).toEqual([]);expect(entry.fixture.commands.filter(command=>command.type==='model.run'||command.type==='browser.run'||command.type==='connection.configure'||/^(?:windows\.capture|context\.(?:start|capture)|export\.)/.test(command.type))).toEqual([]);
  const path=test.info().outputPath('saved-source-recovery.json');await writeFile(path,JSON.stringify({scope:'Actual public App routes and React retarget; actual core/cache/sidecar. Declared pre/postcommit transport faults and one synthetic external freshness event. No native quit claim.',taskId:task.id,sourceA:sourceA.id,sourceB:sourceB.id,after,commands:entry.fixture.commands,sidecar:await entry.fixture.learningDrafts.read(),frames},null,2)+'\n');await test.info().attach('saved-source-recovery',{path,contentType:'application/json'});
 }finally{
  held?.release();
  try{
   const observed=(await Promise.allSettled([entry.fixture.core.listTasks(),entry.fixture.learningDrafts.read()])).map(result=>result.status==='fulfilled'?result:{status:'rejected',message:String(result.reason)});
   const snapshot={scope:'Actual partial owned core and raw-sidecar read before close; available on success or earlier assertion failure. No reconstruction of deleted previous-attempt files.',tasks:observed[0],sidecar:observed[1],commands:entry.fixture.commands,frames};
   const text=JSON.stringify(snapshot,null,2)+'\n',bytes=Buffer.byteLength(text),path=test.info().outputPath('saved-source-partial-before-close.json');
   await writeFile(path,bytes<=256*1024?text:JSON.stringify({scope:snapshot.scope,kind:'not-retained-size-limit',bytes,limit:256*1024})+'\n');
   await test.info().attach('saved-source-partial-before-close',{path,contentType:'application/json'});
  }finally{await entry.close();}
 }

});
