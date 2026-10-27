import type {ExportCommand,ExportReply,OtherCommand} from '../src/shared/export-contract';
import {test,expect,type Page} from '@playwright/test';
import {BrowserFixture} from './browser-fixture';
import {taskTool,sourceTool} from './ui-tools';

test.use({viewport:{width:1080,height:720},reducedMotion:'reduce'});
let fixture:BrowserFixture;
test.afterEach(async()=>{await fixture?.close();});
async function openImage(page:Page){
 fixture=await BrowserFixture.open(page);
 await expect(page.locator('.workspace')).toHaveAttribute('data-surface-reveal','settled');
 const data=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=600;canvas.height=360;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#174c3b';ctx.fillRect(0,0,600,360);ctx.fillStyle='#e2c87c';ctx.fillRect(250,100,100,100);return canvas.toDataURL('image/png');});
 const task=await fixture.core.putSource(fixture.taskA.id,{kind:'image',label:'Owned image preview',role:'fact',content:data}),source=task.sources.at(-1)!;
 await fixture.changed(task.id);await taskTool(page,'Context');await page.getByRole('button',{name:'Owned image preview Source material',exact:true}).click();
 const contextPreview=await page.getByAltText('Source snapshot: Owned image preview',{exact:true}).boundingBox();
 await sourceTool(page,'Crop & annotate');await expect(page.getByRole('button',{name:'Save edited image',exact:true})).toBeEnabled();
 return {task,source,data,contextPreview};
}

test('crop uses the wide working image and annotation updates the actual saved pixels without replacing the original',async({page})=>{
 const {task,source,data,contextPreview}=await openImage(page),original=page.getByAltText('Original image for crop selection',{exact:true});
 const image=await original.boundingBox();expect(image!.width).toBeGreaterThan(550);expect(image!.width).toBeGreaterThan(contextPreview!.width*1.5);expect(image!.height).toBeGreaterThan(330);
 await expect(page.getByLabel('Width (px)',{exact:true})).toBeHidden();await expect(page.getByLabel('Image title',{exact:true})).toBeHidden();
 const corner=page.getByRole('button',{name:'Resize crop bottom right corner',exact:true});await corner.focus();await page.keyboard.press('ArrowLeft');
 await page.getByText('Output details ·',{exact:false}).click();await expect(page.getByLabel('Width (px)',{exact:true})).toHaveValue('599');
 for(const [label,value] of [['Left (px)','50'],['Top (px)','40'],['Width (px)','400'],['Height (px)','220']] as const)await page.getByLabel(label,{exact:true}).fill(value);
 await page.getByRole('button',{name:'Add annotation',exact:true}).click();await expect(original).toHaveCount(0);
 const preview=page.getByRole('img',{name:'Preview of cropped and annotated image',exact:true});await expect(preview).toBeVisible();
 const before=await preview.evaluate(element=>(element as HTMLCanvasElement).toDataURL('image/png'));
 await page.getByLabel('Annotation (optional)',{exact:true}).fill('Owned observation on the saved crop.');
 await expect.poll(()=>preview.evaluate(element=>(element as HTMLCanvasElement).toDataURL('image/png'))).not.toBe(before);
 const pixels=await preview.evaluate(element=>{const canvas=element as HTMLCanvasElement,ctx=canvas.getContext('2d')!;return {width:canvas.width,height:canvas.height,top:[...ctx.getImageData(0,0,1,1).data],bottom:[...ctx.getImageData(0,canvas.height-1,1,1).data],png:canvas.toDataURL('image/png').split(',')[1]};});
 expect(pixels).toMatchObject({width:400,height:220,top:[23,76,59,255]});expect(pixels.bottom.slice(0,3).every(channel=>channel>210)).toBe(true);
 const scroll=page.locator('.image-editor-scroll'),footer=page.locator('.image-editor-footer');
 for(const width of [1080,390]){
  await page.setViewportSize({width,height:720});await page.getByLabel('Height (px)',{exact:true}).focus();await scroll.evaluate(element=>{element.scrollTop=element.scrollHeight;});
  const bodyBox=await scroll.boundingBox(),footerBox=await footer.boundingBox(),fieldBox=await page.getByLabel('Height (px)',{exact:true}).boundingBox(),dialogBox=await page.locator('.context-inspector').boundingBox();
  expect(bodyBox!.y+bodyBox!.height).toBeLessThanOrEqual(footerBox!.y+.5);expect(fieldBox!.y+fieldBox!.height).toBeLessThanOrEqual(footerBox!.y+.5);expect(footerBox!.y+footerBox!.height).toBeLessThanOrEqual(dialogBox!.y+dialogBox!.height);
 }
 await page.getByRole('button',{name:'Save edited image',exact:true}).click();await expect.poll(async()=>(await fixture.core.getTask(task.id)).artifacts.length).toBe(2);
 const savedTask=await fixture.core.getTask(task.id),saved=savedTask.artifacts.at(-1)!.revisions[0],png=Buffer.from(saved.content,'base64');
 expect(saved.content).toBe(pixels.png);expect(png.readUInt32BE(16)).toBe(400);expect(png.readUInt32BE(20)).toBe(220);expect(saved.sourceRefs).toEqual([{sourceId:source.id,version:1,digest:source.versions[0].digest}]);
 expect(savedTask.sources.find(item=>item.id===source.id)!.versions).toEqual(source.versions);expect(savedTask.sources.find(item=>item.id===source.id)!.versions[0].content).toBe(data);
 expect(fixture.commands.filter(command=>['windows.capture','model.run','export.approve'].includes(command.type))).toHaveLength(0);expect(fixture.externalRequests).toEqual([]);
});

