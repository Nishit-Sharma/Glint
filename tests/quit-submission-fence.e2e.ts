import {expect,test,type Locator,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createQuitDraftBarrier} from '../src/host/quit-drafts';
import {quitSubmissionEntry,document,openFiles,reopenWorkflow,workflowTitle,workspace} from './quit-submission-app.fixture';

const evidence=process.env.QUIT_SUBMISSION_EVIDENCE??'evidence/quit-submission-app';
const frozenText='Editing is paused while the app finishes saving before closing. Your edits are kept; editing resumes if closing is cancelled.';
type Entry=Awaited<ReturnType<typeof quitSubmissionEntry>>;
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true});});
const settle=(page:Page)=>page.evaluate(()=>new Promise<void>(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done()))));
async function rule(page:Page){
 const scope=document(page),summary=scope.getByText('Change Edit from Ready',{exact:true});
 if(await summary.locator('..').getAttribute('open')===null)await summary.click();
 const reason=scope.getByLabel('Edit from Ready reason',{exact:true}),form=reason.locator('xpath=ancestor::form');
 return {scope,reason,form,destination:scope.getByLabel('Edit from Ready destination',{exact:true}),apply:form.getByRole('button',{name:'Apply rule',exact:true})};
}
async function draft(page:Page,entry:Entry,reason:string){const form=await rule(page);await form.destination.selectOption({label:'In review'});await form.reason.fill(reason);await entry.fixture.flushDrafts();const record=(await entry.records()).find(item=>item.slot.includes(':rule:')&&item.value?.value.includes(reason));if(!record)throw Error('Expected actual durable raw rule draft.');return {...form,record};}
async function noAck(page:Page,entry:Entry,id:string){await settle(page);expect(entry.acknowledgements(id)).toEqual([]);}
async function ack(entry:Entry,id:string,error=false){await expect.poll(()=>entry.acknowledgements(id).length).toBe(1);const reply=entry.acknowledgements(id)[0];if(error)expect(reply.error).toBeTruthy();else expect(reply.error).toBeUndefined();return reply;}
async function shot(page:Page,anchor:Locator,name:string){await anchor.scrollIntoViewIfNeeded();await expect(anchor).toBeVisible();const fits=await anchor.evaluate(element=>{const box=element.getBoundingClientRect();let left=0,top=0,right=innerWidth,bottom=innerHeight;for(let parent=element.parentElement;parent;parent=parent.parentElement){const style=getComputedStyle(parent),bounds=parent.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,bounds.left+parent.clientLeft);right=Math.min(right,bounds.left+parent.clientLeft+parent.clientWidth);}if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,bounds.top+parent.clientTop);bottom=Math.min(bottom,bounds.top+parent.clientTop+parent.clientHeight);}}return box.left>=left&&box.right<=right&&box.top>=top&&box.bottom<=bottom;});expect(fits).toBe(true);await page.screenshot({path:join(evidence,name+'.png')});}
async function record(entry:Entry,name:string,extra:unknown={}){
 expect(entry.fixture.external).toEqual([]);expect(entry.fixture.commands.filter(command=>command.type==='model.run'||command.type==='browser.run'||command.type==='windows.capture'||command.type==='context.capture'||command.type.startsWith('export.'))).toEqual([]);
 await writeFile(join(evidence,name+'.json'),JSON.stringify({source:'715dddab7947a3e8de7c4401bf576515212e4938972be5f0f6ceab69ce993f03',scope:'Actual App/hook with disposable core/store; synthetic quit events and explicit transport holds only. No native quit or process termination.',owner:entry.owner,commands:entry.fixture.commands,writes:entry.writes,records:await entry.records(),state:await entry.state(),extra},null,2)+'\n');
}

test('real hook quit drain waits a committed module reply and its matching held tombstone',async({page})=>{
 const entry=await quitSubmissionEntry(page),module=entry.holdModule(),write=entry.holdDraft('null'),id='owned-quit-delayed-success';
 try{
  const form=await draft(page,entry,'Exact submitted reason before quit.');await form.apply.click();await module.entered;
  expect(await entry.state()).toMatchObject({revision:1,editNotes:[{reason:'Exact submitted reason before quit.'}]});
  await entry.fixture.emit({type:'draft.flush',quitId:id});const notice=form.form.getByText(frozenText,{exact:true});await expect(notice).toBeVisible();await noAck(page,entry,id);await shot(page,notice,'01-confirmation-held');
  module.release();await write.entered;await noAck(page,entry,id);expect((await entry.records()).find(item=>item.slot===form.record.slot)).toMatchObject({value:form.record.value});await shot(page,notice,'02-tombstone-held');
  write.release();await ack(entry,id);const cleared=(await entry.records()).find(item=>item.slot===form.record.slot);expect(cleared).toMatchObject({owner:entry.owner,revision:form.record.revision+1,value:null});
  await entry.fixture.emit({type:'draft.resume',quitId:id});await expect(notice).toHaveCount(0);await record(entry,'01-delayed-success');
 }finally{module.release();write.release();await entry.close();}
});

