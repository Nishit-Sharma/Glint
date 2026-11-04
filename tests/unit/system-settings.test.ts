import {expect,it,vi} from 'vitest';
import {mkdtemp,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {buildSync} from 'esbuild';
import {tmpdir} from 'node:os';
import {HardwareAccelerationSettings} from '../../src/host/system-settings';
import {readSystemSettingsCommand,readSystemSettingsView} from '../../src/shared/system-settings';

function electron(enabled=true){
 let ready=false,gpu=()=>{};
 const api={isReady:()=>ready,disableHardwareAcceleration:vi.fn(()=>{expect(ready).toBe(false);}),isHardwareAccelerationEnabled:vi.fn(()=>enabled),onGpuInfo:(callback:()=>void)=>{gpu=callback;}};
 return {api,emit:()=>{ready=true;gpu();}};
}
it('applies saved OFF synchronously before ready and observes actual runtime only after gpu-info-update',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-system-setting-'));await writeFile(join(directory,'system-settings.json'),JSON.stringify({schemaVersion:1,revision:1,hardwareAcceleration:false}));let ready=false,gpu:(()=>void)|undefined;const disable=vi.fn(()=>{expect(ready).toBe(false);}),query=vi.fn(()=>false),settings=new HardwareAccelerationSettings(directory,{isReady:()=>ready,disableHardwareAcceleration:disable,isHardwareAccelerationEnabled:query,onGpuInfo:callback=>{gpu=callback;}});
 try{expect(disable).toHaveBeenCalledOnce();expect(query).not.toHaveBeenCalled();expect((await settings.read()).runtime).toMatchObject({kind:'pending'});ready=true;gpu!();expect(query).toHaveBeenCalledOnce();expect((await settings.read()).runtime).toMatchObject({kind:'observed',enabled:false});}
 finally{await rm(directory,{recursive:true,force:true});}
});

it('defaults ON without writing, saves OFF privately for the next launch, and restores ON across real file reopens',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-system-setting-')),first=electron(),settings=new HardwareAccelerationSettings(directory,first.api);
 try{
  expect(readSystemSettingsView(await settings.read())).toMatchObject({saved:{kind:'available',source:'default',current:{revision:0,hardwareAcceleration:true}},launch:{kind:'requested',enabled:true},runtime:{kind:'pending'},restartRequired:false});
  expect(await readdir(directory)).toEqual([]);expect(first.api.disableHardwareAcceleration).not.toHaveBeenCalled();first.emit();
  const off=await settings.update({type:'system.settings.update',expectedRevision:0,hardwareAcceleration:false});
  expect(off).toMatchObject({kind:'saved',view:{saved:{current:{revision:1,hardwareAcceleration:false}},launch:{enabled:true},runtime:{kind:'observed',enabled:true},restartRequired:true}});
  expect((await stat(join(directory,'system-settings.json'))).mode&0o777).toBe(0o600);expect(first.api.disableHardwareAcceleration).not.toHaveBeenCalled();
  const second=electron(false),reopened=new HardwareAccelerationSettings(directory,second.api);expect(second.api.disableHardwareAcceleration).toHaveBeenCalledOnce();expect(second.api.isHardwareAccelerationEnabled).not.toHaveBeenCalled();second.emit();
  expect(await reopened.read()).toMatchObject({launch:{enabled:false},runtime:{kind:'observed',enabled:false},restartRequired:false});
  const on=await reopened.update({type:'system.settings.update',expectedRevision:1,hardwareAcceleration:true});expect(on).toMatchObject({view:{saved:{current:{revision:2,hardwareAcceleration:true}},launch:{enabled:false},runtime:{enabled:false},restartRequired:true}});
  const third=electron(),restored=new HardwareAccelerationSettings(directory,third.api);third.emit();expect(third.api.disableHardwareAcceleration).not.toHaveBeenCalled();expect(await restored.read()).toMatchObject({launch:{enabled:true},runtime:{enabled:true},restartRequired:false});
  expect(await readdir(directory)).toEqual(['system-settings.json']);
 }finally{await rm(directory,{recursive:true,force:true});}
});

