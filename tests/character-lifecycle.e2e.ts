import {test,expect} from '@playwright/test';
import type {OriginalActor} from '../src/renderer/src/character-original/actor-runtime';

declare global {interface Window {__actorContract:{actor:OriginalActor;canvas:HTMLCanvasElement;failures:number;gl:WebGL2RenderingContext;sizeWrites:number};}}
async function mount(page:import('@playwright/test').Page,motion=true){
 await page.route('**/actor-contract.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0;background:#222526}canvas{width:210px;height:230px;display:block}</style><canvas></canvas>'}));
 await page.goto(`http://127.0.0.1:${process.env.WINDOW_COMPANION_TEST_PORT??4173}/actor-contract.html`);
 await page.evaluate(async motion=>{
  const path='/src/character-original/actor-runtime.js';const {mountOriginal}=await import(/* @vite-ignore */path);
  const canvas=document.querySelector('canvas')!;let failures=0,sizeWrites=0;const observer=new MutationObserver(records=>sizeWrites+=records.length);observer.observe(canvas,{attributes:true,attributeFilter:['width','height']});
  const actor:OriginalActor=mountOriginal(canvas,{shape:'soup',color:'dough',face:'curious',motion},()=>failures++);
  const gl=canvas.getContext('webgl2')!;
  window.__actorContract={actor,canvas,get failures(){return failures;},gl,get sizeWrites(){return sizeWrites;}};
 },motion);
}
test('original actor follows nearby gaze without resizing every frame, then destroys its work idempotently',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});await mount(page);
 await expect.poll(()=>page.evaluate(()=>window.__actorContract.actor.stats().frames)).toBeGreaterThan(0);
 await page.waitForTimeout(100);const before=await page.evaluate(()=>({stats:window.__actorContract.actor.stats(),writes:window.__actorContract.sizeWrites}));
 await page.mouse.move(170,90);await expect.poll(()=>page.evaluate(()=>window.__actorContract.actor.stats().frames)).toBeGreaterThan(before.stats.frames+3);
 expect(await page.evaluate(()=>window.__actorContract.sizeWrites)).toBe(before.writes);
 const stopped=await page.evaluate(()=>{const {actor}=window.__actorContract;actor.destroy();actor.destroy();return actor.stats();});expect(stopped).toMatchObject({destroyed:true,active:false,idle:false});
 await page.mouse.move(80,90);await page.waitForTimeout(300);expect(await page.evaluate(()=>window.__actorContract.actor.stats().frames)).toBe(stopped.frames);expect(await page.evaluate(()=>window.__actorContract.gl.isContextLost())).toBe(true);
});
test('motion off and reduced motion stop scheduling while static resize repaints at the effective size',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await mount(page,false);
 const before=await page.evaluate(()=>window.__actorContract.actor.stats());expect(before).toMatchObject({active:false,idle:false});
 await page.mouse.move(160,80);await page.waitForTimeout(250);expect(await page.evaluate(()=>window.__actorContract.actor.stats().frames)).toBe(before.frames);
 await page.evaluate(()=>{window.__actorContract.canvas.style.width='150px';window.__actorContract.canvas.style.height='165px';});
 await expect.poll(()=>page.evaluate(()=>window.__actorContract.canvas.width)).toBe(150);await expect.poll(()=>page.evaluate(()=>window.__actorContract.canvas.height)).toBe(165);
 expect(await page.evaluate(()=>window.__actorContract.actor.stats())).toMatchObject({active:false,idle:false});
 await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForTimeout(100);expect(await page.evaluate(()=>window.__actorContract.actor.stats())).toMatchObject({active:false,idle:false});
 await page.evaluate(()=>window.__actorContract.actor.resume());await page.mouse.move(100,90);await expect.poll(()=>page.evaluate(()=>window.__actorContract.actor.stats().near)).toBe(true);
 await page.emulateMedia({reducedMotion:'reduce'});await expect.poll(()=>page.evaluate(()=>window.__actorContract.actor.stats().active)).toBe(false);expect(await page.evaluate(()=>window.__actorContract.actor.stats().idle)).toBe(false);
 await page.evaluate(()=>window.__actorContract.actor.destroy());
});
test('real context loss releases the actor and reports one static recovery without an automatic retry',async({page})=>{
 await mount(page);await page.evaluate(()=>window.__actorContract.gl.getExtension('WEBGL_lose_context')!.loseContext());
 await expect.poll(()=>page.evaluate(()=>window.__actorContract.failures)).toBe(1);expect(await page.evaluate(()=>window.__actorContract.actor.stats())).toMatchObject({destroyed:true,active:false,idle:false});const frames=await page.evaluate(()=>window.__actorContract.actor.stats().frames);await page.waitForTimeout(300);expect(await page.evaluate(()=>window.__actorContract.actor.stats().frames)).toBe(frames);
});

test('a failure during real WebGL setup cleans partial resources and leaves the failed canvas context lost',async({page})=>{
 await page.route('**/actor-contract.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><canvas style="width:100px;height:100px"></canvas>'}));await page.goto(`http://127.0.0.1:${process.env.WINDOW_COMPANION_TEST_PORT??4173}/actor-contract.html`);
 const result=await page.evaluate(async()=>{
  const path='/src/character-original/actor-runtime.js';const {mountOriginal}=await import(/* @vite-ignore */path);const canvas=document.querySelector('canvas')!,original=WebGL2RenderingContext.prototype.drawElements;
  WebGL2RenderingContext.prototype.drawElements=()=>{throw Error('Synthetic GPU draw failure.');};let failed=false;
  try{mountOriginal(canvas,{shape:'soup',color:'dough',face:'curious',motion:true});}catch{failed=true;}finally{WebGL2RenderingContext.prototype.drawElements=original;}
  return {failed,lost:canvas.getContext('webgl2')!.isContextLost()};
 });expect(result).toEqual({failed:true,lost:true});
});

