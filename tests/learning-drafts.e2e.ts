import {test,expect,type Page} from '@playwright/test';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {workflowEntry} from './workflow-entry.fixture';
import {sourceJoinEntry} from './source-join-entry.fixture';

const evidence=process.env.LEARNING_DRAFT_EVIDENCE??'evidence/learning-drafts';
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true});});
async function openWorkflow(page:Page){
 const entry=await workflowEntry(page),workspace=page.locator('.workspace');
 await workspace.getByRole('button',{name:'Task options',exact:true}).click();
 await workspace.getByRole('button',{name:'Files',exact:true}).click();
 const files=page.getByRole('dialog',{name:'Files',exact:true});
 await files.getByRole('button',{name:'New file',exact:true}).click();
 await files.getByRole('button',{name:'Workflow example',exact:true}).click();
 const scope=page.getByRole('dialog',{name:'Document',exact:true});
 await expect(scope.getByRole('region',{name:'Workflow experiment',exact:true})).toBeVisible();
 return {...entry,scope};
}
async function unfinishedPractice(page:Page){
 const workspace=page.locator('.workspace');
 await workspace.getByRole('button',{name:'Task options',exact:true}).click();
 await workspace.getByRole('button',{name:'Files',exact:true}).click();
 const files=page.getByRole('dialog',{name:'Files',exact:true});
 await files.getByText('Unfinished practice',{exact:true}).click();
 return files;
}
test('workflow unapplied rule and zero prediction restore after task navigation and store reopen',async({page})=>{
 const entry=await openWorkflow(page),{fixture,scope}=entry;
 try{
  await scope.getByText('Change Edit from Ready',{exact:true}).click();
  await scope.getByLabel('Edit from Ready destination',{exact:true}).selectOption({label:'In review'});
  await scope.getByLabel('Edit from Ready reason',{exact:true}).fill('  Keep this exact unfinished reasoning.  ');
  await scope.getByRole('combobox',{name:'Final state',exact:true}).selectOption({label:'Ready'});
  await scope.getByLabel('Blocked events',{exact:true}).fill('0');
  await scope.getByLabel('Prediction reasoning',{exact:true}).fill('  Zero is deliberate.  ');
  const before=await fixture.core.getTask(entry.task.id);
  await page.getByRole('complementary',{name:'Task navigation',exact:true}).getByRole('button',{name:'Observatory visit',exact:true}).click();
  try{await expect(page.getByRole('dialog',{name:'Keep your unsaved edits?',exact:true})).toHaveCount(0);}
  catch(error){await page.screenshot({path:`${evidence}/restoration-contract-red.png`});await writeFile(`${evidence}/restoration-contract-red.json`,JSON.stringify({before,after:await fixture.core.getTask(entry.task.id),commands:fixture.commands},null,2));throw error;}
  await page.getByRole('complementary',{name:'Task navigation',exact:true}).getByRole('button',{name:entry.task.title,exact:true}).click();
  const lab=page.locator('.workspace').getByRole('region',{name:'Workflow experiment',exact:true});
  await lab.getByText('Change Edit from Ready',{exact:true}).click();
  await expect(lab.getByLabel('Edit from Ready reason',{exact:true})).toHaveValue('  Keep this exact unfinished reasoning.  ');
  await expect(lab.getByLabel('Edit from Ready destination',{exact:true}).locator('option:checked')).toHaveText('In review');
  await expect(lab.getByLabel('Blocked events',{exact:true})).toHaveValue('0');
  await fixture.flushDrafts();await fixture.restart();
  const restored=page.locator('.workspace').getByRole('region',{name:'Workflow experiment',exact:true});
  await restored.getByText('Change Edit from Ready',{exact:true}).click();
  await expect(restored.getByLabel('Edit from Ready reason',{exact:true})).toHaveValue('  Keep this exact unfinished reasoning.  ');
  await expect(restored.getByLabel('Prediction reasoning',{exact:true})).toHaveValue('  Zero is deliberate.  ');
  expect((await fixture.core.getTask(entry.task.id)).session?.moduleStates??[]).toEqual(before.session?.moduleStates??[]);
  await page.screenshot({path:`${evidence}/restored-workflow.png`});
 }finally{await fixture.close();}
});

