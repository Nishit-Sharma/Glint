import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {BrowserFixture} from '../support/browser-fixture';
import {OnboardingFixture} from '../support/onboarding-fixture';
import type {OriginalActor} from '../../src/renderer/src/character-original/actor-runtime';
import {settleCapture} from '../support/settled-capture';
declare global {interface Window {__gazeActors:OriginalActor[]}}
const output='evidence/gaze/'+(process.env.GAZE_CAPTURE??'after');
async function observe(page:import('@playwright/test').Page){
 await mkdir(output,{recursive:true});
 await page.route('**/character-original/actor-runtime.js*',async route=>{const response=await route.fetch();const source=await response.text();await route.fulfill({response,body:source.replace(/function mountOriginal\s*\(/,'function originalMount(').replace(/export \{\s*mountOriginal\s*\};?/, '')+'\nexport function mountOriginal(...args){const actor=originalMount(...args);(window.__gazeActors??=[]).push(actor);return actor;}'});});
}
async function capture(page:import('@playwright/test').Page,name:string){if(name!=='anchor-rest')await settleCapture(page);await page.screenshot({path:output+'/'+name+'.png'});}
const live=(page:import('@playwright/test').Page)=>page.evaluate(()=>window.__gazeActors.map((actor,instance)=>({...actor.stats(),instance})).filter(state=>!state.destroyed));

async function landmarks(page:import('@playwright/test').Page){return page.locator('.appearance-preview canvas').evaluate(async canvas=>{
 const image=new Image();image.src=(canvas as HTMLCanvasElement).toDataURL();await image.decode();const sample=document.createElement('canvas');sample.width=image.width;sample.height=image.height;const context=sample.getContext('2d')!;context.drawImage(image,0,0);const {data}=context.getImageData(0,0,image.width,image.height);let left=image.width,right=0,top=image.height,bottom=0;
 for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){const i=(y*image.width+x)*4;if(data[i+3]>180&&data[i]>115&&data[i+1]>100&&data[i+2]>80){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
 const width=right-left,height=bottom-top;let sumX=0,sumY=0,count=0;
 for(let y=Math.ceil(top+height*.30);y<top+height*.62;y++)for(let x=Math.ceil(left+width*.22);x<left+width*.78;x++){const i=(y*image.width+x)*4;if(data[i+3]>180&&data[i]<75&&data[i+1]<75&&data[i+2]<90){sumX+=x;sumY+=y;count++;}}
 if(count<30)throw Error('Visible eyes were not found inside the original body.');return {x:(sumX/count-(left+right)/2)/width,y:(sumY/count-top)/height,eyePixels:count,body:{left,right,top,bottom}};
 });}

test('App character responds in screen directions then rests after quiet and distant pointer',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});const fixture=await BrowserFixture.open(page);await observe(page);await page.reload();
 try{
  await expect(page.getByRole('button',{name:'Customize Glint',exact:true})).toBeVisible();await page.waitForTimeout(900);await capture(page,'workspace-rest');
  await page.getByRole('button',{name:'Customize Glint',exact:true}).click();await expect(page.locator('.appearance-preview canvas')).toBeVisible();await page.waitForTimeout(900);await capture(page,'appearance-rest');
  const box=(await page.locator('.appearance-preview canvas').boundingBox())!;const cx=box.x+box.width/2,cy=box.y+box.height/2;
  const samples:Record<string,unknown>={},pixels:Record<string,Awaited<ReturnType<typeof landmarks>>>={rest:await landmarks(page)};
  for(const [name,x,y] of [['right',cx+box.width*.45,cy],['left',cx-box.width*.45,cy],['up',cx,cy-box.height*.45],['down',cx,cy+box.height*.45]] as const){await page.mouse.move(x,y);await page.waitForTimeout(450);samples[name]=await live(page);pixels[name]=await landmarks(page);await capture(page,'appearance-'+name);}
  await page.mouse.move(cx+box.width*.45,cy);await page.waitForTimeout(3000);samples.quiet=await live(page);pixels.quiet=await landmarks(page);await capture(page,'appearance-quiet');
  await page.mouse.move(1100,740);await page.waitForTimeout(1100);samples.distant=await live(page);await capture(page,'appearance-distant');
  await writeFile(output+'/app-poses.json',JSON.stringify({host:'BrowserFixture real App + stores; OS and provider substitutes; actor wrapper only observes public stats',box,samples,pixels,commands:fixture.commands.map(command=>command.type),external:fixture.externalRequests},null,2));
  expect(Math.abs(pixels.quiet.x),'Resting face must be centered toward the existing camera').toBeLessThan(.05);
  expect(pixels.right.x-pixels.left.x,'Visible eyes must follow screen left and right').toBeGreaterThan(.08);
  expect(pixels.down.y-pixels.up.y,'Visible eyes must follow screen up and down').toBeGreaterThan(.03);
  expect((samples.quiet as {instance:number}[]).at(-1)!.instance,'Quiet-pointer acceptance must observe the same App actor').toBe((samples.right as {instance:number}[]).at(-1)!.instance);
  const quiet=(samples.quiet as ReturnType<OriginalActor['stats']>[]).at(-1)!;
  expect(Math.abs(quiet.eye[0])+Math.abs(quiet.eye[1]),'Pointer quiet must return visible preview to rest').toBeLessThan(.03);
  const distant=(samples.distant as ReturnType<OriginalActor['stats']>[]).at(-1)!;
  expect(Math.abs(distant.eye[0])+Math.abs(distant.eye[1]),'Distant owned-content response must remain subtle').toBeLessThan(.2);
  expect(fixture.externalRequests).toEqual([]);
 }finally{await fixture.close();}
});
test('onboarding, compact and anchor show the same forward resting character',async({page})=>{
 await observe(page);await page.emulateMedia({reducedMotion:'reduce'});const fixture=await OnboardingFixture.open(page);
 try{await expect(page.getByRole('heading',{name:'Choose your companion'})).toBeVisible();await capture(page,'onboarding-rest');await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByText('Local example · Bundled on this device')).toBeVisible();await capture(page,'onboarding-workspace-rest');await page.setViewportSize({width:360,height:440});await page.getByRole('button',{name:'Switch to compact companion',exact:true}).click();await capture(page,'compact-rest');await fixture.emit({type:'surface',mode:'anchor'});await page.setViewportSize({width:74,height:64});await expect(page.getByRole('button',{name:'Open Glint'})).toBeVisible();await capture(page,'anchor-rest');expect(fixture.external).toEqual([]);}finally{await fixture.close();}
});