test('hidden document cancels scheduled work and resumes only when visible with movement enabled',async({page})=>{
 await mount(page);await page.mouse.move(150,90);
 const hidden=await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));return window.__actorContract.actor.stats();});expect(hidden).toMatchObject({active:false,idle:false});
 await page.waitForTimeout(200);expect(await page.evaluate(()=>window.__actorContract.actor.stats().frames)).toBe(hidden.frames);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});await expect.poll(()=>page.evaluate(()=>window.__actorContract.actor.stats().idle)).toBe(true);await page.evaluate(()=>window.__actorContract.actor.destroy());
});


test('active original gaze advances on display frames and stops once settled',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});await mount(page);
 const sample=await page.evaluate(async()=>{
  const {actor}=window.__actorContract;actor.pause();actor.resume();
  document.dispatchEvent(new PointerEvent('pointermove',{pointerType:'mouse',clientX:185,clientY:55}));
  const frames=[actor.stats().frames];
  for(let index=0;index<12;index++){await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));frames.push(actor.stats().frames);}
  return {frames,progress:frames.at(-1)!-frames[0]};
 });
 expect(sample.progress).toBeGreaterThanOrEqual(10);
 await page.mouse.move(800,600);await expect.poll(()=>page.evaluate(()=>window.__actorContract.actor.stats().active)).toBe(false);
 const settled=await page.evaluate(()=>window.__actorContract.actor.stats().frames);await page.waitForTimeout(180);
 expect(await page.evaluate(()=>window.__actorContract.actor.stats().frames)).toBe(settled);await page.evaluate(()=>window.__actorContract.actor.destroy());
});


test('pause and resume keep the painted neutral pose continuous after nearby motion',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});await mount(page);
 await page.mouse.move(185,55);await expect.poll(()=>page.evaluate(()=>window.__actorContract.actor.stats().eye[0])).toBeGreaterThan(.3);
 const result=await page.evaluate(async()=>{
  const {actor,canvas}=window.__actorContract;actor.pause();const paused=canvas.toDataURL();actor.resume();
  await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));const resumed=canvas.toDataURL();actor.destroy();return {paused,resumed};
 });
 expect(result.resumed).toBe(result.paused);
});


test('distant owned content keeps the character forward while nearby gaze stays responsive',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});await mount(page);
 await page.mouse.move(700,450);
 await expect.poll(()=>page.evaluate(()=>window.__actorContract.actor.stats().eye[0]),{timeout:1800}).toBeLessThan(.2);
 await expect.poll(()=>page.evaluate(()=>window.__actorContract.actor.stats().body[0]),{timeout:1800}).toBeLessThan(.2);
 const right=await page.evaluate(()=>window.__actorContract.canvas.toDataURL());
 await page.mouse.move(30,50);await expect.poll(()=>page.evaluate(()=>window.__actorContract.actor.stats().eye[0])).toBeLessThan(-.25);
 const left=await page.evaluate(()=>window.__actorContract.canvas.toDataURL());expect(left===right).toBe(false);
 expect(await page.evaluate(()=>window.__actorContract.failures)).toBe(0);await page.evaluate(()=>window.__actorContract.actor.destroy());
});


test('idle original glances are brief and return forward while sleeping between reactions',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});await page.clock.install();await mount(page);
 await page.evaluate(()=>document.dispatchEvent(new Event('pointerleave')));
 let left=false,right=false,returned=false;
 for(let step=0;step<140;step++){
  await page.clock.runFor(250);const state=await page.evaluate(()=>window.__actorContract.actor.stats());
  if(state.eye[0]<-.15)left=true;
  if(left&&Math.abs(state.eye[0])<.02&&!state.active)returned=true;
  if(returned&&state.eye[0]>.15){right=true;break;}
 }
 expect({left,right,returned}).toEqual({left:true,right:true,returned:true});
 await page.clock.runFor(2000);const resting=await page.evaluate(()=>window.__actorContract.actor.stats());expect(resting).toMatchObject({active:false,idle:true});expect(Math.abs(resting.eye[0])).toBeLessThan(.02);
 await page.clock.runFor(300);expect(await page.evaluate(()=>window.__actorContract.actor.stats().frames)).toBe(resting.frames);
 await page.evaluate(()=>window.__actorContract.actor.destroy());
});

test('an offscreen actor sleeps and returns forward when its surface reappears',async({page})=>{
 await mount(page);await page.mouse.move(180,75);await expect.poll(()=>page.evaluate(()=>window.__actorContract.actor.stats().eye[0])).toBeGreaterThan(.3);
 await page.evaluate(()=>window.__actorContract.canvas.style.transform='translateY(-1000px)');await expect.poll(()=>page.evaluate(()=>window.__actorContract.actor.stats().active)).toBe(false);const hidden=await page.evaluate(()=>window.__actorContract.actor.stats().frames);await page.waitForTimeout(200);expect(await page.evaluate(()=>window.__actorContract.actor.stats().frames)).toBe(hidden);
 await page.evaluate(()=>window.__actorContract.canvas.style.transform='');await expect.poll(()=>page.evaluate(()=>Math.abs(window.__actorContract.actor.stats().eye[0])),{timeout:1800}).toBeLessThan(.03);await page.evaluate(()=>window.__actorContract.actor.destroy());
});
