import {createInterface,emitKeypressEvents,type Key} from 'node:readline';
import {CliPresetStore} from './presets';
import {expandCliPrompt,parsePromptArguments,parsePromptWords,promptTerminalText,type CliPresetSnapshot} from '../shared/cli-presets';

export function presetMenuKey(index:number,key:{name?:string;ctrl?:boolean},text:string):{index:number;action:'continue'|'select'|'cancel'}{
 if(key.ctrl&&key.name==='c'||key.name==='escape')return {index,action:'cancel'};
 if(key.name==='return'||key.name==='enter')return {index,action:'select'};
 if(key.name==='up')index=(index+9)%10;else if(key.name==='down')index=(index+1)%10;else if(/^[0-9]$/.test(text))index=text==='0'?9:Number(text)-1;
 return {index,action:'continue'};
}
function line(input:NodeJS.ReadStream,output:NodeJS.WriteStream,prompt:string):Promise<string|null>{
 return new Promise(resolve=>{const reader=createInterface({input,output,terminal:true,historySize:0});let settled=false;const finish=(value:string|null)=>{if(settled)return;settled=true;reader.close();resolve(value);};reader.once('SIGINT',()=>finish(null));reader.once('close',()=>finish(null));reader.question(prompt,value=>finish(value));});
}
function choose(snapshot:CliPresetSnapshot,input:NodeJS.ReadStream,output:NodeJS.WriteStream):Promise<number|null>{
 output.write('\nSaved presets (local text only)\n'+Array.from({length:10},(_,i)=>`${i+1}. ${snapshot.presets.find(p=>p.slot===i+1)?.name??'(empty)'}`).join('\n')+'\nUp/Down or1–9/0 (slot10), Enter to recall, Esc to cancel.\n');
 return new Promise(resolve=>{let index=0;const previous=input.isRaw;emitKeypressEvents(input);input.setRawMode(true);input.resume();const show=()=>output.write(`Selected slot ${index+1}: ${snapshot.presets.find(p=>p.slot===index+1)?.name??'(empty)'}\n`);const finish=(slot:number|null)=>{input.removeListener('keypress',keypress);input.setRawMode(previous);input.pause();resolve(slot);};const keypress=(text:string,key:Key)=>{const next=presetMenuKey(index,key,text);index=next.index;if(next.action==='cancel')finish(null);else if(next.action==='select'){if(snapshot.presets.some(p=>p.slot===index+1))finish(index+1);else output.write('That slot is empty. Choose a saved preset or Esc.\n');}else show();};input.on('keypress',keypress);show();});
}
export async function runPromptWorkbench(directory:string,menuInitially=false,input=process.stdin,output=process.stdout):Promise<void>{
 if(!input.isTTY||!output.isTTY)throw Error('The local prompt workbench requires an interactive terminal. No request was sent.');
 const store=new CliPresetStore(directory);let draft='',first=menuInitially;
 output.write('Glint local prompt workbench — no provider or request execution\n/presets keyboard recall · /prompts:name arguments · /edit multiline · /show · /clear · /quit\nPlain input replaces the local draft. Enter keeps it. Drafts are not sent or saved as tasks.\n');
 const display=()=>output.write('\nLocal draft (not sent):\n'+(draft?promptTerminalText(draft):'(empty)')+'\n');
 while(true){const value=first?'/presets':await line(input,output,'Local prompt> ');first=false;if(value===null||value==='/quit')return;
  try{
   if(value==='/presets'){
    const snapshot=await store.read(),slot=await choose(snapshot,input,output);if(slot===null)continue;const preset=snapshot.presets.find(p=>p.slot===slot)!;const params=await line(input,output,'Parameters (positional or NAME=value; blank for none)> ');if(params===null)return;
    const latest=await store.read();if(latest.revision!==snapshot.revision)throw Error('Presets changed while selecting. Choose again; the existing draft was kept.');draft=expandCliPrompt(preset.body,parsePromptArguments(parsePromptWords(params)));display();
   }else if(value.startsWith('/prompts:')){const words=parsePromptWords(value),name=words.shift()!.slice(9),snapshot=await store.read(),preset=snapshot.presets.find(p=>p.name===name);if(!preset)throw Error('This preset name is not saved.');draft=expandCliPrompt(preset.body,parsePromptArguments(words));display();}
   else if(value==='/edit'){
    output.write('Edit local draft: enter lines; a single . accepts, .. inserts a literal dot. Ctrl+C cancels. No commands run inside this editor.\n');const lines:string[]=[];let cancelled=false;
    while(true){const next=await line(input,output,'> ');if(next===null){cancelled=true;break;}if(next==='.')break;lines.push(next==='..'?'.':next);if(Buffer.byteLength(lines.join('\n'))>131072)throw Error('The local draft exceeds128KiB. Existing draft kept.');}
    if(!cancelled)draft=lines.join('\n');display();
   }else if(value==='/clear'){draft='';display();}else if(value==='/show'||value==='')display();else{if(Buffer.byteLength(value)>131072)throw Error('The local draft exceeds128KiB.');draft=value;display();}
  }catch(error){output.write('Glint presets: '+promptTerminalText(error instanceof Error?error.message:'The preset could not be opened.')+'\n');}
 }
}
