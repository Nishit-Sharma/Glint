import {test,expect} from '@playwright/test';
import {BrowserFixture} from '../support/browser-fixture';
import {emptyTaskSession,type TaskSession} from '../../src/core/task-session';

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

for(const outcome of ['completed','not-completed'] as const)test('a fresh reviewed receipt replaces obsolete uncertainty in its conversation turn: '+outcome,async({page})=>{
 fixture=await BrowserFixture.open(page);const requestId=await uncertainTurn();
 const turn=page.locator('.workspace .conversation-turn').filter({hasText:'Save Mesa once and check the receipt.'});
 await expect(turn.getByRole('button',{name:'Inspect outcome',exact:true})).toBeVisible();
 fixture.browserInspection=async command=>{expect(command).toMatchObject({runId:requestId,operationId:'save-mesa',url:'https://owned.example/receipts'});return review(requestId,outcome);};
 await turn.getByLabel('Page with the outcome').fill('https://owned.example/receipts');await turn.getByRole('button',{name:'Inspect outcome',exact:true}).click();
 await expect(turn.locator('.conversation-status')).toHaveText(outcome==='completed'?'Reviewed as completed':'Reviewed as not completed');
 await expect(turn).toContainText('You reviewed a fresh page');
 await expect(turn.getByRole('button',{name:'Inspect outcome',exact:true})).toHaveCount(0);
 await expect(turn.locator('.conversation-answer')).not.toContainText('Inspect its outcome before trying another action.');
 await expect(turn).toContainText('https://owned.example/receipts');
 await fixture.restartCore();await page.reload();await expect(turn.locator('.conversation-status')).toHaveText(outcome==='completed'?'Reviewed as completed':'Reviewed as not completed');
 await expect(page.locator('.workspace')).toHaveAttribute('data-surface-reveal',/^(settled|cancelled)$/);await expect(turn.locator('.conversation-status')).toBeVisible();await page.screenshot({path:`evidence/browser-outcome-ui/full-reviewed-${outcome}.png`});
 expect(fixture.externalRequests).toEqual([]);
});

test('reviewing one action leaves another unknown action available for inspection',async({page})=>{
 fixture=await BrowserFixture.open(page);const taskId=fixture.taskA.id,requestId=await uncertainTurn(),session=(await fixture.core.getTask(taskId)).session!,run=session.runs[0];
 await fixture.core.replaceSession(taskId,session.revision,{...session,runs:[{...run,operations:[...run.operations,{...run.operations[0],id:'second-effect',reason:'Check a separate unknown action'}]}]});await fixture.changed(taskId);
 fixture.browserInspection=async()=>review(requestId);
 const turn=page.locator('.workspace .conversation-turn').last();await expect(turn.getByRole('button',{name:'Inspect outcome',exact:true})).toHaveCount(2);
 await turn.getByRole('button',{name:'Inspect outcome',exact:true}).first().click();
 await expect(turn.locator('.conversation-status')).toHaveText('Outcome needs review');await expect(turn).toContainText('Some actions have been reviewed.');
 await expect(turn.getByRole('button',{name:'Inspect outcome',exact:true})).toHaveCount(1);
 await expect(turn.getByRole('button',{name:'Inspect outcome',exact:true})).toBeVisible();
 expect(fixture.commands.filter(command=>command.type==='browser.inspect')).toHaveLength(1);expect(fixture.commands.some(command=>command.type==='browser.run')).toBe(false);
});

test('compact response and citations belong to the original request rather than newer saved files',async({page})=>{
 fixture=await BrowserFixture.open(page,'companion');const taskId=fixture.taskA.id,source=fixture.taskA.sources[0];
 const request=await fixture.core.runRequest({taskId,requestId:'associated-answer',kind:'explain',prompt:'Read the Alpha brief.',sourceIds:[source.id]},async()=>({title:'Associated answer',content:'The original request answer.'}));
 await fixture.core.saveArtifact(taskId,{artifactId:request.artifactId,expectedRevision:1,title:'Associated answer edited',content:'A later manual edit.'});
 const withOtherSource=await fixture.core.putSource(taskId,{kind:'text',role:'fact',label:'Unrelated reference',content:'Another local reference.'}),other=withOtherSource.sources.at(-1)!;
 await fixture.core.saveArtifact(taskId,{title:'Unrelated saved file',content:'An unrelated newer file.',sourceRefs:[{sourceId:other.id,version:1,digest:other.versions[0].digest}]});await fixture.changed(taskId);
 const compact=page.locator('.compact-companion');await expect(compact).toContainText('The original request answer.');
 await expect(compact).not.toContainText('A later manual edit.');await expect(compact).not.toContainText('An unrelated newer file.');
 await expect(compact.getByLabel('What this answer used').getByRole('button',{name:'Alpha brief',exact:true})).toBeVisible();
 await expect(compact.getByLabel('What this answer used')).not.toContainText('Unrelated reference');
});

test('a stale pending response cannot cover a newer request outcome in compact',async({page})=>{
 fixture=await BrowserFixture.open(page,'companion');const taskId=fixture.taskA.id;
 await page.locator('.compact-companion').getByRole('textbox',{name:'Ask companion',exact:true}).fill('Start the older request.');await page.locator('.compact-companion').getByRole('button',{name:'Ask',exact:true}).click();
 await expect.poll(()=>fixture.pending.size).toBe(1);await fixture.stream('Older response still in progress.');
 await fixture.core.runRequest({taskId,requestId:'newer-denied',kind:'browser',prompt:'The newer request.',sourceIds:[]},async()=>{throw Error('The browser task was not authorized. Nothing was sent.');});await fixture.changed(taskId);
 const compact=page.locator('.compact-companion');await expect(compact.getByRole('status').filter({hasText:'Not authorized'})).toBeVisible();
 await expect(compact).not.toContainText('Older response still in progress.');fixture.complete('The older response finally arrived.');
 await expect.poll(()=>fixture.pending.size).toBe(0);await expect(compact.getByRole('status').filter({hasText:'Not authorized'})).toBeVisible();await expect(compact).not.toContainText('The older response finally arrived.');
});

