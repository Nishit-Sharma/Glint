import {seedReturningProfile} from '../support/native-profile';
import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir,platform,arch} from 'node:os';
import {execFile} from 'node:child_process';

test('normal launch is capture-free and own window protection preserves internal presentation snapshots',async()=>{
 test.setTimeout(30000);
 const dataDir=await mkdtemp(join(tmpdir(),'companion-native-privacy-'));
 await seedReturningProfile(dataDir);
 const app=await electron.launch({args:[resolve('..')],env:{...process.env,WINDOW_COMPANION_DATA_DIR:dataDir,WINDOW_COMPANION_TEST_NO_GLOBAL_INPUT:'1'}});
 try{
  const page=await app.firstWindow();await expect(page.getByRole('heading',{name:'Bring a window into this task.',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.companion.invoke({type:'tasks.list'}))).toEqual([]);
  await expect(page.locator('.context-intake')).toHaveCount(0);
  const panel=await app.evaluate(({BrowserWindow})=>{
   const window=BrowserWindow.getAllWindows().find(window=>window.getTitle()==='Glint')!;
   return {protected:window.isContentProtected(),visible:window.isVisible()};
  });
  expect(panel.protected).toBe(process.platform==='darwin'||process.platform==='win32');expect(panel.visible).toBe(true);
  const snapshot=await app.evaluate(async({BrowserWindow})=>{
   const window=BrowserWindow.getAllWindows().find(window=>window.getTitle()==='Glint')!;
   const image=await window.webContents.capturePage();return {size:image.getSize(),empty:image.isEmpty()};
  });
  expect(snapshot.empty).toBe(false);expect(snapshot.size.width).toBeGreaterThan(0);
  await page.evaluate(()=>window.companion.invoke({type:'connection.select',provider:'meta'}));
  await page.evaluate(()=>window.companion.invoke({type:'connection.configure'}));
  await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(window=>window.getTitle()==='Connect Meta'&&window.isVisible()))).toBe(true);
  const credential=await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows().find(window=>window.getTitle()==='Connect Meta')!;return {protected:window.isContentProtected(),visible:window.isVisible()};});
  expect(credential.protected).toBe(panel.protected);
  await mkdir('next/evidence/resume-20261025',{recursive:true});
  await writeFile('next/evidence/resume-20261025/native-privacy.json',JSON.stringify({utc:new Date().toISOString(),platform:platform(),arch:arch(),panel,credential,internalSnapshot:snapshot,normalLaunchTasks:0,scope:'Real Electron API flags on own windows and internal capturePage. No external target capture, recorder exclusion measurement, model call or credential entry. ScreenCaptureKit may ignore the macOS flag; Windows requires separate testing.'},null,2));
 }finally{await app.close();}
});

test('macOS selected-window recorder probe measures an owned harmless window with and without protection',async()=>{
 test.skip(process.platform!=='darwin','This recorder probe uses the macOS selected-window screencapture binary.');
 test.setTimeout(40000);
 const dataDir=await mkdtemp(join(tmpdir(),'companion-recorder-probe-'));
 await seedReturningProfile(dataDir);
 const app=await electron.launch({args:[resolve('..')],env:{...process.env,WINDOW_COMPANION_DATA_DIR:dataDir,WINDOW_COMPANION_TEST_NO_GLOBAL_INPUT:'1'}});
 try{
  await app.firstWindow();
  const permission=await app.evaluate(({systemPreferences})=>systemPreferences.getMediaAccessStatus('screen'));
  test.skip(permission!=='granted','Existing screen-recording permission is required; this test does not request it.');
  const id=await app.evaluate(async({BrowserWindow})=>{
   const window=new BrowserWindow({width:240,height:160,frame:false,show:false,title:'Owned capture-protection probe',backgroundColor:'#26a269',webPreferences:{sandbox:true,nodeIntegration:false}});
   await window.loadURL('data:text/html,<style>html,body{margin:0;width:100%;height:100%;background:%2326a269}</style>');window.showInactive();
   return window.id;
  });
  const samples=[];
  for(const enabled of [false,true]){
   const destination=join(dataDir,enabled?'protected.png':'unprotected.png');
   const source=await app.evaluate(async({BrowserWindow},{id,enabled})=>{
    const window=BrowserWindow.fromId(id)!;window.setContentProtection(enabled);
    await new Promise<void>(resolve=>setTimeout(resolve,250));
    const match=/^window:(\d+):/.exec(window.getMediaSourceId());if(!match)throw Error('Missing exact probe window ID.');
    return {osId:match[1],flag:window.isContentProtected()};
   },{id,enabled});
   const result=await new Promise<{ok:boolean;code?:string|number}>(resolve=>execFile('/usr/sbin/screencapture',[`-l${source.osId}`,'-x','-o','-a','-t','png',destination],{timeout:10000},error=>resolve(error?{ok:false,code:error.code??undefined}:{ok:true})));
   const sample=result.ok?await app.evaluate(({nativeImage},{enabled,flag,destination})=>{
    const image=nativeImage.createFromPath(destination),pixels=image.toBitmap();let green=0;
    for(let i=0;i<pixels.length;i+=4)if(pixels[i+1]>120&&pixels[i+1]>pixels[i+2]*1.8&&pixels[i+1]>pixels[i]*1.25)green++;
    return {enabled,flag,result:'image',size:image.getSize(),greenFraction:green/(pixels.length/4)};
   },{enabled,flag:source.flag,destination}):{enabled,flag:source.flag,result:'capture-rejected',code:result.code};samples.push(sample);
   if(sample.result==='image')await writeFile(`next/evidence/resume-20261025/recorder-${enabled?'protected':'unprotected'}.png`,await readFile(destination));
  }
  expect(samples[0].result).toBe('image');expect('greenFraction' in samples[0]?samples[0].greenFraction:0).toBeGreaterThan(.8);expect(samples[1].flag).toBe(true);
  const protectedVisible='greenFraction' in samples[1]&&samples[1].greenFraction>.8;
  await writeFile('next/evidence/resume-20261025/recorder-probe.json',JSON.stringify({utc:new Date().toISOString(),platform:platform(),arch:arch(),permission,path:'/usr/sbin/screencapture -l<owned-window-id> -x -o -a -t png',samples,protectedContentVisible:protectedVisible,scope:'Actual selected-window macOS capture of a dedicated solid-green test window only. This is not a test of Zoom, OBS, ScreenCaptureKit, or Windows. Modern ScreenCaptureKit may ignore the flag regardless of this result.'},null,2));
 }finally{await app.close();}
});
