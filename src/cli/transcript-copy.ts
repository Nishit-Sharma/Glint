import {createHash} from 'node:crypto';
import {PassThrough} from 'node:stream';
import {emitKeypressEvents,type Key} from 'node:readline';
import type {Task} from '../core/types';
import {readSnapshot,terminalText} from './cli';
import {CLIPBOARD_TEXT_LIMIT,type ClipboardWriter} from './clipboard';
export const CTRL_INSERT='\u001b[2;5~';
export interface TranscriptBlock{id:string;role:'User'|'Assistant';content?:string;unavailable?:string;fingerprint:string}
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
export function transcriptBlocks(task:Task):TranscriptBlock[]{
 if(task.requests.some(request=>!request.id||request.id.length>200)||new Set(task.requests.map(request=>request.id)).size!==task.requests.length)throw Error('This task has ambiguous request identities. Reopen a valid snapshot.');
 const blocks:TranscriptBlock[]=[];
 for(const request of task.requests){
  if(!['explain','create'].includes(request.kind)||request.targetArtifactId)continue;
  const append=(role:TranscriptBlock['role'],content?:string,unavailable?:string)=>{const id=JSON.stringify([task.id,request.id,role]);blocks.push({id,role,...(content===undefined?{}:{content}),...(unavailable?{unavailable}:{}),fingerprint:hash(JSON.stringify([id,request.digest,request.answer,content,unavailable]))});};
  append('User',request.prompt);
  if(request.status!=='completed')continue;
  const ref=request.answer,owners=ref?task.artifacts.filter(artifact=>artifact.id===ref.artifactId):[],revisions=ref&&owners.length===1?owners[0].revisions.filter(revision=>revision.revision===ref.revision):[],revision=revisions[0];
  if(!ref||request.artifactId&&request.artifactId!==ref.artifactId||owners.length!==1||revisions.length!==1||!revision||revision.digest!==ref.digest||hash(revision.content)!==ref.digest){append('Assistant',undefined,'The exact original saved answer is missing, ambiguous or unverifiable.');continue;}
  if(revision.encoding==='base64'||!['text/plain','text/markdown'].includes(revision.mimeType)){append('Assistant',undefined,'This answer format is not supported for exact transcript copying.');continue;}
  append('Assistant',revision.content);
 }
 return blocks;
}
export function transcriptCopyPayload(blocks:readonly TranscriptBlock[],selection:ReadonlySet<string>):string{
 const selected=blocks.filter(block=>selection.has(block.id));if(!selected.length)throw Error('Select at least one available block with Space or Enter.');if(selected.length!==selection.size||selected.some(block=>block.content===undefined||block.unavailable))throw Error('A selected block is unavailable. Reopen and select it again.');
 const text=selected.map(block=>`[${block.role}]\n${block.content}`).join('\n\n');if(Buffer.from(text,'utf8').toString('utf8')!==text)throw Error('Selected blocks contain unsupported Unicode and cannot be copied exactly.');if(Buffer.byteLength(text,'utf8')>CLIPBOARD_TEXT_LIMIT)throw Error('Selected blocks exceed the 256 KiB clipboard limit. Nothing was copied.');return text;
}
export async function runTranscriptCopy(directory:string,input:NodeJS.ReadStream,output:NodeJS.WriteStream,clipboard:ClipboardWriter):Promise<void>{
 if(!input.isTTY||!output.isTTY||input.destroyed||output.destroyed||output.writableEnded)throw Error('/copy requires an interactive terminal. No clipboard write occurred.');
 const initial=await readSnapshot(directory),tasks=initial.tasks;if(tasks.some(task=>!task.id||task.id.length>200)||new Set(tasks.map(task=>task.id)).size!==tasks.length)throw Error('The snapshot has ambiguous task identities. Nothing was copied.');
 if(!tasks.length){output.write('No saved tasks. Nothing was copied.\n');return;}
 return new Promise<void>((resolve,reject)=>{
  let taskIndex=0,blockIndex=0,blocks:TranscriptBlock[]|undefined,selection=new Set<string>(),closing=false,busy:Promise<void>|undefined,pasting=false,copyAllowed=true,framePrefix='',frameDirty=false,outputClosed=false;
  const previousRaw=!!input.isRaw,previousPaused=input.isPaused(),decoder=new PassThrough();
  const say=(message:string)=>{if(outputClosed||output.destroyed||output.writableEnded)throw Error('The terminal output is closed.');return output.write(message+'\n');};
  const show=()=>{const task=tasks[taskIndex];if(!blocks){say(`Task ${taskIndex+1}/${tasks.length}: ${terminalText(task.title).slice(0,180)} [${terminalText(task.id)}]`);return;}const block=blocks[blockIndex];say(`${terminalText(task.title).slice(0,180)} · block ${blocks.length?blockIndex+1:0}/${blocks.length} · ${selection.size} selected`);if(block)say(`${selection.has(block.id)?'[selected] ':''}${block.role}: ${block.unavailable??terminalText(block.content??'').slice(0,180)}`);else say('No eligible ordinary transcript blocks. Press B to choose another task.');};
  const cleanup=()=>{input.removeListener('data',data);input.removeListener('end',ended);input.removeListener('close',ended);input.removeListener('error',failed);output.removeListener('error',failed);output.removeListener('close',outputEnded);output.removeListener('finish',outputEnded);decoder.removeAllListeners();decoder.destroy();try{input.setRawMode(previousRaw);if(previousPaused)input.pause();else input.resume();}catch{}try{if(!outputClosed&&!output.destroyed&&!output.writableEnded)output.write('\u001b[?2004l');}catch{}};
  const finish=(error?:Error)=>{if(closing)return;closing=true;cleanup();if(busy){try{say('A copy operation was already started; waiting for its result before exit.');}catch{}void busy.then(()=>error?reject(error):resolve(),reason=>reject(error??reason));}else if(error)reject(error);else resolve();};
  const ended=()=>finish(),failed=()=>finish(Error('The terminal stream failed. Any already-started clipboard write may have changed the clipboard.')),outputEnded=()=>{outputClosed=true;finish(Error('The terminal output closed. Any already-started clipboard write may have changed the clipboard.'));};
  const copy=()=>{if(busy||!blocks)return;const expected=blocks,chosen=new Set(selection),taskId=tasks[taskIndex].id;
   busy=(async()=>{const payload=transcriptCopyPayload(expected,chosen),fresh=await readSnapshot(directory),owners=fresh.tasks.filter(task=>task.id===taskId);if(owners.length!==1)throw Error('The selected task changed. Exit and reopen /copy.');const current=transcriptBlocks(owners[0]);for(const block of expected.filter(block=>chosen.has(block.id)))if(current.filter(item=>item.id===block.id&&item.fingerprint===block.fingerprint).length!==1)throw Error('Selected transcript blocks changed. Exit and reopen /copy before copying.');if(closing)return;await clipboard(payload);if(!closing)say('Selected blocks copied.');})().catch(error=>{const failure=Error(terminalText(error instanceof Error?error.message:'Clipboard completion could not be confirmed; the clipboard may have changed.'));if(closing){try{say('Copy failed: '+failure.message);}catch{}throw failure;}try{say('Copy failed: '+failure.message);}catch{finish(Error('The terminal output failed; clipboard completion could not be displayed.'));throw failure;}}).finally(()=>{busy=undefined;});void busy.catch(()=>{});
  };
  const keypress=(text:string,key:Key)=>{if(closing)return;try{
   if(key.sequence==='\u001b[200~'){pasting=true;return;}if(key.sequence==='\u001b[201~'){pasting=false;return;}if(pasting||!copyAllowed)return;
   if(key.ctrl&&key.name==='c'||key.ctrl&&key.name==='d'||key.name==='escape'){finish();return;}
   if(key.sequence===CTRL_INSERT&&copyAllowed&&key.ctrl&&key.name==='insert'){copy();return;}
   if(busy)return;
   if(!blocks){if(key.name==='up')taskIndex=(taskIndex+tasks.length-1)%tasks.length;else if(key.name==='down')taskIndex=(taskIndex+1)%tasks.length;else if(key.name==='return'||key.name==='enter'){blocks=transcriptBlocks(tasks[taskIndex]);blockIndex=0;selection=new Set();}else return;}
   else if((text??'').toLowerCase()==='b'&&!key.ctrl&&!key.meta){blocks=undefined;selection=new Set();}
   else if(blocks.length){if(key.name==='up')blockIndex=(blockIndex+blocks.length-1)%blocks.length;else if(key.name==='down')blockIndex=(blockIndex+1)%blocks.length;else if(key.name==='space'||key.name==='return'||key.name==='enter'){const block=blocks[blockIndex];if(block.content!==undefined&&!block.unavailable){if(selection.has(block.id))selection.delete(block.id);else selection.add(block.id);}else say('This block is unavailable and was not selected.');}else return;}
   show();
  }catch(error){finish(Error(terminalText(error instanceof Error?error.message:'Transcript could not be displayed.')));}};
  const data=(chunk:Buffer|string)=>{
   const value=framePrefix+(Buffer.isBuffer(chunk)?chunk.toString('utf8'):chunk),previousDirty=frameDirty;
   let literals=value.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|(?!\[)[ -/]*[@-~])/g,'');
   const partial=/\u001b(?:\[[0-?]*[ -/]*)?$/.exec(literals);framePrefix=partial?.[0]??'';if(partial)literals=literals.slice(0,partial.index);
   const dirty=/[^\r\n bB\u0003\u0004]/u.test(literals);copyAllowed=!dirty&&!previousDirty;frameDirty=!!partial&&(dirty||previousDirty);
   decoder.write(chunk);
  };
  try{emitKeypressEvents(decoder);decoder.on('keypress',keypress);input.on('data',data);input.once('end',ended);input.once('close',ended);input.once('error',failed);output.once('error',failed);output.once('close',outputEnded);output.once('finish',outputEnded);input.setRawMode(true);input.resume();output.write('\u001b[?2004h');say('Glint /copy · read-only saved transcript');say('Up/Down navigate tasks or blocks; Enter opens a task; Space/Enter selects blocks; B returns to tasks; Esc/Ctrl+C exits.');say('Ctrl+Insert (CSI 2;5~) copies selected blocks in transcript order. Plain Insert never copies. Your terminal must send this sequence.');say('Bracketed paste is ignored; untagged pasted control keys cannot be distinguished from live keys. Only ordinary Explain/Create questions and exact saved plain-text answers are eligible. Each copied block starts [User] or [Assistant] plus a newline; blocks are separated by two newlines. Content, whitespace and line endings stay exact. Maximum 256 KiB; macOS /usr/bin/pbcopy only.');show();}catch{failed();}
 });
}
