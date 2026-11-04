import {expect,test,type Locator,type Page} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {emptyLocalTaskDraft,localTaskDraftBasis,parseLocalTaskDraft,type LocalTaskDraft} from '../../src/shared/local-task-draft';
import {serializeLearningDraftJson} from '../../src/shared/learning-drafts';
import {localTaskDurableEntry} from '../support/local-task-durable-app.fixture';
import {settleCapture} from '../support/settled-capture';
import {taskTool} from '../support/ui-tools';

type Entry=Awaited<ReturnType<typeof localTaskDurableEntry>>;
type Form='text'|'draft';
const evidence='evidence/local-task-durable-app',frames:string[]=[];
const workspace=(page:Page)=>page.locator('.workspace:visible');
const local=(page:Page)=>workspace(page).getByRole('region',{name:/^Start with (text|a draft)$/});
const body=(page:Page,form:Form)=>local(page).getByRole('textbox',{name:form==='text'?'Source text':'Draft content',exact:true});
const title=(page:Page)=>local(page).getByRole('textbox',{name:'Title (optional)',exact:true});
const document=(page:Page)=>page.getByRole('dialog',{name:'Document',exact:true});
const storage=(page:Page)=>workspace(page).locator('main').getByRole('region',{name:'Practice draft recovery',exact:true});
const raw=(title:string,content:string):LocalTaskDraft=>({...emptyLocalTaskDraft,title,content});
const freezeText='Editing is paused while the app saves before closing. It resumes if closing is cancelled.';
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true});});
test.beforeEach(()=>{frames.length=0;});
async function onboard(page:Page,entry:Entry){
 expect(await entry.fixture.core.listTasks()).toHaveLength(0);await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByText('Local example · Bundled on this device',{exact:true})).toBeVisible();const tasks=await entry.fixture.core.listTasks();expect(tasks).toHaveLength(1);return tasks[0];
}
async function newTask(page:Page){
 const inspector=page.locator('.context-inspector:visible');if(await inspector.count())await inspector.getByRole('button',{name:'Back to task',exact:true}).click();
 await workspace(page).getByRole('complementary',{name:'Task navigation',exact:true}).getByRole('button',{name:'New task',exact:true}).click();
}
async function openLocalEntry(page:Page,form:Form){
 if(await local(page).count())await local(page).getByRole('button',{name:'Back to new task',exact:true}).click();
 await newTask(page);await workspace(page).getByRole('button',{name:form==='text'?'Paste text':'Write a draft',exact:true}).click();await expect(local(page)).toBeVisible();
}
async function begin(page:Page,form:Form){await openLocalEntry(page,form);await expect(body(page,form)).toBeEnabled();await expect(title(page)).toBeEnabled();}
async function beginUncertain(page:Page,entry:Entry,form:Form,expected:LocalTaskDraft){
 const starts=entry.creations.length;expect(expected.intentId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);expect(expected.intentId).toBe(entry.creations.at(-1)?.intentId);expect(expected.binding).toMatch(/^local-task-start-form:v1:[0-9a-f]{64}$/);
 await openLocalEntry(page,form);await expect(body(page,form)).toBeDisabled();await expect(title(page)).toBeDisabled();await expect(body(page,form)).toHaveValue(expected.content);await expect(title(page)).toHaveValue(expected.title);
 await expect(local(page).getByRole('button',{name:'Retry same save',exact:true})).toBeEnabled();await expect(local(page).getByRole('button',{name:'Back to new task',exact:true})).toBeEnabled();await expect(local(page).getByRole('button',{name:'Create task',exact:true})).toHaveCount(0);await expect(local(page).getByRole('button',{name:'Cancel',exact:true})).toHaveCount(0);
 await durable(entry,form,expected);expect(entry.creations).toHaveLength(starts);
}
async function fill(page:Page,form:Form,value:LocalTaskDraft){await title(page).fill(value.title);await body(page,form).fill(value.content);}
async function durable(entry:Entry,form:Form,value:LocalTaskDraft,minRevision=0){
 const expected={initial:serializeLearningDraftJson(emptyLocalTaskDraft),value:serializeLearningDraftJson(value,'local-task-form'),basis:localTaskDraftBasis(form)};
 await expect.poll(async()=>(await entry.record(form))?.value).toEqual(expected);const record=(await entry.record(form))!;expect(record.revision).toBeGreaterThan(minRevision);return record;
}
async function cleared(entry:Entry,form:Form){await expect.poll(async()=>await entry.record(form)).toMatchObject({value:null});}
async function chooseTask(page:Page,name:string){const button=workspace(page).getByRole('complementary',{name:'Task navigation',exact:true}).getByRole('button',{name,exact:true});await expect(button).toHaveCount(1);await button.click();await expect(workspace(page).locator('.workspace-task h1')).toHaveText(name);}
async function noEffects(entry:Entry,starts:number,tasks:number){
 expect(entry.creations).toHaveLength(starts);expect(await entry.fixture.core.listTasks()).toHaveLength(tasks);expect(entry.fixture.configured).toBe(false);expect(entry.fixture.external).toEqual([]);
 expect(entry.fixture.commands.filter(command=>command.type==='tasks.create'||command.type==='model.run'||command.type==='browser.run'||command.type==='connection.configure'||/^(?:windows\.capture|context\.(?:start|capture)|export\.)/.test(command.type))).toEqual([]);
 expect((await entry.fixture.core.listTasks()).every(task=>task.requests.length===0)).toBe(true);
 for(const dispatch of entry.dispatchRaw){expect(dispatch.record).toBeDefined();expect(dispatch.record!.value).not.toBeNull();const saved=parseLocalTaskDraft(JSON.parse(dispatch.record!.value!.value));expect(saved.intentId).toBe(dispatch.command.intentId);expect(saved.binding).toMatch(/^local-task-start-form:v1:[0-9a-f]{64}$/);expect(saved.content).toBe(dispatch.command.content);}
}
async function frame(page:Page,name:string,anchor:Locator,visible:Locator[]=[anchor],intentionalDisabled:Locator[]=[]){
 for(const item of intentionalDisabled)expect(visible.includes(item)).toBe(true);
 await expect(anchor).toHaveCount(1);await anchor.evaluate(element=>element.scrollIntoView({block:'center',inline:'nearest',behavior:'auto'}));await settleCapture(page);
 for(const item of visible){await expect(item).toHaveCount(1);await expect(item).toBeVisible();const disabled=intentionalDisabled.includes(item);
  // Shipped button:disabled uses own opacity0.5. Only explicitly declared
  // disabled buttons may use that value; their ancestors still must be opaque.
  if(disabled){await expect(item).toBeDisabled();expect(await item.evaluate(element=>element instanceof HTMLButtonElement&&element.disabled)).toBe(true);await expect(item).toHaveCSS('opacity','0.5');}
  await expect.poll(()=>item.evaluate((element,allowDisabledSelf)=>{for(let node:Element|null=element;node;node=node.parentElement){const style=getComputedStyle(node);if((!(allowDisabledSelf&&node===element)&&Number(style.opacity)<0.99)||style.visibility!=='visible'||style.display==='none')return false;}return true;},disabled)).toBe(true);
  const geometry=await item.evaluate(element=>{const r=element.getBoundingClientRect();let left=0,top=0,right=innerWidth,bottom=innerHeight;for(let node=element.parentElement;node;node=node.parentElement){const s=getComputedStyle(node),b=node.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(s.overflowX)){left=Math.max(left,b.left+node.clientLeft);right=Math.min(right,b.left+node.clientLeft+node.clientWidth);}if(/auto|scroll|hidden|clip/.test(s.overflowY)){top=Math.max(top,b.top+node.clientTop);bottom=Math.min(bottom,b.top+node.clientTop+node.clientHeight);}}return {fits:r.width>0&&r.height>0&&r.left>=left-1&&r.top>=top-1&&r.right<=right+1&&r.bottom<=bottom+1,rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},clip:{left,top,right,bottom}};});expect(geometry.fits,JSON.stringify(geometry)).toBe(true);
 }
 await page.screenshot({path:join(evidence,name+'.png')});frames.push(name+'.png');
}
async function ledger(entry:Entry,name:string){await writeFile(join(evidence,name+'.json'),JSON.stringify({boundary:'Actual public React App + disposable real core/sidecar. Explicit transport/disk-adversarial controls; no native/process quit/provider.',phases:entry.phases,events:entry.events,frames:[...frames],commands:entry.fixture.commands,creations:entry.creations,dispatchRaw:entry.dispatchRaw,writes:entry.writes,tasks:await entry.fixture.core.listTasks(),sidecar:JSON.parse((await readFile(join(entry.fixture.directory,'learning-drafts.json'))).toString())},null,2));}
async function openCreated(page:Page,form:Form,name:string){
 await chooseTask(page,name);
 if(form==='text'){await taskTool(page,'Sources');const row=page.getByRole('dialog',{name:'Context',exact:true}).locator('.source-list-row').filter({has:page.getByText(name,{exact:true})});await expect(row).toHaveCount(1);await row.click();return page.getByRole('region',{name:'Source snapshot',exact:true});}
 const row=workspace(page).locator('.conversation-manual-files').getByRole('button',{name,exact:true});await expect(row).toHaveCount(1);await row.click();return document(page);
}

