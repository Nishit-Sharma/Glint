import {createHash} from 'node:crypto';
import {Schema} from 'effect';
import type {Companion} from './companion';
import type {Task,RequestInput} from './types';
import {prepareWorkflowSourceContext} from './workflow-lab-host';
import {prepareSignalOverwrites,signalOverwriteDocument,signalOverwritePracticeDocument,signalOverwriteAnswers,SIGNAL_OVERWRITE_PRACTICE_PROMPT} from '../learning/signal-overwrite';

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const ref=Schema.Struct({sourceId:id,version:Schema.Int.pipe(Schema.positive()),digest:id});
const artifact=Schema.Struct({artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest:id});
const source={taskId:id,basis:artifact,expectedSourceRefs:Schema.Array(ref).pipe(Schema.minItems(1),Schema.maxItems(2)),sourceId:id,start:Schema.Int.pipe(Schema.nonNegative()),end:Schema.Int.pipe(Schema.positive()),quote:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(1000)),confirmed:Schema.Literal(true)};
const lesson={...source,mode:Schema.Literal('lesson'),secondEnabled:Schema.Boolean};
const practice={...source,mode:Schema.Literal('practice')};
const input=Schema.Union(Schema.Struct(lesson),Schema.Struct(practice));
const create=Schema.Union(Schema.Struct({...lesson,retryOf:Schema.optional(id)}),Schema.Struct({...practice,answer:Schema.Literal(...signalOverwriteAnswers),retryOf:Schema.optional(id)}));
type Input=typeof input.Type;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const maxAttempts=64;

function admitted(task:Task,value:Input){
 const context=prepareWorkflowSourceContext(task,value.basis),basis=task.artifacts.find(a=>a.id===value.basis.artifactId)?.revisions.at(-1);
 if(!basis?.mimeType.startsWith('text/')||basis.encoding==='base64')throw Error('Review a saved text document.');
 if(JSON.stringify(value.expectedSourceRefs)!==JSON.stringify(context.sourceRefs))throw Error('Linked sources changed. Review their current versions.');
 const pairs=prepareSignalOverwrites(context.sources.map(s=>({sourceId:s.ref.sourceId,text:s.version.content}))),pair=pairs.find(p=>p.sourceId===value.sourceId&&p.start===value.start&&p.end===value.end&&p.quote===value.quote);
 if(!pair)throw Error('Review two adjacent simple assignments to the same target with different source names. Delays, waits and other intervening text are outside this lesson.');
 const sourceRefs=task.sources.flatMap(s=>{const ref=context.sourceRefs.find(r=>r.sourceId===s.id);return ref?[ref]:[];});
 if(sourceRefs.length!==context.sourceRefs.length)throw Error('Linked source identities changed.');
 const binding={taskId:value.taskId,basis:context.artifact,sourceRefs,sourceId:value.sourceId,start:value.start,end:value.end,quote:value.quote,mode:value.mode,...(value.mode==='lesson'?{secondEnabled:value.secondEnabled}:{})};
 return {pair,binding};
}
const attemptId=(binding:ReturnType<typeof admitted>['binding'],index:number)=>`signal-overwrite-${binding.mode}-v1-`+hash(binding)+(index?'_'+index:'');
const attemptNumber=(binding:ReturnType<typeof admitted>['binding'],requestId:string)=>{for(let i=0;i<maxAttempts;i++)if(attemptId(binding,i)===requestId)return i;return -1;};
export function signalOverwriteResult(task:Task,value:Input,request:Task['requests'][number]){
 const {binding,pair}=admitted(task,value),saved=request.artifactId&&task.artifacts.find(a=>a.id===request.artifactId)?.revisions.at(-1);
 const expected=value.mode==='lesson'?[signalOverwriteDocument(pair,value.secondEnabled)]:signalOverwriteAnswers.map(answer=>signalOverwritePracticeDocument(pair,answer));
 if(request.status!=='completed'||!saved||saved.revision!==request.answer?.revision||saved.digest!==request.answer.digest||saved.mimeType!=='text/markdown'||!expected.includes(saved.content)||JSON.stringify(saved.sourceRefs)!==JSON.stringify(binding.sourceRefs))throw Error('The saved lesson or answer changed. Review its source and version history.');
 return {task,artifactId:request.artifactId!,revision:saved.revision};
}
export function readSignalOverwriteSubmission(raw:unknown){
 let value:typeof create.Type;try{value=Schema.decodeUnknownSync(create,{onExcessProperty:'error'})(raw);}catch{throw Error('Review both exact source lines and choose the lesson experiment or a supported practice answer.');}
 return value;
}
export function signalOverwritePublication(task:Task,value:ReturnType<typeof readSignalOverwriteSubmission>){
 const {binding}=admitted(task,value);let index=0;
 if(value.retryOf!==undefined){const previous=attemptNumber(binding,value.retryOf),request=task.requests.find(r=>r.id===value.retryOf);if(previous<0||previous>=maxAttempts-1||!request||request.kind!=='experiment'||!['failed','interrupted','cancelled'].includes(request.status)||request.artifactId!==undefined||JSON.stringify(request.sourceRefs)!==JSON.stringify(binding.sourceRefs))throw Error('Check the previous publication before starting a new attempt.');index=previous+1;}
 const request:RequestInput={taskId:value.taskId,requestId:attemptId(binding,index),kind:'experiment',prompt:value.mode==='lesson'?'Explain two reviewed assignments to one signal.':SIGNAL_OVERWRITE_PRACTICE_PROMPT,executionScope:`signal-overwrite-${value.mode}-v1:`+hash(binding),sourceIds:binding.sourceRefs.map(r=>r.sourceId),expectedSourceRefs:binding.sourceRefs,expectedArtifacts:[binding.basis]};
 const artifact=(()=>{
  const {pair}=admitted(task,value);return {title:value.mode==='lesson'?'Two assignments to one signal':'Signal replacement practice',mimeType:'text/markdown',content:value.mode==='lesson'?signalOverwriteDocument(pair,value.secondEnabled):signalOverwritePracticeDocument(pair,value.answer)};
 })();return {request,artifact};
}
export async function createSignalOverwrite(core:Companion,raw:unknown,assertCurrent:()=>void=()=>{}){return core.saveSignalOverwrite(raw,assertCurrent);}

export async function inspectSignalOverwrite(core:Companion,raw:unknown){
 let value:Input;try{value=Schema.decodeUnknownSync(input,{onExcessProperty:'error'})(raw);}catch{throw Error('Review and confirm both exact linked source lines.');}
 const task=await core.getTask(value.taskId),{binding}=admitted(task,value);let latest:Task['requests'][number]|undefined;
 for(let i=0;i<maxAttempts;i++){const request=task.requests.find(r=>r.id===attemptId(binding,i));if(!request)break;if(request.kind!=='experiment'||JSON.stringify(request.sourceRefs)!==JSON.stringify(binding.sourceRefs))throw Error('The publication record needs review.');latest=request;}
 if(!latest)return {kind:'not-started' as const};if(latest.status==='running')return {kind:'running' as const,requestId:latest.id};
 if(latest.status==='completed'){const saved= signalOverwriteResult(task,value,latest);return {kind:'completed' as const,requestId:latest.id,artifactId:saved.artifactId,revision:saved.revision};}
 if(latest.artifactId!==undefined)throw Error('The previous publication needs review.');
 return {kind:'terminal' as const,requestId:latest.id,canRetry:attemptNumber(binding,latest.id)<maxAttempts-1};
}
