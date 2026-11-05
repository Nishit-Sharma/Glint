import {test,expect,type Page} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {contextualPublicEntry} from '../support/grounded-contextual-entry.fixture';
import {taskTool} from '../support/ui-tools';
import {pickingPublicFrame as frame} from '../support/picking-public-frame';
import type {SourceRef} from '../../src/core/types';
import {parseSavedDocumentDraft,SAVED_DOCUMENT_DRAFT_SLOT} from '../../src/shared/saved-document-draft';

test.use({viewport:{width:1080,height:800}});
const workspace=(page:Page)=>page.locator('.workspace:visible');
const context=(page:Page)=>workspace(page).getByRole('dialog',{name:'Attachments',exact:true});
const document=(page:Page)=>workspace(page).getByRole('dialog',{name:'Document',exact:true});
const body=(page:Page)=>document(page).getByRole('textbox',{name:'Draft content',exact:true});
async function openDocument(page:Page,id:string){await taskTool(page,'Files');await workspace(page).getByRole('dialog',{name:'Files',exact:true}).locator(`button.artifact-row[data-view-focus="artifact:${id}"]`).click();await expect(document(page)).toBeVisible();}
async function markdown(page:Page){
 if(!await document(page).getByRole('textbox',{name:'Draft title',exact:true}).isVisible())await document(page).getByRole('button',{name:/^(Edit document|Edit Markdown)$/}).click();
 await expect(body(page)).toBeVisible();
 if(await body(page).evaluate(element=>element.tagName)!=='TEXTAREA'){await document(page).getByRole('button',{name:'Document options',exact:true}).click();await document(page).getByRole('button',{name:'Edit Markdown',exact:true}).click();}
 await expect(body(page)).toHaveJSProperty('tagName','TEXTAREA');
}
type Entry=Awaited<ReturnType<typeof contextualPublicEntry>>;
type RawDocument={title:string;content:string;sourceRefs:SourceRef[]};
async function exactStoredRaw(entry:Entry,taskId:string,artifactId:string,expected:RawDocument){
 await expect.poll(async()=>{
  const read=await entry.fixture.learningDrafts.read();if(read.kind!=='available')throw Error('The owned document sidecar is unavailable.');
  const records=read.records.filter(record=>'kind' in record.owner&&record.owner.kind==='saved-document-edit'&&record.owner.taskId===taskId&&record.owner.artifactId===artifactId&&record.slot===SAVED_DOCUMENT_DRAFT_SLOT);expect(records).toHaveLength(1);
  if(!records[0].value)throw Error('The exact owned raw document is missing.');return parseSavedDocumentDraft(JSON.parse(records[0].value.value));
 }).toEqual({present:true,...expected});
}
async function inspectRawDocument(page:Page,entry:Entry,taskId:string,artifactId:string,expected:RawDocument){
 await exactStoredRaw(entry,taskId,artifactId,expected);
 const earlier=document(page).getByText('Earlier document edits',{exact:true});await earlier.click();await expect(document(page).getByRole('textbox',{name:'Earlier document content',exact:true})).toHaveValue(expected.content);await earlier.click();
 await markdown(page);await expect(body(page)).toHaveValue(expected.content);await exactStoredRaw(entry,taskId,artifactId,expected);
}
async function links(page:Page){
 await document(page).getByRole('button',{name:'Document options',exact:true}).click();await document(page).getByRole('button',{name:'Sources & versions',exact:true}).click();await document(page).getByRole('button',{name:'Edit links',exact:true}).click();
 return document(page).getByRole('region',{name:'Linked sources',exact:true});
}
async function addText(page:Page,label:string,content:string){
 await context(page).getByRole('button',{name:'All attachments',exact:true}).click();await context(page).getByRole('button',{name:'Add source',exact:true}).click();await context(page).getByRole('button',{name:'Paste text',exact:true}).click();
 await context(page).getByRole('textbox',{name:'Source name (optional)',exact:true}).fill(label);await context(page).getByRole('textbox',{name:'Source text',exact:true}).fill(content);await context(page).getByRole('button',{name:'Add text',exact:true}).click();await expect(context(page).getByRole('region',{name:'Source snapshot',exact:true})).toContainText(content);
}
async function refreshText(page:Page,label:string,content:string){
 await taskTool(page,'Sources');await context(page).locator('button.source-list-row').filter({hasText:label}).click();await context(page).getByRole('button',{name:'Source options',exact:true}).click();await context(page).getByRole('button',{name:'Edit / refresh',exact:true}).click();await context(page).getByRole('textbox',{name:'Source text',exact:true}).fill(content);await context(page).getByRole('button',{name:'Save new version',exact:true}).click();await expect(context(page).getByRole('region',{name:'Source snapshot',exact:true})).toContainText(content);
}

