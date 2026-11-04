import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {build} from 'esbuild';
import {mkdir,mkdtemp,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {DEFAULT_CHARACTER} from '../src/shared/character-catalog';

// Actual host registration, validation, dispatch and window wiring from src/host/index.ts.
// Only Electron, native metadata and the Codex account are inert (same seams as muse-production.test.ts).
const cleanups:Array<()=>Promise<void>>=[];
beforeEach(()=>{vi.stubGlobal('fetch',()=>{throw Error('Live transport is outside this fixture.');});});
afterEach(async()=>{try{for(const cleanup of cleanups.splice(0).reverse())await cleanup();}finally{vi.unstubAllGlobals();}});
async function fixture(){
 await mkdir(resolve('work/continuation'),{recursive:true});const root=resolve('.'),directory=await mkdtemp(resolve('work/continuation/screen-recording-host-')),key='screenHost'+randomUUID().replaceAll('-','');
 let host:any;cleanups.push(async()=>{try{await host?.closeForTest();}finally{Reflect.deleteProperty(globalThis,key);await rm(directory,{recursive:true,force:true});}});
 await symlink(join(root,'node_modules'),join(directory,'node_modules'),'dir');await writeFile(join(directory,'character-preferences.json'),JSON.stringify({schemaVersion:1,revision:0,profile:DEFAULT_CHARACTER}));
 const handlers=new Map<string,Function>(),windows:any[]=[],events:any[]=[],seams={handlers,windows,events};Reflect.set(globalThis,key,seams);const seam=`globalThis[${JSON.stringify(key)}]`;
 const electron=`const noop=()=>{};export const app={getPath:()=>process.env.WINDOW_COMPANION_DATA_DIR,isReady:()=>false,isHardwareAccelerationEnabled:()=>true,disableHardwareAcceleration:()=>{throw Error('No hardware action');},setPath:noop,whenReady:()=>new Promise(()=>{}),on:noop};export class BrowserWindow {constructor(options){this.options=options;this.protection=[];this.webContents={mainFrame:{},setWindowOpenHandler:noop,on:noop,send:(channel,event)=>${seam}.events.push(event)};this.destroyed=false;${seam}.windows.push(this);}once(){return this}on(){return this}isDestroyed(){return this.destroyed}focus(){}setContentProtection(value){this.protection.push(value)}loadURL(value){this.url=value;}close(){this.destroyed=true;}};export const Notification={isSupported:()=>false};export const Menu={};export class Tray{};export const dialog={showMessageBox:async()=>({response:0})};export const globalShortcut={isRegistered:()=>false,unregisterAll:noop};export const ipcMain={handle:(name,handler)=>${seam}.handlers.set(name,handler)};export const nativeImage={};export const safeStorage={isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from('encrypted-fixture:'+text),decryptString:bytes=>bytes.toString().replace(/^encrypted-fixture:/,'')};export const systemPreferences={isTrustedAccessibilityClient:()=>false};export const session={};export const screen={};export const clipboard={write(){throw Error('No clipboard action')}};export class ClipboardItem {constructor(){throw Error('No clipboard action')}};`;
 const native=`export class NativeSourceAdapter {permissionStatus(){return Promise.resolve({screen:'not-granted',accessibility:'not-granted'})}capture(){throw Error('No native capture')}};export const placeCompanion=()=>{throw Error('No native placement')};`;
 const codex=`export const buildCodexInput=()=>{throw Error('Codex serialization is outside this fixture.');};export class CodexProvider {status(){return Promise.resolve({provider:'Codex (temporary)',configured:false,endpoint:'inert://account',model:'inert',state:'unconfigured',detail:'inert',specialized:{sam:'off',computer:'off'}})}reset(){}close(){}defaultInference(){return undefined}}`;
 const source=await readFile(join(root,'src/host/index.ts'),'utf8'),registration=source.match(/ipcMain\.handle\('companion:command',dispatchCompanionCommand\)/)?.[0];
 // The production panel line that follows panel construction; replayed exactly so the fixture panel is wired the same way.
 const panelProtection=source.match(/\n  panel=new BrowserWindow\([^\n]*\n  (if\(process\.platform==='darwin'\|\|process\.platform==='win32'\)screenRecording\.track\(panel\))\n/)?.[1];
 if(!registration||!panelProtection)throw Error('Production registration or panel protection not found.');
 if(source.includes('setContentProtection('))throw Error('A window bypasses the shared screen recording owner.');
 const outfile=join(directory,'host.cjs'),contents=source.replace('new MuseSettings(dataDir,safeStorage)','new MuseSettings(dataDir,safeStorage,{})')+`
 export const initializeForTest=async()=>{core=await createCompanion({dataDir:join(dataDir,'store')});botPreferences=await BotPreferences.open(dataDir,core);await museSettings.load();panel=new BrowserWindow({title:'Glint'});${panelProtection};${registration};};
 export const panelForTest=()=>panel;
 export const credentialForTest=()=>credentialWindow;
 export const dispatchForTest=value=>${seam}.handlers.get('companion:command')({sender:panel.webContents,senderFrame:panel.webContents.mainFrame},value);
 export const untrustedForTest=value=>${seam}.handlers.get('companion:command')({sender:{},senderFrame:{}},value);
 export const holdGateForTest=()=>{let release;const done=contentBackupGate.maintain(()=>new Promise(resolve=>{release=resolve;}),{before:async()=>{},freeze:async()=>'screen-recording-test',resume:()=>{}});return async()=>{release();await done;};};
 export const sealGateForTest=()=>contentBackupGate.seal();
 export const closeForTest=()=>core.close();`;
 await build({stdin:{contents,resolveDir:join(root,'src/host'),sourcefile:join(root,'src/host/index.ts'),loader:'ts'},bundle:true,platform:'node',format:'cjs',define:{'import.meta.url':JSON.stringify(pathToFileURL(outfile).href)},packages:'external',outfile,logLevel:'silent',plugins:[{name:'inert-account-native',setup(b){b.onResolve({filter:/^(electron|\.\/codex-provider|\.\/native)$/},a=>({path:a.path,namespace:'inert'}));b.onLoad({filter:/.*/,namespace:'inert'},a=>({contents:a.path==='electron'?electron:a.path==='./native'?native:codex,loader:'js'}));}}]});
 const prior=process.env.WINDOW_COMPANION_DATA_DIR;process.env.WINDOW_COMPANION_DATA_DIR=directory;
 try{host=createRequire(pathToFileURL(outfile))(outfile);}finally{if(prior===undefined)delete process.env.WINDOW_COMPANION_DATA_DIR;else process.env.WINDOW_COMPANION_DATA_DIR=prior;}
 await host.initializeForTest();
 return {host,windows,events,command:(value:unknown)=>host.dispatchForTest(value)};
}

it.runIf(process.platform==='darwin')('production host starts protected, toggles the main panel immediately, keeps the Muse key window protected and validates IPC',async()=>{
 const f=await fixture(),panel=f.host.panelForTest();
 expect(panel.protection).toEqual([true]);
 expect(await f.command({type:'screen-recording.get'})).toEqual({allowed:false,confirmed:true,scope:'this-session'});
 for(const bad of [{type:'screen-recording.set'},{type:'screen-recording.set',allowed:'true'},{type:'screen-recording.set',allowed:true,persist:true},{type:'screen-recording.get',allowed:true},{type:'screen-recording.unknown'}])
  await expect(f.command(bad)).rejects.toThrow();
 await expect(f.host.untrustedForTest({type:'screen-recording.set',allowed:true})).rejects.toThrow();
 expect(panel.protection).toEqual([true]);
 expect(await f.command({type:'screen-recording.set',allowed:true})).toEqual({allowed:true,confirmed:true,scope:'this-session'});
 expect(panel.protection.at(-1)).toBe(false);expect(f.events).toContainEqual({type:'screen-recording.changed',state:{allowed:true,confirmed:true,scope:'this-session'}});
 await f.command({type:'connection.select',provider:'meta'});await f.command({type:'connection.configure'});
 const credential=f.host.credentialForTest();expect(credential?.options.title).toBe('Connect Muse');expect(credential.protection).toEqual([true]);
 expect(await f.command({type:'screen-recording.set',allowed:false})).toEqual({allowed:false,confirmed:true,scope:'this-session'});
 expect(panel.protection.at(-1)).toBe(true);expect(credential.protection.every(Boolean)).toBe(true);
 await f.command({type:'screen-recording.set',allowed:true});expect(credential.protection.every(Boolean)).toBe(true);expect(panel.protection.at(-1)).toBe(false);
});

it.runIf(process.platform==='darwin')('restoring protection and reading the state are never blocked by a content backup, restore or post-restore seal',async()=>{
 const f=await fixture(),panel=f.host.panelForTest();
 await f.command({type:'screen-recording.set',allowed:true});expect(panel.protection.at(-1)).toBe(false);
 const release=f.host.holdGateForTest();await Promise.resolve();
 await expect(f.command({type:'system.settings.get'})).rejects.toThrow();// the gate is really closed for content commands
 expect(await f.command({type:'screen-recording.get'})).toEqual({allowed:true,confirmed:true,scope:'this-session'});
 expect(await f.command({type:'screen-recording.set',allowed:false})).toEqual({allowed:false,confirmed:true,scope:'this-session'});expect(panel.protection.at(-1)).toBe(true);
 expect(f.events.at(-1)).toEqual({type:'screen-recording.changed',state:{allowed:false,confirmed:true,scope:'this-session'}});
 await release();
 await f.command({type:'screen-recording.set',allowed:true});f.host.sealGateForTest();
 await expect(f.command({type:'system.settings.get'})).rejects.toThrow();
 expect(await f.command({type:'screen-recording.get'})).toEqual({allowed:true,confirmed:true,scope:'this-session'});
 expect(await f.command({type:'screen-recording.set',allowed:false})).toEqual({allowed:false,confirmed:true,scope:'this-session'});expect(panel.protection.at(-1)).toBe(true);
 await expect(f.command({type:'screen-recording.set',allowed:'false'})).rejects.toThrow();expect(panel.protection.at(-1)).toBe(true);
});
