import {expect,test} from 'vitest';
import {changeWarning,collectWarnings,createWarningStore,dismissReviewed,hostWarningDiagnostics,isWarningKeepKey,readWarningSnapshot,WARNING_LIMIT,type WarningDiagnostic,type WarningLock} from '../../src/renderer/src/warning-retention';
import type {HostStatus} from '../../src/shared/bridge';
const host:HostStatus={platform:'darwin',screenPermission:'unknown',accessibilityPermission:'unknown',shortcut:'Both Option keys',captureMode:'explicit-frozen',memoryEnabled:false,dataDir:'/test'};
const first:WarningDiagnostic={key:'physical:unavailable',title:'Screen context shortcut',message:'This shortcut could not start.'};
const second:WarningDiagnostic={key:'fallback:unavailable',title:'Screen context fallback',message:'Fallback unavailable.'};
let sequence=0;
const collect=(snapshot=readWarningSnapshot(null),diagnostics=[first])=>collectWarnings(snapshot,diagnostics,()=>`warning-${++sequence}`,'2026-11-02T00:00:00.000Z');
function fixture(){
 let raw:string|null=null;
 const storage={getItem:()=>raw,setItem:(_key:string,value:string)=>{raw=value;}};
 let queue=Promise.resolve();
 const lock:WarningLock=work=>{const result=queue.then(work);queue=result.then(()=>{},()=>{});return result;};
 return {storage,store:createWarningStore(storage,lock),lock};
}
test('only actual host diagnostic conditions produce warnings, preserving original listener text',()=>{
 expect(hostWarningDiagnostics()).toEqual([]);expect(hostWarningDiagnostics(host)).toEqual([]);
 expect(hostWarningDiagnostics({...host,modifierShortcutStatus:'ready',shortcutStatus:'registered',fallbackShortcutStatus:'registered'})).toEqual([]);
 expect(hostWarningDiagnostics({...host,modifierShortcutStatus:'starting'})).toEqual([]);
 expect(hostWarningDiagnostics({...host,modifierShortcutStatus:'permission-required'})[0].message).toBe('Allow Accessibility access for Glint in System Settings, then reopen Glint to enable the physical shortcut.');
 expect(hostWarningDiagnostics({...host,modifierShortcutStatus:'unsupported'})[0].message).toContain('not supported');
 for(const state of ['unavailable','stopped'] as const)expect(hostWarningDiagnostics({...host,modifierShortcutStatus:state})[0].message).toContain('could not start');
 expect(hostWarningDiagnostics({...host,shortcutStatus:'unavailable',fallbackShortcut:'Control+Alt+G',fallbackShortcutStatus:'unavailable'})).toHaveLength(2);
});
test('closing dismisses only actually reviewed pending IDs; kept and unseen arrivals survive',()=>{
 let state=collect(undefined,[first,second]);const [a,b]=state.warnings;
 state=changeWarning(state,a.id,true);
 state=collect(state,[first,second,{...first,key:'new',message:'New arrival'}]);
 state=dismissReviewed(state,new Set([a.id,b.id]));
 expect(state.warnings.map(w=>w.state)).toEqual(['kept','dismissed','pending']);
 expect(state.warnings[0]).toEqual({...a,state:'kept'});
 state=changeWarning(state,a.id,false);
 expect(dismissReviewed(state,new Set([a.id])).warnings[0].state).toBe('dismissed');
});
test('same active warning stays dismissed, resolved then recurring condition has a new identity',()=>{
 let state=collect();const id=state.warnings[0].id;state=dismissReviewed(state,new Set([id]));
 expect(collect(state).warnings[0].state).toBe('dismissed');
 state=collect(state,[]);expect(state.warnings).toEqual([]);
 state=collect(state);expect(state.warnings[0].id).not.toBe(id);expect(state.warnings[0].state).toBe('pending');
});
test('kept exact snapshot survives resolution, binding changes and ordinary reopen',async()=>{
 const {store,storage,lock}=fixture();let state=await store.update('initial',value=>collect(value));const warning=state.warnings[0];
 state=await store.update(state.revision,value=>changeWarning(value,warning.id,true));
 state=await store.update(state.revision,value=>collect(value,[{...first,key:'different binding',message:'Different exact warning'}]));
 const reopened=createWarningStore(storage,lock).read();
 expect(reopened.warnings[0]).toEqual({...warning,state:'kept'});expect(reopened.warnings[1].state).toBe('pending');
});
test('storage denial, corruption, and readback mismatch reject without reporting kept',async()=>{
 const initial=collect();
 for(const storage of [
  {getItem:()=>JSON.stringify(initial),setItem:()=>{throw Error('quota');}},
  {getItem:()=>JSON.stringify(initial),setItem:()=>{}},
 ])await expect(createWarningStore(storage,async work=>work()).update(initial.revision,value=>changeWarning(value,value.warnings[0].id,true))).rejects.toThrow();
 expect(()=>readWarningSnapshot('{broken')).toThrow();
 expect(()=>readWarningSnapshot(JSON.stringify({...initial,version:2}))).toThrow();
 expect(()=>readWarningSnapshot(JSON.stringify({...initial,active:{bad:'unknown'}}))).toThrow();
 expect(()=>readWarningSnapshot(JSON.stringify({...initial,warnings:[initial.warnings[0],initial.warnings[0]]}))).toThrow();
});
test('two windows with the same expected revision cannot overwrite each other',async()=>{
 const {store,storage,lock}=fixture();const state=await store.update('initial',value=>collect(value));const id=state.warnings[0].id;
 const other=createWarningStore(storage,lock);
 const results=await Promise.allSettled([store.update(state.revision,value=>changeWarning(value,id,true)),other.update(state.revision,value=>dismissReviewed(value,new Set([id])))]);
 expect(results.map(result=>result.status)).toEqual(['fulfilled','rejected']);expect(store.read().warnings[0].state).toBe('kept');
});
test('bounded storage refuses to discard kept or unseen warnings',()=>{
 const full=collect(undefined,Array.from({length:WARNING_LIMIT},(_,i)=>({...first,key:String(i)})));
 expect(()=>collect(full,[...full.warnings,{...first,key:'overflow'}])).toThrow('full');
 expect(full.warnings).toHaveLength(WARNING_LIMIT);
 const dismissed=dismissReviewed(full,new Set([full.warnings[0].id]));
 expect(collect(dismissed,[{...first,key:'overflow'}]).warnings).toHaveLength(WARNING_LIMIT);
});
test('k is scoped to focused viewer, ignores typing, modifiers, repeated and composing keys',()=>{
 const event={key:'k',altKey:false,ctrlKey:false,metaKey:false,shiftKey:false,repeat:false,isComposing:false};
 expect(isWarningKeepKey(event,false,true)).toBe(true);
 expect(isWarningKeepKey(event,true,true)).toBe(false);expect(isWarningKeepKey(event,false,false)).toBe(false);
 for(const key of ['altKey','ctrlKey','metaKey','shiftKey','repeat','isComposing'] as const)expect(isWarningKeepKey({...event,[key]:true},false,true)).toBe(false);
 expect(isWarningKeepKey({...event,key:'K'},false,true)).toBe(false);
});