test('text raw survives Back, task navigation, full-only compact return and fresh core/store object reload',async({page})=>{
 const entry=await localTaskDurableEntry(page);
 try{const example=await onboard(page,entry);await begin(page,'text');const value=raw('  Exact local title  ','  First line.\nSecond line.  \n');await fill(page,'text',value);await durable(entry,'text',value);
  await local(page).getByRole('button',{name:'Back to new task',exact:true}).click();await begin(page,'text');await expect(title(page)).toHaveValue(value.title);await expect(body(page,'text')).toHaveValue(value.content);
  await chooseTask(page,example.title);await begin(page,'text');await expect(body(page,'text')).toHaveValue(value.content);
  await workspace(page).getByRole('button',{name:'Switch to compact companion',exact:true}).click();await page.setViewportSize({width:360,height:640});const compact=page.locator('.compact-companion:visible');await expect(compact).toBeVisible();await expect(compact.getByRole('textbox',{name:'Source text',exact:true})).toHaveCount(0);await frame(page,'01-compact-full-only',compact.getByRole('button',{name:'Open task workspace',exact:true}));
  await compact.getByRole('button',{name:'Open task workspace',exact:true}).click();await page.setViewportSize({width:1080,height:800});await expect(body(page,'text')).toHaveValue(value.content);
  await entry.recreateCoreAndStore();await begin(page,'text');await expect(title(page)).toHaveValue(value.title);await expect(body(page,'text')).toHaveValue(value.content);await frame(page,'02-text-reopened',body(page,'text'));
  const first=(await entry.record('text'))!.revision;await body(page,'text').fill('');await durable(entry,'text',raw(value.title,''),first);await title(page).fill('');await cleared(entry,'text');
  await entry.recreateCoreAndStore();await begin(page,'text');await expect(title(page)).toHaveValue('');await expect(body(page,'text')).toHaveValue('');await expect(local(page).getByRole('button',{name:'Create task',exact:true})).toBeDisabled();await local(page).getByRole('button',{name:'Cancel',exact:true}).click();await expect(local(page)).toHaveCount(0);await noEffects(entry,0,1);await ledger(entry,'text-continuity');
 }finally{await entry.close();}
});

