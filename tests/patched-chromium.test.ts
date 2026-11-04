import {execFileSync} from 'node:child_process';
import {chmod,mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MINIMUM_PATCHED_CHROMIUM,browserEngineLabel,browserPatchedUnavailableMessage,isBrowserPatchedUnavailable} from '../src/shared/browser-control';
import {publicErrorMessage} from '../src/shared/public-messages';
import {BrowserControl} from '../src/host/browser/control';
import type {BrowserCandidate} from '../src/host/browser/patched-chromium';
import {choiceBrowser,choiceOrigin,stubChoiceDom} from './browser-select.fixture';

const external=vi.hoisted(()=>({launch:vi.fn(),candidates:[] as BrowserCandidate[]}));
vi.mock('playwright-core',()=>({chromium:{launch:external.launch}}));
// Real detection over fake installed browsers only; the person's /Applications is never read by product calls here.
vi.mock('../src/host/browser/patched-chromium',async original=>{const actual=await original<typeof import('../src/host/browser/patched-chromium')>();return {...actual,requirePatchedBrowser:()=>actual.requirePatchedBrowser(external.candidates)};});
const actual=await vi.importActual<typeof import('../src/host/browser/patched-chromium')>('../src/host/browser/patched-chromium');
const {bundledChromiumVersion,compareChromiumVersions,confirmRunningBrowser,findPatchedBrowser,knownBrowserCandidates,LOOPBACK_TEST_ENGINE,LOOPBACK_TEST_LOCK,waitForBuiltInBlocker}=actual;
const {LocalBrowser}=await import('../src/host/browser/local-browser');
const {BrowserCoordinator}=await import('../src/host/browser/coordinator');
const {createCompanion}=await import('../src/core/companion');

let root='';
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'patched-chromium-'));external.candidates=[];external.launch.mockReset();});
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllGlobals();delete (globalThis as Record<symbol,unknown>)[LOOPBACK_TEST_ENGINE];await rm(root,{recursive:true,force:true});});

type Fake={id:string;version:string;frameworks?:string[]|null;executable?:boolean;binaryPlist?:boolean;extraFramework?:boolean};
/** A fake installed .app: an inert script that is never run, an Info.plist and a framework layout. */
async function fakeApp(app:string,{id,version,frameworks,executable=true,binaryPlist=false,extraFramework=false}:Fake):Promise<string>{
 const contents=join(root,`${app}.app`,'Contents'),path=join(contents,'MacOS',app);
 await mkdir(join(contents,'MacOS'),{recursive:true});
 await writeFile(path,'#!/bin/sh\necho "fake executables are never run" >&2\nexit 97\n');await chmod(path,executable?0o755:0o644);
 const plist=join(contents,'Info.plist');
 await writeFile(plist,`<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${id}</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>\n`);
 if(binaryPlist)execFileSync('/usr/bin/plutil',['-convert','binary1',plist]);
 if(frameworks!==null)for(const framework of [...(frameworks??[version]),'Current'])await mkdir(join(contents,'Frameworks',`${app} Framework.framework`,'Versions',framework),{recursive:true});
 if(extraFramework)await mkdir(join(contents,'Frameworks','Other Framework.framework','Versions',version),{recursive:true});
 return path;
}
const chrome=(version:string,extra:Partial<Fake>={})=>fakeApp('Google Chrome',{id:'com.google.Chrome',version,...extra});
const refusal=(found?:{name:string;version:string})=>browserPatchedUnavailableMessage(found);

it('compares four-part Chromium versions numerically against the patched minimum',()=>{
 expect(MINIMUM_PATCHED_CHROMIUM).toBe('156.0.8078.73');
 for(const vulnerable of ['156.0.8078.4','156.0.8078.72','155.0.9999.999','99.0.0.0'])expect(compareChromiumVersions(vulnerable,MINIMUM_PATCHED_CHROMIUM)).toBe(-1);
 for(const patched of ['156.0.8078.73','156.0.8078.79','156.0.8079.0','157.0.0.0'])expect(compareChromiumVersions(patched,MINIMUM_PATCHED_CHROMIUM)).toBeGreaterThanOrEqual(0);
 for(const invalid of ['156.0.8078','156.0.8078.73-beta','v156.0.8078.73',''])expect(()=>compareChromiumVersions(invalid,MINIMUM_PATCHED_CHROMIUM)).toThrow('Invalid Chromium version');
});