test('incoming shortcut context and a rejected foreign-task activation preserve saved learning input',async({page})=>{
 const entry=await openWorkflow(page),{fixture,scope}=entry,workspace=page.locator('.workspace');
 try{
  await scope.getByRole('button',{name:'Back to task',exact:true}).click();
  const lab=workspace.getByRole('region',{name:'Workflow experiment',exact:true});
  await lab.getByText('Change Edit from Ready',{exact:true}).click();
  await lab.getByLabel('Edit from Ready reason',{exact:true}).fill('  Restore after the other source window.  ');
  await fixture.flushDrafts();
  const before=await fixture.core.getTask(entry.task.id),invoke=fixture.invoke.bind(fixture);
  const target={id:'owned-synthetic-window',title:'Owned second source',owner:{name:'Owned source fixture'},bounds:{x:0,y:0,width:600,height:500}};
  fixture.invoke=async command=>{
   if(command.type!=='context.capture')return invoke(command);
   fixture.commands.push(structuredClone(command));
   const task=await fixture.core.putSource(entry.task.id,{id:'other-owned-source',kind:'text',role:'fact',label:'Synthetic other-window boundary',content:'Owned second source supplied by a transport fixture, not a native capture.'});
   return {activationId:command.activationId,tucked:false,state:'captured',task,sourceId:'other-owned-source'};
  };
  await fixture.emit({type:'context.activate',activation:{activationId:'incoming-owned',trigger:'shortcut',tucked:false,target,choices:[],ownerTaskId:entry.task.id}});
  await expect(workspace.getByText('“Owned second source” is attached. Your draft is kept.',{exact:true})).toBeVisible();
  await lab.getByText('Change Edit from Ready',{exact:true}).click();
  await expect(lab.getByLabel('Edit from Ready reason',{exact:true})).toHaveValue('  Restore after the other source window.  ');
  const captures=fixture.commands.filter(command=>command.type==='context.capture').length;
  await fixture.emit({type:'context.activate',activation:{activationId:'foreign-owner',trigger:'shortcut',tucked:false,target,choices:[],ownerTaskId:'not-this-task'}});
  await expect.poll(()=>fixture.commands.filter(command=>command.type==='context.cancel'&&command.activationId==='foreign-owner').length).toBe(1);
  expect(fixture.commands.filter(command=>command.type==='context.capture')).toHaveLength(captures);
  expect((await fixture.core.getTask(entry.task.id)).session?.moduleStates??[]).toEqual(before.session?.moduleStates??[]);
  await fixture.flushDrafts();await fixture.restart();
  const restored=workspace.getByRole('region',{name:'Workflow experiment',exact:true});await restored.getByText('Change Edit from Ready',{exact:true}).click();
  await expect(restored.getByLabel('Edit from Ready reason',{exact:true})).toHaveValue('  Restore after the other source window.  ');
  await page.screenshot({path:`${evidence}/incoming-context-restored.png`});
 }finally{await fixture.close();}
});

test('a newer compact edit survives an earlier full-view submission and requires explicit baseline recovery',async({page})=>{
 const entry=await openWorkflow(page),{fixture,scope}=entry;
 let release:()=>void=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});
 try{
  await scope.getByText('Change Edit from Ready',{exact:true}).click();
  await scope.getByLabel('Edit from Ready destination',{exact:true}).selectOption({label:'In review'});
  await scope.getByLabel('Edit from Ready reason',{exact:true}).fill('Submit this generation.');
  const invoke=fixture.invoke.bind(fixture);let pending=false;
  fixture.invoke=async command=>{if(command.type==='module.edit'&&command.action.kind==='set-rule'){pending=true;await held;}return invoke(command);};
  await scope.getByRole('button',{name:'Apply rule',exact:true}).click();
  await expect.poll(()=>pending).toBe(true);
  await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:640});
  const compact=page.locator('.compact-companion');await compact.getByText('Change Edit from Ready',{exact:true}).click();
  await expect(compact.getByLabel('Edit from Ready reason',{exact:true})).toHaveValue('Submit this generation.');
  await compact.getByLabel('Edit from Ready reason',{exact:true}).fill('  NEWER input after dispatch.  ');
  await compact.getByLabel('Edit from Ready enabled',{exact:true}).uncheck();
  release();
  await expect(compact.getByText('Earlier unapplied edits need review',{exact:true})).toBeVisible();
  await compact.getByText('Earlier unapplied edits need review',{exact:true}).click();
  await expect(compact.locator('.learning-draft-recovery')).toContainText('  NEWER input after dispatch.  ');
  await expect(compact.getByLabel('Edit from Ready reason',{exact:true})).toHaveValue('');
  expect(fixture.commands.filter(command=>command.type==='module.edit'&&command.action.kind==='set-rule')).toHaveLength(1);
  await fixture.flushDrafts();await fixture.restart();
  const restored=page.locator('.workspace').getByRole('region',{name:'Workflow experiment',exact:true});await restored.getByText('Change Edit from Ready',{exact:true}).click();
  await restored.getByText('Earlier unapplied edits need review',{exact:true}).click();
  await expect(restored.locator('.learning-draft-recovery')).toContainText('  NEWER input after dispatch.  ');
  await restored.locator('.learning-draft-recovery').screenshot({path:`${evidence}/newer-mirror-recovery.png`});
  await restored.getByRole('button',{name:'Discard earlier unapplied edits',exact:true}).click();
  await expect(restored.getByText('Earlier unapplied edits need review',{exact:true})).toHaveCount(0);
 }finally{release();await fixture.close();}
});

