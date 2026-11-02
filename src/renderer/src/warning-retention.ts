import type {HostStatus} from '../../shared/bridge';

export type WarningDiagnostic={key:string;title:string;message:string};
export type RetainedWarning=WarningDiagnostic&{id:string;observedAt:string;state:'pending'|'kept'|'dismissed'};
export type WarningSnapshot={version:1;revision:string;active:Record<string,string>;warnings:RetainedWarning[]};
export const WARNING_LIMIT=64;
export class WarningCapacityError extends Error{constructor(){super('The warning list is full. Review and dismiss warnings before collecting more.');this.name='WarningCapacityError';}}
let warningWork:Promise<void>=Promise.resolve();
/** Observations stay ordered across viewer unmount/remount within this renderer. */
export function queueWarningWork<T>(work:()=>Promise<T>):Promise<T>{const result=warningWork.then(work);warningWork=result.then(()=>{},()=>{});return result;}
export const WARNING_STORAGE_KEY='glint.warning-review.v1';
const empty=():WarningSnapshot=>({version:1,revision:'initial',active:{},warnings:[]});

export function hostWarningDiagnostics(host?:HostStatus):WarningDiagnostic[]{
 if(!host)return [];
 const warnings:WarningDiagnostic[]=[];
 const listener=host.modifierShortcutStatus;
 const message=listener==='permission-required'?'Allow Accessibility access for Window Companion in System Settings, then reopen Glint to enable the physical shortcut.':listener==='unsupported'?'The physical shortcut is not supported on this system. Use the fallback shortcut or Screen context.':listener==='unavailable'||listener==='stopped'||host.shortcutStatus==='unavailable'?'This shortcut could not start. Check Accessibility access and reopen Glint. Use Screen context, or change the fallback below.':'';
 if(message)warnings.push({key:JSON.stringify(['physical',listener??null,host.shortcutStatus??null,host.shortcut]),title:'Screen context shortcut',message});
 if(host.fallbackShortcutStatus==='unavailable')warnings.push({key:JSON.stringify(['fallback',host.fallbackShortcut??null]),title:'Screen context fallback',message:host.fallbackShortcut?`The fallback shortcut ${host.fallbackShortcut} is unavailable. Check its current binding in Preferences → Screen and shortcuts.`:'The fallback shortcut is unavailable. Check its current binding in Preferences → Screen and shortcuts.'});
 return warnings;
}
export function readWarningSnapshot(raw:string|null):WarningSnapshot{
 if(raw===null)return empty();
 if(raw.length>150_000)throw Error('The saved warning list is too large to open.');
 const value:unknown=JSON.parse(raw);
 if(!value||typeof value!=='object')throw Error('The saved warning list could not be read.');
 const data=value as WarningSnapshot;
 if(data.version!==1||typeof data.revision!=='string'||!data.active||typeof data.active!=='object'||Array.isArray(data.active)||!Array.isArray(data.warnings)||data.warnings.length>WARNING_LIMIT)throw Error('The saved warning list could not be read.');
 const ids=new Set<string>();
 for(const warning of data.warnings){
  if(!warning||typeof warning!=='object'||!['id','key','title','message','observedAt'].every(key=>typeof warning[key as keyof RetainedWarning]==='string'&&(warning[key as keyof RetainedWarning] as string).length>0&&(warning[key as keyof RetainedWarning] as string).length<=4000)||!['pending','kept','dismissed'].includes(warning.state)||ids.has(warning.id)||!Number.isFinite(Date.parse(warning.observedAt)))throw Error('The saved warning list could not be read.');
  ids.add(warning.id);
 }
 for(const [key,id] of Object.entries(data.active))if(!data.warnings.some(warning=>warning.id===id&&warning.key===key))throw Error('The saved warning list could not be read.');
 return data;
}
export function collectWarnings(snapshot:WarningSnapshot,diagnostics:WarningDiagnostic[],id:()=>string,now:string):WarningSnapshot{
 const keys=new Set(diagnostics.map(warning=>warning.key));
 const active=Object.fromEntries(Object.entries(snapshot.active).filter(([key])=>keys.has(key)));
 const warnings=snapshot.warnings.filter(warning=>warning.state!=='dismissed'||Object.values(active).includes(warning.id));
 for(const diagnostic of diagnostics){
  if(active[diagnostic.key])continue;
  if(warnings.length===WARNING_LIMIT)throw new WarningCapacityError();
  const warning={...diagnostic,id:id(),observedAt:now,state:'pending' as const};
  warnings.push(warning);active[diagnostic.key]=warning.id;
 }
 return {...snapshot,active,warnings};
}
export function changeWarning(snapshot:WarningSnapshot,id:string,keep:boolean):WarningSnapshot{
 if(!snapshot.warnings.some(warning=>warning.id===id&&warning.state!=='dismissed'))throw Error('This warning changed. Reload the warning list.');
 return {...snapshot,warnings:snapshot.warnings.map(warning=>warning.id===id?{...warning,state:keep?'kept':'pending'}:warning)};
}
export function dismissReviewed(snapshot:WarningSnapshot,reviewed:ReadonlySet<string>):WarningSnapshot{
 return {...snapshot,warnings:snapshot.warnings.map(warning=>reviewed.has(warning.id)&&warning.state==='pending'?{...warning,state:'dismissed'}:warning)};
}
export type WarningStorage=Pick<Storage,'getItem'|'setItem'>;
export type WarningLock=<T>(work:()=>T|Promise<T>)=>Promise<T>;
export function createWarningStore(storage:WarningStorage,lock:WarningLock,key=WARNING_STORAGE_KEY){
 return {
  read:()=>readWarningSnapshot(storage.getItem(key)),
  update:(expected:string,change:(snapshot:WarningSnapshot)=>WarningSnapshot)=>lock(()=>{
   const current=readWarningSnapshot(storage.getItem(key));
   if(current.revision!==expected)throw Error('Warnings changed in another window. Reload before continuing.');
   const changed=change(current);
   if(JSON.stringify(changed)===JSON.stringify(current))return current;
   const next={...changed,revision:crypto.randomUUID()};
   const raw=JSON.stringify(next);readWarningSnapshot(raw);
   storage.setItem(key,raw);
   if(storage.getItem(key)!==raw)throw Error('The warning change could not be verified. Reload the warning list.');
   return next;
  })
 };
}
export type WarningKeyInput={key:string;altKey:boolean;ctrlKey:boolean;metaKey:boolean;shiftKey:boolean;repeat:boolean;isComposing:boolean};
export function isWarningKeepKey(event:WarningKeyInput,editable:boolean,focused:boolean):boolean{
 return focused&&!editable&&event.key==='k'&&!event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.repeat&&!event.isComposing;
}
