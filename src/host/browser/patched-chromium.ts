import {execFile} from 'node:child_process';
import {access,constants,readFile,readdir,stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {MINIMUM_PATCHED_CHROMIUM,browserPatchedUnavailableMessage,type BrowserFound} from '../../shared/browser-control';

// Playwright's bundled Chromium predates MINIMUM_PATCHED_CHROMIUM; websites open only in an installed browser at or above it.
export type BrowserCandidate={name:string;executablePath:string};
/** `launchArgs` is set only by the loopback test engine below; detected browsers never carry extra arguments. */
export type PatchedBrowser=BrowserCandidate&{chromiumVersion:string;contentBlocker?:true;launchArgs?:readonly string[]};

// Chrome-family bundles report the Chromium version as their own; Helium reports its own version, so only its framework counts.
// Helium always runs a built-in uBlock Origin that no launch switch disables; it is disclosed. Brave and Edge cannot be confirmed.
const bundleRules:Record<string,{ownVersionIsChromium:boolean;contentBlocker?:true}>={
 'com.google.Chrome':{ownVersionIsChromium:true},
 'com.google.chrome.for.testing':{ownVersionIsChromium:true},
 'org.chromium.Chromium':{ownVersionIsChromium:true},
 'net.imput.helium':{ownVersionIsChromium:false,contentBlocker:true},
};
// Preference order: no built-in content blocker first. Playwright's cache (~/Library/Caches/ms-playwright) is never searched.
const knownProducts=[['Chrome for Testing','Google Chrome for Testing'],['Google Chrome','Google Chrome'],['Chromium','Chromium'],['Helium','Helium']] as const;

export function knownBrowserCandidates(home=homedir()):BrowserCandidate[]{
 return knownProducts.flatMap(([name,app])=>['/Applications',join(home,'Applications')].map(root=>({name,executablePath:join(root,`${app}.app`,'Contents','MacOS',app)})));
}

const versionPattern=/^\d{1,6}\.\d{1,6}\.\d{1,6}\.\d{1,6}$/;
export function compareChromiumVersions(left:string,right:string):number{
 if(!versionPattern.test(left)||!versionPattern.test(right))throw Error('Invalid Chromium version.');
 const a=left.split('.').map(Number),b=right.split('.').map(Number);
 for(let index=0;index<4;index++)if(a[index]!==b[index])return a[index]<b[index]?-1:1;
 return 0;
}

function plistString(plist:string,key:string):string|undefined{
 return new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plist)?.[1]?.trim();
}
const run=promisify(execFile);
async function readPlist(path:string):Promise<string>{
 const bytes=await readFile(path);
 return bytes.subarray(0,6).toString('latin1')==='bplist'?(await run('/usr/bin/plutil',['-convert','xml1','-o','-',path],{encoding:'utf8',timeout:5_000})).stdout:bytes.toString('utf8');
}
/** Every installed framework version; throws when the framework layout is missing or malformed. */
async function frameworkVersions(contents:string):Promise<string[]>{
 const root=join(contents,'Frameworks'),frameworks=(await readdir(root)).filter(entry=>entry.endsWith(' Framework.framework'));
 if(frameworks.length!==1)throw Error('Unexpected framework layout.');
 const versions=(await readdir(join(root,frameworks[0],'Versions'))).filter(entry=>entry!=='Current');
 if(!versions.length||!versions.every(version=>versionPattern.test(version)))throw Error('Unexpected framework versions.');
 return versions;
}

/** The confirmed Chromium version of an installed app bundle, or undefined. Nothing is executed. */
export async function bundledChromiumVersion(executablePath:string):Promise<string|undefined>{return (await inspectBundle(executablePath))?.version;}
async function inspectBundle(executablePath:string):Promise<{version:string;contentBlocker?:true}|undefined>{
 const bundle=/^(.+\.app)\/Contents\/MacOS\/[^/]+$/.exec(executablePath)?.[1];
 if(!bundle)return undefined;
 await access(executablePath,constants.X_OK);
 if(!(await stat(executablePath)).isFile())return undefined;
 const contents=join(bundle,'Contents'),plist=await readPlist(join(contents,'Info.plist'));
 const rule=Object.hasOwn(bundleRules,plistString(plist,'CFBundleIdentifier')??'')?bundleRules[plistString(plist,'CFBundleIdentifier')!]:undefined;
 if(!rule)return undefined;
 const own=plistString(plist,'CFBundleShortVersionString');
 if(rule.ownVersionIsChromium&&(!own||!versionPattern.test(own)))return undefined;
 // A pending update can leave two framework versions; trust the lowest. A missing or malformed layout refuses.
 const version=[...(rule.ownVersionIsChromium?[own!]:[]),...await frameworkVersions(contents)].sort(compareChromiumVersions)[0];
 return {version,...(rule.contentBlocker?{contentBlocker:true as const}:{})};
}