test('narrow compact reviewed outcome keeps recovery and composer reachable without overflow',async({page})=>{
 await page.setViewportSize({width:360,height:440});fixture=await BrowserFixture.open(page,'companion');const requestId=await uncertainTurn();await review(requestId);await fixture.changed(fixture.taskA.id);
 const compact=page.locator('.compact-companion');await expect(compact.getByRole('status').filter({hasText:'Reviewed as completed'})).toBeVisible();
 const recovery=compact.getByRole('button',{name:'View in conversation',exact:true});await recovery.scrollIntoViewIfNeeded();await expect(recovery).toBeVisible();
 const bounds=await recovery.boundingBox(),composer=await compact.locator('.compact-compose').boundingBox();expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(composer!.y);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await expect(compact.getByRole('textbox',{name:'Ask companion',exact:true})).toBeVisible();
 await expect(page.locator('.t-gen,.t-tig')).toHaveCount(0);await expect(compact).toHaveAttribute('data-surface-reveal',/^(settled|cancelled)$/);await page.screenshot({path:'evidence/browser-outcome-ui/compact-reviewed-360.png'});
});

test('compact shows the later uncertain and reviewed turn instead of an older successful answer',async({page})=>{
 fixture=await BrowserFixture.open(page,'companion');const taskId=fixture.taskA.id;
 await fixture.core.runRequest({taskId,requestId:'older-comparison',kind:'browser',prompt:'Compare Mesa and Pine.',sourceIds:[]},async()=>({title:'Earlier comparison',content:'Mesa is $40. Pine is $55. No draft was submitted or saved.'}));await fixture.changed(taskId);
 const compact=page.locator('.compact-companion');await expect(compact).toContainText('No draft was submitted or saved.');
 const requestId=await uncertainTurn();
 await expect(compact.getByRole('status').filter({hasText:'Outcome needs review'})).toBeVisible();
 await expect(compact).not.toContainText('No draft was submitted or saved.');
 await expect(compact.getByRole('button',{name:'Review browser outcome',exact:true})).toBeVisible();
 await review(requestId);await fixture.changed(taskId);
 await expect(compact.getByRole('status').filter({hasText:'Reviewed as completed'})).toBeVisible();
 await expect(compact).toContainText('You reviewed a fresh page');
 await fixture.restartCore();await page.reload();await expect(compact.getByRole('status').filter({hasText:'Reviewed as completed'})).toBeVisible();
 await compact.getByRole('button',{name:'View in conversation',exact:true}).click();
 await expect(page.locator('.workspace').getByLabel('Task conversation')).toContainText('No draft was submitted or saved.');
 await expect(page.locator('.workspace .conversation-turn').last().locator('.conversation-status')).toHaveText('Reviewed as completed');
 expect(fixture.externalRequests).toEqual([]);
});

test('compact exposes a later denied action and keeps the earlier answer in history',async({page})=>{
 fixture=await BrowserFixture.open(page,'companion');const taskId=fixture.taskA.id;
 await fixture.core.runRequest({taskId,requestId:'comparison',kind:'browser',prompt:'Compare filters.',sourceIds:[]},async()=>({title:'Comparison',content:'Older comparison only. No draft was saved.'}));
 const requestId=await uncertainTurn(),session=(await fixture.core.getTask(taskId)).session!;
 await fixture.core.replaceSession(taskId,session.revision,{...session,runs:session.runs.map(run=>run.id!==requestId?run:{...run,operations:run.operations.map(operation=>({...operation,status:'retired' as const,error:'The action was not authorized.'}))})});await fixture.changed(taskId);
 const compact=page.locator('.compact-companion');await expect(compact.getByRole('status').filter({hasText:'Not run'})).toBeVisible();
 await expect(compact).toContainText('The last browser action was not run.');
 await expect(compact).not.toContainText('Older comparison only.');
 await compact.getByRole('button',{name:'View in conversation',exact:true}).click();
 await expect(page.locator('.workspace').getByLabel('Task conversation')).toContainText('Older comparison only.');
});

test('a cancelled later request does not hide the earlier reviewed website effect',async({page})=>{
 fixture=await BrowserFixture.open(page,'companion');const taskId=fixture.taskA.id,requestId=await uncertainTurn();
 await fixture.core.runRequest({taskId,requestId:'later-cancel',kind:'browser',prompt:'A later request I did not authorize.',sourceIds:[]},async()=>{throw Error('The browser task was not authorized. Nothing was sent.');});
 await review(requestId);await fixture.changed(taskId);
 const compact=page.locator('.compact-companion');await expect(compact.getByRole('status').filter({hasText:'Not authorized'})).toBeVisible();
 await expect(compact.getByRole('status').filter({hasText:'Earlier browser action: Reviewed as completed'})).toBeVisible();
 await expect(compact).toContainText('The earlier website outcome was reviewed by you.');
 await fixture.restartCore();await page.reload();await expect(compact.getByRole('status').filter({hasText:'Earlier browser action: Reviewed as completed'})).toBeVisible();
 expect(fixture.commands.some(command=>command.type==='browser.run')).toBe(false);
});