test('a legal 100k Unicode draft and intentional blank title/content retain exact whole raw after reopening',async({page})=>{
 const entry=await localTaskDurableEntry(page);
 try{await onboard(page,entry);await begin(page,'draft');const value=raw('題'.repeat(200),'界'.repeat(99_998)+'🙂');expect(value.content.length).toBe(100_000);await fill(page,'draft',value);await durable(entry,'draft',value);
  await local(page).getByRole('button',{name:'Back to new task',exact:true}).click();await entry.recreateCoreAndStore();await begin(page,'draft');await expect(title(page)).toHaveValue(value.title);await expect(body(page,'draft')).toHaveValue(value.content);await frame(page,'03-unicode-draft-reopened',body(page,'draft'));
  await title(page).fill('');await durable(entry,'draft',raw('',value.content));await body(page,'draft').fill('');await cleared(entry,'draft');await entry.recreateCoreAndStore();await begin(page,'draft');await expect(title(page)).toHaveValue('');await expect(body(page,'draft')).toHaveValue('');await noEffects(entry,0,1);await ledger(entry,'unicode-and-empty');
 }finally{await entry.close();}
});

test('queued visible edits persist before one Create dispatch and fields freeze immediately',async({page})=>{
 const entry=await localTaskDurableEntry(page);
 try{await onboard(page,entry);await begin(page,'text');const held=entry.holdRaw('text');await title(page).fill('Queued title');await expect.poll(held.reached).toBe(true);await body(page,'text').fill('g1');await body(page,'text').fill('g2 typed before Create');await local(page).getByRole('button',{name:'Create task',exact:true}).click({clickCount:2});
  await expect(body(page,'text')).toBeDisabled();await expect(title(page)).toBeDisabled();await expect(body(page,'text')).toHaveValue('g2 typed before Create');await expect(title(page)).toHaveValue('Queued title');await expect(local(page)).toHaveAttribute('aria-busy','true');
  // An intent is already prepared while its raw write waits. Actual actions are
  // disabled Retry/Back at this phase; Cancel and Saving… have been replaced.
  const preparing=local(page).getByText('Preparing this local save…',{exact:true}),retry=local(page).getByRole('button',{name:'Retry same save',exact:true}),back=local(page).getByRole('button',{name:'Back to new task',exact:true});
  await expect(preparing).toBeVisible();await expect(retry).toBeDisabled();await expect(back).toBeDisabled();await expect(local(page).locator('.local-task-actions button:not(:disabled)')).toHaveCount(0);expect(entry.creations).toHaveLength(0);
  await frame(page,'04-precreate-freeze',preparing,[preparing,retry,back],[retry,back]);expect(entry.creations).toHaveLength(0);held.release();
  await expect(page.getByRole('region',{name:'Source snapshot',exact:true})).toContainText('g2 typed before Create');await cleared(entry,'text');await noEffects(entry,1,2);expect(entry.dispatchRaw[0].record!.value!.value).toContain('g2 typed before Create');await ledger(entry,'queued-create');
 }finally{await entry.close();}
});

