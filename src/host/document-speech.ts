import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir,mkdtemp,open,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import type {Companion} from '../core/companion';
import {emptyTaskSession} from '../core/task-session';
import type {Task} from '../core/types';
import {SPEECH_AUDIO_BYTES,SPEECH_SECONDS_LIMIT,SPEECH_ERROR,speechText,speechChoices,validSpeechText,sameSpeechTarget,type SpeechAudio,type SpeechCommand,type SpeechSelection,type SpeechView,type SpeechVoice} from '../shared/document-speech';
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function fail():never{throw Error(SPEECH_ERROR);}
export function installedSpeechVoices(stdout:string):SpeechVoice[]{
 if(stdout.length>128000)fail();const voices:SpeechVoice[]=[];
 for(const line of stdout.split(/\r?\n/)){if(!line.trim())continue;const match=/^(.+?)\s+([a-z]{2,3}_[A-Za-z0-9_-]+)\s+#/.exec(line);if(!match||!match[1].trim()||match[1].trim().length>200||/[\x00-\x1f\x7f]/.test(match[1]))fail();const voice={name:match[1].trim(),language:match[2]};if(voices.some(item=>item.name===voice.name))continue;voices.push(voice);if(voices.length>500)fail();}if(!voices.length)fail();return voices;
}
/** Fixed system executable and argument vector. User text goes to stdin, never a shell or process argument. */
export function localSay(args:string[],text:string|undefined,signal:AbortSignal):Promise<string>{
 if(process.platform!=='darwin')return Promise.reject(Error(SPEECH_ERROR));
 return new Promise((resolve,reject)=>{const child=execFile('/usr/bin/say',args,{encoding:'utf8',timeout:text===undefined?5000:45000,maxBuffer:128000,signal},(error,stdout)=>{if(error)reject(Error(SPEECH_ERROR));else resolve(stdout);});child.stdin?.on('error',()=>{});child.stdin?.end(text??'');});
}
export function validateSpeechWave(bytes:Buffer):{seconds:number}{
 if(bytes.length<44||bytes.length>SPEECH_AUDIO_BYTES||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE'||bytes.readUInt32LE(4)+8!==bytes.length)fail();let offset=12,rate=0,align=0,data=0,formats=0,chunks=0;
 while(offset+8<=bytes.length){if(++chunks>128)fail();const name=bytes.toString('ascii',offset,offset+4),length=bytes.readUInt32LE(offset+4),start=offset+8,end=start+length;if(end>bytes.length)fail();if(name==='fmt '){if(++formats!==1||length<16||bytes.readUInt16LE(start)!==1||bytes.readUInt16LE(start+2)!==1||bytes.readUInt16LE(start+14)!==16)fail();rate=bytes.readUInt32LE(start+4);align=bytes.readUInt16LE(start+12);if(rate!==22050||align!==2||bytes.readUInt32LE(start+8)!==44100)fail();}if(name==='data'){if(data)fail();data=length;}offset=end+(length%2);}
 const seconds=data/(rate*align);if(offset!==bytes.length||formats!==1||data<2||data%2||!Number.isFinite(seconds)||seconds<=0||seconds>SPEECH_SECONDS_LIMIT)fail();return {seconds};
}
type Core=Pick<Companion,'getTask'|'replaceSession'>;
export class DocumentSpeech{
 private active:{taskId:string;controller:AbortController;done:Promise<unknown>}|undefined;
 private selectionQueue:Promise<unknown>=Promise.resolve();
 constructor(private readonly options:{directory:string;core:Core;runSay?:typeof localSay}){}
 private runSay(...args:Parameters<typeof localSay>){return (this.options.runSay??localSay)(...args);}
 cancel(taskId?:string){if(!taskId||this.active?.taskId===taskId)this.active?.controller.abort();return {kind:'stopped' as const};}
 async stop(taskId?:string){const active=this.active;this.cancel(taskId);if(active&&(!taskId||active.taskId===taskId))await active.done.catch(()=>{});return {kind:'stopped' as const};}
 async close(){await this.stop();}
 private file(taskId:string){return join(this.options.directory,'speech-cache',hash(taskId),'audio.wav');}
 private async task(taskId:string,guard:()=>void){guard();const task=await this.options.core.getTask(taskId);guard();if(task.status!=='active'||task.archive)fail();return task;}
 private current(task:Task,selection:SpeechSelection){const text=speechText(task,selection.target);if(!text.current||!validSpeechText(text.text))fail();return text;}
 private async voices(){return installedSpeechVoices(await this.runSay(['-v','?'],undefined,new AbortController().signal));}
 private key(selection:SpeechSelection){return hash(JSON.stringify({target:selection.target,voice:selection.voice,rate:180,format:'WAVE-LEI16-22050-v1'}));}
 private async bytes(taskId:string,selection:SpeechSelection){
  const audio=selection.audio;if(!audio||audio.key!==this.key(selection))fail();const file=await open(this.file(taskId),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const info=await file.stat();if(!info.isFile()||info.size!==audio.byteLength||info.size>SPEECH_AUDIO_BYTES)fail();const bytes=await file.readFile();const parsed=validateSpeechWave(bytes);if(bytes.length!==audio.byteLength||hash(bytes)!==audio.digest||Math.abs(parsed.seconds-audio.seconds)>.001)fail();return bytes;}finally{await file.close();}
 }
 private async view(task:Task):Promise<SpeechView>{
  let voices:SpeechVoice[]=[];try{voices=await this.voices();}catch{}
  const selection=task.session?.speech;let selected:ReturnType<typeof speechText>|undefined,audioReady=false;try{if(selection){selected=speechText(task,selection.target);if(selected.current){await this.bytes(task.id,selection);audioReady=true;}}}catch{}
  return {kind:'speech',generation:this.active?.taskId===task.id?'generating':'idle',voices,...(selection?{selection}:{}),...(selected?{selected}:{}),choices:speechChoices(task),audioReady,available:voices.length>0};
 }
 async command(c:SpeechCommand,guard:()=>void=()=>{}):Promise<SpeechView|SpeechAudio|{kind:'stopped'}>{
  try{
   if(c.type==='speech.cancel')return await this.stop(c.taskId);
   if(c.type==='speech.get')return this.view(await this.task(c.taskId,guard));
   if(c.type==='speech.audio'){const task=await this.task(c.taskId,guard),selection=task.session?.speech;if(!selection||selection.revision!==c.expectedRevision)fail();this.current(task,selection);const bytes=await this.bytes(task.id,selection);guard();return {kind:'audio',selection,dataUrl:'data:audio/wav;base64,'+bytes.toString('base64')};}
   if(c.type==='speech.select'){
    this.cancel(c.taskId);const result=this.selectionQueue.then(async()=>{const task=await this.task(c.taskId,guard),previous=task.session?.speech;if((previous?.revision??0)!==c.expectedRevision)fail();const target=speechText(task,c.target);if(!target.current)fail();const voices=await this.voices();guard();if(!voices.some(voice=>voice.name===c.voice))fail();const selection:SpeechSelection={revision:c.expectedRevision+1,target:c.target,voice:c.voice,speed:c.speed,...(previous&&sameSpeechTarget(previous.target,c.target)&&previous.voice===c.voice&&previous.audio?{audio:previous.audio}:{})};await this.saveSelection(task,selection,guard);return this.view(await this.task(c.taskId,guard));});this.selectionQueue=result.catch(()=>{});return await result;
   }
   if(this.active)fail();const controller=new AbortController(),done=this.generate(c,controller,guard);this.active={taskId:c.taskId,controller,done};try{return await done;}finally{if(this.active?.controller===controller)this.active=undefined;}
  }catch{throw Error(SPEECH_ERROR);}
 }
 private async saveSelection(task:Task,selection:SpeechSelection,guard:()=>void){
  guard();const session=task.session??emptyTaskSession(),target=selection.target;await this.options.core.replaceSession(task.id,session.revision,{...session,speech:selection},{requireActive:true,sourceRefs:target.kind==='source'?[{sourceId:target.sourceId,version:target.version,digest:target.digest}]:[],artifactRefs:target.kind==='document'?[{artifactId:target.artifactId,revision:target.revision,digest:target.digest}]:[]});guard();
 }
 private async generate(c:Extract<SpeechCommand,{type:'speech.generate'|'speech.audio'}>,controller:AbortController,guard:()=>void):Promise<SpeechAudio>{
  let temporary:string|undefined;const check=()=>{guard();if(controller.signal.aborted)fail();};
  try{const task=await this.task(c.taskId,check),selection=task.session?.speech;if(!selection||selection.revision!==c.expectedRevision)fail();const spoken=this.current(task,selection),voices=await this.voices();check();if(!voices.some(voice=>voice.name===selection.voice))fail();const directory=join(this.options.directory,'speech-cache',hash(task.id));await mkdir(directory,{recursive:true,mode:0o700});temporary=await mkdtemp(join(directory,'.generate-'));const path=join(temporary,'speech.wav');
   await this.runSay(['-v',selection.voice,'-r','180','-o',path,'--file-format=WAVE','--data-format=LEI16@22050','--channels=1','-f','-'],spoken.text,controller.signal);check();const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes:Buffer;try{const info=await file.stat();if(!info.isFile()||info.size>SPEECH_AUDIO_BYTES)fail();bytes=await file.readFile();}finally{await file.close();}const wave=validateSpeechWave(bytes),currentTask=await this.task(task.id,check),current=currentTask.session?.speech;if(!current||current.revision!==selection.revision||!sameSpeechTarget(current.target,selection.target)||this.current(currentTask,current).text!==spoken.text)fail();check();await rename(path,this.file(task.id));
   const saved:SpeechSelection={...selection,revision:selection.revision+1,audio:{key:this.key(selection),digest:hash(bytes),byteLength:bytes.length,seconds:wave.seconds,createdAt:new Date().toISOString()}};await this.saveSelection(currentTask,saved,check);return {kind:'audio',selection:saved,dataUrl:'data:audio/wav;base64,'+bytes.toString('base64')};
  }finally{if(temporary)await rm(temporary,{recursive:true,force:true});}
 }
}
