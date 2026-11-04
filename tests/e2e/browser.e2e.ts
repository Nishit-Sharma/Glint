import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { BrowserFixture } from '../support/browser-fixture';
import {taskTool,sourceTool} from '../support/ui-tools';

test.use({ browserName: 'chromium', viewport: { width: 430, height: 760 }, reducedMotion: 'reduce' });
let fixture: BrowserFixture;
test.beforeEach(async ({ page }) => { fixture = await BrowserFixture.open(page); await expect(page.getByRole('heading', { name: 'Task Alpha', exact: true })).toBeVisible(); });
test.afterEach(async ({ page }, info) => {
  const name = info.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 100);
  await mkdir('evidence', { recursive: true });
  await page.screenshot({ path: `evidence/browser-${name}.png` }).catch(() => undefined);
  await writeFile(`evidence/browser-${name}.json`, JSON.stringify({ evidenceKind: 'browser', mode: 'explicit host/provider fixture with real temporary-file core', liveProvider: false, nativeCapture: false, title: info.title, status: info.status, timestamp: new Date().toISOString(), url: page.url(), viewport: page.viewportSize(), externalRequests: fixture?.externalRequests, commands: fixture?.commands }, null, 2));
  await fixture?.close();
});

async function selectTask(page: Page, title: string) {
  await page.getByRole('button', { name: 'Choose task' }).click();
  await page.getByRole('dialog',{name:'Tasks',exact:true}).getByRole('button',{name:new RegExp(`^${title} `)}).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}
async function openFile(page:Page,title:string,procedure=false){await taskTool(page,'Files');await page.getByRole('dialog',{name:'Files',exact:true}).getByRole('button',{name:new RegExp('^'+title+(procedure?' \\d+ steps$':' (?:Document|Image|Experiment|Procedure) ·'))}).click();}
async function startRequest(page: Page) {
  await page.getByLabel('Ask about this task').fill('Explain the explicitly supplied source.');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect.poll(() => fixture.pending.size).toBe(1);
}

