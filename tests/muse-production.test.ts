import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {build} from 'esbuild';
import {mkdir,mkdtemp,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {MUSE_CONNECTION_MESSAGES,MUSE_PROFILES,MUSE_TEST_REPLY,type MuseProfile} from '../src/shared/muse-connection';
import {DEFAULT_CHARACTER} from '../src/shared/character-catalog';

// Actual host registration/validation/dispatch, core, settings, provider and SDK.
// Only Electron, native metadata, Codex account and HTTP transport are inert.
const cleanups:Array<()=>Promise<void>>=[];
beforeEach(()=>{vi.stubGlobal('fetch',()=>{throw Error('Live transport is outside this fixture.');});});
afterEach(async()=>{try{for(const cleanup of cleanups.splice(0).reverse())await cleanup();}finally{vi.unstubAllGlobals();}});
async function fixture(savedProfile?:string){
 await mkdir(resolve('work/continuation'),{recursive:true});const root=resolve('.'),directory=await mkdtemp(resolve('work/continuation/muse-host-')),key='museHost'+randomUUID().replaceAll('-','');
 let host:any;cleanups.push(async()=>{try{await host?.closeForTest();}finally{Reflect.deleteProperty(globalThis,key);await rm(directory,{recursive:true,force:true});}});
 await symlink(join(root,'node_modules'),join(directory,'node_modules'),'dir');await writeFile(join(directory,'character-preferences.json'),JSON.stringify({schemaVersion:1,revision:0,profile:DEFAULT_CHARACTER}));
 if(savedProfile!==undefined)await writeFile(join(directory,'muse-profile.json'),savedProfile);
  const handlers=new Map<string,Function>(),calls={reviews:[] as any[],bodies:[] as any[],urls:[] as string[],authorization:[] as Array<string|null>,redirects:[] as Array<RequestRedirect|undefined>,captures:0,secure:[] as string[]},state={response:1,status:200,confirm:undefined as undefined|((detail:any)=>Promise<{response:number}>),wait:false,keychain:'ready' as 'ready'|'pending'};
 const seams={handlers,state,calls,fetch:vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
   calls.urls.push(String(url));const body=JSON.parse(String(init?.body));calls.bodies.push(body);calls.authorization.push(new Headers(init?.headers).get('authorization'));calls.redirects.push(init?.redirect);
  if(state.wait)return new Promise<Response>((_done,reject)=>{init?.signal?.addEventListener('abort',()=>reject(init.signal?.reason),{once:true});});
  if(state.status!==200)return new Response('PRIVATE_REJECTED_BODY synthetic-secret-key',{status:state.status});
  const chunk=(delta:unknown,finish_reason:string|null)=>'data: '+JSON.stringify({id:'synthetic',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\n';
  return new Response(chunk({content:MUSE_TEST_REPLY},null)+chunk({},'stop')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
 })};Reflect.set(globalThis,key,seams);const seam=`globalThis[${JSON.stringify(key)}]`;
 const electron=`const noop=()=>{};export const app={getPath:()=>process.env.WINDOW_COMPANION_DATA_DIR,isReady:()=>false,isHardwareAccelerationEnabled:()=>true,disableHardwareAcceleration:()=>{throw Error('No hardware action');},setPath:noop,whenReady:()=>new Promise(()=>{}),on:noop};export class BrowserWindow {constructor(){this.webContents={mainFrame:{},setWindowOpenHandler:noop,on:noop};this.destroyed=false;}once(name,listener){(this.listeners??={})[name]=listener;return this}isDestroyed(){return this.destroyed}focus(){}setContentProtection(){}loadURL(value){this.url=value;}close(){if(this.destroyed)return;this.destroyed=true;this.listeners?.closed?.();}};export const Notification={isSupported:()=>false};export const Menu={};export class Tray{};export const dialog={showMessageBox:async(_panel,detail)=>{${seam}.calls.reviews.push(detail);return ${seam}.state.confirm?${seam}.state.confirm(detail):{response:${seam}.state.response}}};export const globalShortcut={isRegistered:()=>false,unregisterAll:noop};export const ipcMain={handle:(name,handler)=>${seam}.handlers.set(name,handler)};export const nativeImage={};export const safeStorage={isAsyncEncryptionAvailable:async()=>{${seam}.calls.secure.push('available');return true},encryptStringAsync:async text=>{${seam}.calls.secure.push('encrypt');return ${seam}.state.keychain==='pending'?new Promise(()=>{}):Buffer.from('encrypted-fixture:'+text)},decryptStringAsync:async bytes=>{${seam}.calls.secure.push('decrypt');return ${seam}.state.keychain==='pending'?new Promise(()=>{}):{result:bytes.toString().replace(/^encrypted-fixture:/,''),shouldReEncrypt:false}}};export const systemPreferences={isTrustedAccessibilityClient:()=>false};export const session={};export const screen={};export const clipboard={write(){throw Error('No clipboard action')}};`;
 const native=`export class NativeSourceAdapter {permissionStatus(){return Promise.resolve({screen:'not-granted',accessibility:'not-granted'})}capture(){throw Error('No native capture')}};export const placeCompanion=()=>{throw Error('No native placement')};`;
 const codex=`export const buildCodexInput=()=>{throw Error('Codex serialization is outside this fixture.');};export class CodexProvider {status(){return Promise.resolve({provider:'Codex (temporary)',configured:false,endpoint:'inert://account',model:'inert',state:'unconfigured',detail:'inert',specialized:{sam:'off',computer:'off'}})}reset(){}close(){}defaultInference(){return undefined}}`;
 const source=await readFile(join(root,'src/host/index.ts'),'utf8'),registration=source.match(/ipcMain\.handle\('companion:command',dispatchCompanionCommand\)/)?.[0],credentialRegistration=source.match(/ipcMain\.handle\('credential:save',async\(event,value\)=>\{[\s\S]*?\n  \}\)/)?.[0];
 if(!registration||!credentialRegistration)throw Error('Production IPC registration not found.');
 for(const injection of ['new MuseSettings(dataDir,safeStorage)','new MetaProvider({getKey,'])if(source.split(injection).length!==2)throw Error('Production inert injection point changed: '+injection);
 const outfile=join(directory,'host.cjs'),contents=source.replace('new MuseSettings(dataDir,safeStorage)','new MuseSettings(dataDir,safeStorage,{})').replace('new MetaProvider({getKey,','new MetaProvider({fetch:'+seam+'.fetch,getKey,')+`
 export {metaProvider,museSettings};
 export const initializeForTest=async()=>{core=await createCompanion({dataDir:join(dataDir,'store')});botPreferences=await BotPreferences.open(dataDir,core);await museSettings.load();panel={isDestroyed:()=>false,webContents:{mainFrame:{},send(){}}};${registration};${credentialRegistration};};
 export const dispatchForTest=value=>${seam}.handlers.get('companion:command')({sender:panel.webContents,senderFrame:panel.webContents.mainFrame},value);
 export const untrustedForTest=value=>${seam}.handlers.get('companion:command')({sender:{},senderFrame:{}},value);
 export const saveCredentialForTest=value=>${seam}.handlers.get('credential:save')({sender:credentialWindow?.webContents,senderFrame:credentialWindow?.webContents.mainFrame},value);
 export const dialogHtmlForTest=()=>credentialWindow?.url;
 export const closeCredentialWindowForTest=()=>credentialWindow?.close();
 export const closeForTest=()=>core.close();`;
 await build({stdin:{contents,resolveDir:join(root,'src/host'),sourcefile:join(root,'src/host/index.ts'),loader:'ts'},bundle:true,platform:'node',format:'cjs',define:{'import.meta.url':JSON.stringify(pathToFileURL(outfile).href)},packages:'external',outfile,logLevel:'silent',plugins:[{name:'inert-account-native',setup(b){b.onResolve({filter:/^(electron|\.\/codex-provider|\.\/native)$/},a=>({path:a.path,namespace:'inert'}));b.onLoad({filter:/.*/,namespace:'inert'},a=>({contents:a.path==='electron'?electron+`export class ClipboardItem {constructor(){throw Error('No clipboard action')}};`:a.path==='./native'?native:codex,loader:'js'}));}}]});
 const prior=process.env.WINDOW_COMPANION_DATA_DIR;process.env.WINDOW_COMPANION_DATA_DIR=directory;
 try{host=createRequire(pathToFileURL(outfile))(outfile);}finally{if(prior===undefined)delete process.env.WINDOW_COMPANION_DATA_DIR;else process.env.WINDOW_COMPANION_DATA_DIR=prior;}
 await host.initializeForTest();
 return {host,directory,calls,state,fetch:seams.fetch,command:(value:unknown)=>host.dispatchForTest(value)};
}

it('registers the production handlers and validates trusted renderer/profile/test payloads before provider access',async()=>{
 const f=await fixture();await expect(f.host.untrustedForTest({type:'muse.test',profile:'meta-direct',id:'inert'})).rejects.toThrow();await expect(f.command({type:'muse.profile',profile:'arbitrary'})).rejects.toThrow();await expect(f.command({type:'muse.test',profile:'meta-direct',id:'inert',prompt:'PRIVATE'})).rejects.toThrow();expect(f.calls.urls).toEqual([]);expect(f.calls.reviews).toEqual([]);
});

it.each(['meta-direct','baseten-hackathon'] as const)('uses actual Settings commands, exact native approval and selected SDK endpoint/model: %s',async profile=>{
  const f=await fixture(),keys={'meta-direct':'synthetic-direct-key','baseten-hackathon':'synthetic-baseten-key'};for(const p of ['meta-direct','baseten-hackathon'] as const)await f.host.museSettings.saveKey(p,keys[p]);await f.command({type:'connection.select',provider:'meta'});await f.command({type:'muse.profile',profile});f.state.response=0;
 expect(await f.command({type:'muse.test',profile,id:'declined'})).toMatchObject({kind:'cancelled'});expect(f.calls.urls).toEqual([]);f.state.response=1;expect(await f.command({type:'muse.test',profile,id:'approved'})).toMatchObject({kind:'passed'});
  expect(f.calls.urls).toEqual([MUSE_PROFILES[profile].endpoint+'/chat/completions']);expect(f.calls.authorization).toEqual(['Bearer '+keys[profile]]);expect(f.calls.redirects).toEqual(['error']);expect(f.calls.bodies[0].model).toBe(MUSE_PROFILES[profile].model);expect(f.calls.bodies[0].messages).toHaveLength(2);expect(f.calls.reviews).toHaveLength(2);expect(f.calls.reviews[1]).toMatchObject({buttons:['Cancel','Send synthetic test'],defaultId:0,cancelId:0});
  const detail=f.calls.reviews[1].detail as string,displayed=detail.match(/\n\n(\{[\s\S]*\})\n\nStopping/);expect(displayed).not.toBeNull();expect(JSON.parse(displayed![1]!)).toEqual(f.calls.bodies[0]);expect(detail).toContain('POST '+f.calls.urls[0]);for(const key of Object.values(keys))expect(detail).not.toContain(key);expect((await f.command({type:'connection.status'})).connection).toMatchObject({verified:true,metaProfile:profile});
});

it.each(['meta-direct','baseten-hackathon'] as const)('never uses the other profile credential when the selected profile is unconfigured: %s',async profile=>{
  const f=await fixture(),other=profile==='meta-direct'?'baseten-hackathon':'meta-direct';await f.host.museSettings.saveKey(other,'synthetic-other-key');await f.command({type:'connection.select',provider:'meta'});await f.command({type:'muse.profile',profile});
  expect((await f.command({type:'connection.status'})).connection).toMatchObject({configured:false,verified:false,metaProfile:profile});await expect(f.command({type:'muse.test',profile,id:'missing-key'})).rejects.toThrow('Configure a key');expect(f.calls.reviews).toEqual([]);expect(f.fetch).not.toHaveBeenCalled();
});

it.each(['profile','route','credential','disconnect'] as const)('retires pending production approval after a %s change without an explicit Stop',async change=>{
  const f=await fixture();await f.host.museSettings.saveKey('meta-direct','synthetic-direct-key');await f.command({type:'connection.select',provider:'meta'});let entered!:()=>void,release!:(value:{response:number})=>void;const started=new Promise<void>(done=>entered=done),approval=new Promise<{response:number}>(done=>release=done);f.state.confirm=async()=>{entered();return approval;};
  const pending=f.command({type:'muse.test',profile:'meta-direct',id:'stale-review'}),rejected=expect(pending).rejects.toThrow();await started;
  if(change==='profile')await f.command({type:'muse.profile',profile:'baseten-hackathon'});
  else if(change==='route')await f.command({type:'connection.select',provider:'codex'});
  else if(change==='disconnect')await f.command({type:'connection.disconnect'});
  else{await f.command({type:'connection.configure'});await f.host.saveCredentialForTest({key:'synthetic-replacement-key',acknowledged:true});}
  release({response:1});await rejected;expect(f.fetch).not.toHaveBeenCalled();expect(f.calls.reviews).toHaveLength(1);
});

it('keeps production cancellation identity-specific and rejects concurrent reviews',async()=>{
  const f=await fixture();await f.host.museSettings.saveKey('meta-direct','synthetic-direct-key');await f.command({type:'connection.select',provider:'meta'});let entered!:()=>void,release!:(value:{response:number})=>void;const started=new Promise<void>(done=>entered=done),approval=new Promise<{response:number}>(done=>release=done);f.state.confirm=async()=>{entered();return approval;};
  const pending=f.command({type:'muse.test',profile:'meta-direct',id:'first'});await started;await f.command({type:'muse.test.cancel',id:'other'});await expect(f.command({type:'muse.test',profile:'meta-direct',id:'second'})).rejects.toThrow('already pending');expect(f.fetch).not.toHaveBeenCalled();release({response:1});expect(await pending).toMatchObject({kind:'passed'});expect(f.calls.reviews).toHaveLength(1);expect(f.fetch).toHaveBeenCalledTimes(1);
});

it('uses the real secure credential dialog selected profile, never overwrites legacy key, and reconnects after restart',async()=>{
 const f=await fixture();await f.host.museSettings.saveKey('meta-direct','legacy-inert-key');const legacy=await readFile(join(f.directory,'connection.bin'));await f.command({type:'connection.select',provider:'meta'});await f.command({type:'muse.profile',profile:'baseten-hackathon'});await f.command({type:'connection.configure'});const html=decodeURIComponent(f.host.dialogHtmlForTest());expect(html).toContain('inference.baseten.co');expect(html).toContain('meta-models/muse-spark-open-1026');expect(html).not.toContain('<b>api.meta.ai</b>');
 await expect(f.host.saveCredentialForTest({key:'inert-baseten-key',acknowledged:false})).rejects.toThrow();await f.host.saveCredentialForTest({key:'inert-baseten-key',acknowledged:true});expect(await readFile(join(f.directory,'connection.bin'))).toEqual(legacy);await f.host.museSettings.load();expect(f.host.museSettings.profile()).toBe('baseten-hackathon');expect((await f.command({type:'connection.status'})).connection).toMatchObject({configured:true,verified:false,metaProfile:'baseten-hackathon'});expect(f.fetch).not.toHaveBeenCalled();
});

it('stops pending native review and refuses old-profile approval after settings change, without transport',async()=>{
 const f=await fixture();await f.host.museSettings.saveKey('meta-direct','inert-direct-key');await f.command({type:'connection.select',provider:'meta'});let entered!:()=>void,release!:(value:{response:number})=>void;const started=new Promise<void>(done=>entered=done),approval=new Promise<{response:number}>(done=>release=done);f.state.confirm=async()=>{entered();return approval;};
 const pending=f.command({type:'muse.test',profile:'meta-direct',id:'pending'}),rejected=expect(pending).rejects.toThrow();await started;await f.command({type:'muse.test.cancel',id:'pending'});await f.command({type:'muse.profile',profile:'baseten-hackathon'});release({response:1});await rejected;expect(f.fetch).not.toHaveBeenCalled();
});

it('aborts active transport through the registered Stop command and surfaces provider failures safely without fallback',async()=>{
 const f=await fixture();await f.host.museSettings.saveKey('baseten-hackathon','inert-baseten-key');await f.command({type:'connection.select',provider:'meta'});await f.command({type:'muse.profile',profile:'baseten-hackathon'});f.state.wait=true;const pending=f.command({type:'muse.test',profile:'baseten-hackathon',id:'streaming'}),rejected=expect(pending).rejects.toThrow();await expect.poll(()=>f.calls.urls.length).toBe(1);await f.command({type:'muse.test.cancel',id:'streaming'});await rejected;expect((await f.command({type:'connection.status'})).connection.verified).toBe(false);
 f.state.wait=false;f.state.status=403;await expect(f.command({type:'muse.test',profile:'baseten-hackathon',id:'rejected'})).rejects.not.toThrow(/PRIVATE_REJECTED_BODY|synthetic-secret-key/);expect(f.calls.urls).toHaveLength(2);expect(new Set(f.calls.urls).size).toBe(1);
});

it('blocks corrupted profile config without falling back to direct Meta or modifying saved bytes',async()=>{
 const bytes='{"schemaVersion":1,"profile":"unexpected"}',f=await fixture(bytes);await f.host.museSettings.saveKey('meta-direct','inert-direct-key');await f.command({type:'connection.select',provider:'meta'});expect((await f.command({type:'connection.status'})).connection).toMatchObject({state:'error',configured:false});await expect(f.command({type:'muse.test',profile:'meta-direct',id:'blocked'})).rejects.toThrow();expect(await readFile(join(f.directory,'muse-profile.json'),'utf8')).toBe(bytes);expect(f.calls.urls).toEqual([]);
});

it.each(['profile','credential'] as const)('serializes %s persistence against every connection mutation and keeps its completed state authoritative',async mutation=>{
 const f=await fixture();await f.command({type:'connection.select',provider:'meta'});
 let entered!:()=>void,release!:()=>void;const started=new Promise<void>(done=>entered=done),waiting=new Promise<void>(done=>release=done);
 let pending:Promise<unknown>;
 if(mutation==='profile'){
  const select=f.host.museSettings.select.bind(f.host.museSettings);f.host.museSettings.select=async(...args:unknown[])=>{await select(...args);entered();await waiting;};
  pending=f.command({type:'muse.profile',profile:'baseten-hackathon'});
 }else{
  await f.command({type:'connection.configure'});const save=f.host.museSettings.saveKey.bind(f.host.museSettings);f.host.museSettings.saveKey=async(...args:unknown[])=>{await save(...args);entered();await waiting;};
  pending=f.host.saveCredentialForTest({key:'inert-saved-key',acknowledged:true});
 }
 await started;
 for(const command of [{type:'muse.profile',profile:'meta-direct'},{type:'connection.configure'},{type:'connection.select',provider:'codex'},{type:'connection.disconnect'}])await expect(f.command(command)).rejects.toThrow('connection change is already pending');
 await expect(f.host.saveCredentialForTest({key:'inert-other-key',acknowledged:true})).rejects.toThrow('connection change is already pending');
 release();await pending;
 const expected=mutation==='profile'?'baseten-hackathon':'meta-direct';expect((await f.command({type:'connection.status'})).connection).toMatchObject({provider:'Meta',metaProfile:expected,verified:false});await f.host.museSettings.load();expect(f.host.museSettings.profile()).toBe(expected);
 if(mutation==='credential')expect(await f.host.museSettings.key('meta-direct')).toBe('inert-saved-key');expect(f.fetch).not.toHaveBeenCalled();
});

it('selects Muse connections and renders status without touching secure storage, and uses only async storage to connect and test',async()=>{
 const f=await fixture();await f.host.museSettings.saveKey('baseten-hackathon','inert-baseten-key');f.calls.secure.length=0;
 await f.command({type:'connection.select',provider:'meta'});await f.command({type:'muse.profile',profile:'baseten-hackathon'});expect((await f.command({type:'connection.status'})).connection).toMatchObject({configured:true,metaProfile:'baseten-hackathon'});
 await f.command({type:'muse.profile',profile:'meta-direct'});expect((await f.command({type:'connection.status'})).connection).toMatchObject({configured:false,metaProfile:'meta-direct'});await f.command({type:'connection.select',provider:'codex'});await f.command({type:'connection.select',provider:'meta'});await f.command({type:'muse.profile',profile:'baseten-hackathon'});await f.command({type:'connection.configure'});
 expect(f.calls.secure).toEqual([]);
 await f.host.saveCredentialForTest({key:'inert-replacement-key',acknowledged:true});expect(f.calls.secure).toEqual(['available','encrypt']);f.calls.secure.length=0;
 f.state.response=1;expect(await f.command({type:'muse.test',profile:'baseten-hackathon',id:'async-test'})).toMatchObject({kind:'passed'});expect(f.calls.secure).toEqual(['available','decrypt']);expect(f.calls.authorization).toEqual(['Bearer inert-replacement-key']);
});

it('keeps other IPC responsive while a Keychain prompt is pending, shows the wait, and Stop ends it without transport',async()=>{
 const f=await fixture();await f.host.museSettings.saveKey('baseten-hackathon','inert-baseten-key');await f.command({type:'connection.select',provider:'meta'});await f.command({type:'muse.profile',profile:'baseten-hackathon'});f.state.response=1;f.state.keychain='pending';
 const pending=f.command({type:'muse.test',profile:'baseten-hackathon',id:'keychain'}),rejected=expect(pending).rejects.toThrow(MUSE_CONNECTION_MESSAGES.keychainCancelled);
 await expect.poll(()=>f.calls.secure.includes('decrypt')).toBe(true);
 await expect.poll(async()=>(await f.command({type:'connection.status'})).connection.detail).toBe(MUSE_CONNECTION_MESSAGES.keychainWaiting);
 await expect(f.command({type:'tasks.list'})).resolves.toBeDefined();
 await f.command({type:'muse.test.cancel',id:'keychain'});await rejected;expect(f.fetch).not.toHaveBeenCalled();expect((await f.command({type:'connection.status'})).connection.detail).not.toBe(MUSE_CONNECTION_MESSAGES.keychainWaiting);
});

it('lets the Connect dialog Cancel a save that is waiting for Keychain, saving nothing and keeping IPC responsive',async()=>{
 const f=await fixture();await f.command({type:'connection.select',provider:'meta'});await f.command({type:'muse.profile',profile:'baseten-hackathon'});await f.command({type:'connection.configure'});f.state.keychain='pending';
 const html=decodeURIComponent(f.host.dialogHtmlForTest());expect(html).toContain('id="cancel"');expect(html).toContain('Keychain');
 const pending=f.host.saveCredentialForTest({key:'inert-pending-key',acknowledged:true}),rejected=expect(pending).rejects.toThrow(MUSE_CONNECTION_MESSAGES.keychainCancelled);
 await expect.poll(()=>f.calls.secure.includes('encrypt')).toBe(true);expect((await f.command({type:'connection.status'})).connection).toMatchObject({configured:false,metaProfile:'baseten-hackathon'});
 f.host.closeCredentialWindowForTest();await rejected;await expect(readFile(join(f.directory,'connection-baseten-hackathon.bin'))).rejects.toMatchObject({code:'ENOENT'});expect((await f.command({type:'connection.status'})).connection.configured).toBe(false);expect(f.fetch).not.toHaveBeenCalled();
});
