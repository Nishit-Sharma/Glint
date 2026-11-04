import {expect,test,type Locator,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {workflowEntry} from '../support/workflow-entry.fixture';

const evidence=process.env.LEARNING_DRAFT_EVIDENCE??'evidence/learning-draft-maintenance-status';
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true});});
async function frame(page:Page,anchor:Locator,visible:Locator[],name:string){
 await anchor.evaluate(element=>element.scrollIntoView({block:'center',inline:'nearest',behavior:'auto'}));
 for(const item of visible){
  await expect(item).toBeVisible();
  const geometry=await item.evaluate(element=>{
   const rect=element.getBoundingClientRect();let left=0,top=0,right=innerWidth,bottom=innerHeight;
   for(let parent=element.parentElement;parent;parent=parent.parentElement){const style=getComputedStyle(parent),bounds=parent.getBoundingClientRect();
    if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,bounds.left+parent.clientLeft);right=Math.min(right,bounds.left+parent.clientLeft+parent.clientWidth);}
    if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,bounds.top+parent.clientTop);bottom=Math.min(bottom,bounds.top+parent.clientTop+parent.clientHeight);}
   }
   return {rect:{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom},bounds:{left,top,right,bottom},fits:rect.left>=left&&rect.top>=top&&rect.right<=right&&rect.bottom<=bottom};
  });
  expect(geometry.fits,JSON.stringify(geometry)).toBe(true);
 }
 await page.screenshot({path:join(evidence,name+'.png')});
}

