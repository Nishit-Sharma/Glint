import {test,expect} from '@playwright/test';
import {BrowserFixture} from '../support/browser-fixture';

let fixture:BrowserFixture;
let releaseSave=()=>{};
test.afterEach(async()=>{releaseSave();releaseSave=()=>{};await fixture?.close();});
test.use({viewport:{width:1080,height:760},reducedMotion:'reduce'});
const alpha='  Keep this unsent plan — α 👋\nwith its exact spacing.  ';
const beta='A separate unsent question for Beta.';

test('offline drafts remain editable across tasks, modes and restart without submitting or opening setup',async({page})=>{
 fixture=await BrowserFixture.open(page);fixture.configured=false;await page.reload();
 const input=page.getByLabel('Ask about this task',{exact:true});
 await expect(input).toBeEnabled({timeout:3000});await input.fill(alpha);
 await expect(page.getByRole('button',{name:'Connect to ask',exact:true})).toBeDisabled();await input.press('Enter');
 await expect(input).toHaveValue(alpha);await expect(page.getByLabel('AI connection',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Request options',exact:true}).click();await page.getByLabel('Request type',{exact:true}).selectOption('create');
 await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();
 await expect(page.getByLabel('Ask companion',{exact:true})).toHaveValue(alpha);await page.getByLabel('Ask companion',{exact:true}).press('Enter');
 await expect(page.getByRole('button',{name:'Connect to ask',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Open task workspace',exact:true}).click();
 await page.getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'Task Beta',exact:true}).click();await input.fill(beta);
 await expect.poll(async()=>(await fixture.core.getTask(fixture.taskA.id)).session?.draft).toBe(alpha);
 await expect.poll(async()=>(await fixture.core.getTask(fixture.taskB.id)).session?.draft).toBe(beta);
 await fixture.restartCore();await page.reload();await expect(page.locator('.workspace h1')).toHaveText('Task Beta');await expect(input).toHaveValue(beta);
 await page.getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'Task Alpha',exact:true}).click();await expect(input).toHaveValue(alpha);
 await page.getByRole('button',{name:'Request options',exact:true}).click();await expect(page.getByLabel('Request type',{exact:true})).toHaveValue('create');
 expect(fixture.commands.filter(command=>['model.run','browser.run','connection.configure'].includes(command.type))).toEqual([]);
 await page.getByRole('button',{name:'Set up Meta',exact:true}).click();await expect(page.getByLabel('AI connection',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Connect',exact:true})).toBeEnabled();
 expect(fixture.commands.filter(command=>['model.run','browser.run','connection.configure'].includes(command.type))).toEqual([]);expect(fixture.externalRequests).toEqual([]);
});

test('per-task composer text and mode survive a fresh renderer without mixing drafts',async({page})=>{
 fixture=await BrowserFixture.open(page);await expect(page.locator('.workspace h1')).toHaveText('Task Alpha');
 await page.getByLabel('Ask about this task',{exact:true}).fill(alpha);
 await page.getByRole('button',{name:'Request options',exact:true}).click();await page.getByLabel('Request type',{exact:true}).selectOption('create');
 await page.getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'Task Beta',exact:true}).click();
 await page.getByLabel('Ask about this task',{exact:true}).fill(beta);
 await page.reload();await expect(page.locator('.workspace h1')).toHaveText('Task Beta');
 await expect(page.getByLabel('Ask about this task',{exact:true})).toHaveValue(beta);
 await page.getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'Task Alpha',exact:true}).click();
 await expect(page.getByLabel('Ask about this task',{exact:true})).toHaveValue(alpha);
 await page.getByRole('button',{name:'Request options',exact:true}).click();await expect(page.getByLabel('Request type',{exact:true})).toHaveValue('create');
 await page.getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'Task Beta',exact:true}).click();await expect(page.getByLabel('Ask about this task',{exact:true})).toHaveValue(beta);
 expect(fixture.commands.some(command=>command.type==='model.run'||command.type==='browser.run')).toBe(false);
});