test('review source changes one at a time, reopen a partial draft and save a corrected document',async({page},info)=>{
 const entry=await contextualPublicEntry(page,Number(process.env.WINDOW_COMPANION_TEST_PORT??4180)),frames:unknown[]=[];
 const taskTitle='Trip requirements',transport='Transport plan',unrelated='Unrelated poster',original='# Visit plan\n\nBring 18 visitors. Return at 15:00.\n',rawTitle='Personal visit plan',raw='\n  My unfinished correction.  \n\nKeep this exact raw text.  \n',corrected='# Personal visit plan\n\nBring 22 visitors. Return at 16:00.\n';
 try{
  await page.getByRole('button',{name:'Continue',exact:true}).click();await workspace(page).getByRole('complementary',{name:'Task navigation',exact:true}).getByRole('button',{name:'New task',exact:true}).click();await workspace(page).getByRole('button',{name:'Paste text',exact:true}).click();const start=workspace(page).getByRole('region',{name:'Start with text',exact:true});await start.getByRole('textbox',{name:'Title (optional)',exact:true}).fill(taskTitle);await start.getByRole('textbox',{name:'Source text',exact:true}).fill('Group size: 18.\nArrival: 09:30.\n');await start.getByRole('button',{name:'Create task',exact:true}).click();await expect(context(page)).toBeVisible();
  await addText(page,transport,'Coach seats: 24.\nReturn: 15:00.\n');await addText(page,unrelated,'Poster colour: blue.\n');
  await taskTool(page,'Files');const files=workspace(page).getByRole('dialog',{name:'Files',exact:true});await files.getByRole('button',{name:'New file',exact:true}).click();await files.getByRole('button',{name:'Draft',exact:true}).click();await markdown(page);await document(page).getByRole('textbox',{name:'Draft title',exact:true}).fill('Visit plan');await body(page).fill(original);await document(page).getByRole('button',{name:'Choose sources',exact:true}).click();await document(page).getByRole('region',{name:'Linked sources',exact:true}).locator('label.dependency-option').filter({hasText:unrelated}).getByRole('checkbox').uncheck();await document(page).getByRole('button',{name:'Save draft',exact:true}).click();await expect(document(page)).toHaveCount(0);
  const task=async()=>(await entry.fixture.core.listTasks()).find(item=>item.title===taskTitle)!,initial=await task(),artifact=structuredClone(initial.artifacts[0]),a=initial.sources.find(source=>source.versions[0].label===taskTitle)!,b=initial.sources.find(source=>source.versions[0].label===transport)!,c=structuredClone(initial.sources.find(source=>source.versions[0].label===unrelated)!);
  expect(artifact.revisions).toHaveLength(1);expect(artifact.revisions[0].content).toBe(original);expect(artifact.revisions[0].sourceRefs.map(ref=>ref.sourceId)).toEqual([a.id,b.id]);
  await openDocument(page,artifact.id);await markdown(page);await document(page).getByRole('textbox',{name:'Draft title',exact:true}).fill(rawTitle);await body(page).fill(raw);await entry.fixture.flushDrafts();await exactStoredRaw(entry,initial.id,artifact.id,{title:rawTitle,content:raw,sourceRefs:artifact.revisions[0].sourceRefs});
  await refreshText(page,taskTitle,'Group size: 22.\nArrival: 09:30.\n');await refreshText(page,transport,'Coach seats: 24.\nReturn: 16:00.\n');
  const refreshed=await task(),ref=(id:string):SourceRef=>{const source=refreshed.sources.find(item=>item.id===id)!,version=source.versions.at(-1)!;return {sourceId:id,version:version.version,digest:version.digest};},a2=ref(a.id),b2=ref(b.id);
  await openDocument(page,artifact.id);await inspectRawDocument(page,entry,initial.id,artifact.id,{title:rawTitle,content:raw,sourceRefs:artifact.revisions[0].sourceRefs});await expect(document(page).getByRole('textbox',{name:'Draft title',exact:true})).toHaveValue(rawTitle);await expect(document(page).getByRole('button',{name:'Save revision',exact:true})).toBeDisabled();
  const linked=await links(page),review=linked.getByRole('region',{name:'Review changed source links',exact:true}),aReview=review.getByRole('region',{name:taskTitle,exact:true});await aReview.getByText('Compare saved snapshots',{exact:true}).click();await expect(aReview.locator('.source-snapshot-changes')).toContainText('Group size: 18.');await expect(aReview.locator('.source-snapshot-changes')).toContainText('Group size: 22.');
  frames.push(await frame(page,aReview.locator('.source-snapshot-changes'),'01-source-change-full'));
  await aReview.getByRole('button',{name:'Use reviewed version 2 · '+taskTitle,exact:true}).click();const remainingChoice=review.getByRole('button',{name:'Use reviewed version 2 · '+transport,exact:true});await expect(remainingChoice).toBeFocused();await expect(remainingChoice).toBeInViewport({ratio:1});await expect(linked.getByText('Source material · linked version 2',{exact:true})).toHaveCount(1);await expect(linked.getByText('Source material · linked version 1',{exact:true})).toHaveCount(1);await expect(review.getByRole('status')).toHaveText('1 source link still needs review or refresh before saving.');await expect(document(page).getByRole('button',{name:'Save revision',exact:true})).toBeDisabled();await expect(body(page)).toHaveValue(raw);await exactStoredRaw(entry,initial.id,artifact.id,{title:rawTitle,content:raw,sourceRefs:[a2,artifact.revisions[0].sourceRefs[1]]});
  frames.push(await frame(page,review.getByRole('status'),'02-partial-adoption-full'));await page.setViewportSize({width:360,height:640});frames.push(await frame(page,review.getByRole('button',{name:'Use reviewed version 2 · '+transport,exact:true}),'03-remaining-source-narrow'));await page.setViewportSize({width:1080,height:800});expect((await task()).artifacts[0]).toEqual(artifact);
  await entry.recreateStoresAndReload();await openDocument(page,artifact.id);await inspectRawDocument(page,entry,initial.id,artifact.id,{title:rawTitle,content:raw,sourceRefs:[a2,artifact.revisions[0].sourceRefs[1]]});await expect(document(page).getByRole('textbox',{name:'Draft title',exact:true})).toHaveValue(rawTitle);const reopenedLinks=await links(page),reopened=reopenedLinks.getByRole('region',{name:'Review changed source links',exact:true});await expect(reopened.getByRole('button',{name:'Use reviewed version 2 · '+taskTitle,exact:true})).toHaveCount(0);await expect(reopenedLinks.getByText('Source material · linked version 2',{exact:true})).toHaveCount(1);const bReview=reopened.getByRole('region',{name:transport,exact:true});await bReview.getByText('Compare saved snapshots',{exact:true}).click();await expect(bReview.locator('.source-snapshot-changes')).toContainText('Return: 15:00.');await expect(bReview.locator('.source-snapshot-changes')).toContainText('Return: 16:00.');frames.push(await frame(page,bReview.locator('.source-snapshot-changes'),'04-reopened-change-full'));
  await bReview.getByRole('button',{name:'Use reviewed version 2 · '+transport,exact:true}).click();await expect(reopenedLinks).toBeFocused();await expect(body(page)).toBeEditable();await expect(body(page)).toHaveValue(raw);await exactStoredRaw(entry,initial.id,artifact.id,{title:rawTitle,content:raw,sourceRefs:[a2,b2]});await body(page).fill(corrected);const save=document(page).getByRole('button',{name:'Save revision',exact:true});await expect(save).toBeEnabled();frames.push(await frame(page,save,'05-corrected-save-full'));await save.click();await expect.poll(async()=>(await task()).artifacts.find(item=>item.id===artifact.id)!.revisions.length).toBe(2);
  const final=await task(),saved=structuredClone(final.artifacts.find(item=>item.id===artifact.id)!);expect(saved.revisions[0]).toEqual(artifact.revisions[0]);expect(saved.revisions[1]).toMatchObject({title:rawTitle,content:corrected,sourceRefs:[a2,b2]});expect(final.sources.find(source=>source.id===c.id)).toEqual(c);expect(final.requests).toEqual([]);
  await openDocument(page,artifact.id);await page.setViewportSize({width:360,height:640});const paragraph=document(page).getByText('Bring 22 visitors. Return at 16:00.',{exact:true});await expect(paragraph).toBeVisible();frames.push(await frame(page,paragraph,'06-saved-correction-narrow'));expect((await task()).artifacts.find(item=>item.id===artifact.id)).toEqual(saved);
  expect(entry.fixture.commands.filter(command=>command.type==='model.run'||command.type==='browser.run'||command.type==='source.image'||command.type==='windows.capture'||command.type==='context.capture'||command.type.startsWith('source.follow.')||command.type.startsWith('export.'))).toEqual([]);expect(entry.fixture.external).toEqual([]);expect(entry.fixture.configured).toBe(false);
  const path=info.outputPath('source-adoption-boundary.json');await writeFile(path,JSON.stringify({scope:'All task/source/document setup and refresh use public controls with actual App/core/cache/sidecar. Partial A2/B1 is flushed and restored by controlled store recreation and renderer reload, then B2 is explicitly adopted and a corrected revision saved. C remains unrelated and unchanged. Six viewport anchors qualify only their named content; exact raw bytes/refs are separate assertions. No native restart, provider, capture, live freshness or inferred section impact.',frames,phases:entry.phases,commands:entry.fixture.commands},null,2));await info.attach('source-adoption-boundary',{path,contentType:'application/json'});
 }finally{await entry.close();}
});
