import {chromium} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const output=new URL('../src/renderer/src/bot-thumbnails/',import.meta.url);await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:320,height:320},deviceScaleFactor:1});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.route('**/bot-thumbnail-capture.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0}canvas{width:320px;height:320px}</style><canvas></canvas>'}));
 await page.goto(`http://127.0.0.1:${process.env.WINDOW_COMPANION_TEST_PORT??4186}/bot-thumbnail-capture.html`);
 const looks=await page.evaluate(async path=>{const {CHARACTER_SHAPES,CHARACTER_COLORS,CHARACTER_FACES}=await import(path);return CHARACTER_SHAPES.flatMap(shape=>CHARACTER_COLORS.flatMap(color=>CHARACTER_FACES.map(face=>({shape:shape.id,color:color.id,face:face.id,motion:false}))));},'/@fs'+fileURLToPath(new URL('../src/shared/character-catalog.ts',import.meta.url)));
 const files={};
 for(const [index,look] of looks.entries()){
  const png=await page.evaluate(async look=>{const path='/src/character-original/actor-runtime.js';const {mountOriginal}=await import(path);const canvas=document.createElement('canvas');document.body.replaceChildren(canvas);const actor=mountOriginal(canvas,look);try{actor.pose(0,0);return canvas.toDataURL('image/png').split(',')[1];}finally{actor.destroy();}},look);
  const bytes=Buffer.from(png,'base64'),name=[look.shape,look.color,look.face].join('-')+'.png';await writeFile(new URL(name,output),bytes);files[name]=createHash('sha256').update(bytes).digest('hex');
  if(index%21===20)process.stdout.write(`${index+1}/${looks.length} original appearance renders saved\n`);
 }
 const actor=await readFile(new URL('../src/renderer/src/character-original/actor-runtime.js',import.meta.url)),geometry=await readFile(new URL('../src/renderer/src/character-original/core.js',import.meta.url));
 await writeFile(new URL('../evidence/onboarding/thumbnail-provenance.json',import.meta.url),JSON.stringify({method:'Original local Three.js render, neutral pose, reduced motion. No generated or third-party character art.',actorSha256:createHash('sha256').update(actor).digest('hex'),geometrySha256:createHash('sha256').update(geometry).digest('hex'),files},null,2));
}finally{await browser.close();}
