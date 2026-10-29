import {expect,test,type Page,type TestInfo,type Locator} from '@playwright/test';
import type {Artifact,ArtifactRef,Task} from '../src/core/types';
import {localTaskDurableEntry} from './local-task-durable-app.fixture';
import {savedDocumentRecoveryEntry} from './saved-document-recovery.fixture';
import {pickingPublicFrame as frame} from './saved-text-source-frame';
import {taskTool} from './ui-tools';
import {open} from 'node:fs/promises';
type Entry=Awaited<ReturnType<typeof localTaskDurableEntry>>;
type Raw={title:string;content:string};
type FlushPhase={label:string;flush:'acknowledged'|'refused-or-unacknowledged';error?:string;recreation:'renderer-and-core-recreation-after-synthetic-flush'|'forced-renderer-and-core-recreation-after-refused-or-unacknowledged-flush'};
const workspace=(page:Page)=>page.locator('.workspace:visible');
const document=(page:Page)=>workspace(page).getByRole('dialog',{name:'Document',exact:true});
const title=(page:Page)=>document(page).getByRole('textbox',{name:'Draft title',exact:true});
const body=(page:Page)=>document(page).getByRole('textbox',{name:'Draft content',exact:true});
const committed={title:'Public saved document continuity',content:'# Public saved document continuity\n\nName | Seats\n--- | ---\nAda | 2\n\nCommitted original text.\n'};
const unsent:Raw={title:'  Unsent title α  ',content:'\n  Unsent body α 👋.  \n\nName | Seats\n--- | ---\nAda | 3\n\nKeep the final spaces.  \n'};

async function editSavedDocument(page:Page){
 await expect(document(page)).toBeVisible();
 if(!await title(page).isVisible()){
  const edit=document(page).getByRole('button',{name:/^(Edit document|Edit Markdown)$/});await expect(edit).toHaveCount(1);await edit.click();
 }
 await expect(title(page)).toBeVisible();await expect(body(page)).toBeVisible();
 if(await body(page).evaluate(element=>element.tagName)!=='TEXTAREA'){
  await document(page).getByRole('button',{name:'Document options',exact:true}).click();await document(page).getByRole('button',{name:'Edit Markdown',exact:true}).click();
 }
 await expect(body(page)).toHaveJSProperty('tagName','TEXTAREA');
}
async function fillRaw(page:Page,raw:Raw){await title(page).fill(raw.title);await body(page).fill(raw.content);}
async function flushAndRecreate(page:Page,entry:Entry,label:string,phases:FlushPhase[],info:TestInfo){
 const firstCommand=entry.fixture.commands.length;let error:string|undefined;
 try{await entry.fixture.flushDrafts();}catch(cause){error=cause instanceof Error?cause.message:String(cause);}
 const acknowledgements=entry.fixture.commands.slice(firstCommand).filter(command=>command.type==='draft.flushed');
 const acknowledged=!error&&acknowledgements.length===1&&acknowledgements[0].error===undefined;
 const phase:FlushPhase={label,flush:acknowledged?'acknowledged':'refused-or-unacknowledged',...(error?{error}:{}),recreation:acknowledged?'renderer-and-core-recreation-after-synthetic-flush':'forced-renderer-and-core-recreation-after-refused-or-unacknowledged-flush'};
 phases.push(phase);
 await info.attach(label+'-flush-outcome',{body:JSON.stringify({boundary:'Synthetic flush/resume only. No native Quit or graceful process-shutdown claim.',phase,acknowledgements},null,2),contentType:'application/json'});
 expect.soft(acknowledged,label+': the intended quit flush should acknowledge success; any following forced recreation is separately labelled').toBe(true);
 await entry.recreateCoreAndStore();
 await expect(workspace(page).locator('.workspace-task h1')).toHaveText(committed.title);
 await workspace(page).locator('.conversation-manual-files').getByRole('button',{name:committed.title,exact:true}).click();
 await editSavedDocument(page);
}
function savedArtifact(task:Task,id:string):Artifact{const artifact=task.artifacts.find(item=>item.id===id);if(!artifact)throw Error('The publicly created document is unavailable.');return artifact;}

