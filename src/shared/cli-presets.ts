export const CLI_PRESET_SLOTS=10;
export const CLI_PRESET_BODY_BYTES=32768;
export const CLI_PRESET_EXPANDED_BYTES=131072;
export type CliPreset={slot:number;revision:number;name:string;body:string};
export type CliPresetSnapshot={schemaVersion:1;revision:number;presets:CliPreset[]};
export type PromptArguments={positional:string[];named:Record<string,string>};
const bytes=(value:string)=>new TextEncoder().encode(value).length;
export function presetSlot(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>CLI_PRESET_SLOTS)throw Error('Choose a preset slot from 1 to 10.');return value;}
export function presetName(value:unknown):string{if(typeof value!=='string'||!/^[a-z][a-z0-9-]{0,47}$/.test(value))throw Error('Use a preset name of 1–48 lowercase letters, digits or hyphens, starting with a letter.');return value;}
export function presetBody(value:unknown):string{if(typeof value!=='string'||!value.trim()||bytes(value)>CLI_PRESET_BODY_BYTES)throw Error('A preset needs nonempty UTF-8 text, up to 32 KiB.');return value;}
export function presetRevision(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>=Number.MAX_SAFE_INTEGER)throw Error('Invalid preset revision. List presets and use their current catalog revision.');return value;}
function object(value:unknown,keys:string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw Error('Unsupported preset file. Existing files were preserved.');return value as Record<string,unknown>;}
export function readCliPresetSnapshot(value:unknown):CliPresetSnapshot{
 const file=object(value,['schemaVersion','revision','presets']);if(file.schemaVersion!==1||!Array.isArray(file.presets)||file.presets.length>CLI_PRESET_SLOTS)throw Error('Unsupported preset file. Existing files were preserved.');
 const revision=presetRevision(file.revision),presets=file.presets.map(item=>{const p=object(item,['slot','revision','name','body']);const entry={slot:presetSlot(p.slot),revision:presetRevision(p.revision),name:presetName(p.name),body:presetBody(p.body)};if(entry.revision<1||entry.revision>revision)throw Error('Unsupported preset revision. Existing files were preserved.');return entry;});
 if(new Set(presets.map(p=>p.slot)).size!==presets.length||new Set(presets.map(p=>p.name)).size!==presets.length)throw Error('Preset slots and names must be unique. Existing files were preserved.');
 return {schemaVersion:1,revision,presets:presets.sort((a,b)=>a.slot-b.slot)};
}
export function parsePromptWords(line:string):string[]{
 if(bytes(line)>32768)throw Error('Prompt arguments exceed 32 KiB.');const words:string[]=[];let word='',quote='',started=false,escape=false;
 for(const char of line){if(escape){word+=char;escape=false;started=true;}else if(char==='\\'&&quote!=="'"){escape=true;started=true;}else if(quote){if(char===quote)quote='';else word+=char;}else if(char==='"'||char==="'"){quote=char;started=true;}else if(/\s/.test(char)){if(started){words.push(word);word='';started=false;}}else{word+=char;started=true;}}
 if(quote||escape)throw Error('Close the quote or escape in the arguments.');if(started)words.push(word);return words;
}
export function parsePromptArguments(values:readonly string[]):PromptArguments{
 if(values.length>32||values.reduce((n,v)=>n+bytes(v),0)>32768)throw Error('Use up to 32 arguments and 32 KiB of parameter text.');
 const positional:string[]=[],named:Record<string,string>=Object.create(null);
 for(const value of values){const match=/^([A-Za-z][A-Za-z0-9_]*)=([\s\S]*)$/.exec(value);if(match){if(!match[2]||Object.hasOwn(named,match[1]))throw Error('Named arguments need a nonempty, unrepeated NAME=value.');named[match[1]]=match[2];}else{if(!value)throw Error('Positional arguments must not be empty.');positional.push(value);}}
 return {positional,named};
}
export function expandCliPrompt(body:string,args:PromptArguments):string{
 presetBody(body);const used=new Set<string>();let largest=0,all=false;
 const expanded=body.replace(/\$\$|\$([1-9](?!\d)|[A-Za-z][A-Za-z0-9_]*)/g,(token,key:string|undefined)=>{
  if(token==='$$')return '$';if(key==='ARGUMENTS'){all=true;if(!args.positional.length)throw Error('Missing positional arguments for $ARGUMENTS.');return args.positional.join(' ');}
  if(key&&/^[1-9]$/.test(key)){const i=Number(key);largest=Math.max(largest,i);if(args.positional[i-1]===undefined)throw Error('Missing argument '+token+'.');return args.positional[i-1];}
  if(!key||!Object.hasOwn(args.named,key))throw Error('Missing named argument '+token+'.');used.add(key);return args.named[key];
 });
 if(Object.keys(args.named).some(key=>!used.has(key))||!all&&args.positional.length>largest)throw Error('An argument is not used by this preset. Review the template parameters.');
 if(bytes(expanded)>CLI_PRESET_EXPANDED_BYTES)throw Error('The expanded prompt exceeds 128 KiB.');return expanded;
}
export function promptTerminalText(value:string):string{
 // Preserve Markdown layout while making every terminal escape/control inert.
 return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
}
