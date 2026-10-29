import {createHash} from 'node:crypto';
import {Schema} from 'effect';
import type {Companion} from './companion';
import type {ArtifactRef,Task} from './types';
import {prepareWorkflowSourceContext} from './workflow-lab-host';
import {prepareWorkflowPassages} from '../learning/workflow-review';
import {makeTruthComparison,makeTruthPrediction,parseBinaryAssignment,readTruthBinding,truthMarkdown,truthStatus,TRUTH_MODULE_PREFIX,TRUTH_PREDICTION_PREFIX,isTruthModuleId,isTruthPredictionId,type TruthBinding} from '../learning/truth-table';
import {parseModuleAnswer,type ModuleAnswer} from './interactive-modules';

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const ref=Schema.Struct({sourceId:id,version:Schema.Int.pipe(Schema.positive()),digest:id});
const artifact=Schema.Struct({artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest:id});
const inputSchema=Schema.Struct({taskId:id,basis:artifact,expectedSourceRefs:Schema.Array(ref).pipe(Schema.minItems(1),Schema.maxItems(2)),sourceId:id,start:Schema.Int.pipe(Schema.nonNegative()),end:Schema.Int.pipe(Schema.positive()),quote:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(500)),confirmed:Schema.Literal(true),mode:Schema.optional(Schema.Literal('table','prediction'))});
const createSchema=Schema.Struct({...inputSchema.fields,retryOf:Schema.optional(id)});
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const maxAttempts=64;
type Mode='table'|'prediction';
const attemptId=(binding:TruthBinding,index:number,mode:Mode)=> (mode==='table'?'truth-v1-':'truth-pred-v1-')+hash(binding)+(index?'_'+index:'');
const attemptNumber=(binding:TruthBinding,requestId:string,mode:Mode)=>{for(let index=0;index<maxAttempts;index++)if(attemptId(binding,index,mode)===requestId)return index;return -1;};
const moduleId=(binding:TruthBinding,mode:Mode)=>(mode==='table'?TRUTH_MODULE_PREFIX:TRUTH_PREDICTION_PREFIX)+hash(binding);
function admitted(task:Task,value:typeof inputSchema.Type){
 const context=prepareWorkflowSourceContext(task,value.basis),basisRevision=task.artifacts.find(a=>a.id===value.basis.artifactId)?.revisions.at(-1);if(!basisRevision?.mimeType.startsWith('text/')||basisRevision.encoding==='base64')throw Error('Review a saved text document.');
 if(JSON.stringify(value.expectedSourceRefs)!==JSON.stringify(context.sourceRefs))throw Error('Linked sources changed. Review their current versions.');
 const prepared=prepareWorkflowPassages(context.sources.map(s=>({sourceId:s.ref.sourceId,text:s.version.content})));if(prepared.issues.length)throw Error(prepared.issues.join(' '));
 const passage=prepared.passages.find(p=>p.sourceId===value.sourceId&&p.start===value.start&&p.end===value.end&&p.quote===value.quote),rule=passage&&parseBinaryAssignment(passage.quote);if(!rule)throw Error('Choose a complete supported two-input AND, OR, XOR, NAND, NOR or XNOR assignment from a linked source.');
 // Request output references are authoritative task-source order, while the reviewed
 // document may intentionally order the same exact references differently.
 const sourceRefs=task.sources.flatMap(source=>{const found=context.sourceRefs.find(ref=>ref.sourceId===source.id);return found?[found]:[];});
 if(sourceRefs.length!==context.sourceRefs.length)throw Error('Linked source identities changed.');
 const binding:TruthBinding={taskId:value.taskId,basis:context.artifact,sourceRefs,sourceId:value.sourceId,start:value.start,end:value.end,quote:value.quote};return {binding,data:value.mode==='prediction'?makeTruthPrediction(rule):makeTruthComparison(rule)};
}
export async function createTruthTable(core:Companion,input:unknown){
 let value:typeof createSchema.Type;try{value=Schema.decodeUnknownSync(createSchema,{onExcessProperty:'error'})(input);}catch{throw Error('Review and confirm one exact linked source assignment.');}
 const task=await core.getTask(value.taskId),prepared=admitted(task,value),mode=value.mode??'table';let index=0;if(value.retryOf!==undefined){const previous=attemptNumber(prepared.binding,value.retryOf,mode),request=task.requests.find(r=>r.id===value.retryOf);if(previous<0||previous>=maxAttempts-1||!request||request.kind!=='experiment'||!['failed','interrupted','cancelled'].includes(request.status)||request.artifactId!==undefined||JSON.stringify(request.sourceRefs)!==JSON.stringify(prepared.binding.sourceRefs))throw Error('Check the previous publication before starting a new attempt.');index=previous+1;}const requestId=attemptId(prepared.binding,index,mode),result=await core.runRequest({taskId:value.taskId,requestId,kind:'experiment',prompt:'Explore a reviewed binary assignment.',executionScope:(mode==='table'?'truth-table-v1:':'truth-prediction-v1:')+hash(prepared.binding),sourceIds:prepared.binding.sourceRefs.map(r=>r.sourceId),expectedSourceRefs:[...prepared.binding.sourceRefs],expectedArtifacts:[prepared.binding.basis]},async current=>{const next=admitted(current.task,value),content=JSON.stringify({schemaVersion:1,markdown:truthMarkdown(next.binding),modules:[{id:moduleId(next.binding,mode),version:1,data:next.data,provenance:[]}]});parseModuleAnswer(JSON.parse(content));return {title:next.data.title,mimeType:'application/vnd.window-companion.modules+json',content};});
 if(result.status!=='completed'||!result.artifactId)throw Error(result.error??'The reviewed truth table could not be created.');const savedTask=await core.getTask(value.taskId);return {task:savedTask,artifactId:result.artifactId,revision:1};
}

