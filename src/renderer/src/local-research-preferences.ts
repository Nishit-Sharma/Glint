import {readLocalResearchPreferenceState,type LocalResearchCommand,type LocalResearchPreferenceState,type LocalResearchPreferences} from '../../shared/local-research-suggestions';

type Bridge={invoke:<T>(command:LocalResearchCommand)=>Promise<T>;subscribe:(listener:(event:{type:string})=>void)=>()=>void};
type Snapshot={state:LocalResearchPreferenceState;version:number;loading:boolean;paused:boolean};
/** The host owns all choices. A failed save cannot be cleared by a renderer reload. */
export function createLocalResearchPreferences(bridge:()=>Bridge){
 let snapshot:Snapshot={state:{kind:'unavailable',message:'Local research choices have not loaded.'},version:0,loading:false,paused:false},generation=0,stop:(()=>void)|undefined;const listeners=new Set<()=>void>();
 function publish(value:Omit<Snapshot,'version'>){snapshot={...value,version:snapshot.version+1};for(const listener of listeners)listener();}
 async function refresh(){if(snapshot.paused)return;const mine=++generation;if(snapshot.state.kind!=='available')publish({...snapshot,loading:true});try{const state=readLocalResearchPreferenceState(await bridge().invoke({type:'research.settings.get'}));if(mine===generation&&!snapshot.paused&&(snapshot.loading||JSON.stringify(state)!==JSON.stringify(snapshot.state)))publish({state,loading:false,paused:false});}catch{if(mine===generation)publish({state:{kind:'unavailable',message:'Local research choices are unavailable. Suggestions and alerts are paused.'},loading:false,paused:false});}}
 async function set(values:Pick<LocalResearchPreferences,'enabled'|'memory'|'notices'>){
  if(snapshot.paused||snapshot.loading||snapshot.state.kind!=='available')throw Error('Local research choices are unavailable.');
  const revision=snapshot.state.current.revision,mine=++generation;publish({...snapshot,loading:true});
  try{const state=readLocalResearchPreferenceState(await bridge().invoke({type:'research.settings',expectedRevision:revision,enabled:values.enabled,memory:values.memory,notices:values.notices}));if(state.kind!=='available'||state.current.revision!==revision+1||state.current.enabled!==values.enabled||state.current.memory!==values.memory||state.current.notices!==values.notices)throw Error('The saved local research choice could not be confirmed.');if(mine===generation&&!snapshot.paused)publish({state,loading:false,paused:false});}
  catch(error){generation++;publish({state:{kind:'unavailable',message:'Local research is paused for this session because saving could not be confirmed. Your previous saved choice may return after restarting. No durable disable is claimed.'},loading:false,paused:true});throw error;}
 }
 return {getSnapshot:()=>snapshot,subscribe(listener:()=>void){listeners.add(listener);if(!stop){try{stop=bridge().subscribe(event=>{if(event.type==='changed'||event.type==='notifications.changed')void refresh();});}catch{}void refresh();}return()=>{listeners.delete(listener);if(!listeners.size){stop?.();stop=undefined;}};},refresh,set};
}
export const localResearchPreferences=createLocalResearchPreferences(()=>window.companion);