it('searches Chrome for Testing, Google Chrome, Chromium and Helium, in that preference, in both application folders',()=>{
 const candidates=knownBrowserCandidates('/Users/fixture');
 expect([...new Set(candidates.map(candidate=>candidate.name))]).toEqual(['Chrome for Testing','Google Chrome','Chromium','Helium']);
 expect(candidates.map(candidate=>candidate.executablePath)).toContain('/Users/fixture/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
 expect(candidates.map(candidate=>candidate.executablePath)).toContain('/Applications/Helium.app/Contents/MacOS/Helium');
 for(const excluded of ['Brave','Edge','ms-playwright'])expect(JSON.stringify(candidates)).not.toContain(excluded);
});

it('reads each bundle’s Chromium version without running it and refuses unknown or malformed bundles',async()=>{
 expect(await bundledChromiumVersion(await chrome('156.0.8078.80'))).toBe('156.0.8078.80');
 expect(await bundledChromiumVersion(await fakeApp('Google Chrome for Testing',{id:'com.google.chrome.for.testing',version:'156.0.8078.90'}))).toBe('156.0.8078.90');
 expect(await bundledChromiumVersion(await fakeApp('Chromium',{id:'org.chromium.Chromium',version:'156.0.8078.80',frameworks:['156.0.8078.4','156.0.8078.80']}))).toBe('156.0.8078.4');
 expect(await bundledChromiumVersion(await fakeApp('Helium',{id:'net.imput.helium',version:'0.20.3.1',frameworks:['156.0.8078.79']}))).toBe('156.0.8078.79');
 await expect(bundledChromiumVersion(await fakeApp('Helium 2',{id:'net.imput.helium',version:'0.20.3.1',frameworks:null}))).rejects.toThrow();
 for(const [app,id] of [['Brave Browser','com.brave.Browser'],['Microsoft Edge','com.microsoft.edgemac'],['Renamed','example.not.chromium']])expect(await bundledChromiumVersion(await fakeApp(app,{id,version:'200.0.0.0'}))).toBeUndefined();
 await rm(root,{recursive:true,force:true});
 await expect(bundledChromiumVersion(await chrome('160.0.0.0',{frameworks:null}))).rejects.toThrow();await rm(root,{recursive:true,force:true});
 await expect(bundledChromiumVersion(await chrome('160.0.0.0',{frameworks:[]}))).rejects.toThrow('Unexpected framework versions');await rm(root,{recursive:true,force:true});
 await expect(bundledChromiumVersion(await chrome('160.0.0.0',{frameworks:['160.0.0.0','beta']}))).rejects.toThrow('Unexpected framework versions');await rm(root,{recursive:true,force:true});
 await expect(bundledChromiumVersion(await chrome('160.0.0.0',{extraFramework:true}))).rejects.toThrow('Unexpected framework layout');
 expect(await bundledChromiumVersion(join(root,'chromium-linux','chrome'))).toBeUndefined();
});

it.runIf(process.platform==='darwin')('reads binary Info.plist files through plutil asynchronously',async()=>{
 expect(await bundledChromiumVersion(await chrome('156.0.8078.90',{binaryPlist:true}))).toBe('156.0.8078.90');
});

it('chooses the first confirmed patched browser and reports the first too-old one otherwise',async()=>{
 const missing={name:'Chromium',executablePath:join(root,'Missing.app','Contents','MacOS','Missing')};
 const old={name:'Google Chrome',executablePath:await chrome('156.0.8078.72')};
 const noExec={name:'Chromium',executablePath:await fakeApp('Chromium',{id:'org.chromium.Chromium',version:'157.0.0.0',executable:false})};
 const brave={name:'Brave',executablePath:await fakeApp('Brave Browser',{id:'com.brave.Browser',version:'200.1.90.1'})};
 const helium={name:'Helium',executablePath:await fakeApp('Helium',{id:'net.imput.helium',version:'0.20.3.1',frameworks:['156.0.8078.79']})};
 const testing={name:'Chrome for Testing',executablePath:await fakeApp('Google Chrome for Testing',{id:'com.google.chrome.for.testing',version:'156.0.8078.79'})};
 expect(await findPatchedBrowser([missing,old,noExec,brave,testing,helium])).toEqual({browser:{...testing,chromiumVersion:'156.0.8078.79'}});
 expect(await findPatchedBrowser([missing,noExec,brave,helium])).toEqual({browser:{...helium,chromiumVersion:'156.0.8078.79',contentBlocker:true}});
 expect(await findPatchedBrowser([missing,old,noExec,brave])).toEqual({tooOld:{name:'Google Chrome',version:'156.0.8078.72'}});
 expect(await findPatchedBrowser([missing,noExec,brave])).toEqual({});
});

it('refuses with an actionable public message naming the too-old browser and the folders searched',async()=>{
 const found=refusal({name:'Google Chrome',version:'156.0.8078.4'}),none=refusal();
 expect(found).toContain('Google Chrome, Chrome for Testing, Chromium or Helium built on Chromium 156.0.8078.73 or later');expect(found).toContain('It found Google Chrome 156.0.8078.4, which is too old.');expect(found).toContain('/Applications and ~/Applications');
 expect(none).toContain('It found none of them.');
 await expect(actual.requirePatchedBrowser([{name:'Google Chrome',executablePath:await chrome('156.0.8078.4')}])).rejects.toThrow(found);
 for(const message of [found,none]){expect(publicErrorMessage(Error(message))).toBe(message);expect(publicErrorMessage(new Error(`Error invoking remote method 'companion:command': Error: ${message}`))).toBe(message);}
 expect(isBrowserPatchedUnavailable(found.replace('Google Chrome 156','Evil 156'))).toBe(false);expect(refusal({name:'/Users/private/Evil',version:'1.2.3.4'})).toBe(none);
});

it('never launches the bundled Chromium when no patched browser is installed',async()=>{
 external.candidates=[{name:'Google Chrome',executablePath:await chrome('156.0.8078.4')}];
 await expect(LocalBrowser.open({taskId:'refused',origin:'https://example.invalid',url:'https://example.invalid'})).rejects.toThrow(refusal({name:'Google Chrome',version:'156.0.8078.4'}));
 expect(external.launch).not.toHaveBeenCalled();
});

function launched(version:string){
 stubChoiceDom();const owned=choiceBrowser('patched'),close=vi.fn(async()=>{}),newContext=vi.fn(async()=>({on:()=>{},newPage:async()=>owned.page,route:async()=>{},routeWebSocket:async()=>{},addInitScript:async()=>{},close:async()=>{}}));
 external.launch.mockResolvedValue({version:()=>version,newContext,close});return {close,newContext};
}

it('launches the detected browser by path with the sandbox kept and a fresh temporary profile, disclosing the running version',async()=>{
 const path=await chrome('156.0.8078.80');external.candidates=[{name:'Google Chrome',executablePath:path}];launched('156.0.8078.90');
 const browser=await LocalBrowser.open({taskId:'patched',origin:choiceOrigin,url:choiceOrigin+'/form'});
 try{
  expect(external.launch).toHaveBeenCalledOnce();expect(external.launch).toHaveBeenCalledWith({executablePath:path,headless:true,chromiumSandbox:true});
  for(const option of ['userDataDir','args','channel','ignoreDefaultArgs'])expect(external.launch.mock.calls[0][0]).not.toHaveProperty(option);
  expect(browser.engine).toEqual({name:'Google Chrome',chromiumVersion:'156.0.8078.90'});
 }finally{await browser.close();}
});

it.each([['156.0.8078.4',{name:'Google Chrome',version:'156.0.8078.4'}],['not-a-version',undefined]] as const)('closes and refuses when the running browser reports %s',async(version,found)=>{
 external.candidates=[{name:'Google Chrome',executablePath:await chrome('156.0.8078.80')}];const {close,newContext}=launched(version);
 await expect(LocalBrowser.open({taskId:'swapped',origin:choiceOrigin,url:choiceOrigin+'/form'})).rejects.toThrow(refusal(found));
 expect(close).toHaveBeenCalledOnce();expect(newContext).not.toHaveBeenCalled();
});

it('refuses before the start consent when no patched browser is installed',async()=>{
 external.candidates=[{name:'Google Chrome',executablePath:await chrome('156.0.8078.4')}];
 const open=vi.spyOn(LocalBrowser,'open'),authorizeStart=vi.fn(async()=>{}),plan=vi.fn();
 const dataDir=await mkdtemp(join(tmpdir(),'patched-consent-')),core=await createCompanion({dataDir});
 try{
  const task=await core.createTask({title:'Refused before consent'});
  const result=await new BrowserCoordinator(core,{endpointKey:'fixture',plan}).run({taskId:task.id,requestId:'refused',goal:'Read the form',origin:choiceOrigin,url:choiceOrigin+'/form',transmissionApproved:true,authorizeStart,approveAction:async()=>({approved:false})});
  expect({status:result.status,error:result.error}).toEqual({status:'failed',error:refusal({name:'Google Chrome',version:'156.0.8078.4'})});
  expect(authorizeStart).not.toHaveBeenCalled();expect(open).not.toHaveBeenCalled();expect(plan).not.toHaveBeenCalled();expect(external.launch).not.toHaveBeenCalled();
 }finally{await core.close();await rm(dataDir,{recursive:true,force:true});}
});

it('discloses the browser name and running Chromium version through browser control status',async()=>{
 external.candidates=[{name:'Google Chrome',executablePath:await chrome('156.0.8078.80')}];
 stubChoiceDom();const dataDir=await mkdtemp(join(tmpdir(),'patched-disclosure-')),core=await createCompanion({dataDir}),control=new BrowserControl();
 try{
  expect(control.status()).not.toHaveProperty('browser');
  const task=await core.createTask({title:'Patched browser disclosure'}),owned=choiceBrowser(task.id);let seen:unknown;
  owned.browser.engine={name:'Google Chrome',chromiumVersion:'156.0.8078.90'};vi.spyOn(LocalBrowser,'open').mockResolvedValue(owned.browser);
  const coordinator=new BrowserCoordinator(core,{endpointKey:'fixture',async plan(){seen=control.status();return {kind:'answer',markdown:'Read.',modules:[]};}});
  const result=await coordinator.run({taskId:task.id,requestId:'disclose',goal:'Read the form',origin:choiceOrigin,url:choiceOrigin+'/form',transmissionApproved:true,control,approveAction:async()=>({approved:false})});
  expect({status:result.status,error:result.error}).toEqual({status:'completed',error:undefined});
  expect(seen).toMatchObject({mode:'agent',browser:{name:'Google Chrome',chromiumVersion:'156.0.8078.90'}});
  expect(browserEngineLabel({name:'Google Chrome',chromiumVersion:'156.0.8078.90'})).toBe('Google Chrome · Chromium 156.0.8078.90');
 expect(browserEngineLabel({name:'Helium',chromiumVersion:'156.0.8078.79',contentBlocker:true})).toBe('Helium · Chromium 156.0.8078.79. Helium’s built-in content blocker is on and may hide or block parts of pages.');
 }finally{await core.close();await rm(dataDir,{recursive:true,force:true});}
});

it('production code cannot select Playwright’s bundled engine',async()=>{
 const {chromium}=await vi.importActual<typeof import('playwright-core')>('playwright-core'),bundled=chromium.executablePath();
 // Detection refuses the real bundled engine by version, even when offered it directly.
 expect(await findPatchedBrowser([{name:'Chrome for Testing',executablePath:bundled}])).toEqual({tooOld:{name:'Chrome for Testing',version:'156.0.8078.4'}});
 expect(()=>confirmRunningBrowser({name:'Chrome for Testing',executablePath:bundled,chromiumVersion:'156.0.8078.80'},()=>'156.0.8078.4')).toThrow('which is too old');
 // The loopback test seam carries its lock, and Glint's Electron process ignores it.
 (globalThis as Record<symbol,unknown>)[LOOPBACK_TEST_ENGINE]={executablePath:bundled};
 expect(await actual.requirePatchedBrowser([])).toEqual({name:'Loopback test Chromium',executablePath:bundled,chromiumVersion:'0.0.0.0',launchArgs:LOOPBACK_TEST_LOCK});
 Object.defineProperty(process.versions,'electron',{value:'40.0.0',configurable:true});
 try{await expect(actual.requirePatchedBrowser([])).rejects.toThrow(refusal());}
 finally{delete (process.versions as Record<string,string|undefined>).electron;}
 expect(process.versions.electron).toBeUndefined();
});

/** Inert CDP stand-in for Helium's built-in blocker background page; it becomes ready after `readyAfter` checks. */
function blockerSession(readyAfter:number){
 const listeners=new Set<(payload:unknown)=>void>();let checks=0;const sent:string[]=[];
 return {sent,session:{
  on:(_event:string,listener:(payload:unknown)=>void)=>listeners.add(listener),off:(_event:string,listener:(payload:unknown)=>void)=>listeners.delete(listener),detach:async()=>{},
  send:async(method:string,params?:{message?:string})=>{
   sent.push(method);
   if(method==='Target.getTargets')return {targetInfos:[{targetId:'page',type:'page',url:'about:blank'},{targetId:'blocker',type:'background_page',url:'chrome-extension://blockjmkbacgjkknlgpkjjiijinjdanf/background.html'}]};
   if(method==='Target.attachToTarget')return {sessionId:'blocker-session'};
   if(method==='Target.sendMessageToTarget'){const {id}=JSON.parse(params!.message!);const value=++checks>readyAfter;queueMicrotask(()=>{for(const listener of listeners)listener({sessionId:'blocker-session',message:JSON.stringify({id,result:{result:{value}}})});});}
   return {};
  }}};
}

it('waits for Helium’s built-in blocker to be ready before a page opens, and gives up after its limit',async()=>{
 const ready=blockerSession(3);await waitForBuiltInBlocker(ready.session);
 expect(ready.sent.filter(method=>method==='Target.sendMessageToTarget')).toHaveLength(4);expect(ready.sent.at(-1)).toBe('Target.detachFromTarget');
 await expect(waitForBuiltInBlocker(blockerSession(1e9).session,undefined,250)).rejects.toThrow('did not become ready');
 const stop=new AbortController();stop.abort();await expect(waitForBuiltInBlocker(blockerSession(1e9).session,stop.signal)).rejects.toThrow('stopped before opening a page');
});
