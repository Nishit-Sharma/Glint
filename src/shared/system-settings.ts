/** Small, dependency-free contract: the host reads this before Electron's first tick. */
export type SystemSettingsSnapshot={revision:number;hardwareAcceleration:boolean};
export type SystemSettingsState=
 | {kind:'available';current:SystemSettingsSnapshot;source:'default'|'file'}
 | {kind:'unavailable';message:string};
export type HardwareAccelerationLaunch=
 | {kind:'requested';enabled:boolean;source:'default'|'file'}
 | {kind:'unavailable';message:string};
export type HardwareAccelerationRuntime=
 | {kind:'pending';sequence:number}
 | {kind:'observed';sequence:number;enabled:boolean}
 | {kind:'unavailable';sequence:number};
export type SystemSettingsView={saved:SystemSettingsState;launch:HardwareAccelerationLaunch;runtime:HardwareAccelerationRuntime;restartRequired:boolean|null};
export type SystemSettingsUpdate={expectedRevision:number;hardwareAcceleration:boolean};
export type SystemSettingsCommit={kind:'saved'|'conflict'|'unavailable';view:SystemSettingsView};
export type SystemSettingsCommand={type:'system.settings.get'}|({type:'system.settings.update'}&SystemSettingsUpdate);
export const SYSTEM_SETTINGS_MESSAGES={
 unavailable:'System settings could not be opened. Your saved file has not been changed.',
 notSaved:'System settings could not be saved. Your previous settings were preserved.',
 uncertain:'System settings save could not be confirmed. Load the saved settings before saving again.',
 limit:'System settings revision limit reached. Your saved settings were preserved.',
} as const;
function record(input:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!keys.includes(key)))throw Error('Invalid system settings.');
 return input as Record<string,unknown>;
}
const revision=(input:unknown):number=>{if(typeof input!=='number'||!Number.isSafeInteger(input)||input<0)throw Error('Invalid system settings revision.');return input;};
const boolean=(input:unknown):boolean=>{if(typeof input!=='boolean')throw Error('Invalid system settings choice.');return input;};
const source=(input:unknown):'default'|'file'=>{if(input!=='default'&&input!=='file')throw Error('Invalid system settings source.');return input;};
export function readSystemSettingsFile(input:unknown):SystemSettingsSnapshot{
 const value=record(input,['schemaVersion','revision','hardwareAcceleration']);
 if(value.schemaVersion!==1)throw Error('Invalid system settings version.');
 return {revision:revision(value.revision),hardwareAcceleration:boolean(value.hardwareAcceleration)};
}
export function readSystemSettingsCommand(input:unknown):SystemSettingsCommand{
 const value=record(input,['type',...(typeof input==='object'&&input!==null&&'type' in input&&input.type==='system.settings.update'?['expectedRevision','hardwareAcceleration']:[])]);
 if(value.type==='system.settings.get')return {type:value.type};
 if(value.type!=='system.settings.update')throw Error('Invalid system settings command.');
 return {type:value.type,expectedRevision:revision(value.expectedRevision),hardwareAcceleration:boolean(value.hardwareAcceleration)};
}
export function readHardwareAccelerationRuntime(input:unknown):HardwareAccelerationRuntime{
 const value=record(input,['kind','sequence','enabled']),sequence=revision(value.sequence);
 if(value.kind==='observed')return {kind:value.kind,sequence,enabled:boolean(value.enabled)};
 if((value.kind!=='pending'&&value.kind!=='unavailable')||'enabled' in value)throw Error('Invalid system runtime status.');
 return {kind:value.kind,sequence};
}
export function readSystemSettingsView(input:unknown):SystemSettingsView{
 const value=record(input,['saved','launch','runtime','restartRequired']),savedValue=record(value.saved,['kind','current','source','message']),launchValue=record(value.launch,['kind','enabled','source','message']);
 let saved:SystemSettingsState,launch:HardwareAccelerationLaunch;
 if(savedValue.kind==='available'){
  const current=record(savedValue.current,['revision','hardwareAcceleration']);
  saved={kind:'available',current:{revision:revision(current.revision),hardwareAcceleration:boolean(current.hardwareAcceleration)},source:source(savedValue.source)};
 }else if(savedValue.kind==='unavailable'&&savedValue.message===SYSTEM_SETTINGS_MESSAGES.unavailable)saved={kind:'unavailable',message:savedValue.message};
 else throw Error('Invalid saved system settings.');
 if(launchValue.kind==='requested')launch={kind:'requested',enabled:boolean(launchValue.enabled),source:source(launchValue.source)};
 else if(launchValue.kind==='unavailable'&&typeof launchValue.message==='string')launch={kind:'unavailable',message:launchValue.message};
 else throw Error('Invalid launch system settings.');
 const restartRequired=saved.kind==='available'&&launch.kind==='requested'?saved.current.hardwareAcceleration!==launch.enabled:null;
 if(value.restartRequired!==restartRequired)throw Error('Invalid restart status.');
 return {saved,launch,runtime:readHardwareAccelerationRuntime(value.runtime),restartRequired};
}
export function readSystemSettingsCommit(input:unknown):SystemSettingsCommit{
 const value=record(input,['kind','view']);
 if(value.kind!=='saved'&&value.kind!=='conflict'&&value.kind!=='unavailable')throw Error('Invalid system settings save result.');
 return {kind:value.kind,view:readSystemSettingsView(value.view)};
}