test('a late annotation stays dirty after the earlier image snapshot finishes saving',async({page})=>{
 const {task,source}=await openImage(page);await page.getByRole('button',{name:'Add annotation',exact:true}).click();
 const annotation=page.getByLabel('Annotation (optional)',{exact:true}),preview=page.getByRole('img',{name:'Preview of cropped and annotated image',exact:true});
 await annotation.fill('Submitted annotation.');await expect(page.getByRole('button',{name:'Save edited image',exact:true})).toBeEnabled();
 const submitted=await preview.evaluate(element=>(element as HTMLCanvasElement).toDataURL('image/png').split(',')[1]);
 await page.evaluate(()=>{const original=window.companion.invoke;function intercepted<C extends ExportCommand>(command:C):Promise<ExportReply<C>>;function intercepted<T=unknown>(command:OtherCommand):Promise<T>;async function intercepted(command:import('../src/shared/bridge').Command):Promise<unknown>{if(command.type==='export.propose'||command.type==='export.approve'||command.type==='export.inspect')return original(command);if(command.type==='artifact.save'&&command.artifact.mimeType==='image/png')return new Promise<unknown>((resolve,reject)=>{Reflect.set(window,'__releaseImageSave',()=>original(command).then(resolve,reject));});return original(command);}window.companion.invoke=intercepted;});
 await page.getByRole('button',{name:'Save edited image',exact:true}).click();await expect.poll(()=>page.evaluate(()=>typeof Reflect.get(window,'__releaseImageSave'))).toBe('function');
 await annotation.fill('Later annotation remains unsaved.');await page.evaluate(()=>Reflect.get(window,'__releaseImageSave')());
 await expect.poll(async()=>(await fixture.core.getTask(task.id)).artifacts.length).toBe(2);await expect(annotation).toHaveValue('Later annotation remains unsaved.');
 const saved=(await fixture.core.getTask(task.id)).artifacts.at(-1)!.revisions[0];expect(saved.content).toBe(submitted);expect(saved.sourceRefs).toEqual([{sourceId:source.id,version:1,digest:source.versions[0].digest}]);
 await page.locator('.source-crop-editor').getByRole('button',{name:'Back to source',exact:true}).click();await expect(page.getByRole('dialog',{name:'Keep your unsaved edits?',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Keep editing',exact:true}).click();await expect(annotation).toHaveValue('Later annotation remains unsaved.');
});
