import {expect,test,type Page} from '@playwright/test';
import {editModule} from '../src/core/module-state';
import {parseModuleAnswer} from '../src/core/interactive-modules';
import {learningDraftKey,parseLearningDraftJson,type LearningDraftRecord} from '../src/shared/learning-drafts';
import {MODULE_MIME} from '../src/shared/module-contract';
import {textHelperEntry} from './text-helper-entry.fixture';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

const evidence=process.env.SEMANTIC_HELPER_RUN_EVIDENCE??'evidence/semantic-helper-run-qualified';
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true});});

const workspace=(page:Page)=>page.locator('.workspace:visible');
const document=(page:Page)=>page.getByRole('dialog',{name:'Document',exact:true});
async function files(page:Page){await workspace(page).getByRole('button',{name:'Task options',exact:true}).click();await workspace(page).getByRole('button',{name:'Files',exact:true}).click();return page.getByRole('dialog',{name:'Files',exact:true});}
async function open(page:Page){
 const entry=await textHelperEntry(page);await page.getByRole('button',{name:'Continue',exact:true}).click();await workspace(page).getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'New task',exact:true}).click();await workspace(page).getByRole('button',{name:'Write a draft',exact:true}).click();
 const start=page.getByRole('region',{name:'Start with a draft',exact:true});await start.getByLabel('Title (optional)',{exact:true}).fill('Run race owner');await start.getByLabel('Draft content',{exact:true}).fill('Owned local helper practice.');await start.getByRole('button',{name:'Create task',exact:true}).click();await document(page).getByRole('button',{name:'Back to task',exact:true}).click();
 const list=await files(page);await list.getByRole('button',{name:'New file',exact:true}).click();await list.getByRole('button',{name:'Text helper',exact:true}).click();return entry;
}
/** Observe the real ordinary raw-save boundary while the deliberately held
 * submission reply remains outstanding. A quit flush correctly waits that reply. */
async function durableRaw(entry:Awaited<ReturnType<typeof open>>,actionKind:string,slot:string,expected:Record<string,unknown>,afterRevision=0){
 const command=[...entry.fixture.commands].reverse().find(command=>command.type==='module.edit'&&command.action.kind===actionKind);
 if(command?.type!=='module.edit')throw Error('Expected the actual held module command.');
 const task=await entry.fixture.core.getTask(command.taskId),artifact=task.artifacts.find(item=>item.id===command.artifactId),revision=artifact?.revisions.find(item=>item.revision===command.artifactRevision);
 if(!revision||revision.mimeType!==MODULE_MIME)throw Error('Expected the actual historical helper answer.');
 const module=parseModuleAnswer(JSON.parse(revision.content)).modules.find(item=>item.id===command.moduleId);
 if(module?.data.kind!=='helper-studio')throw Error('Expected the actual helper module.');
 const owner={taskId:task.id,artifactId:artifact!.id,artifactRevision:revision.revision,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version},key=learningDraftKey(owner,slot);
 let durable:LearningDraftRecord|undefined;
 await expect.poll(async()=>{
  const read=await entry.fixture.learningDrafts.read();if(read.kind!=='available')throw Error('The real raw draft store is unavailable.');
  const record=read.records.find(item=>learningDraftKey(item.owner,item.slot)===key);
  if(!record?.value||record.revision<=afterRevision)return null;durable=record;return parseLearningDraftJson(record.value.value);
 },{timeout:7000,message:'Wait for a later exact helper owner/slot raw input to be durably saved.'}).toMatchObject(expected);
 return durable!;
}
async function readyRecord(page:Page){const scope=document(page).locator('.helper-studio');await scope.getByRole('button',{name:'Create a local record helper',exact:true}).click();await scope.getByRole('button',{name:'Save draft steps',exact:true}).click();await scope.getByRole('button',{name:'Record local computation',exact:true}).click();await scope.getByRole('button',{name:'Check examples',exact:true}).click();await expect(scope).toContainText('Local checks pass.');await scope.getByRole('button',{name:'Save checked record version',exact:true}).click();await scope.getByRole('button',{name:'Activate version 1',exact:true}).click();return scope;}

