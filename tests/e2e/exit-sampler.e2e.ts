import {test,expect,type Page} from '@playwright/test';
import {BrowserFixture} from '../support/browser-fixture';

test.use({browserName:'chromium',viewport:{width:360,height:440},deviceScaleFactor:1.25,reducedMotion:'no-preference'});

async function ready(page:Page){const fixture=await BrowserFixture.open(page,'companion');await expect(page.locator('.compact-companion')).toHaveAttribute('data-surface-reveal','settled');await expect(page.locator('.t-gen')).toHaveCount(0);return fixture;}

test('collapse excludes every leased actor rectangle from the actual image sampler',async({page})=>{
 const fixture=await BrowserFixture.open(page,'companion');let release=()=>{};
 try{
  await expect(page.locator('.compact-companion')).toHaveAttribute('data-surface-reveal','settled');
  await expect(page.locator('.t-gen')).toHaveCount(0);
  const regions=await page.evaluate(()=>{
   const root=document.getElementById('root')!;
   for(const [index,box] of [[12.25,120.5,52.5,48.25],[40.5,142.25,60.25,50.5],[-12.5,220.25,50.5,52.5]].entries()){
    const slot=document.createElement('span');slot.className='character-slot';slot.dataset.characterRender=index===2?'static':'live';slot.dataset.samplerFixture=String(index);
    Object.assign(slot.style,{position:'fixed',left:box[0]+'px',top:box[1]+'px',width:box[2]+'px',height:box[3]+'px',background:['#ff00e7','#00ff64','#ff5000'][index],zIndex:'10000'});root.append(slot);
   }
   const regions=[...root.querySelectorAll<HTMLElement>('.character-slot[data-character-render]')].map(slot=>{const r=slot.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};}).filter(r=>r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight);
   const original=CanvasRenderingContext2D.prototype.drawImage;
   Reflect.set(window,'__exitSamplerInputs',[]);
   CanvasRenderingContext2D.prototype.drawImage=function(source:CanvasImageSource,...coordinates:number[]){
    if(source instanceof HTMLImageElement&&source.closest('[data-presentation-exit-snapshot]'))Reflect.get(window,'__exitSamplerInputs').push(source.src);
    return Reflect.apply(original,this,[source,...coordinates]);
   };
   return regions;
  });
  fixture.captureExitSnapshot=async()=>`data:image/png;base64,${(await page.screenshot({animations:'allow',caret:'initial'})).toString('base64')}`;
  fixture.exitBarrier=new Promise<void>(resolve=>release=resolve);
  await page.getByRole('button',{name:'Collapse to edge anchor',exact:true}).click();
  await expect(page.locator('[data-presentation-exit-snapshot] .t-tig')).toHaveCount(1);
  const result=await page.evaluate(async regions=>{
   const inputs:string[]=Reflect.get(window,'__exitSamplerInputs'),source=inputs[0];
   if(!source)throw Error('The real upstream image sampler did not read the snapshot.');
   const image=new Image();image.src=source;await image.decode();
   const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
   const context=canvas.getContext('2d')!;context.drawImage(image,0,0);
   const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;let nonzero=0,covered=0;
   for(const region of regions){
    const left=Math.max(0,Math.ceil(region.left*canvas.width/innerWidth)),right=Math.min(canvas.width,Math.floor(region.right*canvas.width/innerWidth));
    const top=Math.max(0,Math.ceil(region.top*canvas.height/innerHeight)),bottom=Math.min(canvas.height,Math.floor(region.bottom*canvas.height/innerHeight));
    for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){covered++;const p=(y*canvas.width+x)*4;if(pixels[p]||pixels[p+1]||pixels[p+2]||pixels[p+3])nonzero++;}
   }
   return {nonzero,covered,reads:inputs.length};
  },regions);
  expect(result.covered).toBeGreaterThan(1000);expect(result.reads).toBeGreaterThan(0);
  expect(result.nonzero,'Semantic actor pixels reached the actual upstream sampler input').toBe(0);
  const ordinary=page.locator('[data-presentation-exit-ordinary]');await expect(ordinary).toHaveCount(1);
  expect(await ordinary.evaluate(node=>!node.closest('[data-presentation-exit-effect]'))).toBe(true);
  expect(fixture.externalRequests).toEqual([]);
 }finally{release();await fixture.close();}
});

