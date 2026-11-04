import {expect,test,type Locator,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {workflowEntry} from '../support/workflow-entry.fixture';
import {sourceJoinEntry} from '../support/source-join-entry.fixture';

const evidence=process.env.LEARNING_DRAFT_EVIDENCE??'evidence/learning-draft-dispatch-race';
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

test('a queued rule edit does not dispatch against an advanced workflow revision',async({page})=>{
 const entry=await workflowEntry(page),{fixture}=entry,workspace=page.locator('.workspace');
 let release:()=>void=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});
 try{
  await workspace.getByRole('button',{name:'Task options',exact:true}).click();await workspace.getByRole('button',{name:'Files',exact:true}).click();
  const files=page.getByRole('dialog',{name:'Files',exact:true});await files.getByRole('button',{name:'New file',exact:true}).click();await files.getByRole('button',{name:'Workflow example',exact:true}).click();
  const scope=page.getByRole('dialog',{name:'Document',exact:true}),save=fixture.learningDrafts.save.bind(fixture.learningDrafts);let heldSave=false;
  // Delay only the rule form's disposable sidecar write. Other form writes and core actions remain real.
  fixture.learningDrafts.save=async(...args)=>{if(args[1].includes(':rule:')&&!heldSave){heldSave=true;await held;}return save(...args);};
  await scope.getByText('Change Edit from Ready',{exact:true}).click();await scope.getByLabel('Edit from Ready destination',{exact:true}).selectOption({label:'In review'});
  await expect.poll(()=>heldSave).toBe(true);await scope.getByLabel('Edit from Ready reason',{exact:true}).fill('Rule edit waiting for storage.');
  await scope.getByRole('button',{name:'Apply rule',exact:true}).click();
  await scope.getByText('Change the starting state or event sequence',{exact:true}).click();await scope.getByLabel('Edited starting state',{exact:true}).selectOption({label:'Ready'});
  await scope.getByLabel('Starting-state change reason',{exact:true}).fill('Advance the applied problem.');await scope.getByRole('button',{name:'Apply starting state',exact:true}).click();
  await expect.poll(()=>fixture.commands.filter(command=>command.type==='module.edit'&&command.action.kind==='set-initial').length).toBe(1);
  await expect(scope.getByLabel('Latest applied workflow change',{exact:true})).toContainText('Advance the applied problem.');
  release();await fixture.flushDrafts();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  expect(fixture.commands.filter(command=>command.type==='module.edit'&&command.action.kind==='set-rule')).toHaveLength(0);
  await expect(scope.getByLabel('Edit from Ready reason',{exact:true})).toHaveValue('Rule edit waiting for storage.');
  await expect(scope.getByRole('status').filter({hasText:'The example changed while saving. Review and apply your edits again.'})).toBeVisible();
  await scope.getByLabel('Edit from Ready reason',{exact:true}).fill('Rule edit revised after review.');
  await expect(scope.getByText('The example changed while saving. Review and apply your edits again.',{exact:true})).toHaveCount(0);
  await scope.getByRole('button',{name:'Apply rule',exact:true}).click();await expect.poll(()=>fixture.commands.filter(command=>command.type==='module.edit'&&command.action.kind==='set-rule').length).toBe(1);
  await expect(scope.getByLabel('Latest applied workflow change',{exact:true})).toContainText('Rule edit revised after review.');
  await expect(scope.getByText('The example changed while saving. Review and apply your edits again.',{exact:true})).toHaveCount(0);
 }finally{release();await fixture.close();}
});

test('a newer same-basis edit survives a submission waiting for draft storage',async({page})=>{
 const entry=await workflowEntry(page),{fixture}=entry,workspace=page.locator('.workspace');
 let release:()=>void=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});
 try{
  await workspace.getByRole('button',{name:'Task options',exact:true}).click();await workspace.getByRole('button',{name:'Files',exact:true}).click();
  const files=page.getByRole('dialog',{name:'Files',exact:true});await files.getByRole('button',{name:'New file',exact:true}).click();await files.getByRole('button',{name:'Workflow example',exact:true}).click();
  const scope=page.getByRole('dialog',{name:'Document',exact:true}),save=fixture.learningDrafts.save.bind(fixture.learningDrafts);let heldSave=false;
  // This holds the first rule-sidecar write, before any core action is sent.
  fixture.learningDrafts.save=async(...args)=>{if(args[1].includes(':rule:')&&!heldSave){heldSave=true;await held;}return save(...args);};
  await scope.getByText('Change Edit from Ready',{exact:true}).click();await scope.getByLabel('Edit from Ready destination',{exact:true}).selectOption({label:'In review'});
  await expect.poll(()=>heldSave).toBe(true);const reason=scope.getByLabel('Edit from Ready reason',{exact:true});await reason.fill('Earlier submitted reason.');
  await scope.getByRole('button',{name:'Apply rule',exact:true}).click();await reason.fill('Newer unsent reason.');
  release();await expect.poll(()=>fixture.commands.filter(command=>command.type==='module.edit'&&command.action.kind==='set-rule').length).toBe(1);
  const action=fixture.commands.find(command=>command.type==='module.edit'&&command.action.kind==='set-rule');
  if(!action||action.type!=='module.edit'||action.action.kind!=='set-rule')throw Error('Expected the submitted rule action.');
  expect(action.action.reason).toBe('Earlier submitted reason.');
  const recovery=scope.locator('.learning-draft-recovery');await expect(recovery).toBeVisible();await recovery.locator('summary').click();
  await expect(recovery).toContainText('Newer unsent reason.');await fixture.flushDrafts();
 }finally{release();await fixture.close();}
});