test('a postcommit delayed run response cannot clear a newer compact input',async({page})=>{
 const entry=await open(page);let release=()=>{};
 try{
  const scope=await readyRecord(page),number=scope.getByLabel('Fresh record number',{exact:true});await number.fill('100');await entry.fixture.flushDrafts();
  const invoke=entry.fixture.invoke.bind(entry.fixture);let reached!:()=>void;const arrived=new Promise<void>(resolve=>{reached=resolve;}),waiting=new Promise<void>(resolve=>{release=resolve;});let held=false;
  entry.fixture.invoke=async command=>{if(command.type==='module.edit'&&command.action.kind==='run-semantic-active'&&!held){held=true;entry.fixture.commands.push(structuredClone(command));await editModule(entry.fixture.core,command);reached();await waiting;await entry.fixture.emit({type:'changed'});return entry.fixture.core.getTask(command.taskId);}return invoke(command);};
  await scope.getByRole('button',{name:'Run active record helper',exact:true}).click();await arrived;
  await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:640});const compact=page.locator('.compact-companion:visible');const newer=compact.getByLabel('Fresh record number',{exact:true});await expect(newer).toHaveValue('100');const prior=await durableRaw(entry,'run-semantic-active','helper:semantic:run',{runAmount:'100',runApproved:true,runSensitive:false});await newer.fill('200');await durableRaw(entry,'run-semantic-active','helper:semantic:run',{runAmount:'200',runApproved:true,runSensitive:false},prior.revision);
  release();const recovery=compact.locator('.learning-draft-recovery');await expect(recovery).toBeVisible();await recovery.locator('summary').click();await expect(recovery).toContainText('200');await expect(compact.getByText('Version 1 local result',{exact:true})).toHaveCount(0);
  await recovery.locator('summary').evaluate(node=>node.scrollIntoView({block:'center'}));await page.screenshot({path:join(evidence,'compact-delayed-run-recovery.png')});
  await recovery.locator('pre').first().evaluate(node=>node.scrollIntoView({block:'center'}));await page.screenshot({path:join(evidence,'compact-delayed-run-newer-input.png')});
  await compact.getByRole('button',{name:'Open task workspace',exact:true}).click();await page.setViewportSize({width:1080,height:800});const full=document(page).locator('.helper-studio'),fullRecovery=full.locator('.learning-draft-recovery');await expect(fullRecovery).toBeVisible();await fullRecovery.locator('summary').click();await expect(fullRecovery).toContainText('200');await entry.fixture.flushDrafts();
  await entry.fixture.restart();const list=await files(page);await list.getByText('Unfinished practice',{exact:true}).click();await expect(list.locator('article').filter({hasText:'200'})).toBeVisible();
 }finally{release();await entry.close();}
});

test('all five record form families retain raw edits over reopening',async({page})=>{
 const entry=await open(page);
 try{
  let scope=await readyRecord(page);await scope.getByLabel('Compare with',{exact:true}).fill('2400');await scope.getByLabel('Example number',{exact:true}).fill('27');await scope.getByLabel('Proposed reason',{exact:true}).fill('Keep this unsubmitted reason.');
  await scope.getByText('Correct the proposed reason',{exact:true}).click();await scope.getByLabel('Corrected reason',{exact:true}).fill('Keep this correction.');await scope.getByLabel('Why',{exact:true}).fill('Keep this explanation.');await scope.getByLabel('Fresh record number',{exact:true}).fill('345');
  const versions=scope.getByRole('region',{name:'Record helper versions',exact:true});await versions.getByRole('checkbox',{name:'sensitive',exact:true}).check();await entry.fixture.flushDrafts();await entry.fixture.restart();const list=await files(page);await list.getByRole('button',{name:/^Text helper Document/}).click();scope=document(page).locator('.helper-studio');
  await expect(scope.getByLabel('Compare with',{exact:true})).toHaveValue('2400');await expect(scope.getByLabel('Example number',{exact:true})).toHaveValue('27');await expect(scope.getByLabel('Proposed reason',{exact:true})).toHaveValue('Keep this unsubmitted reason.');await scope.getByText('Correct the proposed reason',{exact:true}).click();await expect(scope.getByLabel('Corrected reason',{exact:true})).toHaveValue('Keep this correction.');await expect(scope.getByLabel('Why',{exact:true})).toHaveValue('Keep this explanation.');await expect(scope.getByLabel('Fresh record number',{exact:true})).toHaveValue('345');await expect(scope.getByRole('region',{name:'Record helper versions',exact:true}).getByRole('checkbox',{name:'sensitive',exact:true})).toBeChecked();
  for(const [label,filename] of [['Compare with','record-restored-steps.png'],['Example number','record-restored-example.png'],['Proposed reason','record-restored-checks.png'],['Corrected reason','record-restored-correction.png'],['Fresh record number','record-restored-run.png']] as const){await scope.getByLabel(label,{exact:true}).evaluate(node=>node.scrollIntoView({block:'center'}));await page.screenshot({path:join(evidence,filename)});}
 }finally{await entry.close();}
});