test('SQL correction drafts reopen exactly and stay unapplied when their source becomes stale',async({page})=>{
 const entry=await sourceJoinEntry(page),{fixture}=entry,workspace=page.locator('.workspace');
 try{
  await workspace.getByRole('button',{name:entry.label,exact:true}).click();await expect.poll(()=>entry.proposalPending()).toBe(true);entry.completeProposal();
  await expect(workspace.getByRole('heading',{name:'Review the cited tables',exact:true})).toBeVisible();
  await workspace.getByLabel('Members row 2, Team corrected value',{exact:true}).fill('0');
  await workspace.getByLabel('Members row 2, Team correction reason',{exact:true}).fill('  Keep the literal zero; not a missing cell.  ');
  await workspace.getByRole('combobox',{name:'Members.Team column type',exact:true}).selectOption('string');
  await workspace.getByLabel('Members.Team type reason',{exact:true}).fill('Text from this source version.');
  const before=await fixture.core.getTask(entry.task.id),requests=entry.counters.modelRequests.length;
  await page.getByRole('complementary',{name:'Task navigation',exact:true}).getByRole('button',{name:'Observatory visit',exact:true}).click();
  await page.getByRole('complementary',{name:'Task navigation',exact:true}).getByRole('button',{name:entry.task.title,exact:true}).click();
  await expect(workspace.getByLabel('Members row 2, Team corrected value',{exact:true})).toHaveValue('0');
  await fixture.flushDrafts();await fixture.restart();
  await expect(workspace.getByLabel('Members row 2, Team correction reason',{exact:true})).toHaveValue('  Keep the literal zero; not a missing cell.  ');
  await expect(workspace.getByLabel('Members.Team type reason',{exact:true})).toHaveValue('Text from this source version.');
  await entry.changedSource();
  await expect(workspace.getByLabel('Members row 2, Team corrected value',{exact:true})).toBeDisabled();
  await expect(workspace.getByLabel('Members row 2, Team corrected value',{exact:true})).toHaveValue('0');
  expect((await fixture.core.getTask(entry.task.id)).session?.moduleStates??[]).toEqual(before.session?.moduleStates??[]);
  expect(entry.counters.modelRequests).toHaveLength(requests);
  await page.screenshot({path:`${evidence}/sql-stale-restored.png`});
 }finally{await fixture.close();}
});

test('write failure holds the exact form and quit flush until explicit save recovery',async({page})=>{
 const entry=await openWorkflow(page),{fixture,scope}=entry;
 try{
  const save=fixture.learningDrafts.save.bind(fixture.learningDrafts);let failed=false;
  fixture.learningDrafts.save=async(...args)=>{if(!failed){failed=true;throw Error('Synthetic draft write failure.');}return save(...args);};
  await scope.getByText('Change Edit from Ready',{exact:true}).click();await scope.getByLabel('Edit from Ready reason',{exact:true}).fill('  Keep this unsaved input.  ');
  await expect(scope.getByText('Unfinished practice could not be saved. Your input is kept in this open app. Resolve this before quitting.',{exact:true})).toBeVisible();
  await expect(scope.getByLabel('Edit from Ready reason',{exact:true})).toHaveValue('  Keep this unsaved input.  ');
  await expect(fixture.flushDrafts()).rejects.toThrow('Unsent messages or practice edits could not be saved.');
  await scope.getByRole('button',{name:'Retry saving practice drafts',exact:true}).click();
  await expect(scope.getByRole('button',{name:'Retry saving practice drafts',exact:true})).toHaveCount(0);
  await fixture.flushDrafts();await fixture.restart();
  const restored=page.locator('.workspace').getByRole('region',{name:'Workflow experiment',exact:true});await restored.getByText('Change Edit from Ready',{exact:true}).click();
  await expect(restored.getByLabel('Edit from Ready reason',{exact:true})).toHaveValue('  Keep this unsaved input.  ');
 }finally{await fixture.close();}
});

test('confirmed task deletion removes stored drafts and rejects a delayed old write',async({page})=>{
 const entry=await openWorkflow(page),{fixture,scope}=entry;
 let release:()=>void=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});
 try{
  const save=fixture.learningDrafts.save.bind(fixture.learningDrafts);let pending=false;
  fixture.learningDrafts.save=async(...args)=>{pending=true;await held;return save(...args);};
  await scope.getByText('Change Edit from Ready',{exact:true}).click();await scope.getByLabel('Edit from Ready reason',{exact:true}).fill('Deleted task draft.');
  await expect.poll(()=>pending).toBe(true);
  await scope.getByRole('button',{name:'Back to task',exact:true}).click();
  await page.locator('.workspace').getByRole('button',{name:'Task options',exact:true}).click();await page.locator('.workspace').getByRole('button',{name:'Task details',exact:true}).click();
  const details=page.getByRole('dialog',{name:'Task details',exact:true});await details.getByText('Delete this task',{exact:true}).click();
  await details.getByRole('button',{name:'Delete task…',exact:true}).click();await details.getByRole('button',{name:'Delete permanently',exact:true}).click();
  await expect.poll(async()=>(await fixture.core.listTasks()).some(task=>task.id===entry.task.id)).toBe(false);
  release();
  await expect.poll(async()=>{const result=await fixture.learningDrafts.read();return result.kind==='available'&&result.records.filter(record=>('taskId' in record.owner)&&record.owner.taskId===entry.task.id).length;}).toBe(0);
  await fixture.restart();expect((await fixture.core.listTasks()).some(task=>task.id===entry.task.id)).toBe(false);
 }finally{release();await fixture.close();}
});

