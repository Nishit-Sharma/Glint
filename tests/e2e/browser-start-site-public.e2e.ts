import {test,expect} from '@playwright/test';
import {BrowserFixture} from '../support/browser-fixture';
import {settleCapture} from '../support/settled-capture';

let fixture:BrowserFixture;
test.afterEach(async()=>{await fixture?.close();});
test.use({viewport:{width:1080,height:800},reducedMotion:'reduce'});
const selectedUrl='https://owned-start.invalid/PRIVATE_PATH?token=PRIVATE_QUERY#PRIVATE_FRAGMENT';
const origin=new URL(selectedUrl).origin;

async function seed(requestId:string,prompt:string,mode:'launch'|'observe'|'denied'|'cancel'){
 const taskId=fixture.taskA.id;
 const result=await fixture.core.runRequest({taskId,requestId,kind:'browser',prompt,sourceIds:[]},async()=>{
  if(mode==='denied')throw Error('The browser task was not authorized. Nothing was sent.');
  await fixture.core.recordBrowserStartingSite(taskId,requestId,origin);
  if(mode==='cancel'){await fixture.core.cancelRequest(taskId,requestId);throw Error('Stopped before opening the browser.');}
  throw Error(mode==='launch'?'Companion could not open its browser. Your task is kept.':'This page could not be read safely. Whether it loaded or changed the website is unknown.');
 });
 expect(result.status).toBe(mode==='cancel'?'cancelled':'failed');await fixture.changed(taskId);
}
async function card(prompt:string){
 const turn=fixture.page.locator('.workspace .conversation-turn').filter({hasText:prompt});await expect(turn).toHaveCount(1);return turn;
}
async function checkReceipt(prompt:string){
 const turn=await card(prompt);await turn.getByText('Starting website',{exact:true}).click();await expect(turn).toContainText(origin);await expect(turn).toContainText('does not establish whether the page loaded or the website changed');await expect(turn).toContainText('Nothing is retried automatically.');for(const marker of ['PRIVATE_PATH','PRIVATE_QUERY','PRIVATE_FRAGMENT'])await expect(turn).not.toContainText(marker);await expect(turn.getByRole('button',{name:/retry|inspect|open.*page/i})).toHaveCount(0);return turn;
}
async function frame(turn:ReturnType<BrowserFixture['page']['locator']>,name:string){
 await turn.scrollIntoViewIfNeeded();await settleCapture(fixture.page);const detail=turn.locator('details.browser-activity');await detail.scrollIntoViewIfNeeded();await expect(detail).toBeVisible();await expect(detail).toBeInViewport({ratio:1});expect(await detail.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);const path=test.info().outputPath(name+'.png');await fixture.page.screenshot({path,fullPage:false});await test.info().attach(name,{path,contentType:'image/png'});
}

test('approved launch and observation failures show only the historical origin; denied consent shows no receipt',async({page})=>{
 fixture=await BrowserFixture.open(page);
 await seed('launch','Synthetic launch failure','launch');await seed('observe','Synthetic observation failure','observe');await seed('denied','Synthetic denied consent','denied');
 const launch=await checkReceipt('Synthetic launch failure');await frame(launch,'launch-wide');
 const observation=await checkReceipt('Synthetic observation failure');await frame(observation,'observation-wide');
 const denied=await card('Synthetic denied consent');await expect(denied.getByText('Starting website',{exact:true})).toHaveCount(0);
 const saved=await fixture.core.getTask(fixture.taskA.id);expect(saved.requests.find(r=>r.id==='denied')?.browserStart).toBeUndefined();expect(saved.session?.runs??[]).toEqual([]);for(const marker of ['PRIVATE_PATH','PRIVATE_QUERY','PRIVATE_FRAGMENT'])expect(JSON.stringify(saved)).not.toContain(marker);expect(fixture.commands.filter(c=>c.type==='browser.run'||c.type==='model.run')).toEqual([]);expect(fixture.externalRequests).toEqual([]);
});

test('cancelled starting website survives disposable store reopen with no retry at narrow width',async({page})=>{
 fixture=await BrowserFixture.open(page);await seed('cancel','Synthetic cancellation','cancel');await fixture.restartCore();await page.reload();await page.setViewportSize({width:390,height:800});
 const turn=await checkReceipt('Synthetic cancellation');await frame(turn,'cancel-reopened-narrow');
 const saved=await fixture.core.getTask(fixture.taskA.id);expect(saved.requests.find(r=>r.id==='cancel')?.browserStart?.origin).toBe(origin);expect(saved.session?.runs??[]).toEqual([]);for(const marker of ['PRIVATE_PATH','PRIVATE_QUERY','PRIVATE_FRAGMENT'])expect(JSON.stringify(saved)).not.toContain(marker);expect(fixture.commands.filter(c=>c.type==='browser.run'||c.type==='model.run')).toEqual([]);expect(fixture.externalRequests).toEqual([]);
});