test('an existing publicly saved document retains unsent raw title and body through renderer recreation, including intentional blanks',async({page},info)=>{
 const entry=await localTaskDurableEntry(page),phases:FlushPhase[]=[];
 let owner:{taskId:string;basis:ArtifactRef;artifact:Artifact}|undefined;
 try{
  expect(await entry.fixture.core.listTasks()).toEqual([]);
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByText('Local example · Bundled on this device',{exact:true})).toBeVisible();
  expect(await entry.fixture.core.listTasks()).toHaveLength(1);
  await workspace(page).getByRole('complementary',{name:'Task navigation',exact:true}).getByRole('button',{name:'New task',exact:true}).click();
  await workspace(page).getByRole('button',{name:'Write a draft',exact:true}).click();
  const local=workspace(page).getByRole('region',{name:'Start with a draft',exact:true});
  await local.getByRole('textbox',{name:'Title (optional)',exact:true}).fill(committed.title);
  await local.getByRole('textbox',{name:'Draft content',exact:true}).fill(committed.content);
  await local.getByRole('button',{name:'Create task',exact:true}).click();
  await expect(document(page)).toBeVisible();
  await expect.poll(async()=>(await entry.record('draft'))?.value).toBeNull();
  const tasks=await entry.fixture.core.listTasks(),task=tasks.find(item=>item.title===committed.title);
  if(!task)throw Error('The public Write a draft action did not create its saved task.');
  expect(tasks).toHaveLength(2);expect(task.artifacts).toHaveLength(1);expect(task.sources).toEqual([]);expect(task.requests).toEqual([]);
  const artifact=task.artifacts[0],revision=artifact.revisions[0];
  expect(artifact.revisions).toHaveLength(1);expect(revision).toMatchObject({revision:1,title:committed.title,content:committed.content,mimeType:'text/markdown',sourceRefs:[]});
  owner={taskId:task.id,basis:{artifactId:artifact.id,revision:revision.revision,digest:revision.digest},artifact:structuredClone(artifact)};

  await editSavedDocument(page);await fillRaw(page,unsent);
  await expect(title(page)).toHaveValue(unsent.title);await expect(body(page)).toHaveValue(unsent.content);
  await expect(document(page).getByRole('button',{name:'Save revision',exact:true})).toBeEnabled();
  await workspace(page).getByRole('button',{name:'Switch to compact companion',exact:true}).click();
  const compact=page.locator('.compact-companion:visible');await expect(compact).toBeVisible();
  await expect(compact.getByRole('textbox',{name:'Draft content',exact:true})).toHaveCount(0);
  await compact.getByRole('button',{name:'Open task workspace',exact:true}).click();
  await expect(title(page)).toHaveValue(unsent.title);await expect(body(page)).toHaveValue(unsent.content);

  await flushAndRecreate(page,entry,'unsent-nonblank',phases,info);
  await expect.soft(title(page),'The exact unsaved title should recover for the same saved document basis.').toHaveValue(unsent.title);
  await expect.soft(body(page),'The exact unsaved source text should recover for the same saved document basis.').toHaveValue(unsent.content);
  await info.attach('diagnostic-unsent-nonblank-reopened-after-value-checks',{body:await page.screenshot(),contentType:'image/png'});
  expect(savedArtifact(await entry.fixture.core.getTask(owner.taskId),owner.basis.artifactId)).toEqual(owner.artifact);

  await fillRaw(page,{title:'',content:''});await expect(title(page)).toHaveValue('');await expect(body(page)).toHaveValue('');
  await expect(document(page).getByRole('button',{name:'Save revision',exact:true})).toBeDisabled();
  await flushAndRecreate(page,entry,'intentional-blanks',phases,info);
  await expect.soft(title(page),'An intentionally blank edited title should not refill from the committed document.').toHaveValue('');
  await expect.soft(body(page),'An intentionally blank edited body should not refill from the committed document.').toHaveValue('');
  await info.attach('diagnostic-intentional-blanks-reopened-after-value-checks',{body:await page.screenshot(),contentType:'image/png'});
  expect(savedArtifact(await entry.fixture.core.getTask(owner.taskId),owner.basis.artifactId)).toEqual(owner.artifact);
  expect(await entry.fixture.core.listTasks()).toHaveLength(2);expect(entry.creations).toHaveLength(1);
  expect(entry.creations[0]).toMatchObject({kind:'draft',title:committed.title,content:committed.content});
  expect(entry.fixture.configured).toBe(false);expect(entry.fixture.external).toEqual([]);
  expect(entry.fixture.commands.filter(command=>command.type==='tasks.create'||command.type==='artifact.save'||command.type==='model.run'||command.type==='browser.run'||command.type==='module.edit'||command.type==='module.document'||command.type==='source.text'||command.type==='source.image'||command.type==='windows.capture'||command.type==='context.capture'||command.type==='connection.configure'||command.type==='connection.select'||command.type.startsWith('export.'))).toEqual([]);
 }finally{
  try{
   try{await attachFinalOwnedData(entry,owner,info);}
   finally{
    await info.attach('saved-document-continuity-boundary',{body:JSON.stringify({baselineSource:'d9c6f1faedf791c64f42050b39e3b10d6b301480ecae42ea0491980292b94c8a',scope:'Actual public onboarding/New task Write a draft, ordinary saved ArtifactEditor, real disposable core and draft sidecar. OS/provider boundaries substituted. Synthetic quit flush/resume and explicit core/store/renderer recreation only; no native Quit.',linkedRefs:'The public draft-only entry has no attached sources. The exact committed empty sourceRefs are preserved; no source is seeded.',owner,phases,events:entry.events,commands:entry.fixture.commands,creations:entry.creations,external:entry.fixture.external},null,2),contentType:'application/json'});
   }
  }finally{await entry.close();}
 }
});

