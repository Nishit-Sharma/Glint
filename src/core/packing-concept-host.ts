import {createHash} from 'node:crypto';
import {Schema} from 'effect';
import type {Companion} from './companion';
import type {Task} from './types';
import {prepareWorkflowSourceContext} from './workflow-lab-host';
import {prepareWorkflowPassages} from '../learning/workflow-review';
import {packingDocument,parsePackingCapacity} from '../learning/packing-concept';
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const ref=Schema.Struct({sourceId:id,version:Schema.Int.pipe(Schema.positive()),digest:id});
const artifact=Schema.Struct({artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest:id});
const input=Schema.Struct({taskId:id,basis:artifact,expectedSourceRefs:Schema.Array(ref).pipe(Schema.minItems(1),Schema.maxItems(2)),sourceId:id,start:Schema.Int.pipe(Schema.nonNegative()),end:Schema.Int.pipe(Schema.positive()),quote:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(500)),confirmed:Schema.Literal(true),count:Schema.Int.pipe(Schema.between(0,10000))});
const create=Schema.Struct({...input.fields,retryOf:Schema.optional(id)});type Input=typeof input.Type;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),maxAttempts=64;
function admitted(task:Task,value:Input){
 const context=prepareWorkflowSourceContext(task,value.basis),basis=task.artifacts.find(a=>a.id===value.basis.artifactId)?.revisions.at(-1);
 if(!basis?.mimeType.startsWith('text/')||basis.encoding==='base64')throw Error('Review a saved text document.');
 if(JSON.stringify(value.expectedSourceRefs)!==JSON.stringify(context.sourceRefs))throw Error('Linked sources changed. Review their current versions.');
 const prepared=prepareWorkflowPassages(context.sources.map(s=>({sourceId:s.ref.sourceId,text:s.version.content})));if(prepared.issues.length)throw Error(prepared.issues.join(' '));
 const passage=prepared.passages.find(p=>p.sourceId===value.sourceId&&p.start===value.start&&p.end===value.end&&p.quote===value.quote);if(!passage||parsePackingCapacity(passage.quote)===null)throw Error('Choose one complete supported capacity line.');
 const sourceRefs=task.sources.flatMap(source=>{const found=context.sourceRefs.find(ref=>ref.sourceId===source.id);return found?[found]:[];});if(sourceRefs.length!==context.sourceRefs.length)throw Error('Linked source identities changed.');
 const binding={taskId:value.taskId,basis:context.artifact,sourceRefs,sourceId:value.sourceId,start:value.start,end:value.end,quote:value.quote,count:value.count};return {binding,content:packingDocument(value.quote,value.count)};
}
const attemptId=(binding:ReturnType<typeof admitted>['binding'],index:number)=>'packing-v1-'+hash(binding)+(index?'_'+index:'');
const attemptNumber=(binding:ReturnType<typeof admitted>['binding'],id:string)=>{for(let i=0;i<maxAttempts;i++)if(attemptId(binding,i)===id)return i;return -1;};
function savedResult(task:Task,value:Input,request:Task['requests'][number]){
 const {binding,content}=admitted(task,value),saved=request.artifactId&&task.artifacts.find(a=>a.id===request.artifactId)?.revisions.at(-1);
 if(request.status!=='completed'||!saved||saved.revision!==request.answer?.revision||saved.digest!==request.answer.digest||saved.mimeType!=='text/markdown'||saved.content!==content||JSON.stringify(saved.sourceRefs)!==JSON.stringify(binding.sourceRefs))throw Error('The saved calculation changed. Review its source and history.');
 return {task,artifactId:request.artifactId!,revision:saved.revision,digest:saved.digest};
}
export async function createPackingConcept(core:Companion,raw:unknown){
 let value:typeof create.Type;try{value=Schema.decodeUnknownSync(create,{onExcessProperty:'error'})(raw);}catch{throw Error('Review the source and enter a supported count.');}
 const task=await core.getTask(value.taskId),{binding}=admitted(task,value);let index=0;
 if(value.retryOf!==undefined){const previous=attemptNumber(binding,value.retryOf),request=task.requests.find(r=>r.id===value.retryOf);if(previous<0||previous>=maxAttempts-1||!request||request.kind!=='experiment'||!['failed','interrupted','cancelled'].includes(request.status)||request.artifactId!==undefined||JSON.stringify(request.sourceRefs)!==JSON.stringify(binding.sourceRefs))throw Error('Check the previous publication before starting a new attempt.');index=previous+1;}
 const result=await core.runRequest({taskId:value.taskId,requestId:attemptId(binding,index),kind:'experiment',prompt:'Explore a reviewed packing capacity.',executionScope:'packing-v1:'+hash(binding),sourceIds:binding.sourceRefs.map(ref=>ref.sourceId),expectedSourceRefs:binding.sourceRefs,expectedArtifacts:[binding.basis]},async context=>{const fresh=admitted(context.task,value);return {title:`Packing ${value.count} items`,mimeType:'text/markdown',content:fresh.content};});
 if(result.status!=='completed'||!result.artifactId)throw Error(result.error??'The reviewed calculation could not be created.');return savedResult(await core.getTask(value.taskId),value,result);
}
export async function inspectPackingConcept(core:Companion,raw:unknown){
 let value:Input;try{value=Schema.decodeUnknownSync(input,{onExcessProperty:'error'})(raw);}catch{throw Error('Review one exact capacity line and enter a supported count.');}
 const task=await core.getTask(value.taskId),{binding}=admitted(task,value);let latest:Task['requests'][number]|undefined;
 for(let index=0;index<maxAttempts;index++){const request=task.requests.find(r=>r.id===attemptId(binding,index));if(!request)break;if(request.kind!=='experiment'||JSON.stringify(request.sourceRefs)!==JSON.stringify(binding.sourceRefs))throw Error('The publication record needs review.');latest=request;}
 if(!latest)return {kind:'not-started' as const};if(latest.status==='running')return {kind:'running' as const,requestId:latest.id};if(latest.status==='completed'){const saved=savedResult(task,value,latest);return {kind:'completed' as const,requestId:latest.id,artifactId:saved.artifactId,revision:saved.revision,digest:saved.digest};}
 if(latest.artifactId!==undefined)throw Error('The previous publication needs review.');return {kind:'terminal' as const,requestId:latest.id,status:latest.status,canRetry:attemptNumber(binding,latest.id)<maxAttempts-1};
}