test('foreign CAS conflict, raw failure and failed Cancel remain local and require explicit recovery',async({page})=>{
 const entry=await localTaskDurableEntry(page);
 try{await onboard(page,entry);await begin(page,'text');await fill(page,'text',raw('Conflict input','First durable input'));await durable(entry,'text',raw('Conflict input','First durable input'));
  const held=entry.holdRaw('text');await body(page,'text').fill('Open local version');await expect.poll(held.reached).toBe(true);await entry.foreignReplace('text','Foreign saved version');held.release();await expect(local(page).getByText('Local input needs recovery. Your saved and open versions are kept; no task is created by recovery.',{exact:true})).toBeVisible();
  await local(page).getByRole('button',{name:'Retry local draft storage',exact:true}).click();await expect(local(page).getByRole('button',{name:'Keep my local input',exact:true})).toBeVisible();await local(page).getByText('Inspect earlier local input',{exact:true}).click();await expect(local(page).getByLabel('Earlier local content',{exact:true})).toHaveValue('Open local version');await expect(local(page).getByLabel('Saved local content',{exact:true})).toHaveValue('Foreign saved version');await frame(page,'05-conflict-versions',local(page).getByLabel('Saved local content',{exact:true}));
  await local(page).getByRole('button',{name:'Keep my local input',exact:true}).click();await durable(entry,'text',raw('Conflict input','Open local version'));
  entry.failNext('text','raw');await body(page,'text').fill('Input after failed write');await expect(local(page).getByRole('button',{name:'Retry local draft storage',exact:true})).toBeVisible();await expect(body(page,'text')).toBeDisabled();await local(page).getByRole('button',{name:'Retry local draft storage',exact:true}).click();await durable(entry,'text',raw('Conflict input','Input after failed write'));
  entry.failNext('text','null');await local(page).getByRole('button',{name:'Cancel',exact:true}).click();await expect(local(page).getByRole('button',{name:'Retry local draft storage',exact:true})).toBeVisible();expect((await entry.record('text'))!.value).not.toBeNull();await expect(local(page)).not.toContainText('Input saved on this Mac. Choose Create task to submit it.');await frame(page,'06-cancel-failure-held',local(page).getByRole('button',{name:'Retry local draft storage',exact:true}));
  await local(page).getByRole('button',{name:'Retry local draft storage',exact:true}).click();await cleared(entry,'text');await expect(local(page).getByRole('button',{name:'Cancel',exact:true})).toBeEnabled();await local(page).getByRole('button',{name:'Cancel',exact:true}).click();await expect(local(page)).toHaveCount(0);await noEffects(entry,0,1);await ledger(entry,'conflict-retry-cancel');
 }finally{await entry.close();}
});