test('recorded input stays bound to its trace and ordinary check corrections acknowledge the selection',async({page})=>{
 const entry=await open(page);
 try{
  let scope=document(page).locator('.helper-studio');await scope.getByRole('button',{name:'Start demonstration',exact:true}).click();await scope.getByRole('button',{name:'Demonstrate operation',exact:true}).click();await scope.getByRole('button',{name:'Stop and use demonstration',exact:true}).click();
  const row=scope.getByRole('row').filter({hasText:'Recorded local demonstration (example)'});await expect(row).toBeVisible();const task=(await entry.fixture.core.listTasks()).find(item=>item.title==='Run race owner')!;const before=task.session!.moduleStates[0].state as import('../src/learning/reusable-helper').HelperState;const recorded=structuredClone(before.draft.tests[0]);
  await row.getByRole('button',{name:'Edit check',exact:true}).click();await expect(scope.getByLabel('Test input',{exact:true})).toHaveJSProperty('readOnly',true);await expect(scope).toContainText('Recorded input belongs to the original demonstration.');await scope.getByLabel('Test input',{exact:true}).evaluate(node=>node.scrollIntoView({block:'center'}));await page.screenshot({path:join(evidence,'recorded-check-readonly-provenance.png')});await scope.getByLabel('Expected text',{exact:true}).fill('Deliberately wrong');await scope.getByRole('button',{name:'Save check correction',exact:true}).click();await expect(scope.getByRole('button',{name:'Add check',exact:true})).toBeEnabled();await expect(scope.getByRole('row').filter({hasText:'Expected transformation (example)'})).toContainText('Fail');await scope.getByRole('row').filter({hasText:'Expected transformation (example)'}).evaluate(node=>node.scrollIntoView({block:'center'}));await page.screenshot({path:join(evidence,'recorded-check-corrected-expectation.png')});
  await scope.getByLabel('Test input',{exact:true}).fill('ordinary original');await scope.getByLabel('Expected text',{exact:true}).fill('ordinary original');await scope.getByRole('button',{name:'Add check',exact:true}).click();const ordinary=scope.getByRole('row').filter({hasText:'Protected or unusual input (counterexample)'});await expect(ordinary).toContainText('Pass');await ordinary.getByRole('button',{name:'Edit check',exact:true}).click();await expect(scope.getByLabel('Test input',{exact:true})).toHaveJSProperty('readOnly',false);await scope.getByLabel('Test input',{exact:true}).fill('  Chosen input  ');await scope.getByLabel('Expected text',{exact:true}).fill('Chosen input');await scope.getByRole('button',{name:'Save check correction',exact:true}).click();await expect(scope.getByRole('button',{name:'Add check',exact:true})).toBeEnabled();await expect(scope.getByRole('row').filter({hasText:'Protected or unusual input (counterexample)'})).toContainText('Chosen input');
  const saved=await entry.fixture.core.getTask(task.id),after=saved.session!.moduleStates[0].state as import('../src/learning/reusable-helper').HelperState;expect(after.draft.tests.find(item=>item.id===recorded.id)).toMatchObject({input:recorded.input,demonstration:recorded.demonstration,expected:{kind:'output',text:'Deliberately wrong'}});
  await entry.fixture.flushDrafts();await entry.fixture.restart();const list=await files(page);await list.getByRole('button',{name:/^Text helper Document/}).click();scope=document(page).locator('.helper-studio');await expect(scope.getByRole('row').filter({hasText:'Expected transformation (example)'})).toContainText('Fail');await expect(scope.getByRole('row').filter({hasText:'Protected or unusual input (counterexample)'})).toContainText('Chosen input');await expect(scope.getByRole('button',{name:'Add check',exact:true})).toBeVisible();
 }finally{await entry.close();}
});

