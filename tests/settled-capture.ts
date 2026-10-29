import {expect,type Page,type Locator} from '@playwright/test';

/** Visibility alone does not mean the authentic reveal has handed off its pixels. */
export async function settleCapture(page:Page){
 await expect(page.locator('[data-runtime-scope="whole-surface"]:visible').first()).toHaveAttribute('data-surface-reveal',/^(settled|skipped|cancelled)$/);
 await expect(page.locator('.t-gen,.t-tig')).toHaveCount(0);
 await expect(page.getByText('Opening interactive answer…',{exact:true})).toHaveCount(0);
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].filter(image=>image.getClientRects().length>0).map(image=>image.decode().catch(()=>{})));await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
}

/** Explicit manual inspection only. Do not use this to prove a product auto-reveal. */
export async function revealForInspection(page:Page,target:Locator){
 await expect(target).toHaveCount(1);await expect(target).toBeVisible();
 const measure=()=>target.evaluate(element=>{
  const rect=(value:DOMRect)=>({left:value.left,top:value.top,right:value.right,bottom:value.bottom,width:value.width,height:value.height}),bounds=element.getBoundingClientRect();
  let left=0,top=0,right=innerWidth,bottom=innerHeight,painted=true;const scrollports=[];
  for(let current:Element|null=element;current;current=current.parentElement){const style=getComputedStyle(current);if(style.display==='none'||style.visibility!=='visible'||Number(style.opacity)<.99||style.clipPath!=='none'||style.filter!=='none')painted=false;if(current===element)continue;const parent=current.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,parent.left+current.clientLeft);right=Math.min(right,parent.left+current.clientLeft+current.clientWidth);}if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,parent.top+current.clientTop);bottom=Math.min(bottom,parent.top+current.clientTop+current.clientHeight);}if(/auto|scroll|hidden|clip/.test(style.overflowX+style.overflowY))scrollports.push({tag:current.tagName,role:current.getAttribute('role'),label:current.getAttribute('aria-label'),rect:rect(parent),clientWidth:current.clientWidth,clientHeight:current.clientHeight,scrollLeft:current.scrollLeft,scrollTop:current.scrollTop,overflowX:style.overflowX,overflowY:style.overflowY});}
  const hit=document.elementFromPoint((bounds.left+bounds.right)/2,(bounds.top+bounds.bottom)/2);
  return {rect:rect(bounds),clip:{left,top,right,bottom},edgeClipping:{left:Math.max(0,left-bounds.left),top:Math.max(0,top-bounds.top),right:Math.max(0,bounds.right-right),bottom:Math.max(0,bounds.bottom-bottom)},viewport:{width:innerWidth,height:innerHeight,devicePixelRatio},painted,centerUnoccluded:!!hit&&(hit===element||element.contains(hit)),scrollports};
 });
 const before=await measure();
 // Conditional nearest-edge scrolling can leave a fractional edge intersection.
 // Center explicitly, then retain the exact ratio1 requirement and record bounds.
 await target.evaluate(element=>element.scrollIntoView({block:'center',inline:'center',behavior:'instant'}));await settleCapture(page);
 const after=await measure(),diagnostic=JSON.stringify({purpose:'Explicit manual inspection; strict viewport ratio unchanged',before,after});
 await expect(target,diagnostic).toBeInViewport({ratio:1});expect(after.painted,diagnostic).toBe(true);expect(after.centerUnoccluded,diagnostic).toBe(true);
 return {before,after};
}
