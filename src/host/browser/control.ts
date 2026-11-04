import {randomUUID} from 'node:crypto';
import type {BrowserControlStatus,BrowserEngine} from '../../shared/browser-control';

export class BrowserControlPaused extends Error {}
/** One live request owns this fence. It never grants a browser action. */
export class BrowserControl {
 private readonly id=randomUUID();
 private mode:BrowserControlStatus['mode']='opening';
 private turn?:AbortController;
 private wake=()=>{};
 private signal?:AbortSignal;
 private focus=async()=>{};
 private browser?:BrowserEngine;
 get requestSignal(){return this.signal;}
 status():BrowserControlStatus{return {id:this.id,mode:this.mode,...(this.browser?{browser:{...this.browser}}:{})};}
 attach(signal:AbortSignal,focus:()=>Promise<void>,browser?:BrowserEngine){if(this.mode==='ended'||signal.aborted)throw Error('Stopped by user.');this.signal=signal;this.focus=focus;if(browser)this.browser={name:browser.name,chromiumVersion:browser.chromiumVersion,...(browser.contentBlocker?{contentBlocker:true}:{})};this.mode='agent';}
 take(){if(this.mode==='agent'){this.mode='pausing';this.turn?.abort();}return this.status();}
 returnToAgent(){if(this.signal?.aborted)throw Error('Stopped by user.');if(this.mode!=='user')throw Error('Wait until browser work is paused before returning control.');this.mode='agent';this.wake();return this.status();}
 async waitForAgent(){
  const paused=this.mode==='pausing'||this.mode==='user';
  if(this.mode==='pausing'){
   await this.focus();
   if(this.signal?.aborted||this.status().mode==='ended')throw Error('Stopped by user.');
   this.mode='user';
  }
  if(this.mode==='user')await new Promise<void>((resolve,reject)=>{
   const stopped=()=>{cleanup();reject(Error('Stopped by user.'));},cleanup=()=>{this.signal?.removeEventListener('abort',stopped);this.wake=()=>{};};
   this.wake=()=>{cleanup();resolve();};
   if(this.signal?.aborted){stopped();return;}
   this.signal?.addEventListener('abort',stopped,{once:true});
  });
  if(this.signal?.aborted||this.mode==='ended')throw Error('Stopped by user.');
  return paused;
 }
 beginTurn(signal:AbortSignal){this.assertAgent();this.turn=new AbortController();return AbortSignal.any([signal,this.turn.signal]);}
 assertAgent(){if(this.mode!=='agent')throw new BrowserControlPaused('Browser work paused for you.');}
 endTurn(){this.turn=undefined;}
 close(){this.mode='ended';this.turn?.abort();this.wake();}
}
