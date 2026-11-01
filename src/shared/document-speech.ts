import {Schema} from 'effect';
import type {Task} from '../core/types';
export const SPEECH_TEXT_LIMIT=6000;
export const SPEECH_AUDIO_BYTES=20*1024*1024;
export const SPEECH_SECONDS_LIMIT=360;
export const SPEECH_ERROR='Local speech could not be prepared. Your saved text and listening choices are kept. Check the selected version and installed voice before trying again.';
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0'))),hash=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),positive=Schema.Int.pipe(Schema.positive());
const range=Schema.Struct({start:Schema.Int.pipe(Schema.between(0,Number.MAX_SAFE_INTEGER)),end:Schema.Int.pipe(Schema.between(1,Number.MAX_SAFE_INTEGER))}).pipe(Schema.filter(value=>value.end>value.start));
export const SpeechTargetSchema=Schema.Union(Schema.Struct({kind:Schema.Literal('document'),artifactId:id,revision:positive,digest:hash,range:Schema.optional(range)}),Schema.Struct({kind:Schema.Literal('source'),sourceId:id,version:positive,digest:hash,range:Schema.optional(range)}));
export type SpeechTarget=typeof SpeechTargetSchema.Type;
export const SpeechSpeedSchema=Schema.Literal(.75,1,1.25,1.5);
export const SpeechAudioSchema=Schema.Struct({key:hash,digest:hash,byteLength:positive,seconds:Schema.Number.pipe(Schema.between(.001,SPEECH_SECONDS_LIMIT)),createdAt:id});
export const SpeechSelectionSchema=Schema.Struct({revision:positive,target:SpeechTargetSchema,voice:id,voiceLanguage:Schema.optional(id),speed:SpeechSpeedSchema,audio:Schema.optional(SpeechAudioSchema)});
export type SpeechSelection=typeof SpeechSelectionSchema.Type;
const commandSchema=Schema.Union(
 Schema.Struct({type:Schema.Literal('speech.get'),taskId:id}),
 Schema.Struct({type:Schema.Literal('speech.select'),taskId:id,expectedRevision:Schema.Int.pipe(Schema.nonNegative()),target:SpeechTargetSchema,voice:id,speed:SpeechSpeedSchema}),
 Schema.Struct({type:Schema.Literal('speech.generate','speech.audio'),taskId:id,expectedRevision:positive}),
 Schema.Struct({type:Schema.Literal('speech.cancel'),taskId:id})
);
export type SpeechCommand=typeof commandSchema.Type;
export function readSpeechCommand(value:unknown):SpeechCommand{try{return Schema.decodeUnknownSync(commandSchema,{onExcessProperty:'error'})(value);}catch{throw Error(SPEECH_ERROR);}}
export function isSpeechCommand(value:{type:string}):value is SpeechCommand{return value.type.startsWith('speech.');}
export const sameSpeechTarget=(a:SpeechTarget,b:SpeechTarget)=>JSON.stringify(a)===JSON.stringify(b);
export type SpeechText={target:SpeechTarget;title:string;text:string;current:boolean;reason?:string};
function selectedText(value:string,target:SpeechTarget):string{
 if(!target.range)return value;
 const {start,end}=target.range,boundary=(index:number)=>!(index>0&&index<value.length&&/[\uD800-\uDBFF]/.test(value[index-1])&&/[\uDC00-\uDFFF]/.test(value[index]));
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>value.length||!boundary(start)||!boundary(end))throw Error(SPEECH_ERROR);
 return value.slice(start,end);
}
export function speechText(task:Task,target:SpeechTarget):SpeechText{
 if(target.kind==='document'){
  const artifact=task.artifacts.find(item=>item.id===target.artifactId),revision=artifact?.revisions.find(item=>item.revision===target.revision&&item.digest===target.digest);
  if(!revision||!revision.mimeType.startsWith('text/')||revision.encoding==='base64')throw Error(SPEECH_ERROR);
  return {target,title:revision.title,text:selectedText(revision.content,target),current:artifact?.revisions.at(-1)===revision,...(artifact?.revisions.at(-1)!==revision?{reason:'The document has a newer saved version. Select it deliberately before generating or playing speech.'}:{})};
 }
 const source=task.sources.find(item=>item.id===target.sourceId),version=source?.versions.find(item=>item.version===target.version&&item.digest===target.digest&&item.kind==='text');
 if(!source||!version)throw Error(SPEECH_ERROR);const current=source.currentVersion===version.version&&source.freshness==='fresh';return {target,title:version.label,text:selectedText(version.content,target),current,...(!current?{reason:'This source version changed or needs refresh. Select its current saved version before generating or playing speech.'}:{})};
}
export function speechChoices(task:Task):SpeechText[]{return [...task.artifacts.flatMap(artifact=>{const revision=artifact.revisions.at(-1);if(!revision||!revision.mimeType.startsWith('text/')||revision.encoding==='base64')return [];return [speechText(task,{kind:'document',artifactId:artifact.id,revision:revision.revision,digest:revision.digest})];}),...task.sources.flatMap(source=>{const version=source.versions.at(-1);return version?.kind==='text'?[speechText(task,{kind:'source',sourceId:source.id,version:version.version,digest:version.digest})]:[];})];}
export function validSpeechText(text:string):boolean{return text.trim().length>0&&text.length<=SPEECH_TEXT_LIMIT&&new TextEncoder().encode(text).length<=24000&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)&&!text.includes('[[')&&text.split(/\s+/u).length<=1000;}
export type SpeechVoice={name:string;language:string};
const speechVoiceBase=(name:string)=>/^([^()]+) \([^]*\)$/.exec(name)?.[1]??name;
/** Older native selections stored display text only. These two legacy locales
 * are qualified by the captured installed-native selections, never guessed. */
const capturedLegacyVoiceLanguages:Readonly<Record<string,string>>={Daniel:'en_GB',Samantha:'en_US'};
export function resolveSpeechVoice(voices:readonly SpeechVoice[],selected:{voice:string;voiceLanguage?:string}):SpeechVoice|undefined{
 const base=speechVoiceBase(selected.voice),language=selected.voiceLanguage??capturedLegacyVoiceLanguages[base];
 const exact=voices.filter(item=>item.name===selected.voice&&(!language||item.language===language));
 if(exact.length)return exact.length===1?exact[0]:undefined;
 if(!language)return;
 const aliases=voices.filter(item=>speechVoiceBase(item.name)===base&&item.language===language);
 return aliases.length===1?aliases[0]:undefined;
}

export type SpeechView={kind:'speech';generation:'idle'|'generating';voices:SpeechVoice[];selection?:SpeechSelection;selected?:SpeechText;choices:SpeechText[];audioReady:boolean;available:boolean};
export type SpeechAudio={kind:'audio';selection:SpeechSelection;dataUrl:string};
