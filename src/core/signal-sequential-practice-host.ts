import {createHash} from 'node:crypto';
import {Schema} from 'effect';
import type {Companion} from './companion';
import type {Task,RequestInput} from './types';
import {admittedSignalConcept} from './signal-concept-host';
import {signalPracticeDocument} from '../learning/signal-sequential-practice';

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const ref=Schema.Struct({sourceId:id,version:Schema.Int.pipe(Schema.positive()),digest:id});
const artifact=Schema.Struct({artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest:id});
const input=Schema.Struct({taskId:id,basis:artifact,expectedSourceRefs:Schema.Array(ref).pipe(Schema.minItems(1),Schema.maxItems(2)),sourceId:id,start:Schema.Int.pipe(Schema.nonNegative()),end:Schema.Int.pipe(Schema.positive()),quote:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(500)),confirmed:Schema.Literal(true)});
const response=Schema.Struct({answer:Schema.Literal(0,1),reasoning:Schema.String.pipe(Schema.maxLength(500))});
const create=Schema.Struct({...input.fields,...response.fields,retryOf:Schema.optional(id)});
type Input=typeof input.Type;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const maxAttempts=64,marker='\n<!--signal-sequential-practice-v1:';
const attemptId=(binding:ReturnType<typeof admittedSignalConcept>['binding'],index:number)=>'signal-practice-v1-'+hash(binding)+(index?'_'+index:'');
const attemptNumber=(binding:ReturnType<typeof admittedSignalConcept>['binding'],id:string)=>{for(let i=0;i<maxAttempts;i++)if(attemptId(binding,i)===id)return i;return -1;};
export function signalPracticeResult(task:Task,value:Input,request:Task['requests'][number]){
 const {binding}=admittedSignalConcept(task,value),saved=request.artifactId&&task.artifacts.find(a=>a.id===request.artifactId)?.revisions.at(-1);
 if(request.status!=='completed'||!saved||saved.revision!==request.answer?.revision||saved.digest!==request.answer.digest||saved.mimeType!=='text/markdown'||JSON.stringify(saved.sourceRefs)!==JSON.stringify(binding.sourceRefs))throw Error('The saved practice changed. Review its source and history.');
 try{const index=saved.content.lastIndexOf(marker);if(index<0||!saved.content.endsWith('-->'))throw Error('Missing response');const encoded=saved.content.slice(index+marker.length,-3);if(!/^[A-Za-z0-9_-]+$/.test(encoded))throw Error('Invalid response');const parsed=Schema.decodeUnknownSync(response,{onExcessProperty:'error'})(JSON.parse(Buffer.from(encoded,'base64url').toString('utf8')));if(saved.content!==signalPracticeDocument(value.quote,parsed.answer,parsed.reasoning)+marker+encoded+'-->')throw Error('Changed response');}catch{throw Error('The saved practice changed. Review its source and history.');}
 return {task,artifactId:request.artifactId!,revision:saved.revision};
}
export function readSignalPracticeSubmission(raw:unknown){
 let value:typeof create.Type;try{value=Schema.decodeUnknownSync(create,{onExcessProperty:'error'})(raw);}catch{throw Error('Review the source and choose a supported answer.');}
 return value;
}
export function signalPracticePublication(task:Task,value:ReturnType<typeof readSignalPracticeSubmission>){
 const {binding}=admittedSignalConcept(task,value);let index=0;
 if(value.retryOf!==undefined){const previous=attemptNumber(binding,value.retryOf),request=task.requests.find(r=>r.id===value.retryOf);if(previous<0||previous>=maxAttempts-1||!request||request.kind!=='experiment'||!['failed','interrupted','cancelled'].includes(request.status)||request.artifactId!==undefined||JSON.stringify(request.sourceRefs)!==JSON.stringify(binding.sourceRefs))throw Error('Check the previous attempt before starting another.');index=previous+1;}
 const request:RequestInput={taskId:value.taskId,requestId:attemptId(binding,index),kind:'experiment',prompt:'Record the first answer to a separate hypothetical signal practice.',executionScope:'signal-practice-v1:'+hash(binding),sourceIds:binding.sourceRefs.map(ref=>ref.sourceId),expectedSourceRefs:binding.sourceRefs,expectedArtifacts:[binding.basis]};
 const artifact=(()=>{admittedSignalConcept(task,value);const encoded=Buffer.from(JSON.stringify({answer:value.answer,reasoning:value.reasoning})).toString('base64url');return {title:'Sequential signal assignment practice',mimeType:'text/markdown',content:signalPracticeDocument(value.quote,value.answer,value.reasoning)+marker+encoded+'-->'};})();return {request,artifact};
}
export async function createSignalPractice(core:Companion,raw:unknown,assertCurrent:()=>void=()=>{}){return core.saveSignalPractice(raw,assertCurrent);}

export async function inspectSignalPractice(core:Companion,raw:unknown){
 let value:Input;try{value=Schema.decodeUnknownSync(input,{onExcessProperty:'error'})(raw);}catch{throw Error('Review and confirm one exact linked source line.');}
 const task=await core.getTask(value.taskId),{binding}=admittedSignalConcept(task,value);let latest:Task['requests'][number]|undefined;
 for(let index=0;index<maxAttempts;index++){const request=task.requests.find(r=>r.id===attemptId(binding,index));if(!request)break;if(request.kind!=='experiment'||JSON.stringify(request.sourceRefs)!==JSON.stringify(binding.sourceRefs))throw Error('The practice record needs review.');latest=request;}
 if(!latest)return {kind:'not-started' as const};if(latest.status==='running')return {kind:'running' as const,requestId:latest.id};if(latest.status==='completed'){const result= signalPracticeResult(task,value,latest);return {kind:'completed' as const,requestId:latest.id,artifactId:result.artifactId,revision:result.revision};}
 if(latest.artifactId!==undefined)throw Error('The previous attempt needs review.');return {kind:'terminal' as const,requestId:latest.id,status:latest.status,canRetry:attemptNumber(binding,latest.id)<maxAttempts-1};
}
