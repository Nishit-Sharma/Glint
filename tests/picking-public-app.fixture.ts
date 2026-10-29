import {expect,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {textHelperEntry} from './text-helper-entry.fixture';
import {editModule} from '../src/core/module-state';
import {parseModuleAnswer} from '../src/core/interactive-modules';
import {pickingHelper,type PickingState} from '../src/learning/picking-helper';
import {learningDraftKey,type LearningDraftOwner} from '../src/shared/learning-drafts';
import {MODULE_MIME} from '../src/shared/module-contract';
import type {Command} from '../src/shared/bridge';

export const pickingSource='Owned workshop picking practice.\nTraining inventory: W-31 | North clamp | 9 | not protected.\nReviewed request: W-31, quantity2, pickup.\nThe table and rules are entered explicitly in the local helper; this text is not automatically extracted or linked to its recipe.';
export const pickingTaskTitle='Owned workshop context';
export const pickingSourceTitle=pickingTaskTitle;
export const pickingWorkspace=(page:Page)=>page.locator('.workspace:visible');
export const pickingDocument=(page:Page)=>page.getByRole('dialog',{name:'Document',exact:true});
export const pickingScope=(page:Page)=>pickingDocument(page).locator('.picking-helper');
export const pickingRun=(page:Page)=>pickingScope(page).getByRole('region',{name:'Fresh local manifest run',exact:true});
export async function pickingFiles(page:Page){await pickingWorkspace(page).getByRole('button',{name:'Task options',exact:true}).click();await pickingWorkspace(page).getByRole('button',{name:'Files',exact:true}).click();return page.getByRole('dialog',{name:'Files',exact:true});}

/** Actual public onboarding/task/source/helper commands. No normal task/module,
 * table, release, raw or attempt is seeded. Only the bridge/OS/provider and one
 * explicitly armed postcommit response failure are substitutes. */
export async function pickingPublicEntry(page:Page){
 const entry=await textHelperEntry(page),fixture=entry.fixture,invoke=fixture.invoke.bind(fixture),pending=new Set<Promise<unknown>>(),boundaries:Array<Record<string,unknown>>=[];let losePrepare=false;
 fixture.invoke=command=>{const work=(async()=>{
  if(command.type==='tasks.pause'||command.type==='tasks.resume'){fixture.commands.push(structuredClone(command));const result=command.type==='tasks.pause'?await fixture.core.pause(command.taskId):await fixture.core.resume(command.taskId);await fixture.emit({type:'changed',taskId:command.taskId});return result;}
  if(losePrepare&&command.type==='module.edit'&&command.action.kind==='picking-prepare'){
   losePrepare=false;fixture.commands.push(structuredClone(command));await editModule(fixture.core,command);const actual=await fixture.core.getTask(command.taskId);boundaries.push({kind:'actual-prepare-committed-response-dropped',taskId:command.taskId,artifactId:command.artifactId,moduleId:command.moduleId,runId:command.action.runId,sessionRevision:actual.session?.revision,utc:new Date().toISOString()});
   // Do not emit a changed event before reporting the deliberately unknown reply.
   throw Error('Owned fixture dropped the local prepare response after commit.');
  }
  return invoke(command);
 })();pending.add(work);void work.finally(()=>pending.delete(work)).catch(()=>{});return work;};
 async function snapshot(){
  const commands=entry.helperCreations;if(commands.length!==1)throw Error('Expected exactly one publicly created normal helper');const created=commands[0],task=await fixture.core.getTask(created.taskId),artifacts=task.artifacts.flatMap(artifact=>{const revision=artifact.revisions.at(-1);if(revision?.mimeType!==MODULE_MIME)return [];const modules=parseModuleAnswer(JSON.parse(revision.content)).modules.filter(module=>module.data.kind==='helper-studio');return modules.map(module=>({artifact,revision,module}));});if(artifacts.length!==1)throw Error('Expected one exact created helper artifact');const {artifact,revision,module}=artifacts[0];if(module.data.kind!=='helper-studio')throw Error('Expected helper');const matches=task.session?.moduleStates.filter(saved=>saved.artifactId===artifact.id&&saved.artifactRevision===revision.revision&&saved.moduleId===module.id)??[];if(matches.length!==1)throw Error('Expected exact installed helper state');const state=pickingHelper.parseState(module.data.id,matches[0].state),owner:LearningDraftOwner={taskId:task.id,artifactId:artifact.id,artifactRevision:revision.revision,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version};
  expect(task.title).toBe(pickingTaskTitle);expect(task.provenance).toBeUndefined();expect(task.sources).toHaveLength(1);const source=task.sources[0],version=source.versions.at(-1)!;expect(version).toMatchObject({kind:'text',label:pickingSourceTitle,content:pickingSource,role:'fact'});expect(source.freshness).toBe('fresh');expect(revision.sourceRefs).toEqual([]);expect(state.owner).toEqual({...owner,helperId:module.data.id});return {task,artifact,revision,module,state,owner,sourceRef:{sourceId:source.id,version:version.version,digest:version.digest}};
 }
 async function raw(family:string){const current=await snapshot(),read=await fixture.learningDrafts.read();if(read.kind!=='available')throw Error('Owned sidecar unavailable');const key=learningDraftKey(current.owner,'helper:table:'+family);return read.records.find(record=>learningDraftKey(record.owner,record.slot)===key);}
 return {...entry,boundaries,snapshot,raw,async drain(){while(pending.size)await Promise.allSettled([...pending]);},loseNextPrepareResponse(){if(losePrepare)throw Error('Prepare response already armed');losePrepare=true;},async ledger(name:string,frames:unknown[]){const current=await snapshot();const directory=process.env.PICKING_PUBLIC_APP_EVIDENCE??'evidence/picking-public-app';await mkdir(directory,{recursive:true});await writeFile(join(directory,name+'.json'),JSON.stringify({sourceDigest:process.env.PICKING_PUBLIC_APP_SOURCE??null,fixtureBoundary:'Real App/React DOM + owned real core/cache/sidecar; bridge/OS/provider substituted; no external effects',taskId:current.task.id,taskTitle:current.task.title,sourceRef:current.sourceRef,sourceContent:pickingSource,helperOwner:current.owner,helperArtifactSourceRefs:current.revision.sourceRefs,state:current.state,commands:fixture.commands,boundaries,frames},null,2)+'\n');},assertNoEffects(){expect(fixture.external).toEqual([]);expect(fixture.configured).toBe(false);expect(fixture.commands.filter(command=>command.type==='model.run'||command.type.startsWith('browser.')||command.type.startsWith('windows.')||command.type.startsWith('export.')||['context.start','context.capture','source.choose','source.image'].includes(command.type))).toEqual([]);expect(entry.creations).toHaveLength(1);expect(entry.creations[0].kind).toBe('text');expect(entry.helperCreations).toHaveLength(1);},async close(){while(pending.size)await Promise.allSettled([...pending]);await entry.close();}};
}

export async function openPickingPublic(page:Page){
 const entry=await pickingPublicEntry(page);try{
  await page.getByRole('button',{name:'Continue',exact:true}).click();await pickingWorkspace(page).getByRole('button',{name:'Task options',exact:true}).click();await pickingWorkspace(page).locator('.chrome .task-menu-items').getByRole('button',{name:'New task',exact:true}).click();await pickingWorkspace(page).getByRole('button',{name:'Paste text',exact:true}).click();const start=page.getByRole('region',{name:'Start with text',exact:true});await start.getByLabel('Title (optional)',{exact:true}).fill(pickingSourceTitle);await start.getByLabel('Source text',{exact:true}).fill(pickingSource);await start.getByRole('button',{name:'Create task',exact:true}).click();
  // Source starts with its public title; rename only through the normal task UI
  // is intentionally avoided. This constant is the actual owning task title.
  await expect(pickingWorkspace(page).getByRole('heading',{level:1,name:pickingSourceTitle,exact:true})).toBeVisible();await expect(page.getByRole('dialog',{name:'Context',exact:true})).toBeVisible();return entry;
 }catch(error){await entry.close();throw error;}
}

export async function createPublicPickingHelper(page:Page,entry:Awaited<ReturnType<typeof pickingPublicEntry>>){
 await page.getByRole('dialog',{name:'Context',exact:true}).getByRole('button',{name:'Back to task',exact:true}).click();const files=await pickingFiles(page);await files.getByRole('button',{name:'New file',exact:true}).click();await files.getByRole('button',{name:'Text helper',exact:true}).click();await pickingDocument(page).getByRole('button',{name:'Create a local picking manifest',exact:true}).click();await expect(pickingScope(page).getByRole('heading',{name:'Local picking manifest',exact:true})).toBeVisible();await pickingScope(page).getByRole('button',{name:'Start with a local example',exact:true}).click();await expect(pickingScope(page).getByRole('button',{name:'Create fresh local context',exact:true})).toBeVisible();await expect.poll(async()=>!!(await entry.snapshot()).state.candidate).toBe(true);return pickingScope(page);
}
export async function publicPickingAction(page:Page,entry:Awaited<ReturnType<typeof pickingPublicEntry>>,button:import('@playwright/test').Locator,kind:string){
 const before=(await entry.snapshot()).state.revision,count=entry.fixture.commands.filter(command=>command.type==='module.edit'&&command.action.kind===kind).length;await button.click();await expect.poll(()=>entry.fixture.commands.filter(command=>command.type==='module.edit'&&command.action.kind===kind).length).toBe(count+1);await expect.poll(async()=>(await entry.snapshot()).state.revision).toBeGreaterThan(before);await entry.drain();await expect(pickingDocument(page).locator('.module-answer > .tiny[role=status]')).toHaveText('');return (await entry.snapshot()).state;
}
export async function openPublicPickingCatalog(page:Page){
 const document=pickingDocument(page);if(await document.isVisible())await document.getByRole('button',{name:'Back to task',exact:true}).click();const files=await pickingFiles(page);await files.getByRole('button',{name:'Saved helpers',exact:true}).click();const catalog=page.getByRole('dialog',{name:'Saved helpers',exact:true}),item=catalog.getByRole('article',{name:'Local picking manifest in '+pickingTaskTitle,exact:true});await expect(item).toBeVisible();await item.getByRole('button',{name:'Open helper',exact:true}).click();await expect(pickingScope(page).getByRole('heading',{name:'Local picking manifest',exact:true})).toBeVisible();return pickingScope(page);
}
