import {expect,type Locator} from '@playwright/test';
export async function assertRevealed(heading:Locator){
 await expect(heading).toBeFocused();
 // Record actual geometry before the strict viewport assertion, so any failure can
 // distinguish a clipped ancestor from a fractional intersection-ratio result.
 const box=await heading.evaluate(element=>{
  const r=element.getBoundingClientRect(),ancestors:{left:number;top:number;right:number;bottom:number;overflowX:string;overflowY:string;scrollTop:number;scrollLeft:number}[]=[];
  let left=0,top=0,right=innerWidth,bottom=innerHeight;
  for(let parent=element.parentElement;parent;parent=parent.parentElement){const style=getComputedStyle(parent),p=parent.getBoundingClientRect(),clip={left:p.left+parent.clientLeft,top:p.top+parent.clientTop,right:p.left+parent.clientLeft+parent.clientWidth,bottom:p.top+parent.clientTop+parent.clientHeight,overflowX:style.overflowX,overflowY:style.overflowY,scrollTop:parent.scrollTop,scrollLeft:parent.scrollLeft};if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,clip.left);right=Math.min(right,clip.right);}if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,clip.top);bottom=Math.min(bottom,clip.bottom);}if(/auto|scroll|hidden|clip/.test(style.overflowX+' '+style.overflowY))ancestors.push(clip);}
  return {fits:r.width>0&&r.height>0&&r.left>=left-.5&&r.right<=right+.5&&r.top>=top-.5&&r.bottom<=bottom+.5,rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height},clip:{left,top,right,bottom},viewport:{width:innerWidth,height:innerHeight},ancestors};
 });
 expect(box.fits,JSON.stringify(box)).toBe(true);
 await expect(heading).toBeInViewport({ratio:1});
}
