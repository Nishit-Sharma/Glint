import {test,expect} from '@playwright/test';
import {BrowserFixture} from './browser-fixture';
import {emptyTaskSession,type TaskSession} from '../src/core/task-session';
import {settleCapture} from './settled-capture';

let fixture:BrowserFixture;
test.afterEach(async()=>{await fixture?.close();});
test.use({viewport:{width:1080,height:760},reducedMotion:'reduce'});

async function uncertainTurn(){
 const taskId=fixture.taskA.id,requestId='delayed-draft';
 await fixture.core.runRequest({taskId,requestId,kind:'browser',prompt:'Save Mesa once and check the receipt.',sourceIds:[]},async()=>{throw Error('This website action has an uncertain outcome. Inspect it before any new attempt.');});
 const session=(await fixture.core.getTask(taskId)).session??emptyTaskSession();
 const observation={id:'before-submit',taskId,browserId:'owned-browser',documentId:'owned-document',url:'https://owned.example/slow-draft',title:'Owned form',text:'Choice Mesa',digest:'before-digest',targets:[]};
 const operation={id:'save-mesa',intent:{kind:'click' as const,snapshotId:observation.id,targetId:'save'},reason:'Save the Mesa draft once',status:'uncertain' as const,error:'The request stopped while the website was responding.'};
 await fixture.core.replaceSession(taskId,session.revision,{...session,runs:[...session.runs,{id:requestId,endpointKey:'fixture',origin:'https://owned.example',browserId:observation.browserId,initialObservation:observation,operations:[operation]}]});
 await fixture.changed(taskId);return requestId;
}

async function review(requestId:string,outcome:'completed'|'not-completed'='completed',operationId='save-mesa'){
 const taskId=fixture.taskA.id,session=(await fixture.core.getTask(taskId)).session!;
 const runs:TaskSession['runs']=session.runs.map(run=>run.id!==requestId?run:{...run,operations:run.operations.map(operation=>operation.id!==operationId?operation:({...operation,status:outcome==='completed'?'observed' as const:'failed' as const,reconciliation:{id:'fresh-review',outcome,basis:'user-reviewed-observation' as const,note:'User reviewed the fresh receipt page.',observation:{...run.initialObservation,id:'fresh-receipt',url:'https://owned.example/receipts',text:'Total saved drafts: 1. Receipt review-1: Choice Mesa.',digest:'fresh-receipt-digest'}}}))});
 await fixture.core.replaceSession(taskId,session.revision,{...session,runs});return fixture.core.getTask(taskId);
}

test('inspection starts from the saved page and preserves a chosen outcome address through failure and an uncertain review',async({page})=>{
 fixture=await BrowserFixture.open(page);const requestId=await uncertainTurn(),taskId=fixture.taskA.id;
 const turn=page.locator('.workspace .conversation-turn').filter({hasText:'Save Mesa once and check the receipt.'});
 const address=turn.getByLabel('Page with the outcome',{exact:true}),inspect=turn.getByRole('button',{name:'Inspect outcome',exact:true});
 await expect(address).toHaveValue('https://owned.example/slow-draft');
 await expect(turn).toContainText('Choose a page that shows the outcome. A saved page may not show the result.');
 const frame=async(name:string)=>{const form=address.locator('xpath=ancestor::form');await form.scrollIntoViewIfNeeded();await settleCapture(page);await expect(form).toBeVisible();await expect(form).toBeInViewport({ratio:1});const path=test.info().outputPath(name+'.png');await page.screenshot({path,fullPage:false});await test.info().attach(name,{path,contentType:'image/png'});};
 await frame('saved-page-suggestion');
 const chosen='https://owned.example/receipts/mesa';await address.fill(chosen);
 let calls=0,release!:()=>void;const hold=new Promise<void>(resolve=>{release=resolve;});
 fixture.browserInspection=async command=>{
  calls++;expect(command).toMatchObject({runId:requestId,operationId:'save-mesa',url:chosen});
  if(calls===1)throw Error('The selected page is unavailable.');
  if(calls===2){await hold;return fixture.core.getTask(taskId);}
  return review(requestId);
 };
 await inspect.click();await expect(turn.getByRole('alert')).toBeVisible();await expect(address).toHaveValue(chosen);await frame('inspection-failed');
 await inspect.click();await expect(inspect).toBeDisabled();expect(calls).toBe(2);release();await expect(inspect).toBeEnabled();
 await expect(address).toHaveValue(chosen);await expect(turn.locator('.conversation-status')).toHaveText('Outcome needs review');
 await inspect.click();await expect(turn.locator('.conversation-status')).toHaveText('Reviewed as completed');
 expect(calls).toBe(3);expect(fixture.commands.filter(command=>command.type==='browser.run'||command.type==='model.run')).toEqual([]);expect(fixture.externalRequests).toEqual([]);
});
