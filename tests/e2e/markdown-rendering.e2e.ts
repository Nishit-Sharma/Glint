import {test,expect,type Locator} from '@playwright/test';
import {BrowserFixture} from '../support/browser-fixture';

const markdown='# Visit plan\n\n3. Check the guide.\n   - Keep the source.\n   - [x] Confirm the date.\n4. Contact the host.\n\n> Capacity still needs confirmation.\n\nName | Places\n--- | ---\nGuests | 12\n\n- [ ] Confirm the count.\n- [x] Read the guide.';
const malicious='[Visit guide](https://untrusted.invalid/guide)\n\n![Tracking pixel](https://untrusted.invalid/pixel.png)\n\n[Unsafe link](javascript:alert%281%29)\n\n<script>window.__markdownUnsafeRuns++</script>\n\n<img src="https://untrusted.invalid/raw.png" onerror="window.__markdownUnsafeRuns++">\n\n<iframe src="https://untrusted.invalid/frame"></iframe>\n\n<Widget onClick={window.__markdownUnsafeRuns++} />\n\n- [x] Keep the saved state.\n\n```js\nfetch("https://untrusted.invalid/code");\n```';
let fixture:BrowserFixture;

test.use({viewport:{width:1080,height:720},reducedMotion:'reduce'});
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{Reflect.set(window,'__markdownUnsafeRuns',0);});
 fixture=await BrowserFixture.open(page);
 await expect(page.locator('.workspace')).toHaveAttribute('data-surface-reveal','settled');
});
test.afterEach(async()=>{await fixture.close();});

async function formatting(surface:Locator){
 await expect(surface.getByRole('heading',{name:'Visit plan',level:2,exact:true})).toBeVisible();
 await expect(surface.locator('ol[start="3"]>li')).toHaveCount(2);
 await expect(surface.locator('ol>li>ul')).toHaveCount(1);
 await expect(surface.locator('blockquote')).toContainText('Capacity still needs confirmation.');
 await expect(surface.getByRole('columnheader',{name:'Name',exact:true})).toBeVisible();
 await expect(surface.getByRole('cell',{name:'12',exact:true})).toBeVisible();
 await expect(surface.getByRole('checkbox')).toHaveCount(3);
 await expect(surface.locator('input:checked')).toHaveCount(2);
 await expect(surface.locator('input:disabled')).toHaveCount(3);
 expect(await surface.locator('li.task-list-item').evaluateAll(items=>items.every(item=>getComputedStyle(item).listStyleType==='none'&&item.querySelectorAll(':scope>input,:scope>p>input').length===1))).toBe(true);
}

async function inert(surface:Locator){
 await expect(surface).toContainText('Image reference: Tracking pixel');
 await expect(surface).toContainText('image not loaded.');
 await expect(surface.locator('a[href],img,script,iframe,object,embed,form,video,audio,source')).toHaveCount(0);
 await expect(surface.locator('[onclick],[onerror],[src],[href]')).toHaveCount(0);
 await expect(surface.locator('button')).toHaveCount(1);
 await expect(surface.getByRole('button',{name:'Copy code block',exact:true})).toHaveCount(1);
 expect(fixture.commands.filter(command=>command.type==='code-block.copy')).toEqual([]);
 await expect(surface.getByRole('checkbox')).toBeDisabled();
 await expect(surface.getByRole('checkbox')).toBeChecked();
 expect(fixture.externalRequests).toEqual([]);
 expect(fixture.commands.filter(command=>['context.start','context.capture','windows.capture','export.propose','export.approve'].includes(command.type))).toEqual([]);
 expect(await surface.page().evaluate(()=>Reflect.get(window,'__markdownUnsafeRuns'))).toBe(0);
 expect((await fixture.core.getTask(fixture.taskA.id)).actions).toHaveLength(0);
}

