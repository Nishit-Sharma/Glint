import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';

const evidence='evidence/module-arrival-motion';await mkdir(evidence,{recursive:true});
await build({entryPoints:['fixtures/motion/tall-motion-preview.tsx'],bundle:true,format:'esm',outfile:'test-results/module-arrival-motion/build/tall-motion.js',loader:{'.woff2':'dataurl'},define:{'process.env.NODE_ENV':'"production"'}});
const server=createServer(async(req,res)=>{
 try{
  if(req.url?.startsWith('/preview.js')){res.setHeader('content-type','application/javascript');res.end(await readFile('test-results/module-arrival-motion/build/tall-motion.js'));return;}
  if(req.url?.startsWith('/preview.css')){res.setHeader('content-type','text/css');res.end(await readFile('test-results/module-arrival-motion/build/tall-motion.css'));return;}
  res.setHeader('content-type','text/html');res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/preview.css"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{background:var(--paper);color:var(--ink)}.fixture-controls{height:70px;padding:4px;display:flex;gap:3px;flex-wrap:wrap}.fixture-controls button{font-size:11px;padding:4px}.fixture-scroll{height:calc(100% - 70px);overflow:auto;padding:8px;box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/preview.js"></script></body></html>');
 }catch{res.statusCode=500;res.end('Fixture could not load.');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:320,height:440},reducedMotion:'no-preference'});const errors=[];page.on('pageerror',error=>errors.push(error.message));
await page.addInitScript(()=>{
 window.overlays=0;window.partRuns=[];
 new MutationObserver(records=>{for(const record of records){for(const node of record.addedNodes)if(node instanceof Element&&(node.matches('.t-gen')||node.querySelector('.t-gen')))window.overlays++;if(record.type==='attributes'&&record.attributeName==='data-artifact-reveal'&&record.target.dataset.artifactReveal==='running')window.partRuns.push(record.target.dataset.artifactMotion);}}).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-artifact-reveal']});
});
const result={scope:'Actual Chromium renderer fixture at320x440 using production ModuleAnswer/ModuleView/ReadyArtifact and unmodified upstream runtime. Synthetic declarations, no native/provider proof.',checks:[]};
try{
 for(const kind of ['comparison','plan']){
  await page.goto(origin+'/?kind='+kind);await page.getByRole('button',{name:'Insert new answer',exact:true}).click();
  const module=page.locator('.interactive-answer');await expect(module).toBeVisible();expect(await module.evaluate(element=>element.getBoundingClientRect().height)).toBeGreaterThan(440);
  await expect.poll(()=>page.evaluate(()=>window.overlays),{timeout:7000}).toBeGreaterThan(0);
  await expect(page.locator('.t-gen')).toHaveCount(0,{timeout:10000});
  await page.screenshot({path:`${evidence}/${kind}-top.png`});
  const target=kind==='comparison'?page.getByRole('radio',{name:'Option 12',exact:true}):page.getByRole('checkbox',{name:'Preparation step 24 Keep this step with the current task.',exact:true});
  const before=await page.evaluate(()=>window.overlays);await target.scrollIntoViewIfNeeded();await expect(target).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.overlays),{timeout:7000}).toBeGreaterThan(before);
  await expect(page.locator('.t-gen')).toHaveCount(0,{timeout:10000});
  await target.focus();await page.keyboard.press('Space');await expect(target).toBeChecked();const count=await page.evaluate(()=>window.overlays);await page.getByRole('button',{name:'Rerender',exact:true}).click();await expect(target).toBeChecked();await page.waitForTimeout(300);expect(await page.evaluate(()=>window.overlays)).toBe(count);
  if(kind==='comparison'){await target.focus();await page.keyboard.press('ArrowUp');await expect(page.getByRole('radio',{name:'Option 11',exact:true})).toBeChecked();}
  await page.screenshot({path:`${evidence}/${kind}-scrolled.png`});
  result.checks.push({kind,overlays:await page.evaluate(()=>window.overlays),partRuns:await page.evaluate(()=>window.partRuns),localEditAndRerenderDidNotReplay:true,keyboard:true});
  await page.goto(origin+'/?kind='+kind+'&history=1');await expect(page.locator('.interactive-answer')).toBeVisible();await page.waitForTimeout(700);expect(await page.evaluate(()=>window.overlays)).toBe(0);result.checks.push({kind,restoredHistoryNoReplay:true});
 }
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(origin);await page.getByRole('button',{name:'Insert new answer',exact:true}).click();await page.waitForTimeout(900);expect(await page.evaluate(()=>window.overlays)).toBe(0);result.checks.push({reducedMotionNoDrawing:true});
 await page.emulateMedia({reducedMotion:'no-preference'});await page.goto(origin);await page.getByRole('button',{name:'Insert new answer',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.overlays)).toBeGreaterThan(0);await page.getByRole('button',{name:'Remove answer',exact:true}).click();await expect(page.locator('.t-gen')).toHaveCount(0);result.checks.push({removalCancels:true});
 expect(errors).toEqual([]);result.passed=true;
}catch(error){result.passed=false;result.error=error.message;await page.screenshot({path:`${evidence}/failure.png`});throw error;}
finally{await writeFile(`${evidence}/result.json`,JSON.stringify(result,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
