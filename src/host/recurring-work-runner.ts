import type {RecurringWorkStatus} from '../shared/recurring-work';

export const RECURRING_CHECK_INTERVAL_MS=15_000;
/** App-lifetime checks serialize occurrences; the host owns any scoped response authorization. */
export function createRecurringWorkRunner(options:{prepare:(assertCurrent:()=>void)=>Promise<string[]>;changed:(taskIds:string[])=>void;now?:()=>Date}){
 let timer:ReturnType<typeof setInterval>|undefined,inFlight:Promise<void>|undefined,epoch=0,stopped=true;
 let status:RecurringWorkStatus={state:'stopped',message:'Scheduled work is stopped.'};
 const tick=()=>{
  if(stopped||inFlight)return;
  const current=epoch,guard=()=>{if(stopped||epoch!==current)throw Error('Schedule checking stopped.');};
  inFlight=(async()=>{
   try{const ids=await options.prepare(guard);guard();status={state:'ready',message:'Checking for due work every 15 seconds while Glint is running.',checkedAt:(options.now?.()??new Date()).toISOString()};options.changed(ids);}
   catch{if(!stopped&&epoch===current){status={state:'error',message:'Scheduled work could not be confirmed. Your saved schedules are kept. Reopen Glint to reconcile the local store.'};options.changed([]);}}
  })().finally(()=>{inFlight=undefined;});
 };
 return {
  read:():RecurringWorkStatus=>({...status}),
  start(){if(!stopped)return;stopped=false;epoch++;status={state:'checking',message:'Checking for due work…'};timer=setInterval(tick,RECURRING_CHECK_INTERVAL_MS);tick();},
  async stop(){stopped=true;epoch++;if(timer)clearInterval(timer);timer=undefined;await inFlight;status={state:'stopped',message:'Scheduled work is stopped.'};},
 };
}