test('unsupported storage has one global explicit backup recovery and keeps open local raw for a choice',async({page})=>{
 const entry=await localTaskDurableEntry(page);
 try{await onboard(page,entry);await begin(page,'text');await fill(page,'text',raw('Unreadable-store input','Earlier saved raw'));await durable(entry,'text',raw('Unreadable-store input','Earlier saved raw'));entry.failNext('text','raw');await body(page,'text').fill('Open input retained through recovery');await expect(local(page).getByRole('button',{name:'Retry local draft storage',exact:true})).toBeVisible();
  const bad=await entry.unsupportedFile();await local(page).getByRole('button',{name:'Retry local draft storage',exact:true}).click();await expect(storage(page)).toHaveCount(1);await expect(storage(page).getByRole('button',{name:'Retry reading practice drafts',exact:true})).toHaveCount(1);await expect(body(page,'text')).toBeDisabled();
  await storage(page).getByText('Recover unreadable practice drafts',{exact:true}).click();await frame(page,'07-single-global-recovery',storage(page).getByRole('button',{name:'Preserve file and start fresh practice drafts',exact:true}));
  await storage(page).getByRole('button',{name:'Preserve file and start fresh practice drafts',exact:true}).click();await expect(local(page).getByRole('button',{name:'Keep my local input',exact:true})).toBeVisible();
  const recovery=entry.fixture.commands.filter(command=>command.type==='learning-drafts.recover');expect(recovery).toHaveLength(1);const names=await import('node:fs/promises').then(fs=>fs.readdir(entry.fixture.directory)),backups=names.filter(name=>/^learning-drafts-recovery-[0-9a-f-]+\.json$/.test(name));expect(backups).toHaveLength(1);expect(await readFile(join(entry.fixture.directory,backups[0]))).toEqual(bad);
  entry.events.push({kind:'exact-unsupported-backup-verified',detail:{basename:backups[0],sha256:createHash('sha256').update(bad).digest('hex')}});await local(page).getByRole('button',{name:'Keep my local input',exact:true}).click();await durable(entry,'text',raw('Unreadable-store input','Open input retained through recovery'));await frame(page,'08-recovered-open-input',body(page,'text'));
  await entry.recreateCoreAndStore();await begin(page,'text');await expect(body(page,'text')).toHaveValue('Open input retained through recovery');await noEffects(entry,0,1);await ledger(entry,'unsupported-recovery');
 }finally{await entry.close();}
});

for(const kind of ['text','draft'] as const)test(`lost ${kind} postcommit reply reopens inertly and same-ID retry retains a later public target edit`,async({page})=>{
 const entry=await localTaskDurableEntry(page);
 try{await onboard(page,entry);await begin(page,kind);const name='Lost '+kind+' save',content='Original '+kind+' input';await fill(page,kind,raw(name,content));await durable(entry,kind,raw(name,content));entry.loseNextResponse();await local(page).getByRole('button',{name:'Create task',exact:true}).click();await expect(local(page).getByRole('button',{name:'Retry same save',exact:true})).toBeEnabled();await expect(body(page,kind)).toBeDisabled();await frame(page,kind==='text'?'09-uncertain-text':'10-uncertain-draft',local(page).getByRole('button',{name:'Retry same save',exact:true}));
  const attempt=(await entry.record(kind))!,identity=parseLocalTaskDraft(JSON.parse(attempt.value!.value));expect(identity.intentId).toBe(entry.creations[0].intentId);await local(page).getByRole('button',{name:'Back to new task',exact:true}).click();const saved=(await entry.fixture.core.listTasks()).find(task=>task.title===name)!;expect(saved).toBeDefined();const scope=await openCreated(page,kind,name);
  if(kind==='text'){await scope.getByRole('button',{name:'Source options',exact:true}).click();await scope.getByRole('button',{name:'Edit / refresh',exact:true}).click();await page.getByRole('textbox',{name:'Source text',exact:true}).fill('Later public source edit');await page.getByRole('button',{name:'Save new version',exact:true}).click();await expect(scope).toContainText('Later public source edit');}
  else{await scope.getByRole('button',{name:'Edit document',exact:true}).click();await scope.getByRole('textbox',{name:'Draft content',exact:true}).fill('Later public document edit');await scope.getByRole('button',{name:'Save revision',exact:true}).click();await expect.poll(async()=>(await entry.fixture.core.getTask(saved.id)).artifacts[0].revisions.length).toBe(2);await scope.getByRole('button',{name:'Cancel',exact:true}).click();await expect(scope).toContainText('Later public document edit');}
  const later=await entry.fixture.core.getTask(saved.id);await beginUncertain(page,entry,kind,identity);await entry.recreateCoreAndStore();await beginUncertain(page,entry,kind,identity);await expect(local(page).getByRole('button',{name:'Retry same save',exact:true})).toBeEnabled();expect(entry.creations).toHaveLength(1);expect(await entry.record(kind)).toEqual(attempt);
  await local(page).getByRole('button',{name:'Retry same save',exact:true}).click();await expect(kind==='text'?page.getByRole('region',{name:'Source snapshot',exact:true}):document(page)).toContainText(kind==='text'?'Later public source edit':'Later public document edit');await cleared(entry,kind);expect(entry.creations[1]).toEqual(entry.creations[0]);const after=await entry.fixture.core.getTask(saved.id);expect(after.sources).toEqual(later.sources);expect(after.artifacts).toEqual(later.artifacts);await noEffects(entry,2,2);await ledger(entry,'lost-'+kind+'-same-id');
 }finally{await entry.close();}
});

