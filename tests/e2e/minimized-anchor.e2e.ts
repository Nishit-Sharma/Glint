import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {BrowserFixture} from '../support/browser-fixture';
import {CHARACTER_SHAPES,DEFAULT_CHARACTER} from '../../src/shared/character-catalog';
import {observe} from '../support/companion-motion-public-helpers';

test('the minimized shell and portrait stay square and centered in both native anchor footprints',async({page})=>{
 const evidence=process.env.OWNED_PUBLIC_EVIDENCE;if(!evidence)throw Error('Owned evidence path is required.');
 await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:74,height:64});
 const fixture=await BrowserFixture.open(page,'anchor'),anchor=page.getByRole('button',{name:'Open Glint',exact:true}),states=[];
 try{
  await expect(anchor).toBeVisible();
  for(const viewport of [{width:74,height:64},{width:28,height:36}]){
   await page.setViewportSize(viewport);
   await expect.poll(()=>anchor.evaluate(element=>{const box=element.getBoundingClientRect();return Math.abs(box.width-box.height);})).toBe(0);
   await anchor.focus();await page.keyboard.press('ArrowLeft');
   const geometry=await anchor.evaluate(element=>{
    const box=element.getBoundingClientRect(),portrait=element.querySelector('.character-portrait')!.getBoundingClientRect(),style=getComputedStyle(element),extent=Math.max(0,parseFloat(style.outlineWidth)+parseFloat(style.outlineOffset));
    return {shell:{width:box.width,height:box.height},outer:{left:box.left,right:innerWidth-box.right,top:box.top,bottom:innerHeight-box.bottom},portrait:{width:portrait.width,height:portrait.height,left:portrait.left-box.left,right:box.right-portrait.right,top:portrait.top-box.top,bottom:box.bottom-portrait.bottom},radii:[style.borderTopLeftRadius,style.borderTopRightRadius,style.borderBottomLeftRadius,style.borderBottomRightRadius],focusVisible:element.matches(':focus-visible'),outline:style.outlineStyle,focusClearance:Math.min(box.left,innerWidth-box.right,box.top,innerHeight-box.bottom)-extent,scroll:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},viewport:{width:innerWidth,height:innerHeight}};
   });
   states.push(geometry);await writeFile(join(evidence,'minimized-anchor-geometry.json'),JSON.stringify({mode:'actual renderer with browser-only host fixture',states},null,2)+'\n');
   expect(geometry.shell.width).toBe(viewport.width===74?60:24);expect(geometry.shell.height).toBeGreaterThanOrEqual(24);
   for(const clearance of Object.values(geometry.outer))expect(clearance).toBeGreaterThanOrEqual(2);
   expect(Math.abs(geometry.outer.left-geometry.outer.right)).toBeLessThanOrEqual(.5);expect(Math.abs(geometry.outer.top-geometry.outer.bottom)).toBeLessThanOrEqual(.5);
   expect(geometry.portrait.width).toBe(geometry.portrait.height);expect(geometry.portrait.left).toBeGreaterThanOrEqual(2);expect(geometry.portrait.top).toBeGreaterThanOrEqual(2);
   expect(Math.abs(geometry.portrait.left-geometry.portrait.right)).toBeLessThanOrEqual(.5);expect(Math.abs(geometry.portrait.top-geometry.portrait.bottom)).toBeLessThanOrEqual(.5);
   expect(new Set(geometry.radii).size).toBe(1);expect(geometry.focusVisible).toBe(true);expect(geometry.outline).toBe('solid');expect(geometry.focusClearance).toBeGreaterThanOrEqual(0);
   expect(geometry.scroll.width).toBe(viewport.width);expect(geometry.scroll.height).toBe(viewport.height);
   await page.screenshot({path:join(evidence,`minimized-anchor-${viewport.width}x${viewport.height}.png`)});
  }
  await page.keyboard.press('ArrowDown');expect(fixture.commands.filter(command=>command.type==='source.choose')).toHaveLength(1);
  await anchor.click();await expect(page.locator('.anchor-wrap')).toBeHidden();expect(fixture.commands.filter(command=>command.type==='surface.expand')).toHaveLength(1);
  expect(fixture.modelInvocations).toHaveLength(0);expect(fixture.externalRequests).toEqual([]);
 }finally{await fixture.close();}
});