for(const kind of ['prediction','row','keys'] as const)test(`an embedded SQL ${kind} submission is held when only the outer revision changes`,async({page})=>{
 const entry=await sourceJoinEntry(page),{fixture}=entry,scope=page.locator('.workspace');
 let release:()=>void=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});
 try{
  // Review the existing synthetic source/provider fixture through the actual product UI.
  await scope.getByRole('button',{name:entry.label,exact:true}).click();await expect.poll(()=>entry.proposalPending()).toBe(true);entry.completeProposal();
  for(const name of ['Members.Team','Invitations.Team']){
   await scope.getByRole('combobox',{name:name+' column type',exact:true}).selectOption('string');
   const reason=scope.getByLabel(name+' type reason',{exact:true});await reason.fill('Reviewed as text.');await reason.locator('xpath=ancestor::form').getByRole('button',{name:'Confirm type',exact:true}).click();
  }
  await scope.getByLabel('Members row 2, Team corrected value',{exact:true}).fill('x');
  const correction=scope.getByLabel('Members row 2, Team correction reason',{exact:true});await correction.fill('Reviewed synthetic value.');await correction.locator('xpath=ancestor::form').getByRole('button',{name:'Apply correction',exact:true}).click();
  await scope.getByRole('combobox',{name:'Reviewed join type',exact:true}).selectOption('INNER');await scope.getByRole('combobox',{name:'Reviewed left key',exact:true}).selectOption('p-key');await scope.getByRole('combobox',{name:'Reviewed right key',exact:true}).selectOption('p-rkey');
  await scope.getByLabel('Why these keys?',{exact:true}).fill('Use the displayed keys.');await scope.getByRole('button',{name:'Confirm join condition',exact:true}).click();
  await scope.getByRole('button',{name:'Accept reviewed extraction and experiment',exact:true}).click();
  const save=fixture.learningDrafts.save.bind(fixture.learningDrafts),slot=kind==='prediction'?':prediction:':kind==='row'?':row:left:':':keys:';let heldSave=false;
  // Delay only this form's disposable sidecar save; core mutations are not faked.
  fixture.learningDrafts.save=async(...args)=>{if(args[1].includes(slot)&&!heldSave){heldSave=true;await held;}return save(...args);};
  const count=scope.getByLabel('Predict the output row count',{exact:true}),why=scope.getByRole('textbox',{name:'Why? (recorded, not graded)',exact:true});
  const row=scope.getByRole('textbox',{name:'Members row 1 Team',exact:true}),left=scope.getByRole('combobox',{name:'Left key',exact:true}),right=scope.getByRole('combobox',{name:'Right key',exact:true});
  const button=kind==='prediction'?scope.getByRole('button',{name:'Check prediction',exact:true}):kind==='row'?row.locator('xpath=ancestor::tr').getByRole('button',{name:'Apply row',exact:true}):scope.getByRole('button',{name:'Apply keys',exact:true});
  if(kind==='prediction'){await count.fill('0');await why.fill('Prediction queued before explanation changed.');}
  else if(kind==='row')await row.fill('z');
  else{await left.selectOption('p-alt');await right.selectOption('p-ralt');}
  await expect.poll(()=>heldSave).toBe(true);await button.click();
  const styles=scope.getByRole('group',{name:'Grounded explanation style',exact:true});await styles.getByRole('button',{name:'Deep',exact:true}).click();
  await expect(styles.getByRole('button',{name:'Deep',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect.poll(()=>fixture.commands.filter(command=>command.type==='module.edit'&&command.action.kind==='explanation-mode'&&command.action.mode==='deep').length).toBe(1);
  release();await fixture.flushDrafts();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const actionKind=kind==='prediction'?'predict':kind==='row'?'edit-row':'set-keys';
  const actions=()=>fixture.commands.filter(command=>command.type==='module.edit'&&command.action.kind==='lab'&&command.action.action.kind===actionKind);
  expect(actions()).toHaveLength(0);
  if(kind==='prediction'){await expect(count).toHaveValue('0');await expect(why).toHaveValue('Prediction queued before explanation changed.');}
  else if(kind==='row')await expect(row).toHaveValue('z');
  else{await expect(left).toHaveValue('p-alt');await expect(right).toHaveValue('p-ralt');}
  const notice=scope.getByRole('status').filter({hasText:'The example changed while saving. Review and apply your edits again.'});
  await expect(notice).toBeVisible();await frame(page,notice,[notice,button],`${kind==='prediction'?'04':kind==='row'?'05':'06'}-sql-${kind}-outer-retry`);
  await button.click();await expect.poll(()=>actions().length).toBe(1);
  if(kind==='prediction')await expect(scope.getByRole('region',{name:'Computed result',exact:true})).toBeVisible();
  else await expect(button).toBeDisabled();
 }finally{release();await fixture.close();}
});