test('actual unmount then newer visible raw survives late acknowledgement and cancelled/repeated synthetic quit IDs',async({page})=>{
 const entry=await localTaskDurableEntry(page);
 try{const example=await onboard(page,entry);await begin(page,'text');await fill(page,'text',raw('Committed old input','Submitted g1'));await durable(entry,'text',raw('Committed old input','Submitted g1'));const reply=entry.holdReply('text'),nullWrite=entry.holdNull('text');await local(page).getByRole('button',{name:'Create task',exact:true}).click();await expect.poll(reply.reached).toBe(true);expect(await entry.fixture.core.listTasks()).toHaveLength(2);
  await chooseTask(page,example.title);await expect(local(page)).toHaveCount(0);await newTask(page);await expect(workspace(page).getByRole('button',{name:'Paste text',exact:true})).toBeDisabled();reply.release();await expect.poll(nullWrite.reached).toBe(true);await workspace(page).getByRole('button',{name:'Paste text',exact:true}).click();await expect(body(page,'text')).toBeEnabled();await fill(page,'text',raw('New visible input','g2 after old form unmounted'));
  const oldQuit=crypto.randomUUID(),newQuit=crypto.randomUUID();await entry.flushEvent(oldQuit);await expect(body(page,'text')).toBeDisabled();await expect(local(page).getByText(freezeText,{exact:true})).toBeVisible();expect(entry.acknowledgements(oldQuit)).toHaveLength(0);
  await entry.resumeEvent(oldQuit);await expect(body(page,'text')).toBeEnabled();await body(page,'text').fill('g3 after cancelled quit');await entry.flushEvent(newQuit);await entry.resumeEvent(oldQuit);await expect(body(page,'text')).toBeDisabled();expect(entry.acknowledgements(newQuit)).toHaveLength(0);await frame(page,'11-newer-input-quit-held',local(page).getByText(freezeText,{exact:true}));nullWrite.release();
  await expect.poll(()=>entry.acknowledgements(newQuit).length).toBe(1);expect(entry.acknowledgements(newQuit)[0].error).toBeUndefined();await expect.poll(()=>entry.acknowledgements(oldQuit).length).toBe(1);expect(entry.acknowledgements(oldQuit)[0].error).toBeTruthy();await durable(entry,'text',raw('New visible input','g3 after cancelled quit'));await expect(workspace(page).locator('.workspace-task h1')).toHaveText('New task');await expect(body(page,'text')).toHaveValue('g3 after cancelled quit');
  await entry.resumeEvent(newQuit);await expect(body(page,'text')).toBeEnabled();await noEffects(entry,1,2);await ledger(entry,'unmount-newer-quit');
 }finally{await entry.close();}
});

test('an incoming choice-only activation retires late presentation while a real committed result still clears exact raw',async({page})=>{
 const entry=await localTaskDurableEntry(page);
 try{await onboard(page,entry);await begin(page,'draft');await fill(page,'draft',raw('Committed before incoming','Exact submitted document'));await durable(entry,'draft',raw('Committed before incoming','Exact submitted document'));const reply=entry.holdReply('draft');await local(page).getByRole('button',{name:'Create task',exact:true}).click();await expect.poll(reply.reached).toBe(true);
  const activationId=crypto.randomUUID();entry.events.push({kind:'synthetic-choice-only-context-activation-no-target-or-pixels',detail:activationId});await entry.fixture.emit({type:'context.activate',activation:{activationId,tucked:false,choices:[],newTask:true,intent:'attach',origin:'source-picker'}});const context=workspace(page).getByRole('region',{name:'Screen context',exact:true});await expect(context.getByRole('heading',{name:'Which window?',exact:true})).toBeVisible();await expect(local(page)).toHaveCount(0);await frame(page,'12-incoming-keeps-presentation',context.getByRole('heading',{name:'Which window?',exact:true}));reply.release();await cleared(entry,'draft');await entry.settleWork();await expect(context).toBeVisible();await expect(document(page)).toHaveCount(0);await context.getByRole('button',{name:'Cancel',exact:true}).click();await expect(context).toHaveCount(0);await noEffects(entry,1,2);await ledger(entry,'incoming-late-result');
 }finally{await entry.close();}
});