test('Markdown retains structure from the live stream through saved conversation and reopened document',async({page},info)=>{
 await page.getByLabel('Ask about this task',{exact:true}).fill('Prepare a visit plan with the supplied formatting.');
 await page.getByRole('button',{name:'Ask',exact:true}).click();
 await expect.poll(()=>fixture.pending.size).toBe(1);
 await fixture.stream(markdown);
 await formatting(page.locator('.workspace .conversation-answer .streaming-text'));
 fixture.complete(markdown);
 const saved=page.locator('.workspace .conversation-answer .readable-text:not(.streaming-text)');
 await formatting(saved);
 await page.getByRole('button',{name:'Open Fixture provider result',exact:true}).click();
 const opened=page.locator('.document-scroll .readable-text');
 await formatting(opened);
 await page.screenshot({path:info.outputPath('markdown-opened.png')});
 await page.getByRole('button',{name:'Back to task',exact:true}).click();
 await page.getByRole('button',{name:'Open Fixture provider result',exact:true}).click();
 await formatting(page.locator('.document-scroll .readable-text'));
 const result=(await fixture.core.getTask(fixture.taskA.id)).artifacts.find(item=>item.revisions.at(-1)?.title==='Fixture provider result');
 expect(result?.revisions.at(-1)?.content).toBe(markdown);
});

test('untrusted Markdown cannot navigate, fetch assets, run code, capture a window or create an action',async({page},info)=>{
 let popups=0;page.on('popup',()=>{popups++;});
 await page.getByLabel('Ask about this task',{exact:true}).fill('Show the supplied references as a document.');
 await page.getByRole('button',{name:'Ask',exact:true}).click();
 await expect.poll(()=>fixture.pending.size).toBe(1);
 await fixture.stream(malicious);
 await inert(page.locator('.workspace .conversation-answer .streaming-text'));
 fixture.complete(malicious);
 const saved=page.locator('.workspace .conversation-answer .readable-text:not(.streaming-text)');
 await inert(saved);
 await saved.locator('.markdown-reference').first().click();
 expect(page.url()).toBe('http://127.0.0.1:4173/');
 await page.getByRole('button',{name:'Open Fixture provider result',exact:true}).click();
 await inert(page.locator('.document-scroll .readable-text'));
 expect(popups).toBe(0);
 await info.attach('inert-markdown-boundaries',{body:JSON.stringify({externalRequests:fixture.externalRequests,unsafeRuns:await page.evaluate(()=>Reflect.get(window,'__markdownUnsafeRuns')),popups,captureAndExportCommands:fixture.commands.filter(command=>['context.start','context.capture','windows.capture','export.propose','export.approve'].includes(command.type)),scope:'Actual browser renderer and durable core; provider and OS host are substitutes.'}),contentType:'application/json'});
});

test('long prose wraps while code and tables scroll internally at 320px and 200% text size',async({page},info)=>{
 const long='document_identifier_'.repeat(24),text='# Narrow plan\n\n'+long+'\n\n```text\n'+long+'\n```\n\nName | Reference | Status\n--- | --- | ---\nGuests | '+long+' | Waiting';
 await fixture.core.runRequest({taskId:fixture.taskA.id,requestId:'narrow-markdown',kind:'explain',prompt:'Read this narrow plan.'},async()=>({title:'Narrow plan',content:text,mimeType:'text/markdown'}));
 await fixture.changed(fixture.taskA.id);
 await page.getByRole('button',{name:'Open Narrow plan',exact:true}).click();
 await page.setViewportSize({width:320,height:720});
 const surface=page.locator('.document-scroll .readable-text');
 const check=async()=>{
  await expect(surface).toBeVisible();
  expect(await surface.evaluate(root=>root.scrollWidth<=root.clientWidth+1)).toBe(true);
  expect(await surface.locator('.markdown-paragraph,li').evaluateAll(items=>items.every(item=>{const style=getComputedStyle(item);return parseFloat(style.lineHeight)>=parseFloat(style.fontSize)*1.4;}))).toBe(true);
  expect(await surface.locator('pre').evaluate(root=>root.scrollWidth>root.clientWidth&&getComputedStyle(root).overflowX==='auto')).toBe(true);
  expect(await surface.locator('.markdown-table-scroll').evaluate(root=>root.scrollWidth>root.clientWidth&&getComputedStyle(root).overflowX==='auto')).toBe(true);
 };
 await check();
 await page.screenshot({path:info.outputPath('markdown-320.png')});
 await surface.evaluate(root=>{(root as HTMLElement).style.fontSize='200%';});
 await check();
 await page.screenshot({path:info.outputPath('markdown-320-text-200.png')});
});