it('serializes competing saves, rejects stale revisions, and leaves no-op saves unchanged',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-system-setting-')),settings=new HardwareAccelerationSettings(directory,electron().api);
 try{
  const [saved,conflict]=await Promise.all([settings.update({type:'system.settings.update',expectedRevision:0,hardwareAcceleration:false}),settings.update({type:'system.settings.update',expectedRevision:0,hardwareAcceleration:true})]);
  expect(saved.kind).toBe('saved');expect(conflict).toMatchObject({kind:'conflict',view:{saved:{current:{revision:1,hardwareAcceleration:false}}}});
  const before=await readFile(join(directory,'system-settings.json'));
  expect(await settings.update({type:'system.settings.update',expectedRevision:1,hardwareAcceleration:false})).toMatchObject({kind:'saved',view:{saved:{current:{revision:1}}}});
  expect(await readFile(join(directory,'system-settings.json'))).toEqual(before);
 }finally{await rm(directory,{recursive:true,force:true});}
});

it.each(['not JSON',JSON.stringify({schemaVersion:1,revision:1,hardwareAcceleration:false,extra:true}),' '.repeat(4097)])('preserves unavailable startup bytes and never presents them as a saved default (%#)',async document=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-system-setting-')),path=join(directory,'system-settings.json');await writeFile(path,document);
 const api=electron(),settings=new HardwareAccelerationSettings(directory,api.api);
 try{
  expect(await settings.read()).toMatchObject({saved:{kind:'unavailable'},launch:{kind:'unavailable'},runtime:{kind:'pending'},restartRequired:null});expect(api.api.disableHardwareAcceleration).not.toHaveBeenCalled();
  expect((await settings.update({type:'system.settings.update',expectedRevision:0,hardwareAcceleration:true})).kind).toBe('unavailable');expect(await readFile(path,'utf8')).toBe(document);
 }finally{await rm(directory,{recursive:true,force:true});}
});

it('preserves previous bytes if the host scope retires before publication and removes its temporary file',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-system-setting-')),path=join(directory,'system-settings.json');await writeFile(path,JSON.stringify({schemaVersion:1,revision:1,hardwareAcceleration:true}));
 const settings=new HardwareAccelerationSettings(directory,electron().api),before=await readFile(path);let checks=0;
 try{
  await expect(settings.update({type:'system.settings.update',expectedRevision:1,hardwareAcceleration:false},()=>{if(++checks===2)throw Error('retired');})).rejects.toThrow('previous settings were preserved');
  expect(await readFile(path)).toEqual(before);expect(await readdir(directory)).toEqual(['system-settings.json']);
 }finally{await rm(directory,{recursive:true,force:true});}
});

it('keeps runtime failures and requested-ON/runtime-OFF distinct from restart-required',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-system-setting-')),api=electron(false),settings=new HardwareAccelerationSettings(directory,api.api);
 try{
  api.emit();expect(await settings.read()).toMatchObject({launch:{enabled:true},runtime:{kind:'observed',enabled:false},restartRequired:false});
  api.api.isHardwareAccelerationEnabled.mockImplementation(()=>{throw Error('API unavailable');});api.emit();expect(await settings.read()).toMatchObject({runtime:{kind:'unavailable',sequence:2},restartRequired:false});
  expect(()=>readSystemSettingsCommand({type:'system.settings.get',hardwareAcceleration:false})).toThrow();expect(()=>readSystemSettingsCommand({type:'system.settings.update',expectedRevision:-1,hardwareAcceleration:false})).toThrow();
 }finally{await rm(directory,{recursive:true,force:true});}
});

it.skipIf(process.platform==='win32')('rejects a FIFO before ready without blocking the startup reader',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-system-fifo-')),path=join(directory,'system-settings.json'),modulePath=join(directory,'system-settings.cjs');
 try{
  execFileSync('mkfifo',[path]);
  const bundle=buildSync({entryPoints:[resolve('src/host/system-settings.ts')],bundle:true,platform:'node',format:'cjs',write:false});await writeFile(modulePath,bundle.outputFiles[0].contents,{mode:0o600});
  const script="const {HardwareAccelerationSettings}=require(process.argv[1]);const settings=new HardwareAccelerationSettings(process.argv[2],{isReady:()=>false,disableHardwareAcceleration:()=>{throw Error('must not apply');},isHardwareAccelerationEnabled:()=>{throw Error('must not query');},onGpuInfo:()=>{}});settings.read().then(view=>process.stdout.write(JSON.stringify(view)));";
  const child=spawnSync(process.execPath,['-e',script,modulePath,directory],{timeout:1500,encoding:'utf8'});
  expect(child.error,'the bounded owned child must return instead of timing out at openSync').toBeUndefined();expect(child.status).toBe(0);expect(JSON.parse(child.stdout)).toMatchObject({saved:{kind:'unavailable'},launch:{kind:'unavailable'},runtime:{kind:'pending'}});
  expect((await stat(path)).isFIFO()).toBe(true);
 }finally{await rm(directory,{recursive:true,force:true});}
});
