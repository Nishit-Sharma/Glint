import {test,expect} from '@playwright/test';
import {BrowserFixture} from '../support/browser-fixture';
import {emptyTaskSession} from '../../src/core/task-session';
import {settleCapture} from '../support/settled-capture';

let fixture:BrowserFixture;
let releaseLate=()=>{};
const pending=new Map<string,(error:Error)=>void>();
test.afterEach(async()=>{releaseLate();for(const reject of pending.values())reject(Error('Fixture closed.'));pending.clear();await fixture?.close();});
test.use({viewport:{width:1080,height:760},reducedMotion:'reduce'});

test('stop an outcome check, retain its address, and safely start another check',async({page})=>{
 fixture=await BrowserFixture.open(page);const taskId=fixture.taskA.id,runId='owned-uncertain';
 await fixture.core.runRequest({taskId,requestId:runId,kind:'browser',prompt:'Save once and check the result.',sourceIds:[]},async()=>{throw Error('The website action has an uncertain outcome.');});
 const session=(await fixture.core.getTask(taskId)).session??emptyTaskSession();
 const observation={id:'before',taskId,browserId:'owned-browser',documentId:'owned-document',url:'https://owned.example/form',title:'Owned form',text:'Owned form',digest:'before-digest',targets:[]};
 const operation={id:'owned-action',intent:{kind:'click' as const,snapshotId:'before',targetId:'save'},reason:'Save once',status:'uncertain' as const};
 await fixture.core.replaceSession(taskId,session.revision,{...session,runs:[...session.runs,{id:runId,endpointKey:'fixture',origin:'https://owned.example',browserId:'owned-browser',initialObservation:observation,operations:[operation]}]});await fixture.changed(taskId);
 const turn=page.locator('.workspace .conversation-turn').filter({hasText:'Save once and check the result.'}),address=turn.getByLabel('Page with the outcome',{exact:true}),inspect=turn.getByRole('button',{name:'Inspect outcome',exact:true});
 const late=new Promise<void>(resolve=>{releaseLate=resolve;});let count=0;
 fixture.browserInspection=async command=>{count++;if(!command.attemptId)throw Error('Missing inspection identity');return new Promise((_resolve,reject)=>pending.set(command.attemptId!,reject));};
 fixture.browserInspectionCancel=async command=>{const reject=pending.get(command.attemptId);if(!reject)return {kind:'not-active'};pending.delete(command.attemptId);reject(Error('Browser inspection stopped.'));if(count===1)await late;return {kind:'stopped'};};
 const chosen='https://owned.example/orders/receipt';await address.fill(chosen);await inspect.click();
 const stop=turn.getByRole('button',{name:'Stop checking',exact:true});await expect(stop).toBeVisible();await expect(inspect).toBeDisabled();
 const frame=async(name:string)=>{const form=address.locator('xpath=ancestor::form');await form.scrollIntoViewIfNeeded();await settleCapture(page);await expect(form).toBeVisible();await expect(form).toBeInViewport({ratio:1});const path=test.info().outputPath(name+'.png');await page.screenshot({path,fullPage:false});await test.info().attach(name,{path,contentType:'image/png'});};
 await frame('checking');await stop.click();await expect(inspect).toBeEnabled();await expect(address).toHaveValue(chosen);await expect(turn).toContainText('Stopped checking. The earlier action still needs review.');await frame('stopped');
 await inspect.click();await expect(stop).toBeVisible();await expect(stop).toBeEnabled();releaseLate();await expect(stop).toBeEnabled();
 const inspectionCommands=fixture.commands.filter(command=>command.type==='browser.inspect');expect(inspectionCommands).toHaveLength(2);expect(inspectionCommands[0].attemptId).not.toBe(inspectionCommands[1].attemptId);
 await stop.click();await expect(inspect).toBeEnabled();await expect(address).toHaveValue(chosen);
 expect((await fixture.core.getTask(taskId)).session?.runs.find(run=>run.id===runId)?.operations[0].status).toBe('uncertain');
 expect(fixture.commands.filter(command=>command.type==='browser.run'||command.type==='model.run')).toEqual([]);expect(fixture.externalRequests).toEqual([]);
});
