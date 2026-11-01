export const DEFAULT_FALLBACK_SHORTCUT='Control+Shift+Space';
export const FALLBACK_SHORTCUT_MESSAGES={
 invalid:'Choose a shortcut such as Option+Space or Control+Shift+Space.',
 unavailable:'Shortcut is unavailable. Your previous binding is kept.',
 changed:'The fallback shortcut changed elsewhere. Load its current binding before saving again.',
 notSaved:'The fallback shortcut could not be saved. Your previous binding and saved file were preserved.',
 uncertain:'The fallback shortcut was published, but its durable save could not be confirmed. Load the current binding before changing it again.',
} as const;
export type FallbackShortcutCommand=
 | {type:'shortcut.get'}
 | {type:'shortcut.set';accelerator:string;expectedShortcut?:string}
 | {type:'shortcut.reset';expectedShortcut:string};
export function readFallbackAccelerator(value:unknown):string{
 if(typeof value!=='string'||value.length>80||!/^(CommandOrControl|Control|Ctrl|Command|Cmd|Alt|Option|Shift|Super)(\+[A-Za-z0-9]+)+$/.test(value))throw Error(FALLBACK_SHORTCUT_MESSAGES.invalid);
 return value;
}
export function readFallbackShortcutCommand(input:unknown):FallbackShortcutCommand{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid shortcut setting.');
 const value=input as Record<string,unknown>;
 if(value.type==='shortcut.get'&&Object.keys(value).length===1)return {type:value.type};
 if(value.type==='shortcut.set'&&!Object.keys(value).some(key=>!['type','accelerator','expectedShortcut'].includes(key)))return {type:value.type,accelerator:readFallbackAccelerator(value.accelerator),...(value.expectedShortcut!==undefined?{expectedShortcut:readFallbackAccelerator(value.expectedShortcut)}:{})};
 if(value.type==='shortcut.reset'&&!Object.keys(value).some(key=>!['type','expectedShortcut'].includes(key)))return {type:value.type,expectedShortcut:readFallbackAccelerator(value.expectedShortcut)};
 throw Error('Invalid shortcut setting.');
}
