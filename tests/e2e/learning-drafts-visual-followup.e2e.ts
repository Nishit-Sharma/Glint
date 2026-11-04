import {test,expect,type Locator,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {workflowEntry} from '../support/workflow-entry.fixture';
import {sourceJoinEntry} from '../support/source-join-entry.fixture';

const evidence=process.env.LEARNING_DRAFT_EVIDENCE??'evidence/learning-drafts-visual-followup';
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true});});

async function openWorkflow(page:Page){
 const entry=await workflowEntry(page),workspace=page.locator('.workspace');
 await workspace.getByRole('button',{name:'Task options',exact:true}).click();await workspace.getByRole('button',{name:'Files',exact:true}).click();
 const files=page.getByRole('dialog',{name:'Files',exact:true});await files.getByRole('button',{name:'New file',exact:true}).click();await files.getByRole('button',{name:'Workflow example',exact:true}).click();
 const scope=page.getByRole('dialog',{name:'Document',exact:true});await expect(scope.getByRole('region',{name:'Workflow experiment',exact:true})).toBeVisible();return {...entry,scope};
}
async function frame(page:Page,anchor:Locator,name:string){
 await anchor.scrollIntoViewIfNeeded();await expect(anchor).toBeVisible();
 const rect=await anchor.boundingBox(),viewport=page.viewportSize();if(!rect||!viewport)throw Error('The frame anchor has no viewport bounds.');
 expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.y).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(viewport.width);expect(rect.y+rect.height).toBeLessThanOrEqual(viewport.height);
 await page.screenshot({path:join(evidence,name+'.png')});
}

test('compact recovery shows the entire discard choice after scrolling',async({page})=>{
 const entry=await openWorkflow(page),{fixture,scope}=entry;
 try{
  await scope.getByText('Change Edit from Ready',{exact:true}).click();await scope.getByLabel('Edit from Ready reason',{exact:true}).fill('Earlier saved value.');await fixture.flushDrafts();
  const save=fixture.learningDrafts.save.bind(fixture.learningDrafts);let fail=true;
  fixture.learningDrafts.save=async(...args)=>{if(fail){fail=false;throw Error('Synthetic draft write failure.');}return save(...args);};
  await scope.getByLabel('Edit from Ready reason',{exact:true}).fill('Open unsaved value.');
  await expect(scope.getByText('Unfinished practice could not be saved. Your input is kept in this open app. Resolve this before quitting.',{exact:true})).toBeVisible();
  await writeFile(join(fixture.directory,'learning-drafts.json'),'{synthetic unreadable file');
  await scope.getByRole('button',{name:'Retry saving practice drafts',exact:true}).click();const maintenance=scope.getByRole('region',{name:'Practice draft recovery',exact:true});
  await maintenance.getByText('Recover unreadable practice drafts',{exact:true}).click();await maintenance.getByRole('button',{name:'Preserve file and start fresh practice drafts',exact:true}).click();
  await expect(maintenance).toContainText('Original file preserved in a local backup. Fresh practice draft storage is ready');
  await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:640});
  const compact=page.locator('.compact-companion');await compact.getByText('Change Edit from Ready',{exact:true}).click();const recovery=compact.locator('.learning-draft-recovery');await recovery.getByText('Earlier unapplied edits need review',{exact:true}).click();
  await expect(recovery).toContainText('Open unsaved value.');const discard=recovery.getByRole('button',{name:'Use applied inputs and discard this draft',exact:true});
  expect(await recovery.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);await frame(page,discard,'compact-discard-control');
 }finally{await fixture.close();}
});

