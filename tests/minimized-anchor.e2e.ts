import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {BrowserFixture} from './browser-fixture';

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
   expect(geometry.shell.width).toBeGreaterThanOrEqual(24);expect(geometry.shell.height).toBeGreaterThanOrEqual(24);
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
