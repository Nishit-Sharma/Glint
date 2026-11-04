import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {offlineTaskEntry} from '../support/offline-task-entry.fixture';
import {taskTool} from '../support/ui-tools';
import {pickingPublicFrame as frame} from '../support/picking-public-frame';
import {parseSavedDocumentDraft,SAVED_DOCUMENT_DRAFT_SLOT} from '../../src/shared/saved-document-draft';
import type {SourceRef} from '../../src/core/types';

const workspace=(page:Page)=>page.locator('.workspace:visible');
const document=(page:Page)=>workspace(page).getByRole('dialog',{name:'Document',exact:true});
const revision=(page:Page)=>workspace(page).getByRole('region',{name:'Saved revision',exact:true});
const body=(page:Page)=>document(page).getByRole('textbox',{name:'Draft content',exact:true});
async function markdown(page:Page){
 if(!await document(page).getByRole('textbox',{name:'Draft title',exact:true}).isVisible())await document(page).getByRole('button',{name:/^(Edit document|Edit Markdown)$/}).click();
 if(await body(page).evaluate(element=>element.tagName)!=='TEXTAREA'){await document(page).getByRole('button',{name:'Document options',exact:true}).click();await document(page).getByRole('button',{name:'Edit Markdown',exact:true}).click();}
 await expect(body(page)).toHaveJSProperty('tagName','TEXTAREA');
}
async function openDocument(page:Page,id:string){await taskTool(page,'Files');await workspace(page).getByRole('dialog',{name:'Files',exact:true}).locator(`button.artifact-row[data-view-focus="artifact:${id}"]`).click();await expect(document(page)).toBeVisible();}
async function openHistorical(page:Page){
 await taskTool(page,'History');const activity=workspace(page).getByRole('dialog',{name:'Activity',exact:true});await activity.getByText('Saved at this point',{exact:true}).click();await activity.getByRole('button',{name:'Earlier visit plan · Revision 1',exact:true}).click();await expect(revision(page)).toBeVisible();
}
type Entry=Awaited<ReturnType<typeof offlineTaskEntry>>;
async function rawRecord(entry:Entry,taskId:string,artifactId:string){
 const read=await entry.fixture.learningDrafts.read();if(read.kind!=='available')throw Error('Owned document sidecar is unavailable.');
 const records=read.records.filter(record=>'kind' in record.owner&&record.owner.kind==='saved-document-edit'&&record.owner.taskId===taskId&&record.owner.artifactId===artifactId&&record.slot===SAVED_DOCUMENT_DRAFT_SLOT);expect(records.length).toBeLessThanOrEqual(1);return records[0];
}
async function exactRaw(entry:Entry,taskId:string,artifactId:string,expected:{title:string;content:string;sourceRefs:SourceRef[]}){
 await expect.poll(async()=>{const record=await rawRecord(entry,taskId,artifactId);if(!record?.value)return null;return parseSavedDocumentDraft(JSON.parse(record.value.value));}).toEqual({present:true,...expected});
}

