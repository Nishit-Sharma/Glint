import {afterEach,expect,it,vi} from 'vitest';
import {mkdir,mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {MuseSettings} from '../../src/host/muse-settings';
import {MUSE_CONNECTION_MESSAGES,readMuseConnectionCommand,readMuseProfile} from '../../src/shared/muse-connection';

const directories:string[]=[];
// Inert stand-in for Electron 45's asynchronous safeStorage API only; the deprecated synchronous calls do not exist here.
const secure=()=>{const storage={available:true,isAsyncEncryptionAvailable:vi.fn(async()=>storage.available),encryptStringAsync:vi.fn(async(text:string)=>Buffer.from('encrypted-fixture:'+text)),decryptStringAsync:vi.fn(async(bytes:Buffer)=>({result:bytes.toString().replace(/^encrypted-fixture:/,''),shouldReEncrypt:false}))};return storage;};
async function fixture(){await mkdir(resolve('work/continuation'),{recursive:true});const directory=await mkdtemp(resolve('work/continuation/muse-settings-'));directories.push(directory);const storage=secure(),settings=new MuseSettings(directory,storage,{});return {directory,storage,settings};}
afterEach(async()=>{for(const directory of directories.splice(0))await rm(directory,{recursive:true,force:true});});

it('defaults missing profile settings to legacy direct Meta without rewriting route or encrypted key',async()=>{
 const f=await fixture(),legacy=Buffer.from('encrypted-fixture:legacy-inert-key'),route='{"provider":"meta"}\n';await writeFile(join(f.directory,'provider.json'),route);await writeFile(join(f.directory,'connection.bin'),legacy);
 await f.settings.load();expect(f.settings.profile()).toBe('meta-direct');expect(await f.settings.key('meta-direct')).toBe('legacy-inert-key');expect(await f.settings.key('baseten-hackathon')).toBeUndefined();
 expect(await readFile(join(f.directory,'provider.json'),'utf8')).toBe(route);expect(await readFile(join(f.directory,'connection.bin'))).toEqual(legacy);expect(f.storage.decryptStringAsync).toHaveBeenCalledTimes(1);await expect(stat(join(f.directory,'muse-profile.json'))).rejects.toMatchObject({code:'ENOENT'});
});

it('persists a fixed profile and its separate encrypted key through reopen without migrating the legacy credential',async()=>{
 const f=await fixture();await f.settings.saveKey('meta-direct','legacy-only');const before=await readFile(join(f.directory,'connection.bin'));await f.settings.select('baseten-hackathon');expect(await f.settings.key('baseten-hackathon')).toBeUndefined();await f.settings.saveKey('baseten-hackathon','baseten-only');
 const reopened=new MuseSettings(f.directory,f.storage,{});await reopened.load();expect(reopened.profile()).toBe('baseten-hackathon');expect(await reopened.key(reopened.profile())).toBe('baseten-only');expect(await reopened.key('meta-direct')).toBe('legacy-only');expect(await readFile(join(f.directory,'connection.bin'))).toEqual(before);expect((await stat(join(f.directory,'muse-profile.json'))).mode&0o777).toBe(0o600);
 await reopened.removeKey('baseten-hackathon');expect(await reopened.key('baseten-hackathon')).toBeUndefined();expect(await reopened.key('meta-direct')).toBe('legacy-only');
});

it('keeps the direct Meta environment key but reads the Baseten key only from encrypted Settings storage',async()=>{
 const f=await fixture(),settings=new MuseSettings(f.directory,f.storage,{MODEL_API_KEY:'inert-meta-env',META_API_KEY:'inert-old-meta',BASETEN_API_KEY:'inert-baseten-env'});
 expect(await settings.key('meta-direct')).toBe('inert-meta-env');expect(f.storage.decryptStringAsync).not.toHaveBeenCalled();expect(await settings.key('baseten-hackathon')).toBeUndefined();
 await settings.saveKey('baseten-hackathon','inert-baseten-stored');expect(await settings.key('baseten-hackathon')).toBe('inert-baseten-stored');expect(f.storage.encryptStringAsync).toHaveBeenCalledWith('inert-baseten-stored');expect(await readFile(join(f.directory,'connection-baseten-hackathon.bin'),'utf8')).toBe('encrypted-fixture:inert-baseten-stored');
 const metaOnly=new MuseSettings(f.directory,f.storage,{META_API_KEY:'inert-meta-only'});await metaOnly.removeKey('baseten-hackathon');expect(await metaOnly.key('baseten-hackathon')).toBeUndefined();
});

it.each(['{"schemaVersion":1,"profile":"https://arbitrary.invalid"}','{"schemaVersion":1,"profile":"meta-direct","endpoint":"https://arbitrary.invalid"}','not json'])('fails closed on malformed profile settings, preserving bytes until explicit replacement: %s',async bytes=>{
 const f=await fixture();await writeFile(join(f.directory,'muse-profile.json'),bytes);await f.settings.load();expect(()=>f.settings.profile()).toThrow('could not be read');expect(await readFile(join(f.directory,'muse-profile.json'),'utf8')).toBe(bytes);expect(f.storage.decryptStringAsync).not.toHaveBeenCalled();await f.settings.select('baseten-hackathon');expect(f.settings.profile()).toBe('baseten-hackathon');
});

it('keeps prior settings and encrypted credentials when a guarded save is retired or encryption is unavailable',async()=>{
 const f=await fixture();await f.settings.select('meta-direct');await f.settings.saveKey('meta-direct','initial-inert-key');const profile=await readFile(join(f.directory,'muse-profile.json')),key=await readFile(join(f.directory,'connection.bin'));
 await expect(f.settings.select('baseten-hackathon',()=>{throw Error('Retired');})).rejects.toThrow('Retired');expect(f.settings.profile()).toBe('meta-direct');expect(await readFile(join(f.directory,'muse-profile.json'))).toEqual(profile);
 await expect(f.settings.saveKey('meta-direct','new-inert-key',()=>{throw Error('Retired');})).rejects.toThrow('Retired');expect(await readFile(join(f.directory,'connection.bin'))).toEqual(key);
 f.storage.available=false;expect(await f.settings.key('meta-direct')).toBeUndefined();await expect(f.settings.saveKey('meta-direct','new-inert-key')).rejects.toThrow('secure storage unavailable');expect(await readFile(join(f.directory,'connection.bin'))).toEqual(key);
});

it('rejects arbitrary profile IDs, extra IPC payloads and invalid key data before writes or credential access',async()=>{
 const f=await fixture();for(const profile of ['https://arbitrary.invalid','constructor',null,undefined]){expect(()=>readMuseProfile(profile)).toThrow();await expect(f.settings.select(profile)).rejects.toThrow();}
 for(const input of [{type:'muse.test',id:'synthetic',profile:'meta-direct',prompt:'private'},{type:'muse.test',id:'bad/id',profile:'meta-direct'},{type:'muse.profile',profile:'meta-direct',endpoint:'https://arbitrary.invalid'},{type:'muse.test.cancel',id:'synthetic',approved:true}])expect(()=>readMuseConnectionCommand(input)).toThrow();
 expect(readMuseConnectionCommand({type:'muse.test',id:'synthetic',profile:'baseten-hackathon'})).toMatchObject({profile:'baseten-hackathon'});for(const key of ['', ' ', 'bad\nkey', 'k'.repeat(513)])await expect(f.settings.saveKey('meta-direct',key)).rejects.toThrow('Invalid API key');expect(f.storage.encryptStringAsync).not.toHaveBeenCalled();
});

it('selects profiles and reports a configured key identity without touching secure storage',async()=>{
 const f=await fixture();await f.settings.saveKey('baseten-hackathon','inert-identity-key');for(const mock of [f.storage.isAsyncEncryptionAvailable,f.storage.encryptStringAsync,f.storage.decryptStringAsync])mock.mockClear();
 await f.settings.select('baseten-hackathon');await f.settings.load();const identity=await f.settings.credentialIdentity('baseten-hackathon');
 expect(identity).toMatch(/^encrypted:/);expect(identity).not.toContain('inert-identity-key');expect(await f.settings.credentialIdentity('meta-direct')).toBeUndefined();await f.settings.select('meta-direct');
 expect(f.storage.isAsyncEncryptionAvailable).not.toHaveBeenCalled();expect(f.storage.encryptStringAsync).not.toHaveBeenCalled();expect(f.storage.decryptStringAsync).not.toHaveBeenCalled();
 await f.settings.saveKey('baseten-hackathon','inert-replaced-key');expect(await f.settings.credentialIdentity('baseten-hackathon')).not.toBe(identity);
});

it('waits for a pending Keychain prompt without blocking other settings work, single-flights it and stops on request',async()=>{
 const f=await fixture();await f.settings.saveKey('baseten-hackathon','inert-pending-key');f.storage.decryptStringAsync.mockImplementation(()=>new Promise(()=>{}));
 const controller=new AbortController(),onWaiting=vi.fn(),first=f.settings.key('baseten-hackathon',{signal:controller.signal,onWaiting}),second=f.settings.key('baseten-hackathon');
 await f.settings.select('baseten-hackathon');expect(f.settings.profile()).toBe('baseten-hackathon');expect(await f.settings.credentialIdentity('baseten-hackathon')).toMatch(/^encrypted:/);
 await vi.waitFor(()=>expect(onWaiting).toHaveBeenCalledTimes(1));expect(f.storage.decryptStringAsync).toHaveBeenCalledTimes(1);
 controller.abort();await expect(first).rejects.toThrow(MUSE_CONNECTION_MESSAGES.keychainCancelled);void second.catch(()=>{});
 await expect(f.settings.key('baseten-hackathon',{signal:AbortSignal.abort()})).rejects.toThrow(MUSE_CONNECTION_MESSAGES.keychainCancelled);
});

it('stops a save that is waiting for Keychain without writing a credential',async()=>{
 const f=await fixture();await f.settings.saveKey('baseten-hackathon','inert-original-key');const before=await readFile(join(f.directory,'connection-baseten-hackathon.bin'));
 f.storage.encryptStringAsync.mockImplementation(()=>new Promise(()=>{}));const controller=new AbortController(),pending=f.settings.saveKey('baseten-hackathon','inert-new-key',()=>{},{signal:controller.signal});
 await vi.waitFor(()=>expect(f.storage.encryptStringAsync).toHaveBeenCalledWith('inert-new-key'));expect(await f.settings.credentialIdentity('baseten-hackathon')).toMatch(/^encrypted:/);
 controller.abort();await expect(pending).rejects.toThrow(MUSE_CONNECTION_MESSAGES.keychainCancelled);expect(await readFile(join(f.directory,'connection-baseten-hackathon.bin'))).toEqual(before);
});