test('a late tombstone failure reports an unsuccessful synthetic quit and storage retry clears only that raw',async({page})=>{
 const entry=await localTaskDurableEntry(page);
 try{await onboard(page,entry);await begin(page,'draft');await fill(page,'draft',raw('Committed but cleanup failed','Saved document body'));await durable(entry,'draft',raw('Committed but cleanup failed','Saved document body'));entry.failNext('draft','null');await local(page).getByRole('button',{name:'Create task',exact:true}).click();await expect(local(page).getByRole('button',{name:'Retry local draft storage',exact:true})).toBeVisible();expect(await entry.fixture.core.listTasks()).toHaveLength(2);expect((await entry.record('draft'))!.value).not.toBeNull();await expect(local(page)).not.toContainText('Input saved on this Mac. Choose Create task to submit it.');
  const quitId=crypto.randomUUID();await entry.flushEvent(quitId);await expect.poll(()=>entry.acknowledgements(quitId).length).toBe(1);expect(entry.acknowledgements(quitId)[0].error).toBeTruthy();await expect(body(page,'draft')).toBeDisabled();const retryStorage=local(page).getByRole('button',{name:'Retry local draft storage',exact:true});await frame(page,'13-committed-cleanup-held',retryStorage,[retryStorage],[retryStorage]);await entry.resumeEvent(quitId);await local(page).getByRole('button',{name:'Retry local draft storage',exact:true}).click();await cleared(entry,'draft');
  await local(page).getByRole('button',{name:'Back to new task',exact:true}).click();await begin(page,'draft');await expect(body(page,'draft')).toHaveValue('');await expect(body(page,'draft')).toBeEnabled();await frame(page,'14-cleared-input-reopened',body(page,'draft'));await noEffects(entry,1,2);await ledger(entry,'late-null-failure');
 }finally{await entry.close();}
});

test('deleting a committed uncertain target retains taskless ownership and retry cannot resurrect the task',async({page})=>{
 const entry=await localTaskDurableEntry(page);
 try{await onboard(page,entry);await begin(page,'draft');await fill(page,'draft',raw('Deleted uncertain task','Task may exist before deletion'));await durable(entry,'draft',raw('Deleted uncertain task','Task may exist before deletion'));entry.loseNextResponse();await local(page).getByRole('button',{name:'Create task',exact:true}).click();await expect(local(page).getByRole('button',{name:'Retry same save',exact:true})).toBeEnabled();const attempt=(await entry.record('draft'))!.value;
  await local(page).getByRole('button',{name:'Back to new task',exact:true}).click();await chooseTask(page,'Deleted uncertain task');await taskTool(page,'Task details');const details=page.getByRole('dialog',{name:'Task details',exact:true});await details.getByText('Delete this task',{exact:true}).click();await details.getByRole('button',{name:'Delete task…',exact:true}).click();await details.getByRole('button',{name:'Delete permanently',exact:true}).click();await expect.poll(async()=>(await entry.fixture.core.listTasks()).length).toBe(1);expect((await entry.record('draft'))!.value).toEqual(attempt);
  await beginUncertain(page,entry,'draft',parseLocalTaskDraft(JSON.parse(attempt!.value)));await local(page).getByRole('button',{name:'Retry same save',exact:true}).click();await expect.poll(()=>entry.creations.length).toBe(2);await expect(local(page).getByRole('button',{name:'Retry same save',exact:true})).toBeEnabled();expect(entry.creations[1]).toEqual(entry.creations[0]);expect((await entry.record('draft'))!.value).toEqual(attempt);await local(page).getByText('Discard this local input',{exact:true}).click();await expect(local(page)).toContainText('This only removes this local input and retry identity; it does not delete or undo a task.');await frame(page,'15-deleted-target-recovery',local(page).getByRole('button',{name:'Discard local input and retry identity',exact:true}));await local(page).getByRole('button',{name:'Discard local input and retry identity',exact:true}).click();await expect(local(page)).toHaveCount(0);await cleared(entry,'draft');await noEffects(entry,2,1);await ledger(entry,'deleted-target');
 }finally{await entry.close();}
});

