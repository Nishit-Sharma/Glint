import type {ScreenRecordingState} from '../shared/screen-recording';

export type ProtectableWindow={setContentProtection(enabled:boolean):void;isDestroyed():boolean};
export type ProtectionKind='surface'|'credential';
/**
 * One in-memory owner of Glint's capture protection. It starts protected on every launch and is never saved,
 * so a forgotten choice cannot expose a later session. Credential surfaces stay protected regardless.
 * `confirmed` is false only when a window's protection could not be applied, so some window may be capturable.
 */
export function createScreenRecordingProtection(){
 let allowed=false,confirmed=true;
 const windows=new Map<ProtectableWindow,ProtectionKind>();
 const apply=(window:ProtectableWindow,kind:ProtectionKind)=>window.setContentProtection(kind==='credential'||!allowed);
 const prune=()=>{for(const window of windows.keys())if(window.isDestroyed())windows.delete(window);};
 const state=():ScreenRecordingState=>({allowed,confirmed,scope:'this-session'});
 return {
  /** Apply the current choice now and keep the window for later changes. */
  track(window:ProtectableWindow,kind:ProtectionKind='surface'){prune();windows.set(window,kind);apply(window,kind);},
  set(next:boolean):ScreenRecordingState{
   allowed=next;prune();
   let failed=false;
   for(const [window,kind] of windows){try{apply(window,kind);}catch{failed=true;}}
   if(!failed){confirmed=true;return state();}
   // Never leave a partial exposure: try to protect every window, and say so honestly if that fails too.
   allowed=false;confirmed=true;
   for(const [window] of windows){try{window.setContentProtection(true);}catch{confirmed=false;}}
   throw Error(confirmed?'Screen recording could not be changed. Glint windows are protected.':'Glint windows could not all be protected. They may be visible to screen recording.');
  },
  state,
 };
}
export type ScreenRecordingProtection=ReturnType<typeof createScreenRecordingProtection>;
