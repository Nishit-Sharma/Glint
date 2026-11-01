import {afterEach,expect,it,vi} from 'vitest';
const faults=vi.hoisted(()=>({directory:'',rename:false,directorySync:false}));
vi.mock('node:fs/promises',async original=>{
 const actual=await original<typeof import('node:fs/promises')>();
 return {...actual,rename:async(from:Parameters<typeof actual.rename>[0],to:Parameters<typeof actual.rename>[1])=>{if(faults.rename)throw Error('publication failed');return actual.rename(from,to);},open:async(path:Parameters<typeof actual.open>[0],flags:Parameters<typeof actual.open>[1],mode?:number)=>{const handle=await actual.open(path,flags,mode);if(path===faults.directory&&faults.directorySync)return {sync:async()=>{throw Error('directory sync failed');},close:()=>handle.close()} as unknown as typeof handle;return handle;}};
});
import {mkdtemp,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FallbackShortcutSettings} from '../src/host/fallback-shortcut';
import {readFallbackShortcutCommand} from '../src/shared/fallback-shortcut';
afterEach(()=>{faults.directory='';faults.rename=false;faults.directorySync=false;});
it('reset registers and durably saves the actual host default before releasing the old binding',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-shortcut-')),old='Control+Alt+F8',binding=new Set([old]);let current=old;
 await writeFile(join(directory,'shortcut.json'),JSON.stringify({shortcut:old}));
 const settings=new FallbackShortcutSettings({directory,current:()=>current,committed:value=>{current=value;},activate:()=>{},registry:{register:vi.fn((value:string)=>{binding.add(value);return true;}),unregister:value=>{if(value===old)expect(JSON.parse(readFileSync(join(directory,'shortcut.json'),'utf8')).shortcut).toBe('Control+Shift+Space');binding.delete(value);},isRegistered:value=>binding.has(value)}});
 try{await settings.reset(old);expect(current).toBe('Control+Shift+Space');expect(binding).toEqual(new Set(['Control+Shift+Space']));expect(JSON.parse(await readFile(join(directory,'shortcut.json'),'utf8'))).toEqual({shortcut:'Control+Shift+Space'});expect((await stat(join(directory,'shortcut.json'))).mode&0o777).toBe(0o600);}
 finally{await rm(directory,{recursive:true,force:true});}
});

async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'glint-shortcut-')),original='Control+Alt+F8',binding=new Set([original]);let current=original,available=true;
 await writeFile(join(directory,'shortcut.json'),JSON.stringify({shortcut:original}));
 const registry={register:vi.fn((value:string)=>{if(!available)return false;binding.add(value);return true;}),unregister:vi.fn((value:string)=>{binding.delete(value);}),isRegistered:(value:string)=>binding.has(value)};
 return {directory,original,binding,registry,current:()=>current,unavailable:()=>{available=false;},settings:new FallbackShortcutSettings({directory,current:()=>current,committed:value=>{current=value;},activate:()=>{},registry})};
}
it('registration failure keeps the old effective binding and saved bytes',async()=>{
 const f=await fixture(),path=join(f.directory,'shortcut.json'),before=await readFile(path);f.unavailable();
 try{await expect(f.settings.change('Control+Shift+F9',f.original)).rejects.toThrow('Shortcut is unavailable');expect(f.current()).toBe(f.original);expect(f.binding).toEqual(new Set([f.original]));expect(await readFile(path)).toEqual(before);expect(await readdir(f.directory)).toEqual(['shortcut.json']);}
 finally{await rm(f.directory,{recursive:true,force:true});}
});
it('prepublication failure unregisters only the candidate and preserves the old file',async()=>{
 const f=await fixture(),path=join(f.directory,'shortcut.json'),before=await readFile(path);faults.rename=true;
 try{await expect(f.settings.reset(f.original)).rejects.toThrow('previous binding and saved file were preserved');expect(f.current()).toBe(f.original);expect(f.binding).toEqual(new Set([f.original]));expect(await readFile(path)).toEqual(before);expect(await readdir(f.directory)).toEqual(['shortcut.json']);}
 finally{await rm(f.directory,{recursive:true,force:true});}
});
it('postpublication uncertainty keeps actual runtime and published file aligned and reports uncertainty',async()=>{
 const f=await fixture();faults.directory=f.directory;faults.directorySync=true;
 try{await expect(f.settings.reset(f.original)).rejects.toThrow('durable save could not be confirmed');expect(f.current()).toBe('Control+Shift+Space');expect(f.binding).toEqual(new Set(['Control+Shift+Space']));expect(JSON.parse(await readFile(join(f.directory,'shortcut.json'),'utf8'))).toEqual({shortcut:f.current()});expect(await readdir(f.directory)).toEqual(['shortcut.json']);}
 finally{await rm(f.directory,{recursive:true,force:true});}
});
it('serializes edits, rejects a stale second intent and preserves the legacy same-profile saved shape',async()=>{
 const f=await fixture();
 try{
  const results=await Promise.allSettled([f.settings.change('Control+Alt+Shift+F9',f.original),f.settings.reset(f.original)]);expect(results[0]).toMatchObject({status:'fulfilled',value:{shortcut:'Control+Alt+Shift+F9',registered:true}});expect(results[1]).toMatchObject({status:'rejected',reason:{message:expect.stringContaining('changed elsewhere')}});expect(f.binding).toEqual(new Set(['Control+Alt+Shift+F9']));
  const bytes=await readFile(join(f.directory,'shortcut.json'));expect(JSON.parse(bytes.toString())).toEqual({shortcut:'Control+Alt+Shift+F9'});const oldHostRestartChoice=JSON.parse(bytes.toString()).shortcut;expect(oldHostRestartChoice).toBe(f.current());
  await f.settings.change(f.current(),f.current());expect(await readFile(join(f.directory,'shortcut.json'))).toEqual(bytes);expect(f.registry.register).toHaveBeenCalledTimes(1);
 }finally{await rm(f.directory,{recursive:true,force:true});}
});
it('retired host scope before publication preserves the original binding and file',async()=>{
 const f=await fixture(),before=await readFile(join(f.directory,'shortcut.json'));let calls=0;
 try{await expect(f.settings.reset(f.original,()=>{if(++calls===2)throw Error('scope retired');})).rejects.toThrow('previous binding and saved file were preserved');expect(f.binding).toEqual(new Set([f.original]));expect(f.current()).toBe(f.original);expect(await readFile(join(f.directory,'shortcut.json'))).toEqual(before);}
 finally{await rm(f.directory,{recursive:true,force:true});}
});
it('closed reset accepts only expected binding, never a renderer-supplied default',()=>{
 expect(readFallbackShortcutCommand({type:'shortcut.reset',expectedShortcut:'Control+Alt+F8'})).toEqual({type:'shortcut.reset',expectedShortcut:'Control+Alt+F8'});
 expect(()=>readFallbackShortcutCommand({type:'shortcut.reset',expectedShortcut:'Control+Alt+F8',accelerator:'Control+F1'})).toThrow();expect(()=>readFallbackShortcutCommand({type:'shortcut.get',extra:true})).toThrow();expect(()=>readFallbackShortcutCommand({type:'shortcut.set',accelerator:'invalid'})).toThrow();
});
