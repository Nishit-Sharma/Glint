import {constants} from 'node:fs';
import {mkdir,open,rename,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {isAbsolute,join} from 'node:path';
import {CLI_PRESET_BODY_BYTES,expandCliPrompt,parsePromptArguments,presetBody,presetName,presetRevision,presetSlot,promptTerminalText,readCliPresetSnapshot,type CliPresetSnapshot} from '../shared/cli-presets';

const FILE_LIMIT=2*1024*1024;
const missing=(error:unknown)=>!!error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT';
async function boundedText(path:string,limit:number):Promise<string>{
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const before=await file.stat();if(!before.isFile()||before.size>limit)throw Error('Choose a regular UTF-8 file within the supported size.');const bytes=Buffer.alloc(Math.min(before.size+1,limit+1));let length=0;while(length<bytes.length){const read=await file.read(bytes,length,bytes.length-length,null);if(!read.bytesRead)break;length+=read.bytesRead;}const after=await file.stat();if(length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error('The selected file changed while reading; nothing was saved.');return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,length));}finally{await file.close();}
}
export class CliPresetStore{
 constructor(private readonly directory:string){}
 async read():Promise<CliPresetSnapshot>{try{return readCliPresetSnapshot(JSON.parse(await boundedText(join(this.directory,'cli-presets.json'),FILE_LIMIT)));}catch(error){if(missing(error))return {schemaVersion:1,revision:0,presets:[]};throw Error('The preset catalog could not be read. Existing files were preserved.');}}
 private async change(update:(current:CliPresetSnapshot)=>CliPresetSnapshot):Promise<CliPresetSnapshot>{
  await mkdir(this.directory,{recursive:true,mode:0o700});const lockPath=join(this.directory,'cli-presets.lock');let lock;
  try{lock=await open(lockPath,'wx',0o600);}catch{throw Error('Presets are locked by another edit. No change was made; retry after that edit finishes.');}
  const temporary=join(this.directory,'.cli-presets-'+randomUUID()+'.tmp');
  try{const current=await this.read(),next=readCliPresetSnapshot(update(current));const target=await open(temporary,'wx',0o600);try{await target.writeFile(JSON.stringify(next)+'\n');await target.sync();}finally{await target.close();}await rename(temporary,join(this.directory,'cli-presets.json'));const directory=await open(this.directory,'r');try{await directory.sync();}finally{await directory.close();}return next;}
  finally{await rm(temporary,{force:true});await lock.close();await rm(lockPath);}
 }
 save(slot:number,name:string,body:string){presetSlot(slot);presetName(name);presetBody(body);return this.change(current=>{if(current.presets.some(p=>p.slot===slot))throw Error('This slot is occupied. Use edit with the catalog revision shown by list.');if(current.presets.some(p=>p.name===name))throw Error('This preset name is already saved in another slot.');const revision=presetRevision(current.revision+1);return {...current,revision,presets:[...current.presets,{slot,name,body,revision}]};});}
 edit(slot:number,name:string,body:string,expectedRevision:number){presetSlot(slot);presetName(name);presetBody(body);presetRevision(expectedRevision);return this.change(current=>{if(current.revision!==expectedRevision)throw Error('Presets changed. List them again before editing.');if(!current.presets.some(p=>p.slot===slot))throw Error('This slot is empty. Use save to create it.');if(current.presets.some(p=>p.name===name&&p.slot!==slot))throw Error('This name belongs to another slot.');const revision=presetRevision(current.revision+1);return {...current,revision,presets:current.presets.map(p=>p.slot===slot?{slot,name,body,revision}:p)};});}
 delete(slot:number,expectedRevision:number){presetSlot(slot);presetRevision(expectedRevision);return this.change(current=>{if(current.revision!==expectedRevision)throw Error('Presets changed. List them again before deleting.');if(!current.presets.some(p=>p.slot===slot))throw Error('This slot is already empty.');return {...current,revision:presetRevision(current.revision+1),presets:current.presets.filter(p=>p.slot!==slot)};});}
}
type Command={kind:'list'}|{kind:'show'|'recall';selector:string;args:string[]}|{kind:'save'|'edit';slot:number;name:string;file?:string;text?:string;expected?:number}|{kind:'delete';slot:number;expected:number}|{kind:'prompt';menu:boolean};
export type PresetCliArguments={command:Command;dataDir?:string;format:'text'|'json'};
export const isPresetCliCommand=(args:readonly string[])=>['presets','prompt','/presets'].includes(args[0])||args[0]?.startsWith('/prompts:');
export function parsePresetCliArguments(args:readonly string[]):PresetCliArguments{
 if(args.length>48)throw Error('Too many preset arguments.');const pos:string[]=[],flags=new Map<string,string>();let literal=false;
 for(let i=0;i<args.length;i++){const arg=args[i];if(arg==='--'&&!literal){literal=true;continue;}if(!literal&&arg.startsWith('--')){if(!['--data-dir','--format','--file','--text','--expect'].includes(arg)||flags.has(arg))throw Error('Unknown or repeated preset option.');const value=args[++i];if(value===undefined)throw Error('Missing preset option value.');flags.set(arg,value);}else pos.push(arg);}
 const dataDir=flags.get('--data-dir');if(dataDir!==undefined&&(!isAbsolute(dataDir)||dataDir.includes('\0')))throw Error('--data-dir must be an absolute path.');const format=flags.get('--format')??'text';if(format!=='text'&&format!=='json')throw Error('--format must be text or json.');const base={...(dataDir?{dataDir}:{}),format};let command:Command;
 const number=(v:string|undefined)=>{if(!v||!/^\d+$/.test(v))throw Error('A numeric slot or revision is required.');return Number(v);};
 if(pos[0]==='prompt'||pos[0]==='/presets'){if(pos.length!==1||format==='json')throw Error('Use glint prompt or glint /presets in an interactive terminal.');command={kind:'prompt',menu:pos[0]==='/presets'};}
 else if(pos[0]?.startsWith('/prompts:')){command={kind:'recall',selector:presetName(pos[0].slice(9)),args:pos.slice(1)};}
 else if(pos[0]==='presets'){
  const action=pos[1]??'list';if(action==='list'&&pos.length<=2)command={kind:'list'};
  else if((action==='show'||action==='recall')&&pos[2]&&(action==='recall'||pos.length===3))command={kind:action,selector:pos[2],args:pos.slice(3)};
  else if((action==='save'||action==='edit')&&pos.length===4){const slot=presetSlot(number(pos[2])),name=presetName(pos[3]),file=flags.get('--file'),text=flags.get('--text');if((file===undefined)===(text===undefined))throw Error('Choose exactly one --file or --text.');if(file!==undefined&&(!isAbsolute(file)||file.includes('\0')))throw Error('--file must name one absolute local UTF-8 Markdown/text file.');const expected=flags.has('--expect')?presetRevision(number(flags.get('--expect'))):undefined;if(action==='edit'&&expected===undefined||action==='save'&&expected!==undefined)throw Error('Edit requires --expect <catalog-revision>; save creates an empty slot.');command={kind:action,slot,name,...(file!==undefined?{file}:{text}),...(expected===undefined?{}:{expected})};}
  else if(action==='delete'&&pos.length===3&&flags.has('--expect'))command={kind:'delete',slot:presetSlot(number(pos[2])),expected:presetRevision(number(flags.get('--expect')))};
  else throw Error('Use presets list, save, edit, show, recall or delete. Run glint help.');
 }else throw Error('Unknown preset command.');
 for(const flag of flags.keys())if(!['--data-dir','--format'].includes(flag)&&!(['save','edit'].includes(command.kind)&&['--file','--text','--expect'].includes(flag))&&!(command.kind==='delete'&&flag==='--expect'))throw Error('This preset option does not apply to the command.');
 return {...base,format,command};
}
export async function runPresetCli(args:readonly string[],directory:string):Promise<string>{
 const parsed=parsePresetCliArguments(args),store=new CliPresetStore(parsed.dataDir??directory),c=parsed.command;let result:unknown,text:string;
 if(c.kind==='prompt')throw Error('The prompt workbench needs an interactive terminal. It never sends requests.');
 if(c.kind==='save'||c.kind==='edit'){const raw=c.file?await boundedText(c.file,CLI_PRESET_BODY_BYTES):c.text!;const body=presetBody(raw.replace(/^\uFEFF/,''));const saved=c.kind==='save'?await store.save(c.slot,c.name,body):await store.edit(c.slot,c.name,body,c.expected!);result=saved;text=`Saved slot ${c.slot} (${c.name}). Catalog revision ${saved.revision}. No request was sent.`;}
 else if(c.kind==='delete'){const saved=await store.delete(c.slot,c.expected);result=saved;text=`Deleted slot ${c.slot}. Catalog revision ${saved.revision}.`;}
 else{const current=await store.read();if(c.kind==='list'){result=current;text=`Preset catalog revision ${current.revision}\n`+Array.from({length:10},(_,i)=>{const p=current.presets.find(p=>p.slot===i+1);return `${i+1}. ${p?p.name+' · revision '+p.revision:'(empty)'}`;}).join('\n')+'\nUse edit/delete --expect '+current.revision+'. Recall never sends a request.';}
  else if('selector' in c){const p=current.presets.find(p=>String(p.slot)===c.selector||p.name===c.selector);if(!p)throw Error('This preset slot or name is not saved.');const prompt=c.kind==='recall'?expandCliPrompt(p.body,parsePromptArguments(c.args)):p.body;result={catalogRevision:current.revision,slot:p.slot,name:p.name,presetRevision:p.revision,prompt};text=promptTerminalText(prompt);}else throw Error('Unsupported preset command.');}
 const output=parsed.format==='json'?JSON.stringify(result,null,2).replace(/[\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'))+'\n':text+'\n';if(Buffer.byteLength(output)>262144)throw Error('Preset output exceeds 256 KiB.');return output;
}
