import {test,expect} from '@playwright/test';

test('initial data hydration may change scene identity before the one startup reveal',async({page})=>{
 await page.goto('http://127.0.0.1:4173/ready-artifact-test.html?defer-ready=1');
 await expect(page.locator('.fixture-surface')).toHaveAttribute('data-surface-reveal','pending');
 await page.getByRole('button',{name:'Finish initial load'}).click();
 await expect(page.locator('.fixture-surface')).toHaveAttribute('data-surface-reveal','running');
 await expect(page.locator('.t-gen')).toHaveCount(1);
 await expect(page.locator('.fixture-surface')).toHaveAttribute('data-surface-reveal','settled');
 await page.getByRole('button',{name:'Change scene identity'}).click();
 await expect(page.locator('.t-gen,.t-tig')).toHaveCount(0);
});

test('real unmount before the first frame consumes startup under the persistent session',async({page})=>{
 await page.addInitScript(()=>{
  const original=requestAnimationFrame,queued=new Map<number,FrameRequestCallback>();let id=0;
  window.requestAnimationFrame=callback=>{queued.set(++id,callback);return id;};
  window.cancelAnimationFrame=key=>{queued.delete(key);};
  Reflect.set(window,'releaseFrames',()=>{window.requestAnimationFrame=original;for(const callback of queued.values())original(callback);queued.clear();});
 });
 await page.goto('http://127.0.0.1:4173/ready-artifact-test.html');
 await expect(page.locator('.fixture-surface')).toHaveAttribute('data-surface-reveal','pending');
 await page.getByRole('button',{name:'Toggle mounted surface'}).evaluate(button=>(button as HTMLButtonElement).click());
 await expect(page.locator('.fixture-surface')).toHaveCount(0);
 await page.getByRole('button',{name:'Toggle mounted surface'}).evaluate(button=>(button as HTMLButtonElement).click());
 await expect(page.locator('.fixture-surface')).toHaveAttribute('data-surface-reveal','settled');
 await page.evaluate(()=>Reflect.get(window,'releaseFrames')());
 await page.waitForTimeout(250);
 await expect(page.locator('.t-gen,.t-tig')).toHaveCount(0);
 await expect(page.locator('.fixture-surface')).toHaveCSS('opacity','1');
});


test('an early startup frame cannot consume entrance before deferred StrictMode replay',async({page})=>{
 await page.setViewportSize({width:800,height:700});await page.emulateMedia({reducedMotion:'no-preference'});
 await page.addInitScript(()=>{
  const nativeFrame=window.requestAnimationFrame.bind(window),nativeCancel=window.cancelAnimationFrame.bind(window);
  const synthetic=-2147483647;let accelerated=false,cancelled=false;
  window.requestAnimationFrame=callback=>{
   // Intercept only the first callback after the surface's prepaint hold.
   // All later callbacks use real RAF, avoiding microtask starvation of runtime.
   if(!accelerated&&document.querySelector('.fixture-surface[data-surface-reveal="pending"]')){
    accelerated=true;Reflect.set(window,'__acceleratedSurfaceFrame',true);
    queueMicrotask(()=>{if(!cancelled)callback(performance.now());});return synthetic;
   }
   return nativeFrame(callback);
  };
  window.cancelAnimationFrame=id=>{if(id===synthetic)cancelled=true;else nativeCancel(id);};
 });
 await page.goto('http://127.0.0.1:4173/ready-artifact-test.html');
 await expect(page.locator('.fixture-surface')).toHaveAttribute('data-surface-reveal','running');
 expect(await page.evaluate(()=>Reflect.get(window,'__acceleratedSurfaceFrame'))).toBe(true);
 await expect(page.locator('.t-gen')).toHaveCount(1);
 await page.getByRole('button',{name:'Insert structured item'}).click();
 await expect(page.locator('.fixture-surface')).toHaveAttribute('data-surface-reveal','cancelled');
 await expect(page.locator('[data-artifact-motion]')).toHaveAttribute('data-artifact-reveal','running');
 await expect(page.locator('.t-gen')).toHaveCount(1);
 await expect(page.locator('[data-artifact-motion]')).toHaveAttribute('data-artifact-reveal','settled');
 await expect(page.locator('.t-gen,.t-tig')).toHaveCount(0);
});
