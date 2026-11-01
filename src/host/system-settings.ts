import {randomUUID} from 'node:crypto';
import {closeSync,constants,fstatSync,openSync,readSync} from 'node:fs';
import {mkdir,open,rename,rm} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {readSystemSettingsCommand,readSystemSettingsFile,SYSTEM_SETTINGS_MESSAGES,type HardwareAccelerationLaunch,type HardwareAccelerationRuntime,type SystemSettingsCommit,type SystemSettingsState,type SystemSettingsView} from '../shared/system-settings';

type ElectronAcceleration={isReady():boolean;disableHardwareAcceleration():void;isHardwareAccelerationEnabled():boolean;onGpuInfo(callback:()=>void):void};
const FILE_LIMIT=4096;
const missing=(error:unknown)=>!!error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT';
const unavailable=():SystemSettingsState=>({kind:'unavailable',message:SYSTEM_SETTINGS_MESSAGES.unavailable});
/** One profile-scoped owner. Construction and OFF application must be synchronous before ready. */
export class HardwareAccelerationSettings{
 private readonly path:string;
 private readonly launch:HardwareAccelerationLaunch;
 private runtime:HardwareAccelerationRuntime={kind:'pending',sequence:0};
 private listeners=new Set<(runtime:HardwareAccelerationRuntime)=>void>();
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private readonly directory:string,private readonly electron:ElectronAcceleration){
  if(!isAbsolute(directory))throw Error('System settings require an absolute host-owned directory.');
  this.path=join(directory,'system-settings.json');
  this.electron.onGpuInfo(()=>this.observeRuntime());
  const saved=this.load();
  if(saved.kind==='unavailable')this.launch={kind:'unavailable',message:'The saved startup choice could not be read. Electron’s default startup configuration was left unchanged.'};
  else if(this.electron.isReady())this.launch={kind:'unavailable',message:'The startup choice could not be applied before Electron was ready.'};
  else{
   try{if(!saved.current.hardwareAcceleration)this.electron.disableHardwareAcceleration();this.launch={kind:'requested',enabled:saved.current.hardwareAcceleration,source:saved.source};}
   catch{this.launch={kind:'unavailable',message:'The startup choice could not be applied. Current runtime status is reported separately.'};}
  }
 }
 private observeRuntime(){
  const sequence=this.runtime.sequence+1;
  try{this.runtime={kind:'observed',sequence,enabled:this.electron.isHardwareAccelerationEnabled()};}
  catch{this.runtime={kind:'unavailable',sequence};}
  for(const listener of this.listeners)listener({...this.runtime});
 }
 onRuntime(listener:(runtime:HardwareAccelerationRuntime)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 private load():SystemSettingsState{
  let descriptor:number|undefined;
  try{
   descriptor=openSync(this.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
   const stat=fstatSync(descriptor);if(!stat.isFile()||stat.size>FILE_LIMIT)return unavailable();
   const buffer=Buffer.alloc(FILE_LIMIT+1);let length=0,count=0;
   do{count=readSync(descriptor,buffer,length,buffer.length-length,null);length+=count;}while(count>0&&length<buffer.length);
   if(length>FILE_LIMIT)return unavailable();
   const current=readSystemSettingsFile(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,length))));
   return {kind:'available',current,source:'file'};
  }catch(error){return missing(error)?{kind:'available',current:{revision:0,hardwareAcceleration:true},source:'default'}:unavailable();}
  finally{if(descriptor!==undefined)closeSync(descriptor);}
 }
 private view(saved:SystemSettingsState):SystemSettingsView{
  return {saved,launch:{...this.launch},runtime:{...this.runtime},restartRequired:saved.kind==='available'&&this.launch.kind==='requested'?saved.current.hardwareAcceleration!==this.launch.enabled:null};
 }
 private serialize<T>(action:()=>Promise<T>):Promise<T>{const result=this.queue.then(action);this.queue=result.catch(()=>{});return result;}
 read(){return this.serialize(async()=>this.view(this.load()));}
 update(input:unknown,assertCurrent:()=>void=()=>{}):Promise<SystemSettingsCommit>{
  const command=readSystemSettingsCommand(input);if(command.type!=='system.settings.update')throw Error('Invalid system settings update.');
  return this.serialize(async()=>{
   const saved=this.load();if(saved.kind==='unavailable')return {kind:'unavailable',view:this.view(saved)};
   if(saved.current.revision!==command.expectedRevision)return {kind:'conflict',view:this.view(saved)};
   assertCurrent();
   if(saved.current.hardwareAcceleration===command.hardwareAcceleration)return {kind:'saved',view:this.view(saved)};
   if(saved.current.revision===Number.MAX_SAFE_INTEGER)throw Error(SYSTEM_SETTINGS_MESSAGES.limit);
   const current={revision:saved.current.revision+1,hardwareAcceleration:command.hardwareAcceleration};
   await mkdir(this.directory,{recursive:true,mode:0o700});
   const temporary=join(this.directory,`.system-settings-${randomUUID()}.tmp`);let renamed=false;
   try{
    const file=await open(temporary,'wx',0o600);
    try{await file.writeFile(JSON.stringify({schemaVersion:1,...current}));await file.sync();}finally{await file.close();}
    assertCurrent();await rename(temporary,this.path);renamed=true;
    const directory=await open(this.directory,'r');try{await directory.sync();}finally{await directory.close();}
    return {kind:'saved',view:this.view({kind:'available',current,source:'file'})};
   }catch(error){throw new Error(renamed?SYSTEM_SETTINGS_MESSAGES.uncertain:SYSTEM_SETTINGS_MESSAGES.notSaved,{cause:error});}
   finally{await rm(temporary,{force:true});}
  });
 }
}