export type BrowserSearch={browser:PatchedBrowser}|{browser?:undefined;tooOld?:BrowserFound};
/** The first installed browser whose Chromium version is confirmed at or above the minimum. */
export async function findPatchedBrowser(candidates:readonly BrowserCandidate[]=knownBrowserCandidates()):Promise<BrowserSearch>{
 let tooOld:BrowserFound|undefined;
 for(const candidate of candidates){
  let bundle:{version:string;contentBlocker?:true}|undefined;
  try{bundle=await inspectBundle(candidate.executablePath);}catch{continue;}
  if(!bundle)continue;
  if(compareChromiumVersions(bundle.version,MINIMUM_PATCHED_CHROMIUM)>=0)return {browser:{...candidate,chromiumVersion:bundle.version,...(bundle.contentBlocker?{contentBlocker:true as const}:{})}};
  tooOld??={name:candidate.name,version:bundle.version};
 }
 return tooOld?{tooOld}:{};
}

// Test seam: suites that serve their own 127.0.0.1 pages install an engine here (Playwright's own, or Helium), locked to loopback.
// It is ignored inside Electron, so the Glint app can never select it.
export const LOOPBACK_TEST_ENGINE=Symbol.for('glint.test.loopback-browser-engine');
export const LOOPBACK_TEST_LOCK=['--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=127.0.0.1','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] as const;
function loopbackTestEngine():PatchedBrowser|undefined{
 if(process.versions.electron)return undefined;
 const installed=(globalThis as Record<symbol,unknown>)[LOOPBACK_TEST_ENGINE] as {executablePath?:unknown;name?:unknown;contentBlocker?:unknown}|undefined;
 if(typeof installed?.executablePath!=='string')return undefined;
 return {name:typeof installed.name==='string'?installed.name:'Loopback test Chromium',executablePath:installed.executablePath,chromiumVersion:'0.0.0.0',...(installed.contentBlocker===true?{contentBlocker:true as const}:{}),launchArgs:LOOPBACK_TEST_LOCK};
}

/** Refuses instead of falling back to Playwright's bundled Chromium. */
export async function requirePatchedBrowser(candidates?:readonly BrowserCandidate[]):Promise<PatchedBrowser>{
 const loopback=loopbackTestEngine();if(loopback)return loopback;
 const search=await findPatchedBrowser(candidates);
 if(!search.browser)throw Error(browserPatchedUnavailableMessage(search.tooOld));
 return search.browser;
}

/** After launch: the running browser's own version must also qualify (an update or swapped app since detection). */
export function confirmRunningBrowser(detected:PatchedBrowser,readVersion:()=>string):PatchedBrowser{
 let running:string;
 try{running=readVersion();compareChromiumVersions(running,MINIMUM_PATCHED_CHROMIUM);}
 catch(error){if(detected.launchArgs===LOOPBACK_TEST_LOCK)return detected;throw Error(browserPatchedUnavailableMessage(),{cause:error});}
 if(detected.launchArgs!==LOOPBACK_TEST_LOCK&&compareChromiumVersions(running,MINIMUM_PATCHED_CHROMIUM)<0)throw Error(browserPatchedUnavailableMessage({name:detected.name,version:running}));
 return {...detected,chromiumVersion:running};
}

type CdpSession={send(method:string,params?:object):Promise<unknown>;on(event:string,listener:(payload:unknown)=>void):unknown;off(event:string,listener:(payload:unknown)=>void):unknown;detach():Promise<void>};
const BUILT_IN_BLOCKER='chrome-extension://blockjmkbacgjkknlgpkjjiijinjdanf/';
/**
 * Helium's built-in uBlock Origin reloads any tab that loaded before its filters were ready, which would replace
 * the page Glint just observed. Read-only check of the blocker's own ready flag before Glint opens a page.
 */
export async function waitForBuiltInBlocker(session:CdpSession,signal?:AbortSignal,timeoutMs=15_000):Promise<void>{
 const deadline=Date.now()+timeoutMs;let attached:string|undefined,id=0,ready=false;
 const listener=(payload:unknown)=>{
  const {sessionId,message}=payload as {sessionId?:string;message?:string};
  if(sessionId!==attached||typeof message!=='string')return;
  try{if((JSON.parse(message) as {result?:{result?:{value?:unknown}}}).result?.result?.value===true)ready=true;}catch{}
 };
 session.on('Target.receivedMessageFromTarget',listener);
 try{
  while(!ready){
   if(signal?.aborted)throw Error('Browser request was stopped before opening a page.');
   if(Date.now()>deadline)throw Error('The built-in content blocker did not become ready.');
   if(!attached){
    const {targetInfos}=await session.send('Target.getTargets') as {targetInfos:{targetId:string;type:string;url:string}[]};
    const target=targetInfos.find(info=>info.type==='background_page'&&info.url.startsWith(BUILT_IN_BLOCKER));
    if(target)attached=(await session.send('Target.attachToTarget',{targetId:target.targetId,flatten:false}) as {sessionId:string}).sessionId;
   }
   if(attached)await session.send('Target.sendMessageToTarget',{sessionId:attached,message:JSON.stringify({id:++id,method:'Runtime.evaluate',params:{expression:'self.µBlock?.readyToFilter===true',returnByValue:true}})});
   await new Promise(resolve=>setTimeout(resolve,100));
  }
 }finally{session.off('Target.receivedMessageFromTarget',listener);if(attached)await session.send('Target.detachFromTarget',{sessionId:attached}).catch(()=>{});}
}
