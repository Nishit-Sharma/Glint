import {createHash} from 'node:crypto';
import {Schema} from 'effect';
import type {Companion} from './companion';
import type {Task,RequestInput} from './types';
import {requirePackingDemonstration} from './packing-concept-host';
import {packingPracticeDocument} from '../learning/packing-concept';
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const ref=Schema.Struct({sourceId:id,version:Schema.Int.pipe(Schema.positive()),digest:id});
const artifact=Schema.Struct({artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest:id});
const input=Schema.Struct({taskId:id,basis:artifact,expectedSourceRefs:Schema.Array(ref).pipe(Schema.minItems(1),Schema.maxItems(2)),sourceId:id,start:Schema.Int.pipe(Schema.nonNegative()),end:Schema.Int.pipe(Schema.positive()),quote:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(500)),confirmed:Schema.Literal(true),previewCount:Schema.Int.pipe(Schema.between(0,10000)),preview:artifact,count:Schema.Int.pipe(Schema.between(0,10000))});
const create=Schema.Struct({...input.fields,prediction:Schema.Int.pipe(Schema.between(0,10000)),retryOf:Schema.optional(id)});type Input=typeof input.Type;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),maxAttempts=64;
function admitted(task:Task,value:Input){
 if(value.count===value.previewCount)throw Error('Choose a count different from the saved demonstration.');
 const {binding}=requirePackingDemonstration(task,{taskId:value.taskId,basis:value.basis,expectedSourceRefs:value.expectedSourceRefs,sourceId:value.sourceId,start:value.start,end:value.end,quote:value.quote,confirmed:true,count:value.previewCount},value.preview);
 return {binding:{...binding,preview:value.preview,count:value.count},sourceRefs:binding.sourceRefs};
}
const attemptId=(binding:ReturnType<typeof admitted>['binding'],index:number)=>'packing-practice-v1-'+hash(binding)+(index?'_'+index:'');
const attemptNumber=(binding:ReturnType<typeof admitted>['binding'],id:string)=>{for(let i=0;i<maxAttempts;i++)if(attemptId(binding,i)===id)return i;return -1;};
export function packingPracticeResult(task:Task,value:Input,request:Task['requests'][number]){
 const {sourceRefs}=admitted(task,value),saved=request.artifactId&&task.artifacts.find(a=>a.id===request.artifactId)?.revisions.at(-1);
 if(request.status!=='completed'||!request.artifactId||request.answer?.artifactId!==request.artifactId||JSON.stringify(request.sourceRefs)!==JSON.stringify(sourceRefs)||!saved||saved.revision!==request.answer?.revision||saved.digest!==request.answer.digest||saved.mimeType!=='text/markdown'||JSON.stringify(saved.sourceRefs)!==JSON.stringify(sourceRefs))throw Error('The saved practice changed. Review its source and history.');
 const match=/\nYour saved prediction: (0|[1-9][0-9]{0,4}) (?:box|boxes)\.\n/.exec(saved.content);if(!match||Number(match[1])>10000||saved.content!==packingPracticeDocument(value.quote,value.count,Number(match[1])))throw Error('The saved practice changed. Review its source and history.');
 return {task,artifactId:request.artifactId!,revision:saved.revision,digest:saved.digest};
}
export function readPackingPracticeSubmission(raw:unknown){
 let value:typeof create.Type;try{value=Schema.decodeUnknownSync(create,{onExcessProperty:'error'})(raw);}catch{throw Error('Review the source and enter supported counts.');}
 return value;
}
export function packingPracticePublication(task:Task,value:ReturnType<typeof readPackingPracticeSubmission>){
 const {binding,sourceRefs}=admitted(task,value);let index=0;
 if(value.retryOf!==undefined){const previous=attemptNumber(binding,value.retryOf),request=task.requests.find(r=>r.id===value.retryOf);if(previous<0||previous>=maxAttempts-1||!request||request.kind!=='experiment'||!['failed','interrupted','cancelled'].includes(request.status)||request.artifactId!==undefined||JSON.stringify(request.sourceRefs)!==JSON.stringify(sourceRefs))throw Error('Check the previous practice before starting another.');index=previous+1;}
 const request:RequestInput={taskId:value.taskId,requestId:attemptId(binding,index),kind:'experiment',prompt:'Record a prediction for a separate packing count.',executionScope:'packing-practice-v1:'+hash(binding),sourceIds:sourceRefs.map(ref=>ref.sourceId),expectedSourceRefs:sourceRefs,expectedArtifacts:[binding.basis,binding.preview]};
 const artifact=(()=>{admitted(task,value);return {title:`Packing practice: ${value.count} items`,mimeType:'text/markdown',content:packingPracticeDocument(value.quote,value.count,value.prediction)};})();return {request,artifact};
}
export async function createPackingPractice(core:Companion,raw:unknown,assertCurrent:()=>void=()=>{}){return core.savePackingPractice(raw,assertCurrent);}

export async function inspectPackingPractice(core:Companion,raw:unknown){
 let value:Input;try{value=Schema.decodeUnknownSync(input,{onExcessProperty:'error'})(raw);}catch{throw Error('Review the source and enter a supported count.');}
 const task=await core.getTask(value.taskId),{binding,sourceRefs}=admitted(task,value);let latest:Task['requests'][number]|undefined;
 for(let index=0;index<maxAttempts;index++){const request=task.requests.find(r=>r.id===attemptId(binding,index));if(!request)break;if(request.kind!=='experiment'||JSON.stringify(request.sourceRefs)!==JSON.stringify(sourceRefs))throw Error('The practice record needs review.');latest=request;}
 if(!latest)return {kind:'not-started' as const};if(latest.status==='running')return {kind:'running' as const,requestId:latest.id};if(latest.status==='completed'){const saved= packingPracticeResult(task,value,latest);return {kind:'completed' as const,requestId:latest.id,artifactId:saved.artifactId,revision:saved.revision,digest:saved.digest};}
 if(latest.artifactId!==undefined)throw Error('The previous practice needs review.');return {kind:'terminal' as const,requestId:latest.id,status:latest.status,canRetry:attemptNumber(binding,latest.id)<maxAttempts-1};
}
