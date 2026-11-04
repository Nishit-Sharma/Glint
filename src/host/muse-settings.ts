import {createHash,randomUUID} from 'node:crypto';
import {open,readFile,rename,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {isCode} from '../core/store';
import {MUSE_CONNECTION_MESSAGES,readMuseProfile,type MuseProfile} from '../shared/muse-connection';

/** Only Electron's non-blocking safeStorage APIs: a pending macOS Keychain prompt must never block the main process. */
type SecureStorage={isAsyncEncryptionAvailable:()=>Promise<boolean>;encryptStringAsync:(text:string)=>Promise<Buffer>;decryptStringAsync:(bytes:Buffer)=>Promise<{result:string}>};
export type KeychainWait={signal?:AbortSignal;onWaiting?:()=>void};
const KEYCHAIN_CANCELLED=MUSE_CONNECTION_MESSAGES.keychainCancelled;
const KEYCHAIN_NOTICE_MS=200;
/** Resolves with the secure-storage result unless the user stops first; the OS prompt itself may stay open. */
function untilStopped<T>(work:Promise<T>,wait:KeychainWait={}):Promise<T>{
  const {signal,onWaiting}=wait;if(signal?.aborted)return Promise.reject(Error(KEYCHAIN_CANCELLED));
  return new Promise<T>((resolve,reject)=>{
    const notice=onWaiting?setTimeout(onWaiting,KEYCHAIN_NOTICE_MS):undefined,stop=()=>{finish();reject(Error(KEYCHAIN_CANCELLED));};
    const finish=()=>{clearTimeout(notice);signal?.removeEventListener('abort',stop);};
    signal?.addEventListener('abort',stop,{once:true});
    work.then(value=>{finish();resolve(value);},error=>{finish();reject(error);});
  });
}
const PROFILE_ERROR=MUSE_CONNECTION_MESSAGES.profile;
export class MuseSettings {
  private selected:MuseProfile='meta-direct';
  private unavailable=false;
  /** Single-flight decrypts, so repeated sends never stack Keychain prompts. Plaintext is not cached after settlement. */
  private readonly unlocking=new Map<string,Promise<string|undefined>>();
  constructor(private readonly directory:string,private readonly secure:SecureStorage,private readonly env:NodeJS.ProcessEnv=process.env){}
  async load(){
    try{
      const value=JSON.parse(await readFile(join(this.directory,'muse-profile.json'),'utf8'));
      if(!value||value.schemaVersion!==1||Object.keys(value).sort().join(',')!=='profile,schemaVersion')throw Error(PROFILE_ERROR);
      this.selected=readMuseProfile(value.profile);this.unavailable=false;
    }catch(error){this.unavailable=!isCode(error,'ENOENT');this.selected='meta-direct';}
  }
  profile():MuseProfile {if(this.unavailable)throw Error(PROFILE_ERROR);return this.selected;}
  private credentialPath(profile:MuseProfile){return join(this.directory,readMuseProfile(profile)==='meta-direct'?'connection.bin':'connection-baseten-hackathon.bin');}
  private async replace(path:string,bytes:string|Buffer,assertCurrent:()=>void){
    const temporary=join(this.directory,`.muse-${randomUUID()}.tmp`);
    try{
      const file=await open(temporary,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
      assertCurrent();await rename(temporary,path);
    }finally{await rm(temporary,{force:true});}
  }
  async select(value:unknown,assertCurrent:()=>void=()=>{}){
    const profile=readMuseProfile(value);
    await this.replace(join(this.directory,'muse-profile.json'),JSON.stringify({schemaVersion:1,profile}),assertCurrent);
    this.selected=profile;this.unavailable=false;
  }
  private environmentKey(profile:MuseProfile){
    // The Baseten hackathon key is read only from OS-encrypted storage entered in Settings; no environment path.
    return profile==='meta-direct'?(this.env.MODEL_API_KEY||this.env.META_API_KEY)||undefined:undefined;
  }
  /** Identifies the configured credential without touching secure storage, for status, selection and account scope. */
  async credentialIdentity(profile:MuseProfile):Promise<string|undefined>{
    readMuseProfile(profile);
    const fromEnvironment=this.environmentKey(profile);
    if(fromEnvironment)return 'environment:'+createHash('sha256').update(fromEnvironment).digest('hex');
    try{const file=await stat(this.credentialPath(profile));return file.isFile()&&file.size>0?`encrypted:${file.dev}:${file.ino}:${file.size}:${file.mtimeMs}`:undefined;}catch{return undefined;}
  }
  /** Decrypts only for an explicit send or connection test. */
  async key(profile:MuseProfile,wait:KeychainWait={}):Promise<string|undefined>{
    readMuseProfile(profile);
    const fromEnvironment=this.environmentKey(profile);
    if(fromEnvironment)return fromEnvironment;
    const identity=await this.credentialIdentity(profile);if(!identity)return undefined;
    if(wait.signal?.aborted)throw Error(KEYCHAIN_CANCELLED);
    let unlocking=this.unlocking.get(identity);
    if(!unlocking){
      unlocking=(async()=>{try{const bytes=await readFile(this.credentialPath(profile));if(!bytes.length||!await this.secure.isAsyncEncryptionAvailable())return undefined;return (await this.secure.decryptStringAsync(bytes)).result||undefined;}catch{return undefined;}})();
      this.unlocking.set(identity,unlocking);const settled=unlocking;void settled.finally(()=>{if(this.unlocking.get(identity)===settled)this.unlocking.delete(identity);});
    }
    return untilStopped(unlocking,wait);
  }
  async saveKey(profile:MuseProfile,key:unknown,assertCurrent:()=>void=()=>{},wait:KeychainWait={}){
    readMuseProfile(profile);
    if(typeof key!=='string'||!key.length||key.length>512||/\s|\0/.test(key))throw Error('Invalid API key.');
    if(!await untilStopped(this.secure.isAsyncEncryptionAvailable(),wait))throw Error('OS secure storage unavailable; connection was not saved.');
    const encrypted=await untilStopped(this.secure.encryptStringAsync(key),wait);
    if(wait.signal?.aborted)throw Error(KEYCHAIN_CANCELLED);
    await this.replace(this.credentialPath(profile),encrypted,assertCurrent);
  }
  async removeKey(profile:MuseProfile){await rm(this.credentialPath(profile),{force:true});}
}