test('anchor framing keeps every saved silhouette inside its canvas at rest and extreme gaze, with aligned fallback and adornments',async({page})=>{
 const evidence=process.env.OWNED_PUBLIC_EVIDENCE;if(!evidence)throw Error('Owned evidence path is required.');
 await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:74,height:64});
 const fixture=await BrowserFixture.open(page,'anchor');await observe(page);const samples=[];
 try{
  for(const [revision,shape] of CHARACTER_SHAPES.entries()){
   await fixture.preferences.update({expectedRevision:revision,profile:{...DEFAULT_CHARACTER,look:{...DEFAULT_CHARACTER.look,shape:shape.id,motion:false,glasses:'round',accessory:'scarf'}}});await page.reload();
   const canvas=page.locator('.anchor canvas');await expect(canvas).toBeVisible();
   for(const viewport of [{width:74,height:64},{width:28,height:36}]){
    await page.setViewportSize(viewport);await expect.poll(()=>canvas.evaluate(node=>(node as HTMLCanvasElement).width)).toBe(viewport.width===74?54:18);
    for(const pose of [[0,0],[-1,-1],[1,1]] as const){
     const sample=await page.evaluate(async({shape,pose})=>{
      const entry=window.__motionActors.find(entry=>entry.canvas.isConnected&&!entry.actor.stats().destroyed)!;entry.actor.pose(pose[0],pose[1]);
      const canvas=entry.canvas,image=new Image();image.src=canvas.toDataURL();await image.decode();const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;const context=copy.getContext('2d')!;context.drawImage(image,0,0);const {data}=context.getImageData(0,0,copy.width,copy.height);
      let left=copy.width,right=-1,top=copy.height,bottom=-1,count=0;
      for(let y=0;y<copy.height;y++)for(let x=0;x<copy.width;x++)if(data[(y*copy.width+x)*4+3]>180){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);count++;}
      return {shape,pose,width:copy.width,height:copy.height,body:{left,right,top,bottom,count},adornmentScale:getComputedStyle(document.querySelector('.anchor .character-adornment')!).scale};
     },{shape:shape.id,pose});samples.push(sample);await writeFile(join(evidence,'anchor-silhouette-bounds.json'),JSON.stringify({samples},null,2)+'\n');
     expect(sample.body.count).toBeGreaterThan(10);expect(sample.body.left).toBeGreaterThan(0);expect(sample.body.top).toBeGreaterThan(0);expect(sample.body.right).toBeLessThan(sample.width-1);expect(sample.body.bottom).toBeLessThan(sample.height-1);expect(sample.adornmentScale).toBe('0.94');
    }
   }
   await page.setViewportSize({width:74,height:64});await page.evaluate(()=>window.__motionActors.find(entry=>entry.canvas.isConnected)!.actor.pose(0,0));await page.screenshot({path:join(evidence,`anchor-shape-${shape.id}.png`)});
  }
  const current=await fixture.preferences.read();if(current.kind!=='available')throw Error('Synthetic appearance is unavailable.');await fixture.preferences.update({expectedRevision:current.current.revision,profile:{...current.current.profile,look:{...current.current.profile.look,motion:true}}});await page.reload();await expect(page.locator('.anchor canvas')).toBeVisible();
  await page.locator('.anchor canvas').evaluate(node=>(node as HTMLCanvasElement).getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext());
  await expect(page.locator('.anchor [data-character-render=static]')).toHaveCount(1);const fallback=page.locator('.anchor .character-slot>img');await expect(fallback).toBeVisible();await expect(fallback).toHaveCSS('scale','0.94');await expect(fallback).toHaveAttribute('data-companion-motion','quiet');
  for(const viewport of [{width:74,height:64},{width:28,height:36}]){await page.setViewportSize(viewport);await expect(fallback).toHaveCSS('transform-origin',viewport.width===74?'27px 27px':'9px 9px');}
  await page.setViewportSize({width:74,height:64});
  await page.screenshot({path:join(evidence,'anchor-fallback.png')});await writeFile(join(evidence,'anchor-silhouette-bounds.json'),JSON.stringify({mode:'actual renderer and WebGL pixels with browser-only host fixture; alpha > 180 excludes floor shadow',samples},null,2)+'\n');
  expect(fixture.modelInvocations).toHaveLength(0);expect(fixture.externalRequests).toEqual([]);
 }finally{await fixture.close();}
});
