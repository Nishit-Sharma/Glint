import {expect,test,type Locator,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {workflowEntry} from '../support/workflow-entry.fixture';

const evidence=process.env.LEARNING_DRAFT_EVIDENCE??'evidence/learning-draft-quit-freeze';
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

test('practice editing is visibly held during a synthetic quit flush and resumes only for its matching id',async({page})=>{
 const entry=await workflowEntry(page),{fixture}=entry,workspace=page.locator('.workspace');
 let release:()=>void=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});
 const quitId='owned-synthetic-quit-flush';
 try{
  await workspace.getByRole('button',{name:'Task options',exact:true}).click();await workspace.getByRole('button',{name:'Files',exact:true}).click();
  const files=page.getByRole('dialog',{name:'Files',exact:true});await files.getByRole('button',{name:'New file',exact:true}).click();await files.getByRole('button',{name:'Workflow example',exact:true}).click();
  const scope=page.getByRole('dialog',{name:'Document',exact:true}),save=fixture.learningDrafts.save.bind(fixture.learningDrafts);let savePending=false;
  // Hold one real write to this fixture's disposable sidecar; no native quit occurs.
  fixture.learningDrafts.save=async(...args)=>{if(args[1].includes(':rule:')&&!savePending){savePending=true;await held;}return save(...args);};
  await scope.getByText('Change Edit from Ready',{exact:true}).click();
  const reason=scope.getByLabel('Edit from Ready reason',{exact:true});await reason.fill('  Exact input before quit.  ');await expect.poll(()=>savePending).toBe(true);
  const before=await fixture.core.getTask(entry.task.id);
  await fixture.emit({type:'draft.flush',quitId});
  const acknowledgements=()=>fixture.commands.filter(command=>command.type==='draft.flushed'&&command.quitId===quitId);
  expect(acknowledgements()).toHaveLength(0);await expect(reason).toHaveValue('  Exact input before quit.  ');
  await expect(reason).toBeDisabled();await expect(scope.getByLabel('Edit from Ready destination',{exact:true})).toBeDisabled();
  await expect(scope.getByRole('button',{name:'Apply rule',exact:true})).toBeDisabled();
  const heldNotice=reason.locator('xpath=ancestor::form').getByRole('status').filter({hasText:/quit|clos|exit/i}).filter({hasText:/edit|held|paus|resum/i});
  await expect(heldNotice).toBeVisible();await frame(page,heldNotice,[reason,heldNotice,scope.getByRole('button',{name:'Apply rule',exact:true})],'01-quit-flush-held');
  await fixture.emit({type:'draft.resume',quitId:'different-synthetic-quit'});await expect(reason).toBeDisabled();await expect(heldNotice).toBeVisible();
  expect(acknowledgements()).toHaveLength(0);
  release();await expect.poll(()=>acknowledgements().length).toBe(1);
  const ack=acknowledgements()[0];if(ack.type!=='draft.flushed')throw Error('Expected the synthetic flush acknowledgement.');expect(ack.error).toBeUndefined();
  const saved=await fixture.learningDrafts.read();if(saved.kind!=='available')throw Error('Expected readable fixture drafts.');
  expect(saved.records.some(record=>('taskId' in record.owner)&&record.owner.taskId===entry.task.id&&record.value?.value.includes('  Exact input before quit.  '))).toBe(true);
  await expect(reason).toBeDisabled();await fixture.emit({type:'draft.resume',quitId});await expect(reason).toBeEnabled();await expect(reason).toHaveValue('  Exact input before quit.  ');
  await reason.fill('  Edited after quit was cancelled.  ');await fixture.flushDrafts();await fixture.restart();
  const restored=workspace.getByRole('region',{name:'Workflow experiment',exact:true});await restored.getByText('Change Edit from Ready',{exact:true}).click();
  const restoredReason=restored.getByLabel('Edit from Ready reason',{exact:true});await expect(restoredReason).toHaveValue('  Edited after quit was cancelled.  ');await expect(restoredReason).toBeEnabled();
  await frame(page,restoredReason,[restoredReason,restored.getByRole('button',{name:'Apply rule',exact:true})],'02-quit-resumed-restored');
  expect((await fixture.core.getTask(entry.task.id)).session?.moduleStates??[]).toEqual(before.session?.moduleStates??[]);
 }finally{release();await fixture.close();}
});