test('queued edits are not described as saved while deletion cleanup blocks their write',async({page})=>{
 const entry=await workflowEntry(page),{fixture}=entry,workspace=page.locator('.workspace');
 let releaseSave:()=>void=()=>{},releaseCleanup:()=>void=()=>{};
 const saveHeld=new Promise<void>(resolve=>{releaseSave=resolve;}),cleanupHeld=new Promise<void>(resolve=>{releaseCleanup=resolve;});
 try{
  await workspace.getByRole('button',{name:'Task options',exact:true}).click();await workspace.getByRole('button',{name:'Files',exact:true}).click();
  const files=page.getByRole('dialog',{name:'Files',exact:true});await files.getByRole('button',{name:'New file',exact:true}).click();await files.getByRole('button',{name:'Workflow example',exact:true}).click();
  await page.getByRole('dialog',{name:'Document',exact:true}).getByRole('button',{name:'Back to task',exact:true}).click();
  await page.getByRole('complementary',{name:'Task navigation',exact:true}).getByRole('button',{name:'Observatory visit',exact:true}).click();
  // Fail cleanup only at the disposable sidecar boundary after the real task deletion.
  fixture.learningDrafts.purgeTask=async()=>{throw Error('Synthetic cleanup failure.');};
  await workspace.getByRole('button',{name:'Task options',exact:true}).click();await workspace.getByRole('button',{name:'Task details',exact:true}).click();
  const details=page.getByRole('dialog',{name:'Task details',exact:true});await details.getByText('Delete this task',{exact:true}).click();await details.getByRole('button',{name:'Delete task…',exact:true}).click();await details.getByRole('button',{name:'Delete permanently',exact:true}).click();
  await expect(workspace.getByText('Task deleted. Its unfinished-practice file could not be cleaned; the old bytes are preserved and cannot reopen the deleted task.',{exact:true})).toBeVisible();
  await page.getByRole('complementary',{name:'Task navigation',exact:true}).getByRole('button',{name:entry.task.title,exact:true}).click();
  const lab=workspace.getByRole('region',{name:'Workflow experiment',exact:true}),answer=lab.locator('xpath=ancestor::section[contains(concat(" ",normalize-space(@class)," ")," interactive-answer ")][1]');
  const status=answer.locator('.learning-draft-status');await lab.getByText('Change Edit from Ready',{exact:true}).click();
  const save=fixture.learningDrafts.save.bind(fixture.learningDrafts);let savePending=false,cleanupPending=false;
  fixture.learningDrafts.save=async(...args)=>{if(args[1].includes(':rule:')&&!savePending){savePending=true;await saveHeld;}return save(...args);};
  const invoke=fixture.invoke.bind(fixture);
  fixture.invoke=async command=>{if(command.type==='learning-drafts.cleanup'){cleanupPending=true;await cleanupHeld;}return invoke(command);};
  await lab.getByLabel('Edit from Ready destination',{exact:true}).selectOption({label:'In review'});await expect.poll(()=>savePending).toBe(true);
  const reason=lab.getByLabel('Edit from Ready reason',{exact:true});await reason.fill('Newer edit waiting behind cleanup.');
  const maintenance=workspace.locator('main').getByRole('region',{name:'Practice draft recovery',exact:true});
  await maintenance.getByRole('button',{name:'Retry deleted-practice cleanup',exact:true}).click();
  releaseSave();await expect.poll(()=>cleanupPending).toBe(true);
  const during=await fixture.learningDrafts.read();if(during.kind!=='available')throw Error('Expected the first sidecar write to be readable.');
  const first=during.records.find(record=>('taskId' in record.owner)&&record.owner.taskId===entry.task.id&&record.slot.includes(':rule:'));
  if(!first?.value)throw Error('Expected the first rule draft to be persisted.');
  expect(first.value.value).not.toContain('Newer edit waiting behind cleanup.');
  await expect(reason).toHaveValue('Newer edit waiting behind cleanup.');await expect(status).toHaveText('Saving unapplied edits…');
  await expect(status).not.toContainText('Unapplied edits saved on this Mac.');
  await expect(reason).toBeDisabled();await expect(lab.getByRole('button',{name:'Apply rule',exact:true})).toBeDisabled();
  const fullNotice=reason.locator('xpath=ancestor::form').getByRole('status').filter({hasText:/maintenance.*(progress|finish)|editing.*(resume|maintenance)/i});
  await expect(fullNotice).toBeVisible();await frame(page,fullNotice,[reason,fullNotice,lab.getByRole('button',{name:'Apply rule',exact:true})],'01-full-maintenance-held');
  await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:640});
  const compact=page.locator('.compact-companion');await compact.getByText('Change Edit from Ready',{exact:true}).click();
  const compactReason=compact.getByLabel('Edit from Ready reason',{exact:true});await expect(compactReason).toHaveValue('Newer edit waiting behind cleanup.');await expect(compactReason).toBeDisabled();
  await expect(compact.getByRole('button',{name:'Apply rule',exact:true})).toBeDisabled();
  const compactNotice=compactReason.locator('xpath=ancestor::form').getByRole('status').filter({hasText:/maintenance.*(progress|finish)|editing.*(resume|maintenance)/i});
  await expect(compactNotice).toBeVisible();await frame(page,compactNotice,[compactReason,compactNotice,compact.getByRole('button',{name:'Apply rule',exact:true})],'02-compact-maintenance-held');
  await compact.getByRole('button',{name:'Open task workspace',exact:true}).click();await page.setViewportSize({width:1080,height:800});
  releaseCleanup();await expect(status).toContainText('Unapplied edits saved on this Mac.');await fixture.flushDrafts();
  const after=await fixture.learningDrafts.read();if(after.kind!=='available')throw Error('Expected the completed sidecar write to be readable.');
  expect(after.records.some(record=>('taskId' in record.owner)&&record.owner.taskId===entry.task.id&&record.value?.value.includes('Newer edit waiting behind cleanup.'))).toBe(true);
  await expect(reason).toBeEnabled();await reason.fill('Edit after cleanup completes.');await fixture.flushDrafts();
  const resumed=await fixture.learningDrafts.read();if(resumed.kind!=='available')throw Error('Expected resumed draft storage to be readable.');
  expect(resumed.records.some(record=>('taskId' in record.owner)&&record.owner.taskId===entry.task.id&&record.value?.value.includes('Edit after cleanup completes.'))).toBe(true);
  await frame(page,reason,[reason,lab.getByRole('button',{name:'Apply rule',exact:true})],'03-full-maintenance-resumed');
 }finally{releaseSave();releaseCleanup();await fixture.close();}
});
