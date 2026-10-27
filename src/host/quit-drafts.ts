import {randomUUID} from 'node:crypto';

/** A native quit may proceed only after the live renderer drains local messages,
 * or after an explicit decision to leave unacknowledged edits behind. */
export function createQuitDraftBarrier(options:{send:(quitId:string)=>void;confirmDiscard:(reason:string)=>Promise<boolean>;timeoutMs?:number}){
 let pending:{id:string;waiting:boolean;reply:(error?:string)=>void;result:Promise<{id:string;allowQuit:boolean;saved:boolean}>}|undefined;
 function acknowledge(id:string,error?:string){if(!pending||pending.id!==id||!pending.waiting)return false;pending.waiting=false;pending.reply(error);return true;}
 function request(priorFailure?:string){
  if(pending)return pending.result;
  const id=randomUUID();let reply:(error?:string)=>void=()=>{};
  const received=new Promise<string|undefined>(resolve=>{reply=resolve;});
  const timer=setTimeout(()=>acknowledge(id,'The app did not confirm that unsent messages were saved.'),options.timeoutMs??3500);
  const result=Promise.resolve().then(async()=>{
   try{options.send(id);}catch{acknowledge(id,'The app could not confirm that unsent messages were saved.');}
   const replyError=await received,error=priorFailure??replyError;clearTimeout(timer);
   if(error===undefined)return {id,allowQuit:true,saved:true};
   const allowQuit=await options.confirmDiscard(error).catch(()=>false);
   return {id,allowQuit,saved:false};
  }).finally(()=>{clearTimeout(timer);if(pending?.id===id)pending=undefined;});
  pending={id,waiting:true,reply,result};return result;
 }
 return {request,acknowledge};
}
