import {test,expect} from '@playwright/test';
import {BrowserFixture} from './browser-fixture';
import {emptyTaskSession} from '../src/core/task-session';
import {BrowserReconciliation,untilInspectionStopped} from '../src/host/browser/reconciliation';
import {BrowserInspectionAttempts} from '../src/host/browser/inspection-attempts';
import {LocalBrowser} from '../src/host/browser/local-browser';
import {settleCapture} from './settled-capture';
import {installLoopbackTestEngine} from './loopback-browser.fixture';
// Loopback-locked engine only: these specs never launch or select the person's installed browsers.
installLoopbackTestEngine();

let fixture:BrowserFixture;
const open=LocalBrowser.open;
test.afterEach(async()=>{LocalBrowser.open=open;await fixture?.close();});
test.use({viewport:{width:1080,height:760},reducedMotion:'reduce'});

async function setup(page:import('@playwright/test').Page){
 fixture=await BrowserFixture.open(page);const taskId=fixture.taskA.id,runId='owned-uncertain';
 await fixture.core.runRequest({taskId,requestId:runId,kind:'browser',prompt:'Save once and check the result.',sourceIds:[]},async()=>{throw Error('The website action has an uncertain outcome.');});
 const session=(await fixture.core.getTask(taskId)).session??emptyTaskSession(),observation={id:'before',taskId,browserId:'old-browser',documentId:'old-document',url:'https://owned.example/form',title:'Owned form',text:'Owned form',digest:'before-digest',targets:[]};
 await fixture.core.replaceSession(taskId,session.revision,{...session,runs:[...session.runs,{id:runId,endpointKey:'fixture',origin:'https://owned.example',browserId:'old-browser',initialObservation:observation,operations:[{id:'action',intent:{kind:'click',snapshotId:'before',targetId:'save'},reason:'Save once',status:'uncertain'}]}]});await fixture.changed(taskId);
 const fresh={...observation,id:'fresh',browserId:'inspection-browser',documentId:'inspection-document',url:'https://owned.example/receipt',text:'Owned receipt',digest:'fresh-digest'};
 LocalBrowser.open=(async()=>({id:'inspection-browser',taskId,origin:'https://owned.example',observe:async()=>fresh,close:async()=>{}} as unknown as LocalBrowser)) as typeof LocalBrowser.open;
 const reconciliation=new BrowserReconciliation(fixture.core),turn=page.locator('.workspace .conversation-turn').filter({hasText:'Save once and check the result.'}),address=turn.getByLabel('Page with the outcome',{exact:true}),inspect=turn.getByRole('button',{name:'Inspect outcome',exact:true});
 async function change(reason:string){const current=(await fixture.core.getTask(taskId)).session!;await fixture.core.replaceSession(taskId,current.revision,{...current,runs:current.runs.map(run=>({...run,operations:run.operations.map(operation=>({...operation,reason}))}))});}
 return {taskId,runId,reconciliation,turn,address,inspect,change};
}
async function frame(page:import('@playwright/test').Page,locator:import('@playwright/test').Locator,name:string){await locator.scrollIntoViewIfNeeded();await settleCapture(page);await expect(locator).toBeVisible();await expect(locator).toBeInViewport({ratio:1});const path=test.info().outputPath(name+'.png');await page.screenshot({path,fullPage:false});await test.info().attach(name,{path,contentType:'image/png'});}
async function assertNoReplay(taskId:string,runId:string){const task=await fixture.core.getTask(taskId),op=task.session!.runs.find(run=>run.id===runId)!.operations[0];expect(op.status).toBe('uncertain');expect(op.reconciliation).toBeUndefined();expect(fixture.commands.filter(c=>c.type==='browser.run'||c.type==='model.run')).toEqual([]);expect(fixture.externalRequests).toEqual([]);}

test('changed action and commit conflict show actionable inspection guidance without replay',async({page})=>{
 const f=await setup(page);let calls=0;
 fixture.browserInspection=async command=>{calls++;const inspection=await f.reconciliation.inspect(command);
  if(calls===1)await f.change('Changed during review');
  const original=fixture.core.replaceSession.bind(fixture.core);if(calls===2)fixture.core.replaceSession=async(...args)=>{fixture.core.replaceSession=original;await f.change('Changed at commit');return original(...args);};
  try{await f.reconciliation.resolve(inspection.id,async()=>({outcome:'completed',note:'Controlled review'}));return await fixture.core.getTask(f.taskId);}finally{fixture.core.replaceSession=original;}
 };
 await f.inspect.click();await expect(f.turn.locator('details.browser-activity').getByRole('alert')).toHaveText('This action changed during review. Inspect its outcome again.');await frame(page,f.turn.locator('details.browser-activity').getByRole('alert'),'stale-action-wide');await assertNoReplay(f.taskId,f.runId);
 await f.inspect.click();await expect(f.turn.locator('details.browser-activity').getByRole('alert')).toHaveText('The task changed during review. Check the action’s current status and inspect again if needed.');await page.setViewportSize({width:390,height:760});await frame(page,f.turn.locator('details.browser-activity').getByRole('alert'),'commit-conflict-narrow');await assertNoReplay(f.taskId,f.runId);expect(calls).toBe(2);
});

test('stopping a pending outcome review leaves it uncertain and does not replay',async({page})=>{
 const f=await setup(page),attempts=new BrowserInspectionAttempts();let reviewStarted!:()=>void;const started=new Promise<void>(resolve=>{reviewStarted=resolve;}),never=new Promise<{outcome:'completed';note:string}>(()=>{});
 fixture.browserInspection=async command=>{if(!command.attemptId)throw Error('Missing attempt');const scope={taskId:command.taskId,runId:command.runId,operationId:command.operationId,attemptId:command.attemptId},attempt=attempts.begin(scope);try{const inspection=await f.reconciliation.inspect({...command,signal:attempt.signal});await f.reconciliation.resolve(inspection.id,async()=>{reviewStarted();return untilInspectionStopped(never,attempt.signal);},attempt);return await fixture.core.getTask(f.taskId);}finally{attempt.finish();}};
 fixture.browserInspectionCancel=async command=>attempts.stop(command);
 await f.inspect.click();await started;const stop=f.turn.getByRole('button',{name:'Stop checking',exact:true});await expect(stop).toBeVisible();await stop.click();await expect(f.turn.locator('details.browser-activity').getByRole('alert')).toHaveText('Stopped checking. The earlier action still needs review.');await frame(page,f.turn.locator('details.browser-activity').getByRole('alert'),'stopped-review-wide');await assertNoReplay(f.taskId,f.runId);expect(fixture.commands.filter(c=>c.type==='browser.inspect')).toHaveLength(1);
});
