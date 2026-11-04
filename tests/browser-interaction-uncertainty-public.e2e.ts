import {test,expect} from '@playwright/test';
import {BrowserFixture} from './browser-fixture';
import {BrowserCoordinator,type BrowserPlanner} from '../src/host/browser/coordinator';
import {BrowserReconciliation} from '../src/host/browser/reconciliation';
import {LocalBrowser} from '../src/host/browser/local-browser';
import {revealPublicViewport} from './picking-public-frame';
import {installLoopbackTestEngine} from './loopback-browser.fixture';
// Loopback-locked engine only: these specs never launch or select the person's installed browsers.
installLoopbackTestEngine();

let fixture:BrowserFixture;
const originalOpen=LocalBrowser.open;
test.afterEach(async()=>{LocalBrowser.open=originalOpen;await fixture?.close();});
test.use({viewport:{width:1080,height:800},reducedMotion:'reduce'});
const origin='https://owned.example';
function browser(taskId:string,effects:{count:number},lose:boolean){
 let version=0,closed=false,clicks=0;const fingerprint=()=>JSON.stringify({version});
 const handle={dispose:async()=>{},isVisible:async()=>true,click:async()=>{clicks++;effects.count++;version++;if(lose)throw Error('Controlled lost interaction result.');},evaluate:async(fn:Function)=>{const source=String(fn);if(source.includes('Choice lists in open shadow roots'))return {label:'Owned button'};if(source.includes('new FormData'))return undefined;if(source.includes('sensitive'))return {sensitive:false,info:{role:'button',label:'Owned button'},fingerprint:fingerprint()};return fingerprint();}};
 const page={on:()=>{},isClosed:()=>closed,evaluate:async()=>({text:'Owned effect count: '+effects.count,title:'Owned page',url:origin+'/page'}),locator:()=>({count:async()=>1,nth:()=>({isVisible:async()=>true,elementHandle:async()=>handle})})};
 const instance=Reflect.construct(LocalBrowser,[{close:async()=>{closed=true;}},{on:()=>{},close:async()=>{closed=true;}},page,taskId,origin]) as LocalBrowser;return {instance,get clicks(){return clicks;}};
}
async function capture(page:import('@playwright/test').Page,anchor:import('@playwright/test').Locator,name:string){await revealPublicViewport(page,anchor,name);const path=test.info().outputPath(name+'.png');await page.screenshot({path,fullPage:false});await test.info().attach(name,{path,contentType:'image/png'});}

test('lost interaction remains uncertain, blocks a second action, and accepts explicit review without replay',async({page})=>{
 fixture=await BrowserFixture.open(page);const taskId=fixture.taskA.id,effects={count:0};let approvals=0,openBrowser=browser(taskId,effects,true);LocalBrowser.open=(async()=>openBrowser.instance) as typeof LocalBrowser.open;
 const planner:BrowserPlanner={endpointKey:'owned',plan:async input=>({kind:'action',reason:'Use the owned button once',action:{kind:'click',targetId:input.observation.targets[0].id}})},run=(id:string)=>new BrowserCoordinator(fixture.core,planner).run({taskId,requestId:id,goal:'Use the owned button once.',origin,url:origin+'/page',transmissionApproved:true,approveAction:async()=>{approvals++;return {approved:true};}});
 expect((await run('lost')).status).toBe('failed');expect(openBrowser.clicks).toBe(1);expect(effects.count).toBe(1);await fixture.changed(taskId);
 const turn=page.locator('.workspace .conversation-turn').filter({hasText:'Use the owned button once.'}).first();await expect(turn).toContainText('Outcome needs review');await capture(page,turn.locator('details.browser-activity').filter({hasText:'An earlier action needs review'}).locator('summary'),'uncertain-wide');
 openBrowser=browser(taskId,effects,false);expect((await run('blocked')).error).toContain('uncertain outcome');expect(approvals).toBe(1);expect(openBrowser.clicks).toBe(0);expect(effects.count).toBe(1);await fixture.changed(taskId);
 const reconcile=new BrowserReconciliation(fixture.core);fixture.browserInspection=async command=>{openBrowser=browser(taskId,effects,false);const inspection=await reconcile.inspect(command);expect(inspection.observation.text).toBe('Owned effect count: 1');await reconcile.resolve(inspection.id,async()=>({outcome:'completed',note:'Controlled user review of the owned counter.'}));return fixture.core.getTask(taskId);};
 await turn.getByRole('button',{name:'Inspect outcome',exact:true}).click();await expect(turn.locator('.conversation-status')).toHaveText('Reviewed as completed');await page.setViewportSize({width:390,height:800});await capture(page,turn.locator('.conversation-status'),'reviewed-narrow');const task=await fixture.core.getTask(taskId);expect(task.session!.runs.find(run=>run.id==='lost')!.operations[0]).toMatchObject({status:'observed',reconciliation:{outcome:'completed',basis:'user-reviewed-observation'}});expect(effects.count).toBe(1);expect(approvals).toBe(1);expect(fixture.commands.filter(c=>c.type==='browser.inspect')).toHaveLength(1);expect(fixture.commands.filter(c=>c.type==='browser.run'||c.type==='model.run')).toEqual([]);expect(fixture.externalRequests).toEqual([]);
});
