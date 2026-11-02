const key='glint-local-response-followups-v1';
type StorageAccess=Pick<Storage,'getItem'|'setItem'>;
export function createPromptSuggestionPreference(storage:()=>StorageAccess){
 let snapshot:Readonly<{enabled:boolean;available:boolean;version:number}>|undefined;
 const listeners=new Set<()=>void>();
 function read(){try{return {enabled:storage().getItem(key)!=='off',available:true};}catch{return {enabled:false,available:false};}}
 function getSnapshot(){return snapshot??(snapshot=Object.freeze({...read(),version:0}));}
 function refresh(){snapshot=Object.freeze({...read(),version:getSnapshot().version+1});for(const listener of listeners)listener();}
 return {getSnapshot,subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},refresh,
  set(enabled:boolean){storage().setItem(key,enabled?'on':'off');refresh();if(getSnapshot().enabled!==enabled||!getSnapshot().available)throw Error('Preference could not be saved.');},key};
}
export const promptSuggestionPreference=createPromptSuggestionPreference(()=>window.localStorage);
if(typeof window!=='undefined')window.addEventListener('storage',event=>{if(event.key===key||event.key===null)promptSuggestionPreference.refresh();});