test('a newer prediction remains reviewable after an earlier mirror submission completes',async({page})=>{
 const entry=await openWorkflow(page),{fixture,scope}=entry;
 let release:()=>void=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});
 try{
  await scope.getByRole('combobox',{name:'Final state',exact:true}).selectOption({label:'Ready'});
  await scope.getByLabel('Blocked events',{exact:true}).fill('0');
  await scope.getByLabel('Prediction reasoning',{exact:true}).fill('Submitted prediction.');
  const invoke=fixture.invoke.bind(fixture);let pending=false;
  fixture.invoke=async command=>{if(command.type==='module.edit'&&command.action.kind==='predict'){pending=true;await held;}return invoke(command);};
  await scope.getByRole('button',{name:'Check prediction',exact:true}).click();await expect.poll(()=>pending).toBe(true);
  await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:640});
  const compact=page.locator('.compact-companion');
  await compact.getByLabel('Prediction reasoning',{exact:true}).fill('  Newer prediction reasoning.  ');
  release();await expect(compact.getByRole('region',{name:'Computed workflow result',exact:true})).toBeVisible();
  await compact.getByRole('button',{name:'Open task workspace',exact:true}).click();await page.setViewportSize({width:1080,height:800});
  await page.getByRole('dialog',{name:'Document',exact:true}).getByRole('button',{name:'Back to task',exact:true}).click();
  const files=await unfinishedPractice(page),draft=files.locator('article').filter({hasText:'Newer prediction reasoning.'});
  await expect(draft).toContainText('Prediction');await expect(draft).toContainText('  Newer prediction reasoning.  ');await draft.scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/hidden-prediction-recovery.png`});
  expect(fixture.commands.filter(command=>command.type==='module.edit'&&command.action.kind==='predict')).toHaveLength(1);
  await fixture.flushDrafts();await fixture.restart();
  const reopened=await unfinishedPractice(page),saved=reopened.locator('article').filter({hasText:'Newer prediction reasoning.'});
  await expect(saved).toBeVisible();await saved.getByRole('button',{name:'Discard this practice draft',exact:true}).click();
  await expect(saved).toHaveCount(0);
 }finally{release();await fixture.close();}
});

test('a workflow prediction made before a rule change requires review',async({page})=>{
 const entry=await openWorkflow(page),{fixture,scope}=entry;
 try{
  await scope.getByRole('combobox',{name:'Final state',exact:true}).selectOption({label:'Ready'});
  await scope.getByLabel('Blocked events',{exact:true}).fill('0');await scope.getByLabel('Prediction reasoning',{exact:true}).fill('  Before the rule change.  ');
  await scope.getByText('Change Edit from Ready',{exact:true}).click();await scope.getByLabel('Edit from Ready destination',{exact:true}).selectOption({label:'In review'});
  await scope.getByLabel('Edit from Ready reason',{exact:true}).fill('Change the problem.');await scope.getByRole('button',{name:'Apply rule',exact:true}).click();
  const recovery=scope.locator('.learning-draft-recovery');await expect(recovery).toBeVisible();
  await expect(scope.getByLabel('Blocked events',{exact:true})).toHaveValue('');
  await recovery.getByText('Earlier unapplied edits need review',{exact:true}).click();await expect(recovery).toContainText('  Before the rule change.  ');await recovery.scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/workflow-prediction-basis.png`});
  expect(fixture.commands.filter(command=>command.type==='module.edit'&&command.action.kind==='predict')).toHaveLength(0);
 }finally{await fixture.close();}
});