/** Read-only reconciliation for this exact reviewed binding; never starts a request. */
export async function inspectTruthTable(core:Companion,input:unknown){
 let value:typeof inputSchema.Type;try{value=Schema.decodeUnknownSync(inputSchema,{onExcessProperty:'error'})(input);}catch{throw Error('Review and confirm one exact linked source assignment.');}
 const task=await core.getTask(value.taskId),{binding}=admitted(task,value),mode=value.mode??'table';let latest:Task['requests'][number]|undefined;
 for(let index=0;index<maxAttempts;index++){const current=task.requests.find(r=>r.id===attemptId(binding,index,mode));if(!current)break;if(current.kind!=='experiment'||JSON.stringify(current.sourceRefs)!==JSON.stringify(binding.sourceRefs))throw Error('The publication record needs review.');latest=current;}
 if(!latest)return {kind:'not-started' as const};
 if(latest.status==='running')return {kind:'running' as const,requestId:latest.id};
 if(latest.status==='completed'){if(!latest.artifactId)throw Error('The completed publication needs review.');const saved=task.artifacts.find(a=>a.id===latest!.artifactId)?.revisions.at(-1);if(!saved||saved.revision!==latest.answer?.revision||saved.digest!==latest.answer.digest)throw Error('The saved publication changed.');const answer=parseModuleAnswer(JSON.parse(saved.content));truthTableGuard(task,answer,{artifactId:latest.artifactId,revision:saved.revision,digest:saved.digest});return {kind:'completed' as const,requestId:latest.id,artifactId:latest.artifactId,revision:saved.revision};}
 if(latest.artifactId!==undefined)throw Error('The previous publication needs review.');
 return {kind:'terminal' as const,requestId:latest.id,status:latest.status,canRetry:attemptNumber(binding,latest.id,mode)<maxAttempts-1};
}

/** Reserved identity, exact generated data and fresh source references are all required. */
export function truthTableGuard(task:Task,answer:ModuleAnswer,output:ArtifactRef){
 const module=answer.modules.find(m=>isTruthModuleId(m.id));if(!module)return undefined;
 if(answer.modules.length!==1||module.version!==1)throw Error('This saved truth table needs review.');const mode:Mode=isTruthPredictionId(module.id)?'prediction':'table';const binding=readTruthBinding(answer.markdown,module.id);if(!binding||moduleId(binding,mode)!==module.id||truthMarkdown(binding)!==answer.markdown||truthStatus(binding,task).kind!=='current')throw Error('The truth table source changed. Review its current source.');
 const reviewedLinks=prepareWorkflowSourceContext(task,binding.basis).sourceRefs;
 const reviewed=admitted(task,{taskId:binding.taskId,basis:binding.basis,expectedSourceRefs:reviewedLinks,sourceId:binding.sourceId,start:binding.start,end:binding.end,quote:binding.quote,confirmed:true,mode});if(JSON.stringify(reviewed.binding)!==JSON.stringify(binding))throw Error('The truth table source binding changed.');
 if(!task.requests.some(r=>attemptNumber(binding,r.id,mode)>=0&&r.kind==='experiment'&&r.status==='completed'&&r.artifactId===output.artifactId))throw Error('The truth table publication needs review.');
 const expected=reviewed.data;if(JSON.stringify(module.data)!==JSON.stringify(expected))throw Error('This saved truth table differs from its reviewed source.');const saved=task.artifacts.find(a=>a.id===output.artifactId)?.revisions.at(-1);if(!saved||saved.revision!==output.revision||saved.digest!==output.digest||JSON.stringify(saved.sourceRefs)!==JSON.stringify(binding.sourceRefs))throw Error('The truth table source or artifact changed.');
 return {sourceRefs:[...binding.sourceRefs],artifactRefs:[output,binding.basis]};
}
