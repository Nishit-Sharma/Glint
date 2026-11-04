import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {BrowserFixture} from '../support/browser-fixture';
import {taskTool} from '../support/ui-tools';

test.use({viewport:{width:430,height:760},reducedMotion:'reduce'});
let fixture:BrowserFixture;
test.beforeEach(async({page})=>{fixture=await BrowserFixture.open(page);await expect(page.getByRole('heading',{name:'Task Alpha',exact:true})).toBeVisible();});
test.afterEach(async()=>{await fixture.close();});

test('whitespace checkpoint validation stays local and retains the unsaved note',async({page})=>{
 await taskTool(page,'History');await expect(page.getByLabel('Note',{exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Add note',exact:true}).click();const input=page.getByLabel('Note',{exact:true});await input.fill(' \n\t ');await page.getByRole('button',{name:'Save note',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Write a note before saving.');await expect(input).toHaveValue(' \n\t ');expect(fixture.commands.filter(command=>command.type==='tasks.checkpoint')).toHaveLength(0);
 await page.getByRole('button',{name:'Back to task',exact:true}).click();const review=page.getByRole('dialog',{name:'Keep your unsaved edits?',exact:true});await expect(review).toBeVisible();await review.getByRole('button',{name:'Keep editing',exact:true}).click();await input.fill('Arrival details reviewed.');await page.getByRole('button',{name:'Save note',exact:true}).click();await expect(input).toHaveCount(0);await expect(page.getByRole('button',{name:'Add note',exact:true})).toBeFocused();await expect(page.getByRole('alert')).toHaveCount(0);expect((await fixture.core.getTask(fixture.taskA.id)).checkpoints[0].note).toBe('Arrival details reviewed.');
});

test('history interleaves records and opens the request exact revision after a later edit',async({page})=>{
 let current=await fixture.core.checkpoint(fixture.taskA.id,'Before the request.');await expect.poll(()=>Date.now()).toBeGreaterThan(Date.parse(current.checkpoints.at(-1)!.createdAt));
 await fixture.core.runRequest({taskId:fixture.taskA.id,requestId:'history-created-report',kind:'create',prompt:'Draft a visit report.'},async()=>({title:'Created report',content:'Created version one.',mimeType:'text/plain'}));current=await fixture.core.getTask(fixture.taskA.id);const request=current.requests[0],artifactId=request.artifactId!;await expect.poll(()=>Date.now()).toBeGreaterThan(Date.parse(request.finishedAt!));
 current=await fixture.core.checkpoint(fixture.taskA.id,'After the request.');await expect.poll(()=>Date.now()).toBeGreaterThan(Date.parse(current.checkpoints.at(-1)!.createdAt));await fixture.core.proposeExport(fixture.taskA.id,{artifactId,revision:1,path:join(fixture.directory,'history-export.txt')});await fixture.core.saveArtifact(fixture.taskA.id,{artifactId,expectedRevision:1,title:'Updated report',content:'Updated version two.'});await fixture.changed(fixture.taskA.id);
 await taskTool(page,'History');await expect(page.locator('.history-events>li')).toHaveCount(4);expect(await page.locator('.history-events>li').evaluateAll(elements=>elements.map(element=>element.getAttribute('data-history-kind')))).toEqual(['export','checkpoint','request','checkpoint']);
 await page.locator('.history-event-request').getByRole('button',{name:'Created report · Revision 1',exact:true}).click();await expect(page.getByRole('region',{name:'Saved revision',exact:true})).toContainText('Revision 1');await expect(page.getByRole('region',{name:'Saved revision',exact:true}).locator('.readable-text')).toContainText('Created version one.');await expect(page.getByRole('region',{name:'Saved revision',exact:true}).locator('.readable-text')).not.toContainText('Updated version two.');
});

test('cancelling a checkpoint keeps text until an explicit discard',async({page})=>{
 await taskTool(page,'History');await page.getByRole('button',{name:'Add note',exact:true}).click();const input=page.getByLabel('Note',{exact:true});await expect(input).toBeFocused();await input.fill('Keep this draft note.');await page.getByRole('button',{name:'Cancel',exact:true}).click();const confirmation=page.getByRole('group',{name:'Discard note',exact:true});await expect(confirmation).toBeVisible();await expect(input).toHaveValue('Keep this draft note.');await confirmation.getByRole('button',{name:'Keep note',exact:true}).click();await expect(confirmation).toHaveCount(0);await expect(input).toBeFocused();await expect(input).toHaveValue('Keep this draft note.');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await confirmation.getByRole('button',{name:'Discard note',exact:true}).click();await expect(input).toHaveCount(0);await expect(page.getByRole('button',{name:'Add note',exact:true})).toBeFocused();await page.getByRole('button',{name:'Back to task',exact:true}).click();await expect(page.getByRole('dialog',{name:'Keep your unsaved edits?',exact:true})).toHaveCount(0);expect((await fixture.core.getTask(fixture.taskA.id)).checkpoints).toHaveLength(0);
});