test('a SQL prediction made before a table change requires review',async({page})=>{
 const entry=await sourceJoinEntry(page),{fixture}=entry,scope=page.locator('.workspace');
 try{
  await scope.getByRole('button',{name:entry.label,exact:true}).click();await expect.poll(()=>entry.proposalPending()).toBe(true);entry.completeProposal();
  for(const name of ['Members.Team','Invitations.Team']){
   await scope.getByRole('combobox',{name:name+' column type',exact:true}).selectOption('string');
   const reason=scope.getByLabel(name+' type reason',{exact:true});await reason.fill('Reviewed as text.');await reason.locator('xpath=ancestor::form').getByRole('button',{name:'Confirm type',exact:true}).click();
  }
  await scope.getByLabel('Members row 2, Team corrected value',{exact:true}).fill('x');
  const reason=scope.getByLabel('Members row 2, Team correction reason',{exact:true});await reason.fill('Reviewed synthetic value.');await reason.locator('xpath=ancestor::form').getByRole('button',{name:'Apply correction',exact:true}).click();
  await scope.getByRole('combobox',{name:'Reviewed join type',exact:true}).selectOption('INNER');await scope.getByRole('combobox',{name:'Reviewed left key',exact:true}).selectOption('p-key');await scope.getByRole('combobox',{name:'Reviewed right key',exact:true}).selectOption('p-rkey');
  await scope.getByLabel('Why these keys?',{exact:true}).fill('Use the displayed keys.');await scope.getByRole('button',{name:'Confirm join condition',exact:true}).click();
  await scope.getByRole('button',{name:'Accept reviewed extraction and experiment',exact:true}).click();
  await scope.getByLabel('Predict the output row count',{exact:true}).fill('0');await scope.getByRole('textbox',{name:'Why? (recorded, not graded)',exact:true}).fill('  Before the row change.  ');
  const row=scope.getByRole('textbox',{name:'Members row 1 Team',exact:true});await row.fill('z');await row.locator('xpath=ancestor::tr').getByRole('button',{name:'Apply row',exact:true}).click();
  const recovery=scope.locator('.learning-draft-recovery');await expect(recovery).toBeVisible();await expect(scope.getByLabel('Predict the output row count',{exact:true})).toHaveValue('');
  await recovery.getByText('Earlier unapplied edits need review',{exact:true}).click();await expect(recovery).toContainText('  Before the row change.  ');await recovery.scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/sql-prediction-basis.png`});
  expect(fixture.commands.filter(command=>command.type==='module.edit'&&command.action.kind==='lab'&&command.action.action.kind==='predict')).toHaveLength(0);
 }finally{await fixture.close();}
});

for(const choice of ['local','remote'] as const)test(`a same-baseline save conflict can use the ${choice} draft after reviewing both`,async({page})=>{
 const entry=await openWorkflow(page),{fixture,scope}=entry;
 try{
  const save=fixture.learningDrafts.save.bind(fixture.learningDrafts);let conflicted=false;
  // A second writer is simulated at the sidecar boundary before the renderer's first save.
  fixture.learningDrafts.save=async(...args)=>{
   if(!conflicted&&args[4]){conflicted=true;const value={...args[4],value:JSON.stringify({...JSON.parse(args[4].value),reason:'Remote saved reason.'})};await save(args[0],args[1],args[2],args[3],value);}
   return save(...args);
  };
  await scope.getByText('Change Edit from Ready',{exact:true}).click();await scope.getByLabel('Edit from Ready reason',{exact:true}).fill('Local typed reason.');
  const recovery=scope.locator('.learning-draft-recovery');await expect(recovery).toBeVisible();await recovery.getByText('Earlier unapplied edits need review',{exact:true}).click();
  await expect(recovery).toContainText('Local typed reason.');await expect(recovery).toContainText('Remote saved reason.');await recovery.scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/save-conflict-${choice}.png`});
  await recovery.getByRole('button',{name:'Check latest saved draft',exact:true}).click();
  await recovery.getByRole('button',{name:choice==='local'?'Keep my edits':'Use saved edits',exact:true}).click();
  await expect(scope.getByLabel('Edit from Ready reason',{exact:true})).toHaveValue(choice==='local'?'Local typed reason.':'Remote saved reason.');
  await fixture.flushDrafts();await fixture.restart();
  const restored=page.locator('.workspace').getByRole('region',{name:'Workflow experiment',exact:true});await restored.getByText('Change Edit from Ready',{exact:true}).click();
  await expect(restored.getByLabel('Edit from Ready reason',{exact:true})).toHaveValue(choice==='local'?'Local typed reason.':'Remote saved reason.');
 }finally{await fixture.close();}
});