for(const kind of ['text','draft'] as const)test(`same mounted ${kind} entry retires old presentation across cancelled quit and opens a fresh save`,async({page})=>{
 const entry=await localTaskDurableEntry(page);
 try{
  await onboard(page,entry);await begin(page,kind);
  const old=raw('Before cancelled quit '+kind,'Old submitted '+kind+' content');
  await fill(page,kind,old);await durable(entry,kind,old);
  const mounted=await local(page).elementHandle();expect(mounted).not.toBeNull();
  const reply=entry.holdReply(kind);await local(page).getByRole('button',{name:'Create task',exact:true}).click();await expect.poll(reply.reached).toBe(true);
  const attempt=(await entry.record(kind))!,identity=parseLocalTaskDraft(JSON.parse(attempt.value!.value)),store=await entry.fixture.learningDrafts.read();
  expect(store.kind).toBe('available');if(store.kind!=='available')throw Error('Expected readable local draft storage');
  expect(identity.title).toBe(old.title);expect(identity.content).toBe(old.content);expect(identity.intentId).toBe(entry.creations[0].intentId);
  const oldTasks=(await entry.fixture.core.listTasks()).filter(task=>task.title===old.title);expect(oldTasks).toHaveLength(1);const oldTask=oldTasks[0];
  expect(identity.binding).toMatch(/^local-task-start-form:v1:[0-9a-f]{64}$/);
  const quitId=crypto.randomUUID();await entry.flushEvent(quitId);await expect(local(page).getByText(freezeText,{exact:true})).toBeVisible();
  await expect(body(page,kind)).toBeDisabled();expect(entry.acknowledgements(quitId)).toHaveLength(0);
  await entry.resumeEvent(quitId);await expect(local(page).getByText(freezeText,{exact:true})).toHaveCount(0);
  expect(await local(page).evaluate((node,original)=>node===original,mounted)).toBe(true);
  await expect(body(page,kind)).toBeDisabled();await expect(title(page)).toBeDisabled();
  await expect(body(page,kind)).toHaveValue(old.content);await expect(title(page)).toHaveValue(old.title);expect(await entry.record(kind)).toEqual(attempt);
  reply.release();await cleared(entry,kind);await expect.poll(()=>entry.acknowledgements(quitId).length).toBe(1);expect(entry.acknowledgements(quitId)[0].error).toBeTruthy();await entry.settleWork();
  expect(await local(page).evaluate((node,original)=>node===original,mounted)).toBe(true);
  await expect(workspace(page).locator('.workspace-task h1')).toHaveText('New task');
  await expect(page.getByRole('region',{name:'Source snapshot',exact:true})).toHaveCount(0);await expect(document(page)).toHaveCount(0);
  await expect(local(page).getByText('Saved locally. You can find this task in your task list.',{exact:true})).toBeVisible();
  const tombstone=entry.writes.filter(write=>write.form===kind&&write.value===null&&write.outcome==='saved');expect(tombstone).toHaveLength(1);
  expect(tombstone[0].expectedEpoch).toBe(store.epoch);expect(tombstone[0].expectedRevision).toBe(attempt.revision);
  expect((await entry.fixture.core.listTasks()).filter(task=>task.title===old.title)).toHaveLength(1);
  await local(page).getByRole('button',{name:'Back to new task',exact:true}).click();
  await workspace(page).getByRole('button',{name:kind==='text'?'Paste text':'Write a draft',exact:true}).click();
  await expect(body(page,kind)).toBeEnabled();await expect(title(page)).toBeEnabled();
  const fresh=raw('After cancelled quit '+kind,'Fresh deliberate '+kind+' content');await fill(page,kind,fresh);await durable(entry,kind,fresh);
  await local(page).getByRole('button',{name:'Create task',exact:true}).click();
  await expect(kind==='text'?page.getByRole('region',{name:'Source snapshot',exact:true}):document(page)).toContainText(fresh.content);
  await expect(workspace(page).locator('.workspace-task h1')).toHaveText(fresh.title);await cleared(entry,kind);
  expect(entry.creations).toHaveLength(2);expect(entry.creations[1].intentId).not.toBe(identity.intentId);expect(entry.creations[1].content).toBe(fresh.content);
  const tasks=await entry.fixture.core.listTasks();expect(tasks.filter(task=>task.title===old.title)).toHaveLength(1);expect(tasks.find(task=>task.id===oldTask.id)).toEqual(oldTask);expect(tasks.filter(task=>task.title===fresh.title)).toHaveLength(1);
  await noEffects(entry,2,3);await ledger(entry,'mounted-resume-'+kind);
 }finally{await entry.close();}
});
