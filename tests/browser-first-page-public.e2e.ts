import {test,expect} from '@playwright/test';
import {BrowserFixture} from './browser-fixture';
import {revealPublicViewport} from './picking-public-frame';

let fixture:BrowserFixture;
test.afterEach(async()=>{await fixture?.close();});
test.use({viewport:{width:1080,height:800},reducedMotion:'reduce'});
async function seed(taskId:string,requestId:string,prompt:string,text:string,uncertain=false){
 const origin='https://owned.example',browserId=requestId+'-browser',observation={id:requestId+'-observation',taskId,browserId,documentId:'owned-document',url:origin+'/selected-page?view=summary#section',title:'Owned page',text,digest:requestId+'-digest',targets:[]};
 await fixture.core.runRequest({taskId,requestId,kind:'browser',prompt,sourceIds:[]},async ctx=>{await fixture.core.beginBrowserRun(taskId,{id:requestId,endpointKey:'fixture',origin,browserId,initialObservation:observation},ctx.task.session?.contextRevision??0);if(uncertain)throw Error('The website action has an uncertain outcome.');return {title:'Owned result',content:'A response based on the saved page.',mimeType:'text/plain'};});
 if(uncertain){const session=(await fixture.core.getTask(taskId)).session!;await fixture.core.replaceSession(taskId,session.revision,{...session,runs:session.runs.map(run=>run.id!==requestId?run:{...run,operations:[{id:'action',intent:{kind:'click',snapshotId:observation.id,targetId:'save'},reason:'Save once',status:'uncertain'}]})});}
 await fixture.changed(taskId);
}
async function capture(page:import('@playwright/test').Page,locator:import('@playwright/test').Locator,name:string){await revealPublicViewport(page,locator,name);const path=test.info().outputPath(name+'.png');await page.screenshot({path,fullPage:false});await test.info().attach(name,{path,contentType:'image/png'});}
function assertNoDispatch(){expect(fixture.commands.filter(c=>['browser.run','browser.inspect','model.run'].includes(c.type))).toEqual([]);expect(fixture.externalRequests).toEqual([]);}

test('saved page text remains complete and keyboard-scrollable after disposable store reopen',async({page})=>{
 fixture=await BrowserFixture.open(page);const content='First paragraph\n'+('Long saved line with ordinary text.\n'.repeat(500))+'END_OF_SAVED_TEXT';await seed(fixture.taskA.id,'read-only','Read the selected page.',content);await fixture.restartCore();await page.reload();
 const turn=page.locator('.workspace .conversation-turn').filter({hasText:'Read the selected page.'}),details=turn.locator('details.browser-first-page'),summary=details.locator('summary');await expect(summary).toHaveText('First page read');await expect(details).not.toHaveAttribute('open','');await summary.focus();await page.keyboard.press('Enter');await expect(details).toHaveAttribute('open','');await expect(details).toContainText('https://owned.example/selected-page?view=summary#section');await expect(details).toContainText('may be out of date');await expect(details).toContainText('does not establish what happened after this page was read');
 const text=details.getByRole('region',{name:'Saved page text'});await expect(text).toHaveText(content);await capture(page,details,'saved-first-page-wide');expect(await text.evaluate(node=>node.scrollHeight>node.clientHeight)).toBe(true);await text.focus();await page.keyboard.press('End');await expect.poll(()=>text.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);await expect.poll(()=>text.evaluate(node=>node.scrollHeight-node.clientHeight-node.scrollTop)).toBeLessThanOrEqual(1);await expect(text).toContainText('END_OF_SAVED_TEXT');await page.setViewportSize({width:390,height:800});await capture(page,details,'saved-first-page-narrow');expect(await text.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);assertNoDispatch();
});

test('empty saved page coexists with uncertain outcome controls and stays scoped to its task',async({page})=>{
 fixture=await BrowserFixture.open(page);await seed(fixture.taskA.id,'uncertain','Check an earlier action.','',true);await seed(fixture.taskB.id,'other','Other task page.','OTHER_TASK_PRIVATE');
 const turn=page.locator('.workspace .conversation-turn').filter({hasText:'Check an earlier action.'}),details=turn.locator('details.browser-first-page');await details.locator('summary').click();await expect(details).toContainText('No page text was saved.');await expect(turn).toContainText('An earlier action needs review');await expect(turn.getByRole('button',{name:'Inspect outcome',exact:true})).toBeVisible();await expect(page.locator('.workspace')).not.toContainText('OTHER_TASK_PRIVATE');await capture(page,details,'empty-page-uncertain');assertNoDispatch();
});
