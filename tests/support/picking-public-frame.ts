import {expect,test,type Locator,type Page} from '@playwright/test';
import {createHash} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {settleCapture} from './settled-capture';
import {viewportFit,viewportAdmission} from './public-viewport-geometry';
export type PickingCritical={locator:Locator;kind:'value'|'text';expected:string;name:string};

/** Actual observations only. Preserve geometry before a gate can fail, rather
 * than inferring a clipped edge or a rounding allowance from an area ratio. */
export async function inspectPublicViewport(locator:Locator){
 const observed=await locator.evaluate(async element=>{
  const rect=(value:DOMRectReadOnly)=>({left:value.left,top:value.top,right:value.right,bottom:value.bottom});
  let entry:IntersectionObserverEntry|null=null,intersectionIssue:string|undefined;
  try{entry=await new Promise<IntersectionObserverEntry|null>(resolve=>{const observer=new IntersectionObserver(entries=>{clearTimeout(timer);observer.disconnect();resolve(entries[0]??null);});const timer=setTimeout(()=>{observer.disconnect();resolve(null);},500);observer.observe(element);});if(!entry)intersectionIssue='No intersection observation arrived.';}catch{intersectionIssue='Intersection observation unavailable.';}
  const r=element.getBoundingClientRect();let left=0,top=0,right=innerWidth,bottom=innerHeight,painted=true;const ancestors=[],paintFailures=[];
  for(let current:Element|null=element;current;current=current.parentElement){const style=getComputedStyle(current);if(style.display==='none'||style.visibility!=='visible'||Number(style.opacity)<.99||style.clipPath!=='none'||style.filter!=='none'){painted=false;paintFailures.push({tag:current.tagName,className:String(current.className),display:style.display,visibility:style.visibility,opacity:style.opacity,clipPath:style.clipPath,filter:style.filter});}if(current!==element){const p=current.getBoundingClientRect(),clipsX=/auto|scroll|hidden|clip/.test(style.overflowX),clipsY=/auto|scroll|hidden|clip/.test(style.overflowY);if(clipsX){left=Math.max(left,p.left+current.clientLeft);right=Math.min(right,p.left+current.clientLeft+current.clientWidth);}if(clipsY){top=Math.max(top,p.top+current.clientTop);bottom=Math.min(bottom,p.top+current.clientTop+current.clientHeight);}if(clipsX||clipsY)ancestors.push({tag:current.tagName,className:String(current.className),rect:rect(p),clientLeft:current.clientLeft,clientTop:current.clientTop,clientWidth:current.clientWidth,clientHeight:current.clientHeight,scrollLeft:current.scrollLeft,scrollTop:current.scrollTop,overflowX:style.overflowX,overflowY:style.overflowY,borderLeft:style.borderLeftWidth,borderRight:style.borderRightWidth,borderTop:style.borderTopWidth,borderBottom:style.borderBottomWidth});}}
  const hit=document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2),centerUnoccluded=!!hit&&(hit===element||element.contains(hit)),control=element instanceof HTMLTextAreaElement?{kind:'textarea',valueLength:element.value.length,scrollTop:element.scrollTop,scrollLeft:element.scrollLeft,scrollWidth:element.scrollWidth,scrollHeight:element.scrollHeight,clientWidth:element.clientWidth,clientHeight:element.clientHeight,selectionStart:element.selectionStart,selectionEnd:element.selectionEnd}:undefined;
  return {painted,paintFailures,centerUnoccluded,rect:rect(r),clip:{left,top,right,bottom},viewport:{width:innerWidth,height:innerHeight,devicePixelRatio},ancestors,control,observedAt:performance.now(),intersectionIssue,intersection:entry?{ratio:entry.intersectionRatio,isIntersecting:entry.isIntersecting,boundingClientRect:rect(entry.boundingClientRect),intersectionRect:rect(entry.intersectionRect),rootBounds:entry.rootBounds?rect(entry.rootBounds):null,time:entry.time}:null};
 });
 const fit=viewportFit(observed.rect,observed.clip);return {...observed,fits:fit.fits,fit};
}
async function attachGeometry(name:string,value:unknown){await test.info().attach(name,{body:JSON.stringify(value,null,2),contentType:'application/json'});}
/** No relaxed ratio: the existing half-CSS-pixel edge envelope and strict
 * complete intersection/paint/unoccluded checks are all still required. */