async function openObservedArtifact(page:Page,artifactId:string,expectedTitle:string){
 await taskTool(page,'Files');const row=workspace(page).getByRole('dialog',{name:'Files',exact:true}).locator('button.artifact-row[data-view-focus="artifact:'+artifactId+'"]');
 await expect(row).toHaveCount(1);await expect(row).toBeVisible();await expect(row.getByText(expectedTitle,{exact:true})).toHaveCount(1);await expect(row.getByText(expectedTitle,{exact:true})).toBeVisible();await expect(row).toBeEnabled();await row.click();await expect(document(page)).toBeVisible();
}

async function recoveryPair(page:Page,anchor:Locator,name:string,frames:unknown[]){
 for(const [suffix,width,height] of [['full',1080,800],['compact',360,640]] as const){await page.setViewportSize({width,height});frames.push(await frame(page,anchor,name+'-'+suffix));}
 await page.setViewportSize({width:1080,height:800});
}

test('a publicly linked document reviews a refreshed source, keeps newer typing after its own saved response, and reconciles failed and lost Cancel tombstones',async({page},info)=>{
 const entry=await savedDocumentRecoveryEntry(page),frames:unknown[]=[],taskName='Linked document recovery',documentName='Recovery document';
 const originalSource='Original linked source v1.',refreshedSource='Reviewed linked source v2.',originalContent='# Recovery document\n\nCommitted document body.';
 const submitted:Raw={title:'Raw document Ω',content:'Submitted document Ω.\n\nName | Seats\n--- | ---\nAda | 3'};
 const newer:Raw={title:'Newer document Δ',content:'Newer raw after dispatch.\n\nName | Seats\n--- | ---\nAda | 4'};
 const finalRaw:Raw={title:'Lost discard raw',content:'Retain this exact raw until Check.\n\nName | Seats\n--- | ---\nAda | 5'};
 const context=()=>workspace(page).getByRole('dialog',{name:'Context',exact:true}),files=()=>workspace(page).getByRole('dialog',{name:'Files',exact:true}),save=()=>document(page).getByRole('button',{name:'Save revision',exact:true});
 let owner:{taskId:string;basis:ArtifactRef;artifact:Artifact}|undefined,held:ReturnType<typeof entry.holdNextDocumentReply>|undefined;
 try{
  expect(await entry.fixture.core.listTasks()).toEqual([]);
  await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByText('Local example · Bundled on this device',{exact:true})).toBeVisible();
  await workspace(page).getByRole('complementary',{name:'Task navigation',exact:true}).getByRole('button',{name:'New task',exact:true}).click();
  await workspace(page).getByRole('button',{name:'Paste text',exact:true}).click();
  const local=workspace(page).getByRole('region',{name:'Start with text',exact:true});await local.getByRole('textbox',{name:'Title (optional)',exact:true}).fill(taskName);await local.getByRole('textbox',{name:'Source text',exact:true}).fill(originalSource);await local.getByRole('button',{name:'Create task',exact:true}).click();
  await expect(context().getByRole('region',{name:'Source snapshot',exact:true})).toContainText(originalSource);
  const created=(await entry.fixture.core.listTasks()).find(task=>task.title===taskName);if(!created)throw Error('Public Paste text did not create the owned task.');expect(created.sources).toHaveLength(1);expect(created.artifacts).toEqual([]);expect(created.requests).toEqual([]);
  const sourceV1=structuredClone(created.sources[0]),v1=sourceV1.versions[0];expect(sourceV1.versions).toHaveLength(1);
  await taskTool(page,'Files');await files().getByRole('button',{name:'New file',exact:true}).click();await files().getByRole('button',{name:'Draft',exact:true}).click();
  await expect(title(page)).toBeEditable();await title(page).fill(documentName);
  await editSavedDocument(page);await expect(body(page)).toHaveJSProperty('tagName','TEXTAREA');await body(page).fill(originalContent);
  await document(page).getByRole('button',{name:'Save draft',exact:true}).click();await expect(document(page)).toHaveCount(0);
  const savedTask=await entry.fixture.core.getTask(created.id);expect(savedTask.artifacts).toHaveLength(1);const artifact=savedTask.artifacts[0],revision=artifact.revisions[0];expect(artifact.revisions).toHaveLength(1);expect(revision).toMatchObject({revision:1,title:documentName,content:originalContent,mimeType:'text/markdown',sourceRefs:[{sourceId:sourceV1.id,version:1,digest:v1.digest}]});
  owner={taskId:created.id,basis:{artifactId:artifact.id,revision:1,digest:revision.digest},artifact:structuredClone(artifact)};entry.bindDocument({taskId:created.id,artifactId:artifact.id});
  await openObservedArtifact(page,artifact.id,documentName);await document(page).getByRole('button',{name:'Edit document',exact:true}).click();
  await expect(body(page)).toHaveAttribute('contenteditable','true');await body(page).fill('Rich cache witness.');await expect(body(page)).toContainText('Rich cache witness.');
  await expect.poll(async()=>{const record=await entry.documentRecord();return record?.value?JSON.parse(record.value.value).content:undefined;}).toBe('# Recovery document\n\nRich cache witness.');
  await editSavedDocument(page);await expect(body(page)).toHaveValue('# Recovery document\n\nRich cache witness.');
  await fillRaw(page,submitted);await expect(title(page)).toHaveValue(submitted.title);await expect(body(page)).toHaveValue(submitted.content);await entry.fixture.flushDrafts();expect(savedArtifact(await entry.fixture.core.getTask(created.id),artifact.id)).toEqual(owner.artifact);
  await taskTool(page,'Sources');await context().getByRole('button',{name:taskName+' Source material',exact:true}).click();await context().getByRole('button',{name:'Source options',exact:true}).click();await context().getByRole('button',{name:'Edit / refresh',exact:true}).click();
  await context().getByRole('textbox',{name:'Source name (optional)',exact:true}).fill('Reviewed source v2');await context().getByRole('textbox',{name:'Source text',exact:true}).fill(refreshedSource);await context().getByRole('button',{name:'Save new version',exact:true}).click();await expect(context().getByRole('region',{name:'Source snapshot',exact:true})).toContainText(refreshedSource);
  const refreshed=await entry.fixture.core.getTask(created.id),sourceV2=refreshed.sources.find(source=>source.id===sourceV1.id)!;expect(sourceV2.versions).toHaveLength(2);expect(sourceV2.versions[1].content).toBe(refreshedSource);expect(sourceV2.currentVersion).toBe(2);const refV2={sourceId:sourceV1.id,version:2,digest:sourceV2.versions[1].digest};expect(savedArtifact(refreshed,artifact.id)).toEqual(owner.artifact);
  await openObservedArtifact(page,artifact.id,documentName);await expect(title(page)).toHaveValue(submitted.title);await expect(body(page)).toHaveValue(submitted.content);await expect(save()).toBeDisabled();await expect(body(page)).toHaveJSProperty('readOnly',true);
  const stale=document(page).getByText('Sources changed. Review them before saving or exporting.',{exact:true});await expect(stale).toBeVisible();await recoveryPair(page,stale,'01-stale-document-save-held',frames);
  await document(page).getByRole('button',{name:'Document options',exact:true}).click();await document(page).getByRole('button',{name:'Sources & versions',exact:true}).click();await document(page).getByRole('button',{name:'Edit links',exact:true}).click();
  const links=document(page).getByRole('region',{name:'Linked sources',exact:true}),review=links.getByRole('button',{name:'I reviewed them — use current versions',exact:true});await expect(links.getByText('Source material · linked version 1',{exact:true})).toBeVisible();await expect(review).toBeEnabled();await review.click();await expect(links.getByText('Source material · linked version 2',{exact:true})).toBeVisible();
  await expect(title(page)).toHaveValue(submitted.title);await expect(body(page)).toHaveValue(submitted.content);await expect(save()).toBeEnabled();await expect(body(page)).toBeEditable();await expect.poll(async()=>{const record=await entry.documentRecord();return record?.value?JSON.parse(record.value.value).sourceRefs:undefined;}).toEqual([refV2]);expect(savedArtifact(await entry.fixture.core.getTask(created.id),artifact.id)).toEqual(owner.artifact);await recoveryPair(page,save(),'02-reviewed-source-ready',frames);
  held=entry.holdNextDocumentReply();await save().click();await expect.poll(()=>held!.reached()).toBe(true);await expect(body(page)).toBeEditable();await fillRaw(page,newer);await expect(title(page)).toHaveValue(newer.title);await expect(body(page)).toHaveValue(newer.content);await expect.poll(async()=>{const record=await entry.documentRecord();return record?.value?JSON.parse(record.value.value).content:undefined;}).toBe(newer.content);
  const whileHeld=savedArtifact(await entry.fixture.core.getTask(created.id),artifact.id);expect(whileHeld.revisions).toHaveLength(2);expect(whileHeld.revisions[1]).toMatchObject({revision:2,title:submitted.title,content:submitted.content,sourceRefs:[refV2]});held.release();held=undefined;await entry.settleBoundary();await expect(save()).toBeEnabled();await expect(title(page)).toHaveValue(newer.title);await expect(body(page)).toHaveValue(newer.content);
  await expect.poll(async()=>{const record=await entry.documentRecord();return record?.value?JSON.parse(record.value.basis).revision:undefined;}).toBe(2);const afterReply=savedArtifact(await entry.fixture.core.getTask(created.id),artifact.id);expect(afterReply.revisions).toEqual(whileHeld.revisions);await recoveryPair(page,save(),'03-own-revision-confirmed-newer-raw-kept',frames);
  const check=()=>document(page).getByRole('button',{name:'Check document draft storage',exact:true});entry.failNextDiscard('reject-before');await document(page).getByRole('button',{name:'Cancel',exact:true}).click();await expect(check()).toBeEnabled();await expect(title(page)).toHaveValue(newer.title);await expect(body(page)).toHaveValue(newer.content);await expect(document(page).getByText('Discarding document edits was not confirmed. Your raw input is kept; check storage before completing this discard.',{exact:true})).toBeVisible();expect(JSON.parse((await entry.documentRecord())!.value!.value).content).toBe(newer.content);await recoveryPair(page,check(),'04-failed-cancel-raw-kept-until-check',frames);
  await check().click();await expect(body(page)).toHaveCount(0);await expect(document(page).getByRole('button',{name:'Edit Markdown',exact:true})).toBeEnabled();expect((await entry.documentRecord())?.value).toBeNull();
  await editSavedDocument(page);await fillRaw(page,finalRaw);await expect(title(page)).toHaveValue(finalRaw.title);await expect(body(page)).toHaveValue(finalRaw.content);await entry.fixture.flushDrafts();entry.failNextDiscard('lose-after');await document(page).getByRole('button',{name:'Cancel',exact:true}).click();await expect(check()).toBeEnabled();await expect(title(page)).toHaveValue(finalRaw.title);await expect(body(page)).toHaveValue(finalRaw.content);await expect(document(page).getByText('Discarding document edits was not confirmed. Your raw input is kept; check storage before completing this discard.',{exact:true})).toBeVisible();expect((await entry.documentRecord())?.value).toBeNull();await recoveryPair(page,check(),'05-lost-cancel-ack-raw-kept-until-check',frames);
  await check().click();await expect(body(page)).toHaveCount(0);const readAgain=document(page).getByRole('button',{name:'Edit Markdown',exact:true});await expect(readAgain).toBeEnabled();expect((await entry.documentRecord())?.value).toBeNull();await recoveryPair(page,readAgain,'06-discard-confirmed-current-document',frames);
  const finalTask=await entry.fixture.core.getTask(created.id);expect(savedArtifact(finalTask,artifact.id).revisions).toEqual(whileHeld.revisions);expect(finalTask.sources).toEqual(refreshed.sources);expect(finalTask.requests).toEqual([]);expect(await entry.fixture.core.listTasks()).toHaveLength(2);expect(entry.creations).toHaveLength(1);expect(entry.creations[0].kind).toBe('text');
  const artifactCommands=entry.fixture.commands.filter(command=>command.type==='artifact.save');expect(artifactCommands).toHaveLength(2);expect(artifactCommands[1]).toMatchObject({type:'artifact.save',taskId:created.id,artifact:{artifactId:artifact.id,expectedRevision:1,title:submitted.title,content:submitted.content,sourceRefs:[refV2]}});const sourceCommands=entry.fixture.commands.filter(command=>command.type==='source.text');expect(sourceCommands).toHaveLength(1);expect(sourceCommands[0]).toMatchObject({type:'source.text',taskId:created.id,source:{id:sourceV1.id,content:refreshedSource},edit:{intentId:expect.any(String)}});
  expect(entry.boundaryEvents.filter(event=>event.kind==='actual-document-core-commit-response-held')).toHaveLength(1);expect(entry.boundaryEvents.filter(event=>event.kind==='document-tombstone-transport-rejected-before-write')).toHaveLength(1);expect(entry.boundaryEvents.filter(event=>event.kind==='document-tombstone-acknowledgement-lost-after-write')).toHaveLength(1);expect(entry.fixture.configured).toBe(false);expect(entry.fixture.external).toEqual([]);expect(entry.fixture.commands.filter(command=>command.type==='tasks.create'||command.type==='model.run'||command.type==='browser.run'||command.type==='module.edit'||command.type==='module.document'||command.type==='source.image'||command.type==='windows.capture'||command.type==='context.capture'||command.type==='connection.configure'||command.type==='connection.select'||command.type.startsWith('export.'))).toEqual([]);
 }finally{
  held?.release();
  try{await entry.settleBoundary();await attachFinalOwnedData(entry,owner,info);await info.attach('saved-document-recovery-boundary',{body:JSON.stringify({productSource:'ab941c89bbdb21d18036406d4f36af8b41620b48f5dab437bda1dd7adc3fba19',scope:'Public onboarding/New task/Paste text, Files/New file/Draft, one real rich edit and visible Markdown switch, public saved-source version edit and document review/manual save. Real disposable core/cache/sidecar. Only exact-owner post-core response and reject-before/lost-after tombstone transport are controlled. Strict frames qualify named small visible anchors only; exact raw checks are separate. No native/provider/capture/foreign-v3 claim.',owner,boundaryEvents:entry.boundaryEvents,events:entry.events,commands:entry.fixture.commands,creations:entry.creations,frames,external:entry.fixture.external},null,2),contentType:'application/json'});}finally{await entry.close();}
 }
});

