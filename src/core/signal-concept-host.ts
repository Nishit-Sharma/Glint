import {createHash} from 'node:crypto';
import {Schema} from 'effect';
import type {Companion} from './companion';
import type {Task,RequestInput} from './types';
import {prepareWorkflowSourceContext} from './workflow-lab-host';
import {prepareWorkflowPassages} from '../learning/workflow-review';
import {parseSignalAssignment,signalConceptDocument} from '../learning/signal-concept';

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const ref=Schema.Struct({sourceId:id,version:Schema.Int.pipe(Schema.positive()),digest:id});
const artifact=Schema.Struct({artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest:id});
const input=Schema.Struct({taskId:id,basis:artifact,expectedSourceRefs:Schema.Array(ref).pipe(Schema.minItems(1),Schema.maxItems(2)),sourceId:id,start:Schema.Int.pipe(Schema.nonNegative()),end:Schema.Int.pipe(Schema.positive()),quote:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(500)),confirmed:Schema.Literal(true),example:Schema.optional(Schema.Struct({target:Schema.Literal(0,1),value:Schema.Literal(0,1)}))});
const create=Schema.Struct({...input.fields,retryOf:Schema.optional(id)});
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const maxAttempts=64;
type Input=typeof input.Type;
export function admittedSignalConcept(task:Task,value:Input){
 const context=prepareWorkflowSourceContext(task,value.basis),basis=task.artifacts.find(a=>a.id===value.basis.artifactId)?.revisions.at(-1);
 if(!basis?.mimeType.startsWith('text/')||basis.encoding==='base64')throw Error('Review a saved text document.');
 if(JSON.stringify(value.expectedSourceRefs)!==JSON.stringify(context.sourceRefs))throw Error('Linked sources changed. Review their current versions.');
 const prepared=prepareWorkflowPassages(context.sources.map(source=>({sourceId:source.ref.sourceId,text:source.version.content})));if(prepared.issues.length)throw Error(prepared.issues.join(' '));
 const passage=prepared.passages.find(p=>p.sourceId===value.sourceId&&p.start===value.start&&p.end===value.end&&p.quote===value.quote),rule=passage&&parseSignalAssignment(passage.quote);
 if(!rule)throw Error('Choose one complete supported simple signal assignment from a linked source.');
 const sourceRefs=task.sources.flatMap(source=>{const found=context.sourceRefs.find(ref=>ref.sourceId===source.id);return found?[found]:[];});if(sourceRefs.length!==context.sourceRefs.length)throw Error('Linked source identities changed.');
 const binding={taskId:value.taskId,basis:context.artifact,sourceRefs,sourceId:value.sourceId,start:value.start,end:value.end,quote:value.quote,...(value.example?{example:value.example}:{})};return {binding,content:signalConceptDocument(rule,value.example)};
}
const attemptId=(binding:ReturnType<typeof admittedSignalConcept>['binding'],index:number)=>(binding.example?'signal-concept-v2-':'signal-concept-v1-')+hash(binding)+(index?'_'+index:'');
const attemptNumber=(binding:ReturnType<typeof admittedSignalConcept>['binding'],requestId:string)=>{for(let index=0;index<maxAttempts;index++)if(attemptId(binding,index)===requestId)return index;return -1;};
export function signalConceptResult(task:Task,value:Input,request:Task['requests'][number]){
 const {binding,content}=admittedSignalConcept(task,value),saved=request.artifactId&&task.artifacts.find(a=>a.id===request.artifactId)?.revisions.at(-1);
 if(request.status!=='completed'||!saved||saved.revision!==request.answer?.revision||saved.digest!==request.answer.digest||saved.mimeType!=='text/markdown'||saved.content!==content||JSON.stringify(saved.sourceRefs)!==JSON.stringify(binding.sourceRefs))throw Error('The saved explanation changed. Review its source before continuing.');
 return {task,artifactId:request.artifactId!,revision:saved.revision};
}
export function readSignalConceptSubmission(raw:unknown){
 let value:typeof create.Type;try{value=Schema.decodeUnknownSync(create,{onExcessProperty:'error'})(raw);}catch{throw Error('Review and confirm one exact linked source line.');}
 return value;
}
export function signalConceptPublication(task:Task,value:ReturnType<typeof readSignalConceptSubmission>){
 const {binding}=admittedSignalConcept(task,value);let index=0;
 if(value.retryOf!==undefined){const previous=attemptNumber(binding,value.retryOf),request=task.requests.find(r=>r.id===value.retryOf);if(previous<0||previous>=maxAttempts-1||!request||request.kind!=='experiment'||!['failed','interrupted','cancelled'].includes(request.status)||request.artifactId!==undefined||JSON.stringify(request.sourceRefs)!==JSON.stringify(binding.sourceRefs))throw Error('Check the previous publication before starting a new attempt.');index=previous+1;}
 const request:RequestInput={taskId:value.taskId,requestId:attemptId(binding,index),kind:'experiment',prompt:'Explain one reviewed signal assignment.',executionScope:(binding.example?'signal-concept-v2:':'signal-concept-v1:')+hash(binding),sourceIds:binding.sourceRefs.map(ref=>ref.sourceId),expectedSourceRefs:binding.sourceRefs,expectedArtifacts:[binding.basis]};
 const artifact=(()=>{const fresh=admittedSignalConcept(task,value);return {title:'Understanding a signal assignment',mimeType:'text/markdown',content:fresh.content};})();return {request,artifact};
}
export async function createSignalConcept(core:Companion,raw:unknown,assertCurrent:()=>void=()=>{}){return core.saveSignalConcept(raw,assertCurrent);}

export async function inspectSignalConcept(core:Companion,raw:unknown){
 let value:Input;try{value=Schema.decodeUnknownSync(input,{onExcessProperty:'error'})(raw);}catch{throw Error('Review and confirm one exact linked source line.');}
 const task=await core.getTask(value.taskId),{binding}=admittedSignalConcept(task,value);let latest:Task['requests'][number]|undefined;
 for(let index=0;index<maxAttempts;index++){const request=task.requests.find(r=>r.id===attemptId(binding,index));if(!request)break;if(request.kind!=='experiment'||JSON.stringify(request.sourceRefs)!==JSON.stringify(binding.sourceRefs))throw Error('The publication record needs review.');latest=request;}
 if(!latest)return {kind:'not-started' as const};if(latest.status==='running')return {kind:'running' as const,requestId:latest.id};
 if(latest.status==='completed'){const saved= signalConceptResult(task,value,latest);return {kind:'completed' as const,requestId:latest.id,artifactId:saved.artifactId,revision:saved.revision};}
 if(latest.artifactId!==undefined)throw Error('The previous publication needs review.');return {kind:'terminal' as const,requestId:latest.id,status:latest.status,canRetry:attemptNumber(binding,latest.id)<maxAttempts-1};
}