test('a prediction clear conflict remains reviewable after the prediction form closes',async({page})=>{
 const entry=await openWorkflow(page),{fixture,scope}=entry;
 try{
  await scope.getByRole('combobox',{name:'Final state',exact:true}).selectOption({label:'Ready'});await scope.getByLabel('Blocked events',{exact:true}).fill('0');
  await scope.getByLabel('Prediction reasoning',{exact:true}).fill('Original submitted prediction.');await fixture.flushDrafts();
  const save=fixture.learningDrafts.save.bind(fixture.learningDrafts);let conflicted=false;
  // A second writer changes the saved value just before the post-submit tombstone.
  fixture.learningDrafts.save=async(...args)=>{
   if(!conflicted&&args[4]===null){
    conflicted=true;const read=await fixture.learningDrafts.read();if(read.kind!=='available')throw Error('Draft storage unavailable.');
    const prior=read.records.find(record=>record.slot===args[1]&&('taskId' in record.owner)&&record.owner.taskId===('taskId' in args[0]?args[0].taskId:undefined))?.value;if(!prior)throw Error('Expected submitted draft.');
    const remote={...prior,value:JSON.stringify({...JSON.parse(prior.value),reasoning:'Remote prediction after submission.'})};
    await save(args[0],args[1],args[2],args[3],remote);
   }
   return save(...args);
  };
  await scope.getByRole('button',{name:'Check prediction',exact:true}).click();await expect(scope.getByRole('region',{name:'Computed workflow result',exact:true})).toBeVisible();
  await expect.poll(()=>conflicted).toBe(true);await scope.getByRole('button',{name:'Back to task',exact:true}).click();
  const files=await unfinishedPractice(page),draft=files.locator('article').filter({hasText:'Remote prediction after submission.'});
  await expect(draft).toBeVisible();await draft.scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/cleared-prediction-conflict.png`});await draft.getByRole('button',{name:'Check latest saved draft',exact:true}).click();
  await draft.getByRole('button',{name:'Use saved edits',exact:true}).click();await expect(draft).toContainText('Remote prediction after submission.');
  await fixture.flushDrafts();await fixture.restart();
  const reopened=await unfinishedPractice(page);await expect(reopened.locator('article').filter({hasText:'Remote prediction after submission.'})).toBeVisible();
 }finally{await fixture.close();}
});

test('stale-source SQL drafts can be inspected and discarded from Files',async({page})=>{
 const entry=await sourceJoinEntry(page),{fixture}=entry,workspace=page.locator('.workspace');
 try{
  await workspace.getByRole('button',{name:entry.label,exact:true}).click();await expect.poll(()=>entry.proposalPending()).toBe(true);entry.completeProposal();
  await workspace.getByLabel('Members row 2, Team correction reason',{exact:true}).fill('  Draft from earlier source.  ');
  await fixture.flushDrafts();await entry.changedSource();
  await expect(workspace.getByLabel('Members row 2, Team correction reason',{exact:true})).toBeDisabled();
  const files=await unfinishedPractice(page),draft=files.locator('article').filter({hasText:'Draft from earlier source.'});
  await expect(draft).toBeVisible();await draft.getByRole('button',{name:'Discard this practice draft',exact:true}).click();await expect(draft).toHaveCount(0);
  await fixture.flushDrafts();await fixture.restart();
  const read=await fixture.learningDrafts.read();expect(read.kind==='available'&&read.records.some(record=>record.value?.value.includes('Draft from earlier source.'))).toBe(false);
 }finally{await fixture.close();}
});

test('an obsolete answer draft remains inspectable and discardable from Files',async({page})=>{
 const entry=await openWorkflow(page),{fixture,scope}=entry;
 try{
  await scope.getByText('Change Edit from Ready',{exact:true}).click();await scope.getByLabel('Edit from Ready reason',{exact:true}).fill('  Draft for the earlier answer.  ');await fixture.flushDrafts();
  const drafts=await fixture.learningDrafts.read();if(drafts.kind!=='available')throw Error('Draft storage unavailable.');
  const record=drafts.records.find(item=>item.value?.value.includes('Draft for the earlier answer.'));if(!record||!('artifactId' in record.owner)||!('artifactRevision' in record.owner))throw Error('Expected saved task draft.');
  await scope.getByRole('button',{name:'Back to task',exact:true}).click();
  // Simulate a later saved artifact revision at the core boundary; the host UI blocks raw module revisions.
  await fixture.core.saveArtifact(entry.task.id,{artifactId:record.owner.artifactId,expectedRevision:record.owner.artifactRevision,title:'Replacement answer',content:'A later answer.',mimeType:'text/plain',sourceRefs:[]});
  await fixture.emit({type:'changed',taskId:entry.task.id});
  const files=await unfinishedPractice(page),draft=files.locator('article').filter({hasText:'Draft for the earlier answer.'});
  await expect(draft).toContainText('The original answer or module changed.');await draft.scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/obsolete-answer-draft.png`});await draft.getByRole('button',{name:'Discard this practice draft',exact:true}).click();await expect(draft).toHaveCount(0);
  await fixture.flushDrafts();await fixture.restart();
  const read=await fixture.learningDrafts.read();expect(read.kind==='available'&&read.records.some(item=>item.value?.value.includes('Draft for the earlier answer.'))).toBe(false);
 }finally{await fixture.close();}
});

