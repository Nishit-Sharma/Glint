import {expect,type Page,type Locator} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {OriginalActor} from '../../src/renderer/src/character-original/actor-runtime';
declare global{interface Window{__motionActors:{actor:OriginalActor;canvas:HTMLCanvasElement;shape:string}[]}}
export const evidence=()=>{const path=process.env.OWNED_PUBLIC_EVIDENCE;if(!path)throw Error('Owned evidence path is required.');return path;};
export async function json(name:string,value:unknown){await writeFile(join(evidence(),name+'.json'),JSON.stringify(value,null,2)+'\n');}
export async function frame(page:Page,name:string){await mkdir(join(evidence(),'frames'),{recursive:true});await page.screenshot({path:join(evidence(),'frames',name+'.png'),animations:'allow',caret:'initial'});}
export async function observe(page:Page){
 await page.route('**/character-original/actor-runtime.js*',async route=>{const response=await route.fetch(),source=await response.text();const rewritten=source.replace(/function mountOriginal\s*\(/,'function observedOriginalMount(').replace(/export \{\s*mountOriginal\s*\};?/, '');await route.fulfill({response,body:rewritten+'\nexport function mountOriginal(...args){const actor=observedOriginalMount(...args);(window.__motionActors??=[]).push({actor,canvas:args[0],shape:args[1].shape});return actor;}'});});
 await page.reload();
}
export async function states(page:Page){return page.evaluate(()=>window.__motionActors.map(({actor,canvas,shape},instance)=>({...actor.stats(),shape,instance,connected:canvas.isConnected})));}
export async function live(page:Page){return (await states(page)).filter(actor=>!actor.destroyed&&actor.connected);}
export async function webgl(page:Page,name:string){
 const contexts=await page.locator('[data-character-render="live"] canvas').evaluateAll(canvases=>canvases.map(canvas=>{const gl=(canvas as HTMLCanvasElement).getContext('webgl2');return {connected:canvas.isConnected,width:(canvas as HTMLCanvasElement).width,height:(canvas as HTMLCanvasElement).height,webgl2:!!gl,lost:gl?.isContextLost()??null,renderer:gl&&!gl.isContextLost()?gl.getParameter(gl.RENDERER):null,version:gl&&!gl.isContextLost()?gl.getParameter(gl.VERSION):null,controlledContextLoss:!!gl?.getExtension('WEBGL_lose_context')};}));
 const renders=await page.locator('[data-character-render]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-character-render')));await json(name,{contexts,usableWebgl2:contexts.some(context=>context.webgl2&&!context.lost),renders,headlessFixture:true,claim:'Records this browser backend only; no physical device ceiling or native smoothness proof.'});return contexts;
}
export async function windowOfMotion(page:Page,name:string,ms=16000){
 const samples:Awaited<ReturnType<typeof states>>[]=[],start=Date.now();await frame(page,name+'-start');
 let middle=false;while(Date.now()-start<ms){samples.push(await states(page));if(!middle&&Date.now()-start>=ms/2){middle=true;await frame(page,name+'-middle');}await page.waitForTimeout(250);}
 samples.push(await states(page));await frame(page,name+'-end');await json(name,{elapsed:Date.now()-start,samples});return samples;
}
export async function quietImageState(page:Page,selector:string){return page.locator(selector).evaluateAll(nodes=>nodes.map(node=>{const image=node as HTMLImageElement,slot=image.closest('.character-slot')!,bounds=slot.getBoundingClientRect(),style=getComputedStyle(image);return {enabled:image.dataset.companionMotion,visible:image.dataset.motionVisible,animation:style.animationName,play:style.animationPlayState,leafTransform:style.transform,animationTime:image.getAnimations()[0]?.currentTime??null,slotTransform:getComputedStyle(slot).transform,bounds:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height}};}));}
export async function expectStill(page:Page){await expect.poll(async()=>(await live(page)).every(actor=>!actor.active&&!actor.idle&&actor.lift===0)).toBe(true);const before=await live(page);await page.waitForTimeout(400);const after=await live(page);expect(after.map(a=>a.frames)).toEqual(before.map(a=>a.frames));expect(after.every(a=>!a.active&&!a.idle&&a.lift===0)).toBe(true);}


async function focusRing(card:Locator){return card.evaluate(node=>{
 const element=node as HTMLElement,style=getComputedStyle(element),rect=element.getBoundingClientRect(),width=parseFloat(style.outlineWidth)||0,offset=parseFloat(style.outlineOffset)||0,extent=Math.max(0,width+offset);
 const ring={left:rect.left-extent,top:rect.top-extent,right:rect.right+extent,bottom:rect.bottom+extent};let left=0,top=0,right=innerWidth,bottom=innerHeight,painted=true;
 for(let current:HTMLElement|null=element;current;current=current.parentElement){
  const css=getComputedStyle(current);if(css.display==='none'||css.visibility!=='visible'||Number(css.opacity)<.99)painted=false;if(current===element)continue;
  const bounds=current.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(css.overflowX)){left=Math.max(left,bounds.left+current.clientLeft);right=Math.min(right,bounds.left+current.clientLeft+current.clientWidth);}if(/auto|scroll|hidden|clip/.test(css.overflowY)){top=Math.max(top,bounds.top+current.clientTop);bottom=Math.min(bottom,bounds.top+current.clientTop+current.clientHeight);}
 }
 const footer=element.closest('.companion-choice')!.querySelector('.choice-footer')!.getBoundingClientRect(),overlapsX=ring.right>footer.left&&ring.left<footer.right;
 return {focusVisible:element.matches(':focus-visible'),painted,outline:{width,offset,style:style.outlineStyle},ring,clip:{left,top,right,bottom},clipped:{left:Math.max(0,left-ring.left),top:Math.max(0,top-ring.top),right:Math.max(0,ring.right-right),bottom:Math.max(0,ring.bottom-bottom)},footer:{top:footer.top,bottom:footer.bottom},footerOverlap:overlapsX?Math.max(0,Math.min(ring.bottom,footer.bottom)-Math.max(ring.top,footer.top)):0};
});}

export async function verifyNarrowFocus(page:Page,shapes:Locator,hop:boolean){
 const first=shapes.getByRole('radio',{name:'Bao',exact:true});await first.focus();await page.keyboard.press('Home');const cards=[];
  for(const [index,[label,shape]] of [['Bao','soup'],['Nori','onigiri'],['Moss','mushroom'],['Lumi','star'],['Miso','sprout']].entries()){
   if(index)await page.keyboard.press('ArrowRight');const card=shapes.getByRole('radio',{name:label,exact:true});await expect(card).toBeFocused();await expect(card).toBeChecked();await expect(card.locator('[data-character-state="live"]')).toHaveCount(1);
   const ring=await focusRing(card);cards.push({shape,ring});await json('narrow-picker-focus-rings',cards);
   expect(ring.focusVisible).toBe(true);expect(ring.painted).toBe(true);expect(ring.outline.style).toBe('solid');expect(ring.outline.width).toBeGreaterThanOrEqual(3);expect(ring.outline.offset).toBeGreaterThanOrEqual(5);
   expect(ring.clipped).toEqual({left:0,top:0,right:0,bottom:0});expect(ring.footerOverlap).toBe(0);
   const before=await card.boundingBox();if(hop)await expect.poll(async()=>(await live(page)).some(a=>a.shape===shape&&a.lift>.02)).toBe(true);const after=await card.boundingBox();expect(after).toEqual(before);Object.assign(cards[cards.length-1],{before,after});await frame(page,'narrow-focus-'+shape);
  }
 return cards;
}