export async function assertPublicViewport(locator:Locator,name:string){
 await expect(locator).toHaveCount(1);await expect(locator).toBeVisible();let latest=await inspectPublicViewport(locator);await attachGeometry(name+'-geometry-initial',latest);
 try{await expect.poll(async()=>{latest=await inspectPublicViewport(locator);return viewportAdmission(latest.fit,latest.intersection?.ratio,latest.painted,latest.centerUnoccluded);},{message:'Public anchor must be completely intersecting, painted, unoccluded and geometrically contained; inspect attached observed rectangles.'}).toBe(true);}finally{await attachGeometry(name+'-geometry-final',latest);}
 return latest;
}
/** A single normal center reveal precedes the shared gate. No retry scrolling,
 * style override, replacement DOM or reconstruction of missing geometry. */
export async function revealPublicViewport(page:Page,locator:Locator,name:string){await settleCapture(page);await expect(locator).toHaveCount(1);await expect(locator).toBeVisible();await locator.evaluate(element=>element.scrollIntoView({block:'center',inline:'nearest',behavior:'auto'}));await settleCapture(page);return assertPublicViewport(locator,name);}
/** Real viewport PNG; never CSS/reveal overrides or tall-element/full-page shots.
 * Pixel scope is the named small anchor plus declared fully visible literals. */
export async function pickingPublicFrame(page:Page,anchor:Locator,name:string,critical:PickingCritical[]=[]){
 const viewport=page.viewportSize();expect(viewport).not.toBeNull();expect([[1080,800],[360,640]]).toContainEqual([viewport!.width,viewport!.height]);await expect(page.locator('[data-runtime-scope="whole-surface"]:visible')).toHaveCount(1);const anchorGeometry=await revealPublicViewport(page,anchor,name);const literals=[];
 for(const check of critical){if(check.kind==='value')await expect(check.locator).toHaveValue(check.expected);else await expect(check.locator).toHaveJSProperty('textContent',check.expected);await expect(check.locator).toHaveCount(1);await expect(check.locator).toBeVisible();const box=await inspectPublicViewport(check.locator);await attachGeometry(name+'-literal-'+check.name,box);expect(box.painted).toBe(true);expect(box.centerUnoccluded).toBe(true);expect(box.fits,JSON.stringify(box)).toBe(true);const metrics=await check.locator.evaluate((element,kind)=>{const style=getComputedStyle(element);if(kind==='value'&&element instanceof HTMLInputElement){const context=document.createElement('canvas').getContext('2d')!;context.font=style.font;return {fullValueFits:context.measureText(element.value).width<=element.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)+.5,scrollLeft:element.scrollLeft,whiteSpace:style.whiteSpace};}return {fullValueFits:element.scrollWidth<=element.clientWidth+1&&element.scrollHeight<=element.clientHeight+1,scrollLeft:element.scrollLeft,whiteSpace:style.whiteSpace};},check.kind);expect(metrics.fullValueFits,check.name).toBe(true);expect(metrics.scrollLeft).toBeLessThanOrEqual(1);if(check.kind==='text'&&(/^\s|\s$| {2}/.test(check.expected)))expect(['pre','pre-wrap','break-spaces']).toContain(metrics.whiteSpace);literals.push({name:check.name,kind:check.kind,expected:check.expected,geometry:box,metrics});}
 const path=test.info().outputPath('frames',name+'.png');await mkdir(dirname(path),{recursive:true});const bytes=await page.screenshot({path,fullPage:false});await test.info().attach(name,{path,contentType:'image/png'});return {name,path,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,viewport,anchorGeometry,literals,scope:'Actual viewport after real reveal; assertions cover named small anchor/literals only, not all offscreen content.'};
}