for(const navigation of ['artifact','task'] as const)test(`a dispatched form remains tracked after ${navigation} navigation unmounts its document`,async({page})=>{
 const entry=await quitSubmissionEntry(page,navigation==='artifact'),module=entry.holdModule(),id='owned-unmounted-'+navigation;
 try{
  const form=await draft(page,entry,'Submitted before '+navigation+' navigation.');await form.apply.click();await module.entered;
  await document(page).getByRole('button',{name:'Back to task',exact:true}).click();await expect(document(page)).toHaveCount(0);
  if(navigation==='artifact'){const files=await openFiles(page);await files.getByRole('button',{name:/^What happens to review after an edit\? notes Document/}).click();await expect(document(page).getByRole('heading',{name:workflowTitle+' notes',exact:true})).toBeVisible();}
  else await workspace(page).getByRole('complementary',{name:'Task navigation',exact:true}).getByRole('button',{name:'Observatory visit',exact:true}).click();
  await entry.fixture.emit({type:'draft.flush',quitId:id});await expect(workspace(page).getByRole('textbox',{name:'Ask about this task',exact:true})).toBeDisabled();await noAck(page,entry,id);
  module.release();await ack(entry,id);expect((await entry.records()).find(item=>item.slot===form.record.slot)?.value).toBeNull();
  await entry.fixture.emit({type:'draft.resume',quitId:id});
  if(navigation==='artifact'){await expect(document(page).getByRole('heading',{name:workflowTitle+' notes',exact:true})).toBeVisible();await shot(page,document(page).getByRole('heading',{name:workflowTitle+' notes',exact:true}),'03-artifact-unmounted-resumed');}
  else {await expect(workspace(page).getByRole('heading',{name:'Observatory visit',exact:true})).toBeVisible();await shot(page,workspace(page).getByRole('heading',{name:'Observatory visit',exact:true}),'04-task-unmounted-resumed');}
  await record(entry,'02-unmounted-'+navigation);
 }finally{module.release();await entry.close();}
});

test('a newer public form edit survives the earlier submission and quit drain',async({page})=>{
 const entry=await quitSubmissionEntry(page),raw=entry.holdDraft('raw'),module=entry.holdModule(),id='owned-quit-newer-generation';
 try{
  const form=await rule(page);await form.destination.selectOption({label:'In review'});await raw.entered;await form.reason.fill('Earlier submitted reason.');await form.apply.click();await form.reason.fill('  NEWER unsent reason.  ');
  raw.release();await module.entered;await entry.fixture.emit({type:'draft.flush',quitId:id});await expect(form.form.getByText(frozenText,{exact:true})).toBeVisible();await noAck(page,entry,id);
  module.release();await ack(entry,id);const saved=(await entry.records()).find(item=>item.slot.includes(':rule:')&&item.value?.value.includes('  NEWER unsent reason.  '));expect(saved).toBeDefined();expect(saved!.value).not.toBeNull();expect(await entry.state()).toMatchObject({editNotes:[{reason:'Earlier submitted reason.'}]});
  await entry.fixture.emit({type:'draft.resume',quitId:id});await document(page).getByRole('button',{name:'Back to task',exact:true}).click();const files=await openFiles(page);await files.getByText('Unfinished practice',{exact:true}).click();const kept=files.locator('article').filter({hasText:'NEWER unsent reason.'});await expect(kept).toBeVisible();await shot(page,kept.getByRole('heading').first(),'05-newer-generation-kept');await record(entry,'03-newer-generation');
 }finally{raw.release();module.release();await entry.close();}
});

test('a real competing public action refuses the stale confirmation while keeping the durable raw draft',async({page})=>{
 const entry=await quitSubmissionEntry(page),module=entry.holdModule('before'),id='owned-quit-refused-action';
 try{
  const form=await draft(page,entry,'Retain this refused rule input.');await form.apply.click();await module.entered;
  await document(page).getByRole('button',{name:'Back to task',exact:true}).click();const lab=workspace(page).getByRole('region',{name:'Workflow experiment',exact:true});await lab.getByRole('button',{name:'Deep',exact:true}).click();await expect(lab.getByRole('button',{name:'Deep',exact:true})).toHaveAttribute('aria-pressed','true');expect(await entry.state()).toMatchObject({revision:1,mode:'deep',editNotes:[]});
  await entry.fixture.emit({type:'draft.flush',quitId:id});await expect(workspace(page).getByRole('textbox',{name:'Ask about this task',exact:true})).toBeDisabled();await noAck(page,entry,id);module.release();await ack(entry,id);
  expect(await entry.state()).toMatchObject({revision:1,mode:'deep',editNotes:[]});expect((await entry.records()).find(item=>item.slot===form.record.slot)?.value?.value).toContain('Retain this refused rule input.');expect(entry.writes.filter(item=>item.value===null)).toEqual([]);
  await entry.fixture.emit({type:'draft.resume',quitId:id});await lab.getByText('Change Edit from Ready',{exact:true}).click();await expect(lab.getByLabel('Edit from Ready reason',{exact:true})).toHaveValue('Retain this refused rule input.');await shot(page,lab.getByLabel('Edit from Ready reason',{exact:true}),'06-refused-action-raw-kept');await record(entry,'04-refused-action');
 }finally{module.release();await entry.close();}
});