async function attachFinalOwnedData(entry:Entry,owner:{taskId:string}|undefined,info:TestInfo){
 const limit=256*1024,metadataReserve=2048;let remaining=limit-metadataReserve;
 const report:Record<string,unknown>={limitBytes:limit,boundary:'Actual finally-time reads before disposable-store cleanup. Task JSON is the core postread; sidecar bytes are unmodified. Unavailable or oversized data is omitted.'};
 const attachments:{name:string;body:Buffer;contentType:string}[]=[];
 const failure=(cause:unknown)=>({kind:'unavailable',error:(cause instanceof Error?cause.message:String(cause)).slice(0,300)});
 try{
  const task=owner?await entry.fixture.core.getTask(owner.taskId):await entry.fixture.core.listTasks();
  const bytes=Buffer.from(JSON.stringify(task));
  if(bytes.length>remaining)report.task={kind:'oversize',byteLength:bytes.length,availableBudget:remaining,read:owner?'getTask':'listTasks-before-owner-created'};
  else{report.task={kind:'available',byteLength:bytes.length,read:owner?'getTask':'listTasks-before-owner-created'};remaining-=bytes.length;attachments.push({name:'final-task-postread.json',body:bytes,contentType:'application/json'});}
 }catch(cause){report.task=failure(cause);}
 let file;
 try{
  file=await open(entry.fixture.directory+'/learning-drafts.json','r');const stat=await file.stat();
  if(!stat.isFile())report.sidecar={kind:'unavailable',error:'The sidecar is not a regular file.'};
  else if(stat.size>remaining)report.sidecar={kind:'oversize',byteLength:stat.size,availableBudget:remaining};
  else{
   const bytes=Buffer.alloc(remaining+1);let size=0;
   while(size<bytes.length){const read=await file.read(bytes,size,bytes.length-size,size);if(read.bytesRead===0)break;size+=read.bytesRead;}
   const after=await file.stat();
   if(size>remaining)report.sidecar={kind:'oversize',observedAtLeastBytes:size,byteLength:after.size,availableBudget:remaining};
   else if(after.size!==size||after.mtimeMs!==stat.mtimeMs)report.sidecar={kind:'unavailable',error:'The sidecar changed during its bounded read.',byteLength:after.size};
   else{report.sidecar={kind:'available',byteLength:size};remaining-=size;attachments.push({name:'final-learning-drafts.raw',body:bytes.subarray(0,size),contentType:'application/octet-stream'});}
  }
 }catch(cause){report.sidecar=failure(cause);}finally{await file?.close().catch(()=>{});}
 report.retainedPayloadBytes=limit-metadataReserve-remaining;
 const metadata=Buffer.from(JSON.stringify(report,null,2));
 if(metadata.length<=metadataReserve)attachments.push({name:'final-owned-store-read-status.json',body:metadata,contentType:'application/json'});
 await Promise.allSettled(attachments.map(({name,...options})=>info.attach(name,options)));
}