test('collapse keeps the rendered effect transparent over every leased actor',async({page},info)=>{
 const fixture=await ready(page);let release=()=>{};
 try{
  const regions=await page.evaluate(()=>{
   const root=document.getElementById('root')!;
   for(const [index,box] of [[12.25,120.5,52.5,48.25],[40.5,142.25,60.25,50.5],[-12.5,220.25,50.5,52.5]].entries()){
    const slot=document.createElement('span');slot.className='character-slot';slot.dataset.characterRender=index===2?'static':'live';
    Object.assign(slot.style,{position:'fixed',left:box[0]+'px',top:box[1]+'px',width:box[2]+'px',height:box[3]+'px',background:['#ff00e7','#00ff64','#ff5000'][index],zIndex:'10000'});root.append(slot);
   }
   return [...root.querySelectorAll<HTMLElement>('.character-slot[data-character-render]')].map(slot=>{const r=slot.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom};}).filter(r=>r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight);
  });
  expect(regions.length).toBeGreaterThan(0);
  fixture.captureExitSnapshot=async()=>`data:image/png;base64,${(await page.screenshot({animations:'allow',caret:'initial'})).toString('base64')}`;
  fixture.exitBarrier=new Promise<void>(resolve=>release=resolve);
  await page.getByRole('button',{name:'Collapse to edge anchor',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-presentation-exit','running');
  await expect(page.locator('[data-presentation-exit-effect] .t-tig')).toHaveCount(1);
  const started=await page.evaluate(()=>{
   if(getComputedStyle(document.getElementById('root')!).visibility!=='hidden')throw Error('The original renderer still paints during exit.');
   document.querySelector<HTMLElement>('[data-presentation-exit-ordinary]')!.style.visibility='hidden';
   document.documentElement.style.background=document.body.style.background='transparent';
   return performance.now();
  });
  const frames=[];
  for(const target of [100,350,650,950,1250,1600]){
   await page.evaluate(({started,target})=>new Promise<void>(resolve=>{const tick=()=>{if(performance.now()-started>=target)resolve();else requestAnimationFrame(tick);};requestAnimationFrame(tick);}),{started,target});
   const png=await page.screenshot({path:info.outputPath(`exit-effect-${target}.png`),omitBackground:true,animations:'allow',caret:'initial'});
   const frame=await page.evaluate(async({source,regions,started})=>{
    const image=new Image();image.src=source;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const context=canvas.getContext('2d')!;context.drawImage(image,0,0);
    const pixels=context.getImageData(0,0,canvas.width,canvas.height).data,actors=new Uint8Array(canvas.width*canvas.height);let actorNonzero=0,actorPixels=0,outsideNonzero=0;
    for(const region of regions){
     const left=Math.max(0,Math.ceil(region.left*canvas.width/innerWidth)+1),right=Math.min(canvas.width,Math.floor(region.right*canvas.width/innerWidth)-1);
     const top=Math.max(0,Math.ceil(region.top*canvas.height/innerHeight)+1),bottom=Math.min(canvas.height,Math.floor(region.bottom*canvas.height/innerHeight)-1);
     for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){actorPixels++;if(pixels[(y*canvas.width+x)*4+3])actorNonzero++;}
     const outerLeft=Math.max(0,Math.floor(region.left*canvas.width/innerWidth)-2),outerRight=Math.min(canvas.width,Math.ceil(region.right*canvas.width/innerWidth)+2);
     const outerTop=Math.max(0,Math.floor(region.top*canvas.height/innerHeight)-2),outerBottom=Math.min(canvas.height,Math.ceil(region.bottom*canvas.height/innerHeight)+2);
     for(let y=outerTop;y<outerBottom;y++)actors.fill(1,y*canvas.width+outerLeft,y*canvas.width+outerRight);
    }
    for(let pixel=0;pixel<actors.length;pixel++)if(!actors[pixel]&&pixels[pixel*4+3])outsideNonzero++;
    return {elapsed:Math.round(performance.now()-started),state:document.documentElement.dataset.presentationExit,actorNonzero,actorPixels,outsideNonzero};
   },{source:`data:image/png;base64,${png.toString('base64')}`,regions,started});
   frames.push({target,...frame});
  }
  await info.attach('exit-effect-raster-alpha',{body:JSON.stringify(frames,null,2),contentType:'application/json'});
  expect(frames.every(frame=>frame.state==='running')).toBe(true);
  expect(frames.every(frame=>frame.actorPixels>1000&&frame.outsideNonzero>0),'Each frame must contain real effect output outside the leased actors').toBe(true);
  expect(frames.map(frame=>frame.actorNonzero),'The rendered upstream effect painted inside leased actor rectangles').toEqual([0,0,0,0,0,0]);
  expect(fixture.externalRequests).toEqual([]);
 }finally{release();await fixture.close();}
});