test('committed deletion is reflected when sidecar cleanup fails',async({page})=>{
 const entry=await openWorkflow(page),{fixture,scope}=entry;
 try{
  await scope.getByText('Change Edit from Ready',{exact:true}).click();await scope.getByLabel('Edit from Ready reason',{exact:true}).fill('Draft before failed cleanup.');await fixture.flushDrafts();
  fixture.learningDrafts.purgeTask=async()=>{throw Error('Synthetic sidecar cleanup failure.');};
  await scope.getByRole('button',{name:'Back to task',exact:true}).click();
  const workspace=page.locator('.workspace');await workspace.getByRole('button',{name:'Task options',exact:true}).click();await workspace.getByRole('button',{name:'Task details',exact:true}).click();
  const details=page.getByRole('dialog',{name:'Task details',exact:true});await details.getByText('Delete this task',{exact:true}).click();await details.getByRole('button',{name:'Delete task…',exact:true}).click();await details.getByRole('button',{name:'Delete permanently',exact:true}).click();
  await expect.poll(async()=>(await fixture.core.listTasks()).some(task=>task.id===entry.task.id)).toBe(false);
  await expect(workspace.getByText('Task deleted. Its unfinished-practice file could not be cleaned; the old bytes are preserved and cannot reopen the deleted task.',{exact:true})).toBeVisible();
  await expect(workspace.getByRole('button',{name:entry.task.title,exact:true})).toHaveCount(0);
  const path=join(fixture.directory,'learning-drafts.json'),before=JSON.parse(await readFile(path,'utf8'));
  expect(before.records.some((record:{owner:{taskId:string}})=>('taskId' in record.owner)&&record.owner.taskId===entry.task.id)).toBe(true);
  const maintenance=workspace.locator('main').getByRole('region',{name:'Practice draft recovery',exact:true});
  await maintenance.scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/deleted-task-cleanup-needed.png`});await maintenance.getByRole('button',{name:'Retry deleted-practice cleanup',exact:true}).click();
  await expect(maintenance).toContainText('Deleted-task practice drafts were removed from current storage. Local recovery backups may still contain them and are not deleted with the task.');
  const cleaned=JSON.parse(await readFile(path,'utf8'));expect(cleaned.records.some((record:{owner:{taskId:string}})=>('taskId' in record.owner)&&record.owner.taskId===entry.task.id)).toBe(false);
  await fixture.restart();
  expect((await fixture.core.listTasks()).some(task=>task.id===entry.task.id)).toBe(false);
  const read=await fixture.learningDrafts.read();expect(read.kind==='available'&&read.records.some(record=>('taskId' in record.owner)&&record.owner.taskId===entry.task.id)).toBe(false);
 }finally{await fixture.close();}
});

test('confirmed deletion survives failed refresh and an older task list arriving late',async({page})=>{
 const entry=await openWorkflow(page),{fixture,scope}=entry;
 let release:()=>void=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});
 try{
  await scope.getByText('Change Edit from Ready',{exact:true}).click();await scope.getByLabel('Edit from Ready reason',{exact:true}).fill('Draft owned by the deleted task.');
  await scope.getByRole('button',{name:'Back to task',exact:true}).click();const workspace=page.locator('.workspace');
  await workspace.getByRole('textbox',{name:'Ask about this task',exact:true}).fill('Message owned by the deleted task.');await fixture.flushDrafts();
  const stale=await fixture.core.listTasks(),invoke=fixture.invoke.bind(fixture);let holdNext=true,entered=false,returned=false,failReads=false;
  // Hold one real pre-delete snapshot; later list reads fail at the transport boundary.
  fixture.invoke=async command=>{
   if(command.type==='tasks.list'&&holdNext){holdNext=false;entered=true;fixture.commands.push(structuredClone(command));await held;returned=true;return stale;}
   if(command.type==='tasks.list'&&failReads){fixture.commands.push(structuredClone(command));throw Error('Synthetic task-list refresh failure.');}
   if(command.type==='tasks.delete')failReads=true;
   return invoke(command);
  };
  fixture.learningDrafts.purgeTask=async()=>{throw Error('Synthetic sidecar cleanup failure.');};
  await fixture.emit({type:'changed',taskId:entry.task.id});await expect.poll(()=>entered).toBe(true);
  await workspace.getByRole('button',{name:'Task options',exact:true}).click();await workspace.getByRole('button',{name:'Task details',exact:true}).click();
  const details=page.getByRole('dialog',{name:'Task details',exact:true});await details.getByText('Delete this task',{exact:true}).click();await details.getByRole('button',{name:'Delete task…',exact:true}).click();await details.getByRole('button',{name:'Delete permanently',exact:true}).click();
  await expect.poll(async()=>(await fixture.core.listTasks()).some(task=>task.id===entry.task.id)).toBe(false);
  await expect(workspace.getByText('Task deleted. The remaining task list could not be refreshed. Your other tasks are kept.',{exact:true})).toBeVisible();
  await expect(workspace.getByText('Task deleted. Its unfinished-practice file could not be cleaned; the old bytes are preserved and cannot reopen the deleted task.',{exact:true})).toBeVisible();
  await expect(workspace.getByRole('button',{name:entry.task.title,exact:true})).toHaveCount(0);await expect(workspace.getByRole('region',{name:'Workflow experiment',exact:true})).toHaveCount(0);
  release();await expect.poll(()=>returned).toBe(true);await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));
  await expect(workspace.getByRole('button',{name:entry.task.title,exact:true})).toHaveCount(0);await expect(workspace.getByRole('region',{name:'Workflow experiment',exact:true})).toHaveCount(0);
  await expect(workspace.getByRole('textbox',{name:'Ask about this task',exact:true})).toHaveValue('');
  const maintenance=workspace.locator('main').getByRole('region',{name:'Practice draft recovery',exact:true});await maintenance.getByRole('button',{name:'Retry deleted-practice cleanup',exact:true}).click();await expect(maintenance).toContainText('Deleted-task practice drafts were removed from current storage. Local recovery backups may still contain them and are not deleted with the task.');
  const read=await fixture.learningDrafts.read();expect(read.kind==='available'&&read.records.some(record=>('taskId' in record.owner)&&record.owner.taskId===entry.task.id)).toBe(false);
  failReads=false;await fixture.restart();expect((await fixture.core.listTasks()).some(task=>task.id===entry.task.id)).toBe(false);await expect(workspace.getByRole('button',{name:entry.task.title,exact:true})).toHaveCount(0);
 }finally{release();await fixture.close();}
});

test('unreadable sidecar recovery preserves the original bytes and unlocks fresh practice',async({page})=>{
 const entry=await openWorkflow(page),{fixture,scope}=entry;
 try{
  await scope.getByText('Change Edit from Ready',{exact:true}).click();await scope.getByLabel('Edit from Ready reason',{exact:true}).fill('Saved before corruption.');
  await fixture.flushDrafts();const before=await fixture.core.getTask(entry.task.id);
  const path=join(fixture.directory,'learning-drafts.json'),bytes=Buffer.from([0x7b,0x22,0xff,0x00,0x7d]);
  await writeFile(path,bytes);await fixture.restart();
  const workspace=page.locator('.workspace'),lab=workspace.getByRole('region',{name:'Workflow experiment',exact:true});
  await lab.getByText('Change Edit from Ready',{exact:true}).click();await expect(lab.getByLabel('Edit from Ready reason',{exact:true})).toBeDisabled();
  const maintenance=workspace.locator('main').getByRole('region',{name:'Practice draft recovery',exact:true});
  await maintenance.getByText('Recover unreadable practice drafts',{exact:true}).click();await maintenance.scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/unreadable-file-recovery.png`});
  await maintenance.getByRole('button',{name:'Preserve file and start fresh practice drafts',exact:true}).click();
  await expect(maintenance).toContainText('Original file preserved in a local backup. Fresh practice draft storage is ready');
  const backups=(await readdir(fixture.directory)).filter(name=>/^learning-drafts-recovery-[0-9a-f-]+\.json$/.test(name));expect(backups).toHaveLength(1);
  expect(await readFile(join(fixture.directory,backups[0]))).toEqual(bytes);
  const fresh=JSON.parse(await readFile(path,'utf8'));expect(fresh.records).toEqual([]);
  await expect(lab.getByLabel('Edit from Ready reason',{exact:true})).toBeEnabled();await expect(lab.getByLabel('Edit from Ready reason',{exact:true})).toHaveValue('');
  expect((await fixture.core.getTask(entry.task.id)).session?.moduleStates??[]).toEqual(before.session?.moduleStates??[]);
 }finally{await fixture.close();}
});