test('streamed Alpha response cannot appear in Beta and cancellation retains its origin request', async ({ page }) => {
  await startRequest(page);
  const request = [...fixture.pending.values()][0].command;
  await fixture.stream('Alpha partial response');
  await expect(page.locator('.conversation .streaming-text')).toContainText('Alpha partial response');
  await selectTask(page, 'Task Beta');
  await fixture.stream('Alpha secret tail must stay in Alpha');
  await expect(page.locator('.conversation .streaming-text')).toHaveCount(0);
  // The task header now exposes the other task's active request through its Stop control.
  await expect(page.getByRole('button',{name:'Stop current request',exact:true})).toBeVisible();
  await page.getByRole('button', { name: 'Stop current request' }).click();
  await expect.poll(() => fixture.commands.filter(command => command.type === 'model.cancel').length).toBe(1);
  expect(fixture.commands.find(command => command.type === 'model.cancel')).toMatchObject({ taskId: fixture.taskA.id, requestId: request.requestId });
  await expect(page.getByRole('button',{name:'Stop current request',exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Task Beta', exact: true })).toBeVisible();
  expect((await fixture.core.getTask(fixture.taskB.id)).requests).toHaveLength(0);
  expect((await fixture.core.getTask(fixture.taskA.id)).requests[0].status).toBe('cancelled');
  await expect(page.getByText('Result saved to this task')).toHaveCount(0);
});

test('an incomplete provider response reports failure and never announces a saved result', async ({ page }) => {
  await startRequest(page);
  await fixture.stream('Partial fixture content that must not become an artifact');
  fixture.fail('Fixture transport ended before completion');
  await expect(page.getByRole('alert')).toContainText('The response was incomplete.');
  await expect(page.getByText('Result saved to this task')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ask', exact: true })).toBeEnabled();
  expect((await fixture.core.getTask(fixture.taskA.id)).artifacts).toHaveLength(1);
  expect((await fixture.core.getTask(fixture.taskA.id)).requests[0].status).toBe('failed');
});

test('malicious source markup remains text and causes no injected elements or external requests', async ({ page }) => {
  await taskTool(page,'Context');
  await page.getByRole('button',{name:'Add source',exact:true}).click();await page.getByRole('button',{name:'Paste text',exact:true}).click();
  const malicious = '<img id="injected-image" src="https://browser-fixture.invalid/exfil" onerror="window.__injected=true"><script>window.__injected=true</script>';
  await page.getByLabel('Source name (optional)',{exact:true}).fill('Untrusted fixture source');
  await page.getByLabel('Source text', { exact: true }).fill(malicious);
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await expect(page.getByRole('status').filter({hasText:'Source added'})).toBeVisible();
  await expect(page.locator('.source-content').filter({ hasText: '<script>' })).toHaveText(malicious);
  await expect(page.locator('#injected-image')).toHaveCount(0);
  expect(await page.evaluate(() => '__injected' in window)).toBe(false);
  expect(fixture.externalRequests).toEqual([]);
  expect(fixture.commands.filter(command => command.type.startsWith('export.'))).toEqual([]);
});

test('rapid repeated draft submission produces a single durable artifact', async ({ page }) => {
  await taskTool(page,'Files');await page.getByRole('button',{name:'New file',exact:true}).click();await page.getByRole('button',{name:'Draft',exact:true}).click();
  await page.getByLabel('Draft title').fill('Only once');
  await expect(page.getByLabel('Draft content',{exact:true})).toHaveAttribute('contenteditable','true');await expect(page.getByRole('group',{name:'Text formatting',exact:true})).toBeVisible();
  await page.getByLabel('Draft content').fill('One deliberate save.');
  await expect(page.getByRole('button',{name:'Save draft',exact:true})).toBeEnabled();
  await page.getByRole('button', { name: 'Save draft', exact: true }).evaluate(button => { if (!(button instanceof HTMLButtonElement)) throw new Error('Expected a native button'); button.click(); button.click(); });
  await expect(page.getByRole('button', { name: /Only once/ })).toBeVisible();
  expect(fixture.commands.filter(command => command.type === 'artifact.save')).toHaveLength(1);
  const task=await fixture.core.getTask(fixture.taskA.id);expect(task.artifacts).toHaveLength(2);expect(task.artifacts.at(-1)?.revisions[0].content.trim()).toBe('One deliberate save.');expect(task.artifacts.at(-1)?.revisions[0].mimeType).toBe('text/markdown');
});

test('compact and workspace share request state and preserve an unsaved source edit',async({page})=>{
  await openFile(page,'Alpha draft');
  await page.getByRole('button',{name:'Edit document',exact:true}).click();
  await page.getByLabel('Draft content',{exact:true}).fill('Unsaved source edit must survive surface changes.');
  await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();
  await expect(page.locator('.compact-companion')).toBeVisible();
  await page.getByLabel('Ask companion',{exact:true}).fill('Explain the selected synthetic source.');
  await page.getByRole('button',{name:'Ask',exact:true}).click();
  await expect.poll(()=>fixture.pending.size).toBe(1);
  const request=[...fixture.pending.values()][0].command;
  await fixture.stream('Actual fixture stream, labeled controlled data.');
  await expect(page.locator('.compact-response')).toContainText('Actual fixture stream');
  await page.getByRole('button',{name:'Open task workspace',exact:false}).click();
  await expect(page.locator('.workspace')).toBeVisible();
  await expect(page.getByLabel('Draft content',{exact:true})).toHaveValue('Unsaved source edit must survive surface changes.');
  await page.getByRole('button',{name:'Stop current request',exact:true}).click();
  await expect.poll(()=>fixture.commands.filter(c=>c.type==='model.cancel').length).toBe(1);
  expect(fixture.commands.find(c=>c.type==='model.cancel')).toMatchObject({taskId:fixture.taskA.id,requestId:request.requestId});
  expect(fixture.commands.filter(c=>c.type==='windows.capture'||c.type==='export.approve')).toHaveLength(0);
});

test('artifact reading is inert formatted content and source editing is explicit',async({page})=>{
  await fixture.core.saveArtifact(fixture.taskA.id,{title:'Readable source',content:'# Visitor handoff\n\n**Capacity:** 20\n\n- [ ] Confirm hosts.\n\n<img id="artifact-injection" src="https://browser-fixture.invalid/exfil">',mimeType:'text/markdown'});
  await fixture.changed(fixture.taskA.id);
  await openFile(page,'Readable source');
  await expect(page.locator('.workspace .readable-text h2')).toHaveText('Visitor handoff');
  await expect(page.locator('.workspace .readable-text strong')).toContainText('Capacity:');
  await expect(page.getByLabel('Draft content',{exact:true})).toHaveCount(0);
  await expect(page.locator('#artifact-injection')).toHaveCount(0);expect(fixture.externalRequests).toEqual([]);
  // Unsupported raw HTML stays in the explicit Markdown editor without being parsed into a live DOM.
  await page.getByRole('button',{name:'Edit Markdown',exact:true}).click();
  await expect(page.getByLabel('Draft content',{exact:true})).toHaveValue(/\*\*Capacity:\*\*/);await expect(page.locator('#artifact-injection')).toHaveCount(0);expect(fixture.externalRequests).toEqual([]);
});

test('an existing export approval stays inaccessible while the viewed artifact has unsaved edits',async({page})=>{
  await openFile(page,'Alpha draft');
  await page.getByRole('button',{name:'Export',exact:true}).click();
  await expect(page.getByRole('button',{name:'Approve export',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Back to document',exact:true}).click();
  await page.getByRole('button',{name:'Edit document',exact:true}).click();
  await page.getByLabel('Draft content',{exact:true}).fill('Unsaved wording that must not be confused with export bytes.');
  // Focused edit mode makes the saved approval inaccessible until edits are resolved.
  await expect(page.getByRole('button',{name:'Approve export',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Export',exact:true})).toHaveCount(0);
  expect((await fixture.core.getTask(fixture.taskA.id)).actions[0].status).toBe('proposed');
  expect(fixture.commands.filter(c=>c.type==='export.approve')).toHaveLength(0);
});

test('a learned procedure keeps observation limits and clears checks after context changes',async({page})=>{
  const draft={schemaVersion:1,kind:'procedure',title:'Observed draft review',summary:'Only supplied synthetic observations were reviewed.',steps:[{intent:'Review wording',target:'Current draft',preconditions:[{key:'review',equals:'approved'}],expectedResult:'A reviewed draft'}],limitations:['The outcome was not demonstrated; human review is required.']};
  await fixture.core.saveArtifact(fixture.taskA.id,{title:draft.title,content:JSON.stringify(draft),mimeType:'application/json'});await fixture.changed(fixture.taskA.id);
  await openFile(page,'Observed draft review');
  await page.getByRole('button',{name:'Artifact options',exact:true}).click();await page.getByRole('button',{name:'Export draft',exact:true}).click();
  await expect(page.getByRole('button',{name:'Approve export',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Back to result',exact:true}).click();
  await page.getByRole('button',{name:'Edit procedure',exact:true}).click();await page.getByRole('button',{name:'Edit step 1: Review wording',exact:true}).click();await page.getByLabel('What to do',{exact:true}).fill('Review and correct wording');
  await page.getByRole('button',{name:'Artifact options',exact:true}).click();await expect(page.getByRole('button',{name:'Export draft',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Artifact options',exact:true}).click();await page.getByRole('button',{name:'Save procedure',exact:true}).click();
  await expect(page.locator('.context-inspector')).toBeHidden();
  await openFile(page,'Observed draft review',true);
  await expect(page.getByText(draft.limitations[0],{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Check conditions',exact:true}).click();await page.getByLabel('Review',{exact:true}).fill('approved');
  await page.getByRole('button',{name:'Check my answers',exact:true}).click();
  await expect(page.getByText('Your answers match the saved conditions. Review the steps before proceeding.',{exact:true})).toBeVisible();
  await page.getByLabel('Review',{exact:true}).fill('rejected');
  await expect(page.getByText('Your answers match the saved conditions. Review the steps before proceeding.',{exact:true})).toHaveCount(0);
  const procedure=(await fixture.core.getTask(fixture.taskA.id)).procedures[0];expect(procedure.revisions[0].observation?.limitations).toEqual(draft.limitations);
});

test('late procedure readiness cannot overwrite changed source context',async({page})=>{
  await fixture.core.saveProcedure(fixture.taskA.id,{title:'Delayed readiness',steps:[{intent:'Review draft',target:'Current draft',preconditions:[],expectedResult:'Reviewed draft'}]});await fixture.changed(fixture.taskA.id);
  await openFile(page,'Delayed readiness',true);
  let release!:()=>void;fixture.checkBarrier=new Promise<void>(resolve=>{release=resolve});
  await page.getByRole('button',{name:'Check conditions',exact:true}).click();await page.getByRole('button',{name:'Check my answers',exact:true}).click();
  await expect.poll(()=>fixture.commands.filter(c=>c.type==='procedure.check').length).toBe(1);
  await fixture.core.putSource(fixture.taskA.id,{id:fixture.taskA.sources[0].id,kind:'text',label:'Changed source',role:'fact',content:'The source changed while readiness was pending.'});await fixture.changed(fixture.taskA.id);
  release();await expect(page.getByRole('button',{name:'Check my answers',exact:true})).toBeEnabled();
  await expect(page.getByText('Your answers match the saved conditions. Review the steps before proceeding.',{exact:true})).toHaveCount(0);
});

test('manual calculation saves a submitted input snapshot and blocks changed provenance',async({page})=>{
  await taskTool(page,'Files');await page.getByRole('button',{name:'New file',exact:true}).click();await page.getByRole('button',{name:'Experiment',exact:true}).click();
  let release!:()=>void;fixture.calculationBarrier=new Promise<void>(resolve=>{release=resolve});
  await page.getByRole('button',{name:'Calculate',exact:true}).click();
  await expect(page.getByLabel('Speed (m/s)',{exact:true})).toBeDisabled();
  await fixture.core.putSource(fixture.taskA.id,{id:fixture.taskA.sources[0].id,kind:'text',label:'Changed calculation context',role:'fact',content:'A source changed during the pending calculation.'});await fixture.changed(fixture.taskA.id);release();
  await expect(page.locator('output')).toContainText('60');await expect(page.getByRole('button',{name:'Save result to task',exact:true})).toBeDisabled();
  fixture.calculationBarrier=undefined;await page.getByLabel('Speed (m/s)',{exact:true}).fill('20');await expect(page.locator('output')).toHaveCount(0);
  await page.getByRole('button',{name:'Calculate',exact:true}).click();await expect(page.locator('output')).toContainText('100');await page.getByRole('button',{name:'Save result to task',exact:true}).click();
  const saved=(await fixture.core.getTask(fixture.taskA.id)).artifacts.at(-1)!.revisions[0];expect(saved.content).toContain('speed = 20');expect(saved.content).toContain('Result: 100 m');expect(saved.sourceRefs[0].version).toBe(2);
});

test('image replacement cannot save old decoded pixels with new source provenance',async({page})=>{
  const colors=await page.evaluate(()=>['#e54040','#2040e5'].map(color=>{const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;const ctx=canvas.getContext('2d')!;ctx.fillStyle=color;ctx.fillRect(0,0,2,2);return canvas.toDataURL('image/png')}));
  let task=await fixture.core.putSource(fixture.taskA.id,{kind:'image',label:'Editable synthetic image',role:'fact',content:colors[0]});const source=task.sources.at(-1)!;await fixture.changed(task.id);
  await taskTool(page,'Context');await page.getByRole('button',{name:'Editable synthetic image Source material',exact:true}).click();
  await sourceTool(page,'Crop & annotate');await expect(page.getByRole('button',{name:'Save edited image',exact:true})).toBeEnabled();
  await page.evaluate(next=>{const Original=window.Image;const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src')!;(window as any).__releaseImage=undefined;window.Image=function(){const image=new Original();Object.defineProperty(image,'src',{get:()=>descriptor.get!.call(image),set:(value:string)=>{if(value===next)(window as any).__releaseImage=()=>descriptor.set!.call(image,value);else descriptor.set!.call(image,value)}});return image} as unknown as typeof Image},colors[1]);
  task=await fixture.core.putSource(task.id,{id:source.id,kind:'image',label:'Editable synthetic image',role:'fact',content:colors[1]});await fixture.changed(task.id);
  await expect.poll(()=>page.evaluate(()=>typeof (window as any).__releaseImage)).toBe('function');
  await expect(page.getByRole('button',{name:'Save edited image',exact:true})).toBeDisabled();expect(fixture.commands.filter(c=>c.type==='artifact.save')).toHaveLength(0);
  await page.evaluate(()=>(window as any).__releaseImage());await expect(page.getByRole('button',{name:'Save edited image',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Save edited image',exact:true}).click();
  const artifact=(await fixture.core.getTask(task.id)).artifacts.at(-1)!.revisions[0];expect(artifact.content).toBe(colors[1].split(',')[1]);expect(artifact.sourceRefs).toEqual([{sourceId:source.id,version:2,digest:task.sources.at(-1)!.versions.at(-1)!.digest}]);
});

test('a stale editor base cannot silently overwrite a concurrent artifact revision', async ({ page }) => {
  await openFile(page,'Alpha draft');
  await page.getByRole('button', { name: 'Edit document', exact: true }).click();
  await page.getByLabel('Draft content').fill('Uncommitted text from editor base one.');
  const artifact = fixture.taskA.artifacts[0];
  await fixture.core.saveArtifact(fixture.taskA.id, { artifactId: artifact.id, expectedRevision: 1, title: 'External correction', content: 'Authoritative revision two.' });
  await fixture.changed(fixture.taskA.id);
  await expect(page.locator('.revision-conflict')).toContainText('A newer revision is available');
  await expect(page.getByLabel('Draft content')).toHaveValue('Uncommitted text from editor base one.');
  await expect(page.getByRole('button', { name: 'Save revision', exact: true })).toBeDisabled();
  // Export is absent during explicit editing; the saved approval stays inaccessible.
  await expect(page.getByRole('button',{name:'Export',exact:true})).toHaveCount(0);
  expect(fixture.commands.filter(command => command.type === 'artifact.save')).toHaveLength(0);
  const task = await fixture.core.getTask(fixture.taskA.id);
  expect(task.artifacts[0].revisions).toHaveLength(2);
  expect(task.artifacts[0].revisions.at(-1)?.content).toBe('Authoritative revision two.');
  await page.screenshot({ path: 'evidence/browser-stale-editor-conflict.png' });
  await page.getByRole('button', { name: 'Load latest revision', exact: true }).click();
  await expect(page.getByLabel('Draft content')).toHaveValue('Authoritative revision two.');
  await expect(page.locator('.revision-conflict')).toHaveCount(0);
});

test('360 pixel reduced-motion views fit without horizontal overflow and keep the logo still', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  const checkWidth = async () => {
    const overflow = await page.evaluate(() => ({ document: document.documentElement.scrollWidth - innerWidth, main: (document.querySelector('main')?.scrollWidth ?? 0) - (document.querySelector('main')?.clientWidth ?? 0) }));
    expect(overflow.document).toBeLessThanOrEqual(1); expect(overflow.main).toBeLessThanOrEqual(1);
  };
  await checkWidth();
  await taskTool(page,'Context'); await checkWidth();
  await taskTool(page,'Work');
  await taskTool(page,'Files');await page.getByRole('button',{name:'New file',exact:true}).click();await page.getByRole('button',{name:'Experiment',exact:true}).click();
  await page.getByLabel('Speed (m/s)', { exact: true }).fill('10');
  await page.getByLabel('Time (s)', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Calculate', exact: true }).click();
  await expect(page.locator('output')).toContainText('20'); await expect(page.locator('output span')).toHaveText('m'); await checkWidth();
  await page.locator('output').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'evidence/browser-narrow-experiment.png' });
  await page.getByRole('button',{name:'Back to task',exact:true}).click();
  await page.getByRole('dialog',{name:'Keep your unsaved edits?',exact:true}).getByRole('button',{name:'Leave and discard edits',exact:true}).click();
  await startRequest(page);
  await expect(page.locator('.t-gen,.t-tig,.workspace [data-sd-animate]')).toHaveCount(0);
  await checkWidth();
  fixture.fail('End reduced-motion fixture');
  await expect(page.getByRole('alert')).toContainText('This action could not be completed.');
});


test('restored PNG history never animates on opening or switching edit modes',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});
 const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=140;canvas.height=80;const c=canvas.getContext('2d')!;c.fillStyle='#6389a1';c.fillRect(0,0,140,80);c.fillStyle='#ecd5a8';c.fillRect(25,15,75,50);return canvas.toDataURL('image/png').split(',')[1];});
 await fixture.core.saveArtifact(fixture.taskA.id,{title:'PNG insertion fixture',content:png,mimeType:'image/png',encoding:'base64'});await fixture.changed(fixture.taskA.id);await openFile(page,'PNG insertion fixture');await expect(page.locator('.workspace').getByAltText('PNG insertion fixture')).toBeVisible();await expect(page.locator('.workspace')).toHaveAttribute('data-surface-reveal',/^(settled|cancelled)$/);await expect(page.locator('.workspace [data-artifact-variant="image"]')).toHaveAttribute('data-artifact-reveal','not a new visible arrival');await expect(page.locator('.t-tig,.t-gen')).toHaveCount(0);await page.getByRole('button',{name:'Edit image details',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.locator('.workspace').getByAltText('PNG insertion fixture')).toBeVisible();await page.waitForTimeout(250);await expect(page.locator('.t-tig,.t-gen')).toHaveCount(0);
});

test('restored structured history never animates on opening',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});const draft={schemaVersion:1,kind:'procedure',title:'Structured insertion fixture',summary:'Only explicit synthetic observations were supplied.',steps:[{intent:'Review a draft',target:'Saved artifact',preconditions:[],expectedResult:'A reviewed artifact'}],limitations:['Execution was not demonstrated.']};await fixture.core.saveArtifact(fixture.taskA.id,{title:draft.title,content:JSON.stringify(draft),mimeType:'application/json'});await fixture.changed(fixture.taskA.id);await openFile(page,'Structured insertion fixture');await expect(page.locator('.model-draft-review')).toBeVisible();await expect(page.locator('.workspace [data-artifact-variant="ui"]')).toHaveCount(1);await expect(page.locator('.workspace')).toHaveAttribute('data-surface-reveal',/^(settled|cancelled)$/);await expect(page.locator('.t-gen,.t-tig')).toHaveCount(0);expect(fixture.externalRequests).toEqual([]);
});

for(const viewport of [{width:1080,height:720},{width:360,height:440}])test(`procedure questions belong to their steps and the last edit clears the footer at ${viewport.width}px`,async({page})=>{
 await page.setViewportSize(viewport);
 await fixture.core.saveProcedure(fixture.taskA.id,{title:'Arrival review',steps:[{intent:'Confirm permission',target:'Visit planning note',preconditions:[{key:'permission_granted',equals:'TRUE'}],expectedResult:'Permission is recorded before the visit.'},{intent:'Review the guest plan',target:'Current planning document',preconditions:[{key:'review',equals:'approved'}],expectedResult:'The guest plan has been reviewed. '+ 'Keep unconfirmed details visible until a person checks the source. '.repeat(5)}]});await fixture.changed(fixture.taskA.id);await openFile(page,'Arrival review',true);
 await expect(page.locator('.procedure-tool').getByRole('heading',{name:'Arrival review',exact:true})).toHaveCount(1);await page.getByRole('button',{name:'Check conditions',exact:true}).click();
 const first=page.getByRole('listitem',{name:'Step 1: Confirm permission',exact:true}),second=page.getByRole('listitem',{name:'Step 2: Review the guest plan',exact:true});
 const answer=first.getByLabel('Permission granted?',{exact:true});await expect(answer).toHaveValue('');await expect(answer.locator('option')).toHaveText(['Not confirmed','Yes','No']);await expect(second.getByLabel('Review',{exact:true})).toBeVisible();await expect(page.getByText(/Step 1 requires/)).toHaveCount(0);
 await answer.selectOption({label:'Yes'});await second.getByLabel('Review',{exact:true}).fill('approved');await second.getByLabel('Review',{exact:true}).press('Enter');await expect(page.getByRole('status').filter({hasText:'Ready for review'})).toBeVisible();expect(fixture.commands.filter(command=>command.type==='procedure.check')).toHaveLength(1);expect(fixture.commands.find(command=>command.type==='procedure.check')).toMatchObject({context:{permission_granted:'TRUE',review:'approved'}});expect(fixture.commands.filter(command=>command.type==='procedure.save')).toHaveLength(0);expect((await fixture.core.getTask(fixture.taskA.id)).procedures[0].revisions).toHaveLength(1);
 await answer.selectOption({label:'No'});await expect(page.getByRole('status').filter({hasText:'Ready for review'})).toHaveCount(0);await page.getByRole('button',{name:'Check my answers',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Conditions need attention'})).toBeVisible();await expect(first).toContainText('Permission granted should be Yes.');await expect(page.locator('.procedure-tool')).toContainText('They do not run the steps or independently verify the screen.');
 await page.getByRole('button',{name:'Review step 2',exact:true}).click();const finalField=page.getByLabel('Required value',{exact:true});await finalField.fill('approved ');await finalField.focus();
 const bounds=await finalField.boundingBox(),footer=await page.locator('.procedure-footer').boundingBox(),body=await page.locator('.procedure-scroll').boundingBox();expect(bounds!.y).toBeGreaterThanOrEqual(body!.y);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(footer!.y);await expect(page.getByRole('button',{name:'Save procedure',exact:true})).toBeEnabled();expect(fixture.commands.filter(command=>command.type==='model.run'||command.type==='windows.capture'||command.type.startsWith('export.'))).toHaveLength(0);
});
