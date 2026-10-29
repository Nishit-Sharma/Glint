import {chromium} from 'playwright-core';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

const browser=await chromium.launch({headless:true,chromiumSandbox:true});
try{
 const page=await browser.newPage({viewport:{width:1024,height:1024},deviceScaleFactor:1,reducedMotion:'reduce'});
 await page.route('http://127.0.0.1:4173/character-icon-proof',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><title>Owned character icon render</title><style>body{margin:0;background:transparent}canvas{display:block;width:1024px;height:1024px}</style></head><body><canvas></canvas></body></html>'}));
 await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:4173'?route.fallback():route.abort());
 await page.goto('http://127.0.0.1:4173/character-icon-proof');
 const data=await page.evaluate(async()=>{
  const {mountOriginal}=await import('/src/character-original/actor-runtime.js');
  const canvas=document.querySelector('canvas');
  const actor=mountOriginal(canvas,{shape:'soup',color:'dough',face:'curious',motion:false});
  try{actor.pause();return {width:canvas.width,height:canvas.height,png:canvas.toDataURL('image/png').split(',')[1]};}finally{actor.destroy();}
 });
 if(data.width!==1024||data.height!==1024)throw Error('Original actor did not render the expected icon size.');
 const bytes=Buffer.from(data.png,'base64');await writeFile('build/companion-icon.png',bytes);
 await mkdir('evidence/character',{recursive:true});
 const files=['src/renderer/src/character-original/core.js','src/renderer/src/character-original/actor-runtime.js'];
 const sources=[];for(const path of files)sources.push({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')});
 await writeFile('evidence/character/icon.json',JSON.stringify({utc:new Date().toISOString(),kind:'Rendered original approved actor with a neutral fixed pose, not new generated artwork',root:resolve('.'),width:data.width,height:data.height,output:'build/companion-icon.png',sha256:createHash('sha256').update(bytes).digest('hex'),sources,installedAppChanged:false},null,2));
 console.log(JSON.stringify({output:'build/companion-icon.png',bytes:bytes.length,width:data.width,height:data.height}));
}finally{await browser.close();}
