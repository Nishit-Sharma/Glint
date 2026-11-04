import {expect,type Page} from '@playwright/test';

export async function checkChrome(page:Page,selector:string){
 const geometry=await page.locator(selector).evaluate(header=>{
  const box=header.getBoundingClientRect(),style=getComputedStyle(header),grip=getComputedStyle(header,'::before'),left=box.left+parseFloat(style.borderLeftWidth)+parseFloat(style.paddingLeft),width=parseFloat(grip.width),height=parseFloat(grip.height),top=box.top+(box.height-height)/2;
  const controls=[...header.querySelectorAll<HTMLElement>('button,summary,a,input,select,textarea')].filter(control=>control.getClientRects().length).map(control=>{const rect=control.getBoundingClientRect();return {label:control.getAttribute('aria-label')??control.getAttribute('title')??control.textContent?.trim(),left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height,region:getComputedStyle(control).getPropertyValue('-webkit-app-region')};});
  return {region:style.getPropertyValue('-webkit-app-region'),grip:{left,top,width,height,right:left+width,bottom:top+height,region:grip.getPropertyValue('-webkit-app-region')},controls,viewport:{width:innerWidth,height:innerHeight}};
 });
 expect(geometry.region).toBe('drag');expect(geometry.grip.region).toBe('drag');expect(geometry.grip.width).toBe(28);expect(geometry.grip.height).toBe(32);expect(geometry.controls.length).toBeGreaterThan(2);
 for(const control of geometry.controls){expect(control.region,control.label??'control').toBe('no-drag');expect(control.left).toBeGreaterThanOrEqual(geometry.grip.right);expect(control.right).toBeLessThanOrEqual(geometry.viewport.width);expect(control.width).toBeGreaterThan(0);expect(control.height).toBeGreaterThanOrEqual(28);}
 return geometry;
}