for(const outcome of ['success','cancel','failure'] as const)test('a submitted task draft is cleared only on success and survives restart: '+outcome,async({page})=>{
 fixture=await BrowserFixture.open(page);await expect(page.locator('.workspace h1')).toHaveText('Task Alpha');const input=page.getByLabel('Ask about this task',{exact:true});
 await input.fill('A deliberate saved question.');await page.getByRole('button',{name:'Ask',exact:true}).click();await expect.poll(()=>fixture.pending.size).toBe(1);
 if(outcome==='success')fixture.complete('The observed answer.');else if(outcome==='cancel')await page.getByRole('button',{name:'Stop',exact:true}).click();else fixture.fail('The model request was not authorized. Nothing was sent.');
 await expect.poll(async()=>(await fixture.core.getTask(fixture.taskA.id)).requests.at(-1)?.status).toBe(outcome==='success'?'completed':outcome==='cancel'?'cancelled':'failed');
 await expect(input).toHaveValue(outcome==='success'?'':'A deliberate saved question.');
 await fixture.restartCore();await page.reload();await expect(input).toHaveValue(outcome==='success'?'':'A deliberate saved question.');
});

test('late completion consumes only its own submitted intent and keeps another task draft',async({page})=>{
 fixture=await BrowserFixture.open(page);await expect(page.locator('.workspace h1')).toHaveText('Task Alpha');
 await page.getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'Task Beta',exact:true}).click();await page.getByLabel('Ask about this task',{exact:true}).fill(beta);await page.getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'Task Alpha',exact:true}).click();
 await page.getByLabel('Ask about this task',{exact:true}).fill('The question sent from Alpha.');await page.getByRole('button',{name:'Ask',exact:true}).click();await expect.poll(()=>fixture.pending.size).toBe(1);
 await page.getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'Task Beta',exact:true}).click();
 fixture.complete('Alpha alone completed.');await expect.poll(async()=>(await fixture.core.getTask(fixture.taskA.id)).requests.at(-1)?.status).toBe('completed');await expect(page.getByLabel('Ask about this task',{exact:true})).toHaveValue(beta);
 await fixture.restartCore();await page.reload();await expect(page.locator('.workspace h1')).toHaveText('Task Beta');await expect(page.getByLabel('Ask about this task',{exact:true})).toHaveValue(beta);
 await page.getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'Task Alpha',exact:true}).click();await expect(page.getByLabel('Ask about this task',{exact:true})).toHaveValue('');
});

test('Quit acknowledgement waits for nonselected task drafts and only its nonce can resume editing',async({page})=>{
 fixture=await BrowserFixture.open(page);await expect(page.locator('.workspace h1')).toHaveText('Task Alpha');fixture.draftSaveBarrier=new Promise<void>(resolve=>releaseSave=resolve);
 await page.getByLabel('Ask about this task',{exact:true}).fill(alpha);await page.getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'Task Beta',exact:true}).click();await page.getByLabel('Ask about this task',{exact:true}).fill(beta);
 await fixture.emit({type:'draft.flush',quitId:'owned-quit'});await expect(page.getByLabel('Ask about this task',{exact:true})).toBeDisabled();expect(fixture.commands.some(command=>command.type==='draft.flushed')).toBe(false);
 releaseSave();await expect.poll(()=>fixture.commands.some(command=>command.type==='draft.flushed'&&command.quitId==='owned-quit'&&!command.error)).toBe(true);
 expect((await fixture.core.getTask(fixture.taskA.id)).session?.draft).toBe(alpha);expect((await fixture.core.getTask(fixture.taskB.id)).session?.draft).toBe(beta);
 await fixture.emit({type:'draft.resume',quitId:'old-quit'});await expect(page.getByLabel('Ask about this task',{exact:true})).toBeDisabled();await fixture.emit({type:'draft.resume',quitId:'owned-quit'});await expect(page.getByLabel('Ask about this task',{exact:true})).toBeEnabled();
});

test('failed Quit flush reports failure and retains the local draft for an explicit keep-open decision',async({page})=>{
 fixture=await BrowserFixture.open(page);await expect(page.locator('.workspace h1')).toHaveText('Task Alpha');fixture.draftSaveError='Synthetic disk failure';await page.getByLabel('Ask about this task',{exact:true}).fill(alpha);
 await fixture.emit({type:'draft.flush',quitId:'failed-quit'});await expect.poll(()=>fixture.commands.some(command=>command.type==='draft.flushed'&&command.quitId==='failed-quit'&&!!command.error)).toBe(true);
 await expect(page.getByLabel('Ask about this task',{exact:true})).toHaveValue(alpha);expect((await fixture.core.getTask(fixture.taskA.id)).session?.draft??'').not.toBe(alpha);
 await fixture.emit({type:'draft.resume',quitId:'failed-quit'});fixture.draftSaveError=undefined;await page.getByLabel('Ask about this task',{exact:true}).fill(alpha+' recovered');await expect.poll(async()=>(await fixture.core.getTask(fixture.taskA.id)).session?.draft).toBe(alpha+' recovered');
});