for(const choice of ['local','remote'] as const)test(`conflict ${choice} selection is shown after resolution`,async({page})=>{
 const entry=await openWorkflow(page),{fixture,scope}=entry;
 try{
  const save=fixture.learningDrafts.save.bind(fixture.learningDrafts);let conflicted=false;
  // The existing real sidecar is given a competing write at the transport boundary.
  fixture.learningDrafts.save=async(...args)=>{if(!conflicted&&args[4]){conflicted=true;const value={...args[4],value:JSON.stringify({...JSON.parse(args[4].value),reason:'Remote saved reason.'})};await save(args[0],args[1],args[2],args[3],value);}return save(...args);};
  await scope.getByText('Change Edit from Ready',{exact:true}).click();const reason=scope.getByLabel('Edit from Ready reason',{exact:true});await reason.fill('Local typed reason.');
  const recovery=scope.locator('.learning-draft-recovery');await recovery.getByText('Earlier unapplied edits need review',{exact:true}).click();await expect(recovery).toContainText('Local typed reason.');await expect(recovery).toContainText('Remote saved reason.');
  await recovery.getByRole('button',{name:'Check latest saved draft',exact:true}).click();await recovery.getByRole('button',{name:choice==='local'?'Keep my edits':'Use saved edits',exact:true}).click();
  await expect(reason).toHaveValue(choice==='local'?'Local typed reason.':'Remote saved reason.');await expect(recovery).toHaveCount(0);await fixture.flushDrafts();
  await frame(page,reason,`conflict-${choice}-resolved`);
 }finally{await fixture.close();}
});

test('restored SQL fields and the stale-source warning share a visible frame',async({page})=>{
 await page.setViewportSize({width:1440,height:1600});
 const entry=await sourceJoinEntry(page),{fixture}=entry,workspace=page.locator('.workspace');
 try{
  await workspace.getByRole('button',{name:entry.label,exact:true}).click();await expect.poll(()=>entry.proposalPending()).toBe(true);entry.completeProposal();
  const value=workspace.getByLabel('Members row 2, Team corrected value',{exact:true}),reason=workspace.getByLabel('Members row 2, Team correction reason',{exact:true});
  await value.fill('0');await reason.fill('Keep literal zero; this cell is not missing.');const before=await fixture.core.getTask(entry.task.id);
  await fixture.flushDrafts();await fixture.restart();await expect(value).toHaveValue('0');await expect(reason).toHaveValue('Keep literal zero; this cell is not missing.');
  await frame(page,reason,'sql-restored-fields');
  await entry.changedSource();await expect(value).toBeDisabled();await expect(value).toHaveValue('0');await expect(reason).toHaveValue('Keep literal zero; this cell is not missing.');
  const stale=workspace.getByRole('alert').filter({hasText:'current-source editing is unavailable'});await expect(stale).toHaveCount(1);await stale.evaluate(element=>element.scrollIntoView({block:'start',inline:'nearest',behavior:'auto'}));await workspace.locator('main').evaluate(element=>element.scrollBy(0,-1));
  const main=workspace.locator('main'),area=await main.boundingBox(),viewport=page.viewportSize();if(!area||!viewport)throw Error('The SQL frame has no viewport bounds.');
  const geometry:{label:string;rect:NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>}[]=[];
  for(const [label,anchor] of [['stale warning',stale],['zero value',value],['correction reason',reason]] as const){
   await expect(anchor).toBeVisible();const rect=await anchor.boundingBox();if(!rect)throw Error(`${label} has no viewport bounds.`);
   geometry.push({label,rect});
  }
  const fits=geometry.every(({rect})=>rect.x>=Math.max(0,area.x)&&rect.y>=Math.max(0,area.y)&&rect.x+rect.width<=Math.min(viewport.width,area.x+area.width)&&rect.y+rect.height<=Math.min(viewport.height,area.y+area.height));
  if(!fits){await writeFile(join(evidence,'sql-frame-geometry.json'),JSON.stringify({geometry,area,viewport},null,2));await frame(page,reason,'sql-stale-fields-fallback');await frame(page,stale,'sql-stale-warning-fallback');}
  expect(fits,JSON.stringify({geometry,area,viewport})).toBe(true);
  await page.screenshot({path:join(evidence,'sql-stale-restored-together.png')});
  expect((await fixture.core.getTask(entry.task.id)).session?.moduleStates??[]).toEqual(before.session?.moduleStates??[]);expect(entry.counters.modelRequests).toHaveLength(1);
 }finally{await fixture.close();}
});