test('a late null-write failure sends an error acknowledgement until public retry succeeds',async({page})=>{
 const entry=await quitSubmissionEntry(page),module=entry.holdModule(),id='owned-quit-late-write-failure';
 try{
  const form=await draft(page,entry,'Core committed; raw cleanup must be confirmed.');entry.failNextNull();await form.apply.click();await module.entered;
  await entry.fixture.emit({type:'draft.flush',quitId:id});await expect(form.form.getByText(frozenText,{exact:true})).toBeVisible();await noAck(page,entry,id);module.release();await ack(entry,id,true);
  expect(await entry.state()).toMatchObject({revision:1,editNotes:[{reason:'Core committed; raw cleanup must be confirmed.'}]});expect((await entry.records()).find(item=>item.slot===form.record.slot)).toMatchObject({value:form.record.value});
  const failure=document(page).getByText('Unfinished practice could not be saved. Your input is kept in this open app. Resolve this before quitting.',{exact:true});await expect(failure).toBeVisible();await shot(page,failure,'07-late-tombstone-error');
  await entry.fixture.emit({type:'draft.resume',quitId:'wrong-id'});await expect(form.form.getByText(frozenText,{exact:true})).toBeVisible();await entry.fixture.emit({type:'draft.resume',quitId:id});
  await document(page).getByRole('button',{name:'Retry saving practice drafts',exact:true}).click();await expect(failure).toHaveCount(0);await entry.fixture.flushDrafts();expect((await entry.records()).find(item=>item.slot===form.record.slot)?.value).toBeNull();await record(entry,'05-late-write-failure');
 }finally{module.release();await entry.close();}
});

test('actual barrier timeout and matching App resume keep stale quit ids from satisfying a later attempt',async({page})=>{
 const entry=await quitSubmissionEntry(page),module=entry.holdModule(),accepted:{id:string;accepted:boolean;error?:string}[]=[],prompts:string[]=[],decisions:Promise<unknown>[]=[];
 let barrier:ReturnType<typeof createQuitDraftBarrier>;
 try{
  const form=await draft(page,entry,'Await this confirmation across two quit ids.');await form.apply.click();await module.entered;
  // Actual barrier logic; only its native dialog is substituted with Keep open.
  barrier=createQuitDraftBarrier({send:id=>{void entry.fixture.emit({type:'draft.flush',quitId:id});},confirmDiscard:async reason=>{prompts.push(reason);return false;}});
  entry.onFlush(command=>accepted.push({id:command.quitId,accepted:barrier.acknowledge(command.quitId,command.error),...(command.error?{error:command.error}:{})}));
  const first=barrier.request();decisions.push(first);expect(barrier.request()).toBe(first);await expect(form.form.getByText(frozenText,{exact:true})).toBeVisible();const cancelled=await first;expect(cancelled).toMatchObject({allowQuit:false,saved:false});expect(prompts).toHaveLength(1);expect(entry.acknowledgements(cancelled.id)).toEqual([]);
  await entry.fixture.emit({type:'draft.resume',quitId:'stale-id'});await expect(form.form.getByText(frozenText,{exact:true})).toBeVisible();await entry.fixture.emit({type:'draft.resume',quitId:cancelled.id});await expect(form.form.getByText(frozenText,{exact:true})).toHaveCount(0);
  const second=barrier.request();decisions.push(second);await expect(form.form.getByText(frozenText,{exact:true})).toBeVisible();module.release();const completed=await second;expect(completed).toMatchObject({allowQuit:true,saved:true});expect(completed.id).not.toBe(cancelled.id);
  await expect.poll(()=>accepted.filter(item=>item.id===cancelled.id).length).toBe(1);expect(accepted.find(item=>item.id===cancelled.id)).toMatchObject({accepted:false,error:expect.any(String)});expect(accepted.find(item=>item.id===completed.id)).toEqual({id:completed.id,accepted:true});
  await entry.fixture.emit({type:'draft.resume',quitId:completed.id});await shot(page,form.form.getByRole('button',{name:'Apply rule',exact:true}),'08-timeout-resumed');await record(entry,'06-timeout-repeated-ids',{accepted,prompts,cancelled,completed});
 }finally{module.release();await Promise.allSettled(decisions);await entry.close();}
});