test('recovering unreadable storage holds open unsaved edits until explicitly kept',async({page})=>{
 const entry=await openWorkflow(page),{fixture,scope}=entry;
 try{
  await scope.getByText('Change Edit from Ready',{exact:true}).click();await scope.getByLabel('Edit from Ready reason',{exact:true}).fill('Earlier saved value.');await fixture.flushDrafts();
  const save=fixture.learningDrafts.save.bind(fixture.learningDrafts);let fail=true;
  fixture.learningDrafts.save=async(...args)=>{if(fail){fail=false;throw Error('Synthetic write failure.');}return save(...args);};
  await scope.getByLabel('Edit from Ready reason',{exact:true}).fill('  Open unsaved value.  ');
  await expect(scope.getByText('Unfinished practice could not be saved. Your input is kept in this open app. Resolve this before quitting.',{exact:true})).toBeVisible();
  const path=join(fixture.directory,'learning-drafts.json'),bytes=Buffer.from('{unreadable synthetic bytes');await writeFile(path,bytes);
  await scope.getByRole('button',{name:'Retry saving practice drafts',exact:true}).click();
  const maintenance=scope.getByRole('region',{name:'Practice draft recovery',exact:true});
  await maintenance.getByText('Recover unreadable practice drafts',{exact:true}).click();await maintenance.getByRole('button',{name:'Preserve file and start fresh practice drafts',exact:true}).click();
  await expect(maintenance).toContainText('Original file preserved in a local backup. Fresh practice draft storage is ready');
  expect(JSON.parse(await readFile(path,'utf8')).records).toEqual([]);
  const recovery=scope.locator('.learning-draft-recovery');await recovery.getByText('Earlier unapplied edits need review',{exact:true}).click();
  await expect(recovery).toContainText('  Open unsaved value.  ');await expect(recovery.getByRole('button',{name:'Use applied inputs and discard this draft',exact:true})).toBeVisible();await expect(recovery.getByRole('button',{name:'Use saved edits',exact:true})).toHaveCount(0);await recovery.scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/open-input-after-file-recovery.png`});
  await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:640});
  const compact=page.locator('.compact-companion');await compact.getByText('Change Edit from Ready',{exact:true}).click();const compactRecovery=compact.locator('.learning-draft-recovery');await compactRecovery.getByText('Earlier unapplied edits need review',{exact:true}).click();
  await expect(compactRecovery.getByRole('button',{name:'Use applied inputs and discard this draft',exact:true})).toBeVisible();expect(await compactRecovery.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);await compactRecovery.scrollIntoViewIfNeeded();await page.screenshot({path:`${evidence}/open-input-after-file-recovery-compact.png`});await compactRecovery.getByRole('button',{name:'Keep my edits',exact:true}).click();
  await fixture.flushDrafts();const saved=JSON.parse(await readFile(path,'utf8'));
  expect(saved.records.some((record:{value:{value:string}|null})=>record.value?.value.includes('Open unsaved value.'))).toBe(true);
  const backups=(await readdir(fixture.directory)).filter(name=>/^learning-drafts-recovery-[0-9a-f-]+\.json$/.test(name));expect(backups).toHaveLength(1);expect(await readFile(join(fixture.directory,backups[0]))).toEqual(bytes);
 }finally{await fixture.close();}
});