test('restore historical text without replacing an unfinished draft, review its stale source and save a new revision explicitly',async({page},info)=>{
 const entry=await offlineTaskEntry(page,Number(process.env.WINDOW_COMPANION_TEST_PORT??4180),{ready:true}),frames:unknown[]=[];
 const historicalTitle='Earlier visit plan',historical='\n# Earlier visit plan\n\nBring 18 visitors.\n\n  Keep my earlier note.  \n',unsentTitle='Unsent personal plan',unsent='\n  Keep my unfinished body.  \n\nDo not replace this draft.\n',corrected='\n# Earlier visit plan\n\nBring 22 visitors.\n\n  Keep my earlier note.  \n';
 try{
  // Disclosed baseline only: real core creates the historical source, two saved
  // revisions and a checkpoint. All recovery/edit/review/save steps below use UI.
  const catalog=await entry.fixture.ready();let task=await entry.fixture.core.createTask({title:'Recover a visit plan',assignedBotId:catalog.defaultBotId});
  task=await entry.fixture.core.putSource(task.id,{kind:'text',role:'fact',label:'Visitor requirements',content:'Visitors: 18.\n'});const source=task.sources[0],a1={sourceId:source.id,version:1,digest:source.versions[0].digest};
  const first=await entry.fixture.core.saveArtifact(task.id,{title:historicalTitle,content:historical,mimeType:'text/markdown',sourceRefs:[a1]});await entry.fixture.core.checkpoint(task.id,'Keep this earlier plan for review.');
  task=await entry.fixture.core.putSource(task.id,{id:source.id,kind:'text',role:'fact',label:'Visitor requirements',content:'Visitors: 22.\n'});const a2={sourceId:source.id,version:2,digest:task.sources[0].versions[1].digest};
  await entry.fixture.core.saveArtifact(task.id,{artifactId:first.artifactId,expectedRevision:1,title:'Current visit plan',content:'# Current visit plan\n\nCurrent saved text for 22 visitors.\n',mimeType:'text/markdown',sourceRefs:[a2]});task=await entry.fixture.core.getTask(task.id);
  const initial=structuredClone(task),saved=structuredClone(task.artifacts[0]);await entry.fixture.emit({type:'changed',taskId:task.id});await workspace(page).getByRole('complementary',{name:'Task navigation',exact:true}).getByRole('button',{name:task.title,exact:true}).click();
  await openDocument(page,saved.id);await markdown(page);await document(page).getByRole('textbox',{name:'Draft title',exact:true}).fill(unsentTitle);await body(page).fill(unsent);await entry.fixture.flushDrafts();await exactRaw(entry,task.id,saved.id,{title:unsentTitle,content:unsent,sourceRefs:[a2]});
  const rawBefore=await readFile(join(entry.fixture.directory,'learning-drafts.json'));
  await openHistorical(page);await revision(page).getByRole('button',{name:'Use revision 1 as a draft',exact:true}).click();const conflict=revision(page).getByRole('status');await expect(conflict).toContainText('An unfinished draft already exists.');await expect(conflict).toContainText('explicitly discard');await expect(document(page)).toHaveCount(0);expect(await readFile(join(entry.fixture.directory,'learning-drafts.json'))).toEqual(rawBefore);expect((await entry.fixture.core.getTask(task.id)).artifacts[0]).toEqual(saved);
  frames.push(await frame(page,conflict,'01-existing-draft-protected-full'));await page.setViewportSize({width:360,height:640});frames.push(await frame(page,revision(page).getByRole('button',{name:'Open existing draft',exact:true}),'02-open-kept-draft-narrow'));await revision(page).getByRole('button',{name:'Open existing draft',exact:true}).click();await page.setViewportSize({width:1080,height:800});
  await markdown(page);await expect(document(page).getByRole('textbox',{name:'Draft title',exact:true})).toHaveValue(unsentTitle);await expect(body(page)).toHaveValue(unsent);await exactRaw(entry,task.id,saved.id,{title:unsentTitle,content:unsent,sourceRefs:[a2]});frames.push(await frame(page,body(page),'03-exact-unsent-body-full',[{locator:body(page),kind:'value',expected:unsent,name:'exact kept unfinished body'}]));
  await document(page).getByRole('button',{name:'Cancel',exact:true}).click();await expect.poll(async()=>(await rawRecord(entry,task.id,saved.id))?.value??null).toBeNull();expect((await entry.fixture.core.getTask(task.id)).artifacts[0]).toEqual(saved);
  await openHistorical(page);await revision(page).getByRole('button',{name:'Use revision 1 as a draft',exact:true}).click();await expect(document(page)).toBeVisible();await markdown(page);await expect(document(page).getByRole('textbox',{name:'Draft title',exact:true})).toHaveValue(historicalTitle);await expect(body(page)).toHaveValue(historical);await exactRaw(entry,task.id,saved.id,{title:historicalTitle,content:historical,sourceRefs:[a1]});await expect(document(page).getByRole('button',{name:'Save revision',exact:true})).toBeDisabled();expect((await entry.fixture.core.getTask(task.id)).artifacts[0]).toEqual(saved);
  frames.push(await frame(page,body(page),'04-restored-historical-body-full',[{locator:body(page),kind:'value',expected:historical,name:'exact restored historical body'}]));
  await document(page).getByRole('button',{name:'Document options',exact:true}).click();await document(page).getByRole('button',{name:'Sources & versions',exact:true}).click();await document(page).getByRole('button',{name:'Edit links',exact:true}).click();const linked=document(page).getByRole('region',{name:'Linked sources',exact:true}),review=linked.getByRole('region',{name:'Review changed source links',exact:true});await review.getByText('Compare saved snapshots',{exact:true}).click();await expect(review.locator('.source-snapshot-changes')).toContainText('Visitors: 18.');await expect(review.locator('.source-snapshot-changes')).toContainText('Visitors: 22.');frames.push(await frame(page,review.locator('.source-snapshot-changes'),'05-stale-source-comparison-full'));
  const adopt=review.getByRole('button',{name:'Use reviewed version 2 · Visitor requirements',exact:true});await page.setViewportSize({width:360,height:640});frames.push(await frame(page,adopt,'06-reviewed-source-choice-narrow'));await page.setViewportSize({width:1080,height:800});await adopt.click();await expect(body(page)).toHaveValue(historical);await exactRaw(entry,task.id,saved.id,{title:historicalTitle,content:historical,sourceRefs:[a2]});expect((await entry.fixture.core.getTask(task.id)).artifacts[0]).toEqual(saved);
  await body(page).fill(corrected);await entry.fixture.flushDrafts();await exactRaw(entry,task.id,saved.id,{title:historicalTitle,content:corrected,sourceRefs:[a2]});const save=document(page).getByRole('button',{name:'Save revision',exact:true});await expect(save).toBeEnabled();frames.push(await frame(page,save,'07-explicit-new-revision-save-full'));expect((await entry.fixture.core.getTask(task.id)).artifacts[0]).toEqual(saved);await save.click();await expect.poll(async()=>(await entry.fixture.core.getTask(task.id)).artifacts[0].revisions.length).toBe(3);
  const final=await entry.fixture.core.getTask(task.id);expect(final.artifacts[0].revisions.slice(0,2)).toEqual(saved.revisions);expect(final.artifacts[0].revisions[2]).toMatchObject({title:historicalTitle,content:corrected,sourceRefs:[a2]});expect(final.sources).toEqual(initial.sources);expect(final.checkpoints).toEqual(initial.checkpoints);expect(final.requests).toEqual([]);
  await openDocument(page,saved.id);await page.setViewportSize({width:360,height:640});frames.push(await frame(page,document(page).getByText('Bring 22 visitors.',{exact:true}),'08-saved-restored-correction-narrow'));expect((await entry.fixture.core.getTask(task.id)).artifacts[0]).toEqual(final.artifacts[0]);
  expect(entry.fixture.commands.filter(command=>command.type==='artifact.save')).toHaveLength(1);expect(entry.fixture.commands.filter(command=>/^(windows\.capture|context\.(start|capture)|source\.follow|model\.run|browser\.|export\.)/.test(command.type))).toEqual([]);expect(entry.fixture.external).toEqual([]);expect(entry.fixture.configured).toBe(false);
  await info.attach('saved-revision-draft-boundary',{body:JSON.stringify({scope:'Initialized identity/bundled example and disclosed real-core historical task/source/revision/checkpoint baseline. All unsent edits, attempted restore, conflict, explicit discard, restored raw, source comparison/adoption/correction and final Save use public App controls with real disposable core/cache/sidecar. Eight strict viewport anchors; exact raw text and refs use separate DOM/disk assertions. No native restart, real browser operation, provider, external network, live freshness or native race claim.',frames,initial,final,commands:entry.fixture.commands,external:entry.fixture.external},null,2),contentType:'application/json'});
 }finally{await entry.close();}
});
