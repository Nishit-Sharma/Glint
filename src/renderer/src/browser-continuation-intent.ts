import type {RequestRecord,Task} from '../../core/types';
import {prepareBrowserContinuation,readBrowserContinuationOutcome,browserContinuationReceipt,readBrowserContinuationReceipt,pendingBrowserContinuation,sameBrowserContinuationInput,type BrowserContinuationCommand,type BrowserContinuationSelection,type BrowserContinuationRelease} from '../../shared/browser-continuation';
export type BrowserContinuationState={kind:'idle'}|{kind:'preparing'|'sending'|'checking'|'unconfirmed'|'not-recorded'|'releasing'|'release-unconfirmed'|'released';command:BrowserContinuationCommand}|{kind:'recorded';command:BrowserContinuationCommand;request:RequestRecord};
type Options={task:Task;selection:BrowserContinuationSelection;binding:string;createId:()=>string;prepare:(command:BrowserContinuationCommand)=>Promise<Task>;send:(command:BrowserContinuationCommand)=>Promise<Task|undefined>;release:(command:BrowserContinuationCommand)=>Promise<BrowserContinuationRelease>;read:(taskId:string)=>Promise<Task>;isCurrent:()=>boolean;onState:(state:BrowserContinuationState)=>void;onRecorded:(task:Task)=>void};
export function initialBrowserContinuationState(task:Task):BrowserContinuationState{const pending=pendingBrowserContinuation(task);return pending?{kind:'unconfirmed',command:Object.freeze({type:'browser.continue' as const,...pending.input,previous:Object.freeze({...pending.input.previous})})}:{kind:'idle'};}
/** Save before dispatch. Restore only checks; explicit local closure fences late admission. */
export function createBrowserContinuationIntent(options:Options){
 let state:BrowserContinuationState=initialBrowserContinuationState(options.task);
 function publish(next:BrowserContinuationState){state=next;if(options.isCurrent())options.onState(next);}
 function recorded(task:Task){if(options.isCurrent())options.onRecorded(task);}
 async function received(task:Task|undefined,command:BrowserContinuationCommand){
  if(!task){publish({kind:'unconfirmed',command});return;}
  const pending=pendingBrowserContinuation(task);if(pending&&!sameBrowserContinuationInput(pending.input,command)){publish({kind:'unconfirmed',command});return;}
  const request=await readBrowserContinuationOutcome(task,command);publish(request?{kind:'recorded',command,request}:{kind:'not-recorded',command});recorded(task);
 }
 return {snapshot:()=>state,
  async submit(value:{prompt:string;url:string}){
   if(state.kind!=='idle'||!options.isCurrent())return;
   const command=prepareBrowserContinuation(options.task,options.selection,value,options.createId(),options.binding);let pendingCommand=command;publish({kind:'preparing',command});
   try{
    const task=await options.prepare(command),pending=pendingBrowserContinuation(task);
    if(!pending)throw Error('Pending intent was not confirmed.');
    const held=Object.freeze({type:'browser.continue' as const,...pending.input,previous:Object.freeze({...pending.input.previous})});pendingCommand=held;recorded(task);
    if(!sameBrowserContinuationInput(pending.input,command)||!options.isCurrent()){publish({kind:'unconfirmed',command:held});return;}
    publish({kind:'sending',command});await received(await options.send(command),command);
   }catch{publish({kind:'unconfirmed',command:pendingCommand});}
  },
  async check(){
   if(state.kind==='idle'||['preparing','sending','checking','releasing','released'].includes(state.kind)||!options.isCurrent())return;
   const {command}=state;publish({kind:'checking',command});try{await received(await options.read(command.taskId),command);}catch{publish({kind:'unconfirmed',command});}
  },
  async release(){
   if(!options.isCurrent()||!(state.kind==='not-recorded'||state.kind==='release-unconfirmed'||state.kind==='recorded'&&state.request.status!=='running'))return;
   const {command}=state;publish({kind:'releasing',command});
   try{
    const reply=await options.release(command),expected=await browserContinuationReceipt(command),receipt=readBrowserContinuationReceipt(reply.receipt);
    if(reply.taskId!==command.taskId||reply.requestId!==command.requestId||reply.task.id!==command.taskId||pendingBrowserContinuation(reply.task)||JSON.stringify(receipt)!==JSON.stringify(expected))throw Error('Different local closure.');
    const request=await readBrowserContinuationOutcome(reply.task,command);
    if(reply.kind==='retired-unstarted'?!!request:reply.kind!=='cleared-terminal'||!request||request.status==='running')throw Error('Closure was not confirmed.');
    publish({kind:'released',command});recorded(reply.task);
   }catch{publish({kind:'release-unconfirmed',command});}
  }
 };
}