test('a delayed saved check response leaves a newer compact selected check for review',async({page})=>{
 const entry=await open(page);let release=()=>{};
 try{
  const scope=document(page).locator('.helper-studio');await scope.getByRole('button',{name:'Start demonstration',exact:true}).click();await scope.getByRole('button',{name:'Demonstrate operation',exact:true}).click();await scope.getByRole('button',{name:'Stop and use demonstration',exact:true}).click();
  await scope.getByLabel('Test input',{exact:true}).fill('ordinary input');await scope.getByLabel('Expected text',{exact:true}).fill('ordinary input');await scope.getByRole('button',{name:'Add check',exact:true}).click();
  await scope.getByRole('row').filter({hasText:'Recorded local demonstration (example)'}).getByRole('button',{name:'Edit check',exact:true}).click();await scope.getByLabel('Expected text',{exact:true}).fill('Earlier changed expectation');await entry.fixture.flushDrafts();
  const invoke=entry.fixture.invoke.bind(entry.fixture);let reached!:()=>void;const arrived=new Promise<void>(resolve=>{reached=resolve;}),waiting=new Promise<void>(resolve=>{release=resolve;});let held=false;
  entry.fixture.invoke=async command=>{if(command.type==='module.edit'&&command.action.kind==='add-test'&&!held){held=true;entry.fixture.commands.push(structuredClone(command));await editModule(entry.fixture.core,command);reached();await waiting;await entry.fixture.emit({type:'changed'});return entry.fixture.core.getTask(command.taskId);}return invoke(command);};
  await scope.getByRole('button',{name:'Save check correction',exact:true}).click();await arrived;await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:640});const compact=page.locator('.compact-companion:visible');const prior=await durableRaw(entry,'add-test','helper:text:check',{testOutput:'Earlier changed expectation',testRole:'example'});await compact.getByRole('button',{name:'Cancel check correction',exact:true}).click();const ordinary=compact.getByRole('row').filter({hasText:'Protected or unusual input (counterexample)'});await ordinary.getByRole('button',{name:'Edit check',exact:true}).click();await compact.getByLabel('Test input',{exact:true}).fill('Newer chosen check input');await durableRaw(entry,'add-test','helper:text:check',{testInput:'Newer chosen check input',editingTest:expect.stringMatching(/\S/),testRole:'counterexample'},prior.revision);release();
  const recovery=compact.locator('.learning-draft-recovery');await expect(recovery).toBeVisible();await recovery.locator('summary').click();await expect(recovery).toContainText('Newer chosen check input');await expect(recovery).toContainText('editing Test');await recovery.locator('pre').first().evaluate(node=>node.scrollIntoView({block:'center'}));await page.screenshot({path:join(evidence,'compact-delayed-check-newer-selection.png')});
  await compact.getByRole('button',{name:'Open task workspace',exact:true}).click();await page.setViewportSize({width:1080,height:800});await entry.fixture.flushDrafts();await entry.fixture.restart();const list=await files(page);await list.getByText('Unfinished practice',{exact:true}).click();await expect(list.locator('article').filter({hasText:'Newer chosen check input'})).toBeVisible();
 }finally{release();await entry.close();}
});
