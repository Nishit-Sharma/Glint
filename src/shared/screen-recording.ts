/**
 * Session-only choice: Glint starts protected on every launch; credential surfaces never follow it.
 * `confirmed:false` means the host could not apply protection to every window, so Glint may be capturable.
 */
export type ScreenRecordingState={allowed:boolean;confirmed:boolean;scope:'this-session'};
export type ScreenRecordingCommand={type:'screen-recording.get'}|{type:'screen-recording.set';allowed:boolean};
const record=(input:unknown,keys:readonly string[]):Record<string,unknown>=>{
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!keys.includes(key)))throw Error('Invalid screen recording setting.');
 return input as Record<string,unknown>;
};
export function readScreenRecordingCommand(input:unknown):ScreenRecordingCommand{
 const type=input&&typeof input==='object'&&'type' in input?(input as {type:unknown}).type:undefined;
 if(type==='screen-recording.get'){record(input,['type']);return {type};}
 if(type!=='screen-recording.set')throw Error('Invalid screen recording setting.');
 const value=record(input,['type','allowed']);
 if(typeof value.allowed!=='boolean')throw Error('Invalid screen recording setting.');
 return {type,allowed:value.allowed};
}
export function readScreenRecordingState(input:unknown):ScreenRecordingState{
 const value=record(input,['allowed','confirmed','scope']);
 if(typeof value.allowed!=='boolean'||typeof value.confirmed!=='boolean'||value.scope!=='this-session')throw Error('Invalid screen recording setting.');
 return {allowed:value.allowed,confirmed:value.confirmed,scope:'this-session'};
}
/** Glint may be visible to capture whenever the choice is on or protection is unconfirmed. */
export const screenRecordingExposed=(state:ScreenRecordingState)=>state.allowed||!state.confirmed;