for(const change of ['scroll','move-return','replace','paint-expansion','resize'])test(`capture coverage stays invalid after ${change}`,async({page})=>{
 const fixture=await ready(page);let release=()=>{},captured=()=>{};const held=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>captured=resolve);
 try{
  fixture.captureExitSnapshot=async()=>{const png=`data:image/png;base64,${(await page.screenshot({animations:'allow'})).toString('base64')}`;captured();await held;return png;};
  await page.getByRole('button',{name:'Collapse to edge anchor',exact:true}).click();await started;
  expect(await page.locator('#root').evaluate(el=>getComputedStyle(el).visibility)).toBe('visible');
  if(change==='resize')await page.setViewportSize({width:370,height:450});
  else await page.evaluate(change=>{
   const slot=document.querySelector<HTMLElement>('.character-slot[data-character-render]')!,root=document.getElementById('root')!;
   if(change==='scroll')window.dispatchEvent(new Event('scroll'));
   if(change==='move-return'){const old=slot.style.left;slot.style.left='7px';slot.style.left=old;}
   if(change==='replace'){const replacement=document.createElement('span');replacement.className='character-slot';replacement.dataset.characterRender='static';slot.replaceWith(replacement);}
   if(change==='paint-expansion'){root.style.filter='blur(3px)';root.style.filter='';}
  },change);
  release();await expect(page.getByRole('button',{name:'Open Glint',exact:true})).toBeVisible();await expect(page.locator('html')).toHaveAttribute('data-presentation-exit','skipped');await expect(page.locator('.t-tig,[data-presentation-exit-snapshot]')).toHaveCount(0);
  expect(fixture.commands.filter(command=>command.type==='presentation.finish')).toHaveLength(1);expect(fixture.commands.filter(command=>command.type==='presentation.reveal')).toHaveLength(1);
 }finally{release();await fixture.close();}
});

test('geometry invalidation during raw PNG decode cannot relatch after returning',async({page})=>{
 const fixture=await ready(page);
 try{
  await page.evaluate(()=>{const original=HTMLImageElement.prototype.decode;let held=false;HTMLImageElement.prototype.decode=function(){const decoded=original.call(this);if(!held&&this.src.startsWith('data:image/png;base64,')){held=true;return decoded.then(()=>new Promise<void>(resolve=>Reflect.set(window,'__releaseCoverageDecode',resolve)));}return decoded;};});
  await page.getByRole('button',{name:'Collapse to edge anchor',exact:true}).click();await expect.poll(()=>page.evaluate(()=>typeof Reflect.get(window,'__releaseCoverageDecode'))).toBe('function');
  await page.evaluate(()=>{const root=document.getElementById('root')!;root.style.paddingTop='2px';root.style.paddingTop='';Reflect.get(window,'__releaseCoverageDecode')();});
  await expect(page.getByRole('button',{name:'Open Glint',exact:true})).toBeVisible();await expect(page.locator('html')).toHaveAttribute('data-presentation-exit','skipped');await expect(page.locator('.t-tig,[data-presentation-exit-snapshot]')).toHaveCount(0);expect(fixture.commands.filter(command=>command.type==='presentation.finish')).toHaveLength(1);
 }finally{await fixture.close();}
});

