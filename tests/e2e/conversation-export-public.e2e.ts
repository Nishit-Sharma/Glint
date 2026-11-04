import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {BrowserFixture} from '../support/browser-fixture';
import {taskTool} from '../support/ui-tools';

test.use({reducedMotion:'reduce'});
for(const viewport of [{width:1280,height:900},{width:430,height:760}])test(`task menu reviews full conversation and saves frozen Markdown and JSON at ${viewport.width}px`,async({page})=>{
 await page.setViewportSize(viewport);const fixture=await BrowserFixture.open(page);try{
  const question='Original question — café 日本語 🧭\n\n```ts\nlet x = `yes`;\n```',answer='Original answer\n\n## Heading\n\n```text\n三\n```';
  await fixture.core.runRequest({taskId:fixture.taskA.id,requestId:'export-original',kind:'explain',prompt:question,sourceIds:[]},async()=>({title:'Original response',content:answer}));const owner=await fixture.core.getTask(fixture.taskA.id),artifact=owner.artifacts.at(-1)!;
  await fixture.core.saveArtifact(owner.id,{artifactId:artifact.id,expectedRevision:1,title:'Response revised',content:'Revised answer version two'});await fixture.changed(owner.id);
  await taskTool(page,'Export conversation');const review=page.getByRole('region',{name:'Conversation export review'});await expect(review).toContainText('Image and binary bodies');await expect(review.getByRole('button',{name:'Choose file location'})).toHaveCount(0);
  await review.getByRole('button',{name:'Review snapshot',exact:true}).click();await expect(review).toContainText('1 recorded request · 3 saved revisions');await review.getByText('Inspect complete file contents',{exact:true}).click();await expect(review.locator('pre')).toContainText(question);await expect(review.locator('pre')).toContainText(answer);await expect(review.locator('pre')).toContainText('Revised answer version two');await expect(review.locator('pre')).not.toContainText('Beta revision one.');await page.screenshot({path:`evidence/conversation-export-${viewport.width}-review.png`,fullPage:true});
  fixture.cancelExport=true;await review.getByRole('button',{name:'Choose file location'}).click();await expect(review.getByRole('status')).toContainText('Save canceled. No file was written.');
  fixture.cancelExport=false;fixture.exportPath=join(fixture.directory,'actual-markdown.md');await review.getByRole('button',{name:'Choose file location'}).click();await expect(review.getByRole('status')).toContainText('Conversation saved');const markdown=await readFile(fixture.exportPath,'utf8');expect(markdown).toContain(question);expect(markdown).toContain(answer);expect(markdown).not.toContain('Alpha event is on October 23.');
  await review.getByRole('combobox',{name:'File format'}).selectOption('json');await expect(review.getByRole('button',{name:'Choose file location'})).toHaveCount(0);await review.getByRole('checkbox').check();await review.getByRole('button',{name:'Review snapshot',exact:true}).click();fixture.exportPath=join(fixture.directory,'actual-json.json');await review.getByRole('button',{name:'Choose file location'}).click();await expect(review.getByRole('status')).toContainText('Conversation saved');const json=JSON.parse(await readFile(fixture.exportPath,'utf8'));expect(json.task.taskId).toBe(owner.id);expect(json.requests[0].question).toBe(question);expect(json.artifacts.at(-1).revisions.map((item:{content:string})=>item.content)).toEqual([answer,'Revised answer version two']);expect(json.sourceText[0].content).toBe('Alpha event is on October 23.');expect(fixture.externalRequests).toEqual([]);await review.getByRole('status').scrollIntoViewIfNeeded();await page.screenshot({path:`evidence/conversation-export-${viewport.width}-saved.png`,fullPage:true});
 }finally{await fixture.close();}
});
