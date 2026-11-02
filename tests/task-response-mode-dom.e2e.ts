// Actual App DOM regression. BrowserFixture substitutes native/provider boundaries.
import {test,expect} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {BrowserFixture} from './browser-fixture';

test('exact installed source keeps one live TaskResponseMode through passive time, refreshes, rerenders and navigation',async({page})=>{
 const directory=resolve('evidence/mode-dom-diagnostic');await mkdir(directory,{recursive:true});const duplicateKeyErrors:string[]=[];page.on('console',message=>{if(message.text().includes('Encountered two children with the same key'))duplicateKeyErrors.push(message.text());});
 const fixture=await BrowserFixture.open(page,undefined,4197);
 try{
  const paths=['src/App.tsx','src/components/TaskResponseMode.tsx','src/components/GeneratedSurface.tsx','src/generation.ts','src/live-generation.ts','src/vendor/transitions/ui-generation.js'];
  const served=await page.evaluate(async paths=>{const results:Array<{path:string;content:string}>=[];for(const path of paths){const module=await import(/* @vite-ignore */ '/'+path+'?raw');results.push({path,content:module.default});}return results;},paths);
  const identity=await Promise.all(served.map(async item=>({path:'src/renderer/'+item.path,expected:createHash('sha256').update(await readFile(resolve('src/renderer/'+item.path))).digest('hex'),actual:createHash('sha256').update(item.content).digest('hex')})));await writeFile(resolve(directory,'FIXED-SERVED-IDENTITY.json'),JSON.stringify(identity,null,2)+'\n');for(const item of identity)expect(item.actual,item.path).toBe(item.expected);
  await expect(page.locator('.workspace main section[aria-label="Task response mode"]')).toHaveCount(1);
  await page.evaluate(()=>{
   const key='__modeDiagnostic',target=window as unknown as Record<string,any>,ids=new WeakMap<Element,number>();let next=0;
   const state={phase:'passive',samples:[] as unknown[],changes:[] as unknown[],max:0,observer:undefined as MutationObserver|undefined,timer:0};
   const sample=()=>{const nodes=[...document.querySelectorAll('section[aria-label="Task response mode"]')],main=document.querySelector('.workspace main'),live=nodes.filter(node=>node.isConnected);state.max=Math.max(state.max,live.length);state.samples.push({time:performance.now(),phase:state.phase,connected:live.length,workspaceMain:main?[...main.querySelectorAll('section[aria-label="Task response mode"]')].length:0,nodeIds:live.map(node=>{if(!ids.has(node))ids.set(node,++next);return ids.get(node);}),mains:document.querySelectorAll('main').length,decorations:document.querySelectorAll('.t-gen').length,modesInDecorations:document.querySelectorAll('.t-gen section[aria-label="Task response mode"]').length,overlayAriaHidden:[...document.querySelectorAll('.t-gen')].map(node=>node.getAttribute('aria-hidden'))});};
   state.observer=new MutationObserver(records=>{let added=0,removed=0;for(const record of records)for(const [nodes,kind] of [[record.addedNodes,'added'],[record.removedNodes,'removed']] as const)for(const node of nodes)if(node instanceof Element){const count=Number(node.matches('section[aria-label="Task response mode"]'))+node.querySelectorAll('section[aria-label="Task response mode"]').length;if(kind==='added')added+=count;else removed+=count;}if(added||removed)state.changes.push({time:performance.now(),phase:state.phase,added,removed});sample();});
   state.observer.observe(document.body,{childList:true,subtree:true});state.timer=window.setInterval(sample,250);sample();target[key]=state;
  });
  const phase=async(value:string)=>page.evaluate(value=>{(window as unknown as Record<string,any>).__modeDiagnostic.phase=value;},value);
  await page.waitForTimeout(20000);
  await phase('150 canonical changed events');for(let index=0;index<150;index++)await fixture.changed(fixture.taskA.id);await page.waitForTimeout(1500);
  await phase('10 explicit saved-message refreshes');for(let index=0;index<10;index++){await page.getByRole('button',{name:'Refresh saved messages',exact:true}).click();await expect(page.getByRole('button',{name:'Refresh saved messages',exact:true})).toBeEnabled();}
  await phase('10 task round trips');for(let index=0;index<10;index++){await page.getByRole('button',{name:'Choose task',exact:true}).click();await page.getByRole('button',{name:'Task Beta',exact:true}).click();await expect(page.locator('.workspace .chrome h1')).toHaveText('Task Beta');await page.getByRole('button',{name:'Choose task',exact:true}).click();await page.getByRole('button',{name:'Task Alpha',exact:true}).click();await expect(page.locator('.workspace .chrome h1')).toHaveText('Task Alpha');}
  await phase('surface and viewport changes');await fixture.enter('companion');await fixture.enter('workspace');await page.setViewportSize({width:1080,height:900});await page.waitForTimeout(1000);await page.setViewportSize({width:430,height:760});await page.waitForTimeout(1000);
  const result=await page.evaluate(()=>{const state=(window as unknown as Record<string,any>).__modeDiagnostic;clearInterval(state.timer);state.observer.disconnect();return {max:state.max,samples:state.samples,changes:state.changes};});
  await writeFile(resolve(directory,'DOM-OBSERVATIONS.json'),JSON.stringify({...result,duplicateKeyErrors},null,2)+'\n');await writeFile(resolve(directory,'DOM-ARIA-SNAPSHOT.txt'),await page.locator('.workspace main').ariaSnapshot());
  expect(result.max).toBe(1);expect(duplicateKeyErrors).toEqual([]);await expect(page.locator('.workspace main section[aria-label="Task response mode"]')).toHaveCount(1);expect(fixture.modelInvocations).toEqual([]);expect(fixture.externalRequests).toEqual([]);
 }finally{await fixture.close();}
});
