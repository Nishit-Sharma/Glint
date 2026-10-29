import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {BrowserFixture} from './browser-fixture';
test.use({viewport:{width:360,height:440},deviceScaleFactor:1,reducedMotion:'no-preference'});
test('a visible static roster beyond sixteen slots keeps the real exit sampler free of mascot pixels',async({page})=>{
 await mkdir('evidence/onboarding',{recursive:true});
 const fixture=await BrowserFixture.open(page,'companion');let release=()=>{};
 try{
  await expect(page.locator('.compact-companion')).toHaveAttribute('data-surface-reveal','settled');await expect(page.locator('.t-gen')).toHaveCount(0);
  const regions=await page.evaluate(async()=>{
   const root=document.getElementById('root')!;
   for(let index=0;index<54;index++){const slot=document.createElement('span');slot.className='character-slot';slot.dataset.characterRender='static';Object.assign(slot.style,{position:'fixed',left:(10+index%6*52)+'px',top:(90+Math.floor(index/6)*50)+'px',width:'38px',height:'38px',zIndex:'10000'});if(index>=24)slot.hidden=true;const image=new Image();image.src='/src/bot-thumbnails/soup-sage-curious.png';slot.append(image);root.append(slot);await image.decode();}
   const original=CanvasRenderingContext2D.prototype.drawImage;Reflect.set(window,'__exitSamplerInputs',[]);
   CanvasRenderingContext2D.prototype.drawImage=function(source:CanvasImageSource,...coordinates:number[]){if(source instanceof HTMLImageElement&&source.closest('[data-presentation-exit-snapshot]'))Reflect.get(window,'__exitSamplerInputs').push(source.src);return Reflect.apply(original,this,[source,...coordinates]);};
   return [...root.querySelectorAll<HTMLElement>('.character-slot[data-character-render]')].filter(slot=>!slot.hidden).map(slot=>{const rect=slot.getBoundingClientRect();return {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom};}).filter(rect=>rect.right>0&&rect.bottom>0&&rect.left<innerWidth&&rect.top<innerHeight);
  });
  expect(regions.length).toBeGreaterThan(16);
  fixture.captureExitSnapshot=async()=>`data:image/png;base64,${(await page.screenshot({animations:'allow',caret:'initial'})).toString('base64')}`;
  fixture.exitBarrier=new Promise<void>(resolve=>release=resolve);
  await page.getByRole('button',{name:'Collapse to edge anchor',exact:true}).click();await expect(page.locator('[data-presentation-exit-effect] .t-tig')).toHaveCount(1);
  const result=await page.evaluate(async regions=>{
   const inputs:string[]=Reflect.get(window,'__exitSamplerInputs'),image=new Image();image.src=inputs[0];await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d')!;context.drawImage(image,0,0);const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;let nonzero=0,covered=0;
   for(const region of regions)for(let y=Math.max(0,Math.ceil(region.top));y<Math.min(canvas.height,Math.floor(region.bottom));y++)for(let x=Math.max(0,Math.ceil(region.left));x<Math.min(canvas.width,Math.floor(region.right));x++){covered++;const offset=(y*canvas.width+x)*4;if(pixels[offset]||pixels[offset+1]||pixels[offset+2]||pixels[offset+3])nonzero++;}
   return {visibleSlots:regions.length,covered,nonzero,samplerReads:inputs.length,state:document.documentElement.dataset.presentationExit};
  },regions);
  expect(result.covered).toBeGreaterThan(1000);expect(result.samplerReads).toBeGreaterThan(0);expect(result.nonzero).toBe(0);await writeFile('evidence/onboarding/static-avatar-exit.json',JSON.stringify(result,null,2));await page.screenshot({path:'evidence/onboarding/exit-many-avatars.png'});
  expect(fixture.externalRequests).toEqual([]);
 }finally{release();await fixture.close();}
});
