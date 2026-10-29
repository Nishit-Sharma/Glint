import {afterEach,describe,expect,it,vi} from 'vitest';
import {rm} from 'node:fs/promises';
import {NativeSourceAdapter} from '../src/host/native';

const os=vi.hoisted(()=>({
 screen:'granted',title:'Synthetic original window',directories:[] as string[],
 preparation:undefined as undefined|(()=>Promise<void>),exec:vi.fn((...args:unknown[])=>{const done=args.at(-1);if(typeof done==='function')done(null,'','');return {};})
}));
vi.mock('electron',()=>({
 systemPreferences:{getMediaAccessStatus:()=>os.screen,isTrustedAccessibilityClient:()=>false},
 desktopCapturer:{getSources:async()=>[{id:'window:42:0',name:os.title}]},
 screen:{getDisplayMatching:()=>({id:9,bounds:{x:0,y:0,width:1600,height:1000},scaleFactor:1})},nativeImage:{}
}));
vi.mock('get-windows',()=>({openWindows:async()=>[{id:42,title:os.title,owner:{name:'Synthetic source',processId:123},bounds:{x:0,y:0,width:200,height:100}}]}));
vi.mock('node:child_process',()=>({execFile:os.exec}));
vi.mock('node:fs/promises',async importOriginal=>{
 const fs=await importOriginal<typeof import('node:fs/promises')>();
 return {...fs,mkdtemp:async(...args:Parameters<typeof fs.mkdtemp>)=>{const directory=await fs.mkdtemp(...args);os.directories.push(String(directory));await os.preparation?.();return directory;},readFile:async(...args:Parameters<typeof fs.readFile>)=>{
  if(String(args[0]).endsWith('/capture.png')){const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12);png.writeUInt32BE(16,16);png.writeUInt32BE(16,20);return png;}
  return fs.readFile(...args);
 }};
});
afterEach(async()=>{os.screen='granted';os.title='Synthetic original window';os.preparation=undefined;os.exec.mockClear();for(const directory of os.directories.splice(0))await rm(directory,{recursive:true,force:true});});
function hold(){let release!:()=>void,entered!:()=>void;return {wait:new Promise<void>(resolve=>release=resolve),started:new Promise<void>(resolve=>entered=resolve),release:()=>release(),enter:()=>entered()};}

describe.skipIf(process.platform!=='darwin')('Production Mac capture helper with controlled OS/I/O boundaries',()=>{
 it.each(['cancel','permission','target'])('checks after temporary directory preparation, before screencapture: %s',async change=>{
  const adapter=new NativeSourceAdapter(),barrier=hold();let current=true;
  os.preparation=async()=>{barrier.enter();await barrier.wait;};
  const pending=adapter.capture('window:42',{assertCurrent:()=>{if(!current)throw Error('Synthetic capture authority retired');}}),result=expect(pending).rejects.toThrow();
  await barrier.started;if(change==='cancel')current=false;if(change==='permission')os.screen='denied';if(change==='target')os.title='Synthetic changed window';barrier.release();await result;
  expect(os.exec).not.toHaveBeenCalled();
 });
 it('can reach the controlled exec boundary once when the original target remains current',async()=>{
  const capture=await new NativeSourceAdapter().capture('window:42');expect(capture.source.id).toBe('window:42');expect(os.exec).toHaveBeenCalledTimes(1);expect(os.exec.mock.calls[0][0]).toBe('/usr/sbin/screencapture');
 });
});