test('a superseding root owner suppresses stale finish reveal and restoration after decode',async({page})=>{
 const fixture=await ready(page);
 try{
  await page.evaluate(()=>{const original=HTMLImageElement.prototype.decode;let held=false;HTMLImageElement.prototype.decode=function(){const decoded=original.call(this);if(!held&&this.src.startsWith('data:image/png;base64,')){held=true;return decoded.then(()=>new Promise<void>(resolve=>Reflect.set(window,'__releaseSupersededDecode',resolve)));}return decoded;};});
  await page.getByRole('button',{name:'Collapse to edge anchor',exact:true}).click();await expect.poll(()=>page.evaluate(()=>typeof Reflect.get(window,'__releaseSupersededDecode'))).toBe('function');
  await page.evaluate(()=>{const root=document.getElementById('root')!;root.dataset.presentationOwner='successor-owner';root.style.visibility='hidden';Reflect.get(window,'__releaseSupersededDecode')();});
  await page.waitForTimeout(100);expect(fixture.commands.filter(command=>command.type==='presentation.finish'||command.type==='presentation.reveal')).toHaveLength(0);expect(await page.locator('#root').evaluate(el=>(el as HTMLElement).style.visibility)).toBe('hidden');await expect(page.locator('.t-tig,[data-presentation-exit-snapshot]')).toHaveCount(0);
 }finally{await fixture.close();}
});

test('a capture with no leased actors still runs the real image exit',async({page})=>{
 const fixture=await ready(page);let release=()=>{};
 try{
  await page.locator('.character-slot[data-character-render]').evaluateAll(slots=>{for(const slot of slots){slot.removeAttribute('data-character-render');(slot as HTMLElement).style.visibility='hidden';}});
  fixture.exitBarrier=new Promise<void>(resolve=>release=resolve);await page.getByRole('button',{name:'Collapse to edge anchor',exact:true}).click();await expect(page.locator('[data-presentation-exit-effect] .t-tig')).toHaveCount(1);expect(await page.locator('[data-presentation-exit-ordinary]').evaluate(el=>(el as HTMLElement).style.clipPath)).toBe('inset(100%)');
 }finally{release();await fixture.close();}
});

test('oversized decoded bitmap dimensions skip before image decode or allocation',async({page})=>{
 const fixture=await ready(page);
 try{
  const png=await page.evaluate(()=>{const header=new Uint8Array(24);header.set([137,80,78,71,13,10,26,10],0);header.set([73,72,68,82],12);const view=new DataView(header.buffer);view.setUint32(16,8193);view.setUint32(20,440);Reflect.set(window,'__exitPngDecodes',0);const original=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=function(){if(this.src.startsWith('data:image/png;base64,'))Reflect.set(window,'__exitPngDecodes',Reflect.get(window,'__exitPngDecodes')+1);return original.call(this);};return 'data:image/png;base64,'+btoa(String.fromCharCode(...header));});
  await fixture.prepareExit('oversized-bitmap',png);await expect.poll(()=>fixture.commands.filter(command=>command.type==='presentation.finish').length).toBe(1);await expect(page.locator('html')).toHaveAttribute('data-presentation-exit','skipped');expect(await page.evaluate(()=>Reflect.get(window,'__exitPngDecodes'))).toBe(0);await expect(page.locator('.t-tig,[data-presentation-exit-snapshot]')).toHaveCount(0);
 }finally{await fixture.close();}
});
