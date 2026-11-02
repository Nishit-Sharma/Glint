import {spawn} from 'node:child_process';
import type {EventEmitter} from 'node:events';
import type {Writable} from 'node:stream';
export const CLIPBOARD_TEXT_LIMIT=262144;
export type ClipboardWriter=(text:string)=>Promise<void>;
export interface ClipboardChild extends EventEmitter{stdin:Writable|null;kill:()=>boolean}
export type ClipboardSpawn=(path:string,args:string[],options:{shell:false;stdio:['pipe','ignore','ignore']})=>ClipboardChild;
/** Fixed platform service; payload is data on stdin, never a shell command. */
export function createClipboardWriter(options:{platform?:string;spawn?:ClipboardSpawn;timeoutMs?:number}={}):ClipboardWriter{
 return async text=>{
  if((options.platform??process.platform)!=='darwin')throw Error('Clipboard copy is supported only on macOS with /usr/bin/pbcopy. No stdout fallback is used.');
  if(Buffer.from(text,'utf8').toString('utf8')!==text)throw Error('Selected text cannot be copied exactly as UTF-8. Nothing was copied.');
  if(Buffer.byteLength(text,'utf8')>CLIPBOARD_TEXT_LIMIT)throw Error('Selected blocks exceed the 256 KiB clipboard limit. Nothing was copied.');
  await new Promise<void>((resolve,reject)=>{
   let child:ClipboardChild|undefined,timer:ReturnType<typeof setTimeout>|undefined,settled=false;
   const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);if(!error){child?.removeListener('error',failed);child?.removeListener('close',closed);child?.stdin?.removeListener('error',failed);}if(error){try{child?.kill();}catch{}reject(error);}else resolve();};
   const failed=()=>finish(Error('The clipboard write failed or could not be confirmed; the clipboard may have changed.'));
   const closed=(code:number|null,signal:NodeJS.Signals|null)=>{if(code===0&&!signal)finish();else failed();child?.removeListener('error',failed);child?.removeListener('close',closed);child?.stdin?.removeListener('error',failed);};
   try{child=(options.spawn??((path,args,settings)=>spawn(path,args,settings)))('/usr/bin/pbcopy',[],{shell:false,stdio:['pipe','ignore','ignore']});child.on('error',failed);child.once('close',closed);if(!child.stdin){failed();return;}child.stdin.on('error',failed);timer=setTimeout(failed,options.timeoutMs??5000);child.stdin.end(Buffer.from(text,'utf8'));}catch{failed();}
  });
 };
}
export const writeClipboard=createClipboardWriter();
