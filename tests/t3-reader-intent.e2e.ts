import {test,expect} from '@playwright/test';
import {BrowserFixture} from './browser-fixture';

test.use({viewport:{width:1000,height:700},reducedMotion:'reduce'});

test('a small upward reading gesture stops live following until the reader returns to the end',async({page})=>{
 const fixture=await BrowserFixture.open(page);
 try{
  await page.getByLabel('Ask about this task',{exact:true}).fill('Explain this source in detail.');
  await page.getByRole('button',{name:'Ask',exact:true}).click();
  await expect.poll(()=>fixture.pending.size).toBe(1);
  const text=Array.from({length:35},(_,i)=>`Paragraph ${i} describes the same frozen source without adding facts.`).join('\n\n');
  await fixture.stream(text);
  const timeline=page.locator('#main');
  await expect.poll(()=>timeline.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(2);
  const box=await timeline.boundingBox();
  await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);
  await page.mouse.wheel(0,-20);
  await expect.poll(()=>timeline.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeGreaterThan(10);
  const reading=await timeline.evaluate(el=>el.scrollTop);
  await fixture.stream(text+'\n\n'+text);
  await expect.poll(()=>timeline.evaluate(el=>el.scrollTop)).toBeCloseTo(reading,0);
  await timeline.evaluate(el=>{el.scrollTop=el.scrollHeight;});
  await expect.poll(()=>timeline.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(2);
  await fixture.stream(text+'\n\n'+text+'\n\nA final paragraph arrives.');
  await expect.poll(()=>timeline.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(2);
  fixture.complete(text);
 }finally{await fixture.close();}
});
