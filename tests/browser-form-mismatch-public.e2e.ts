import {test,expect} from '@playwright/test';
import {BrowserFixture} from './browser-fixture';
import {emptyTaskSession} from '../src/core/task-session';
import {settleCapture} from './settled-capture';

let fixture:BrowserFixture;
test.afterEach(async()=>{await fixture?.close();});
test.use({viewport:{width:1080,height:760},reducedMotion:'reduce'});

test('explains an unoffered form submission and keeps a new request under user control',async({page})=>{
 fixture=await BrowserFixture.open(page,'companion');const taskId=fixture.taskA.id,runId='form-mismatch';
 await fixture.core.runRequest({taskId,requestId:runId,kind:'browser',prompt:'Save the Mesa draft.',sourceIds:[]},async()=>{throw Error('The browser reached its eight-step limit. Review progress before continuing.');});
 const session=(await fixture.core.getTask(taskId)).session??emptyTaskSession();
 const observation={id:'form',taskId,browserId:'owned-browser',documentId:'owned-document',url:'https://owned.example/draft',title:'Owned form',text:'Draft form',digest:'before-digest',targets:[]};
 const operation={id:'submission',intent:{kind:'click' as const,snapshotId:'form',targetId:'save'},reason:'Save the draft',status:'retired' as const,error:'The intended form values did not match the current page. No submission was offered or executed.'};
 await fixture.core.replaceSession(taskId,session.revision,{...session,runs:[...session.runs,{id:runId,endpointKey:'fixture',origin:'https://owned.example',browserId:'owned-browser',initialObservation:observation,operations:[operation]}]});await fixture.changed(taskId);
 const compact=page.locator('.compact-companion'),message='The intended form values could not be matched to the current page, so this submission was not offered or run. Review the page and your request before continuing. Earlier steps may have run.';
 await expect(compact.getByRole('status').filter({hasText:'Not run'})).toBeVisible();await expect(compact).toContainText(message);
 await settleCapture(page);const compactPath=test.info().outputPath('compact-mismatch.png');await page.screenshot({path:compactPath});await test.info().attach('compact-mismatch',{path:compactPath,contentType:'image/png'});
 await compact.getByRole('button',{name:'View request in conversation'}).click();
 const turn=page.locator('.workspace .conversation-turn').filter({hasText:'Save the Mesa draft.'});await expect(turn).toContainText(message);
 await page.reload();await expect(compact).toContainText(message);await compact.getByRole('button',{name:'View request in conversation'}).click();await expect(turn).toContainText(message);
 const composer=page.getByLabel('Ask about this task');await composer.fill('Check the draft values before saving.');await expect(composer).toHaveValue('Check the draft values before saving.');
 await turn.scrollIntoViewIfNeeded();await settleCapture(page);const workspacePath=test.info().outputPath('workspace-mismatch.png');await page.screenshot({path:workspacePath});await test.info().attach('workspace-mismatch',{path:workspacePath,contentType:'image/png'});
 expect(fixture.commands.filter(command=>command.type==='browser.run'||command.type==='model.run')).toEqual([]);expect(fixture.externalRequests).toEqual([]);
});
