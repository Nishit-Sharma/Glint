import {createHash,randomUUID} from 'node:crypto';
import {Schema} from 'effect';
import type {Companion} from './companion';
import {initialModuleState,parseModuleAnswer} from './interactive-modules';
import {recordedTextOrigin,recordedTextProcedure} from '../learning/recorded-text-procedure';
import {MODULE_MIME} from '../shared/module-contract';
const id=Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,80}$/)),revision=Schema.Int.pipe(Schema.between(0,500));
const inputSchema=Schema.Struct({taskId:id,artifactId:id,artifactRevision:Schema.Int.pipe(Schema.positive()),artifactDigest:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),moduleId:id,moduleVersion:Schema.Int.pipe(Schema.positive()),stateRevision:revision,observationId:id});
export type RecordedTextRequest=typeof inputSchema.Type;
export function readRecordedTextRequest(value:unknown){return Schema.decodeUnknownSync(inputSchema,{onExcessProperty:'error'})(value);}
const acceptance=Schema.Struct({...inputSchema.fields,binding:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),confirmed:Schema.Literal('create-separate-inactive-draft')});
export function readRecordedTextAcceptance(value:unknown){return Schema.decodeUnknownSync(acceptance,{onExcessProperty:'error'})(value);}
export async function inspectRecordedTextHelper(core:Companion,value:unknown){
 const input=readRecordedTextRequest(value),task=await core.getTask(input.taskId);
 if(task.status!=='active')throw Error('Resume the owning task before reviewing this local demonstration.');
 const artifact=task.artifacts.find(item=>item.id===input.artifactId),current=artifact?.revisions.at(-1);
 if(!current||current.revision!==input.artifactRevision||current.digest!==input.artifactDigest||current.mimeType!==MODULE_MIME)throw Error('The original helper changed. Open its current version before reviewing recorded steps.');
 const answer=parseModuleAnswer(JSON.parse(current.content)),module=answer.modules.find(item=>item.id===input.moduleId&&item.version===input.moduleVersion);
 if(!module||module.data.kind!=='helper-studio'||module.data.recordedText)throw Error('Choose the original local text helper and its completed demonstration.');
 const state=task.session?.moduleStates.find(item=>item.artifactId===artifact!.id&&item.artifactRevision===current.revision&&(item.moduleId===module.id||item.moduleId===undefined&&answer.modules.length===1))?.state??initialModuleState(module.data);
 if(state.revision!==input.stateRevision||'format' in state)throw Error('The original helper changed. Review its current recorded steps again.');
 const origin=recordedTextOrigin({taskId:task.id,artifactId:artifact!.id,artifactRevision:current.revision,artifactDigest:current.digest,moduleId:module.id,moduleVersion:module.version,helperId:module.data.id,stateRevision:state.revision},module.data,state,input.observationId),procedure=recordedTextProcedure(origin);
 const binding=createHash('sha256').update(JSON.stringify({origin,procedure})).digest('hex');
 return {binding,origin,procedure,activationAuthorized:false as const,independentHeldOutVerified:false as const,effectAuthority:'none' as const};
}
/** A separate local request is idempotent for the exact reviewed source receipt. */
export async function createRecordedTextHelper(core:Companion,value:unknown,assertCurrent:()=>void=()=>{}){
 const accepted=readRecordedTextAcceptance(value),{binding,confirmed:_confirmed,...input}=accepted;
 assertCurrent();const preview=await inspectRecordedTextHelper(core,input);assertCurrent();
 if(preview.binding!==binding)throw Error('The recorded proposal changed. Inspect it again before accepting.');
 const request=await core.runRequest({taskId:input.taskId,requestId:`recorded-text-${binding}`,kind:'create',prompt:'Create a separate inactive draft from the explicitly reviewed local text actions.',executionScope:'local-recorded-text:create:v1',sourceIds:[],expectedSourceRefs:[],expectedArtifacts:[{artifactId:input.artifactId,revision:input.artifactRevision,digest:input.artifactDigest}],expectedModuleStates:[{artifactId:input.artifactId,artifactRevision:input.artifactRevision,moduleId:input.moduleId,stateRevision:input.stateRevision}]},async()=>{
  const data={kind:'helper-studio',schemaVersion:1,id:randomUUID(),title:'Recorded text procedure',description:'Review the staged steps derived from one local text demonstration.',recordedText:preview.origin};
  return {title:data.title,mimeType:MODULE_MIME,content:JSON.stringify({schemaVersion:1,markdown:'A separate inactive draft derived from reviewed local text actions. Review typed stages and declare fresh checks before saving and activation. No external actions were observed.',modules:[{id:randomUUID(),version:1,data,provenance:[]}]})};
 },assertCurrent);
 if(request.status!=='completed'||!request.artifactId||!request.answer)throw Error(request.error??'The separate helper could not be confirmed. Review Files and the original helper before making a new proposal.');
 const task=await core.getTask(input.taskId),artifact=task.artifacts.find(item=>item.id===request.artifactId),current=artifact?.revisions.at(-1);
 if(!current||current.revision!==request.answer.revision||current.digest!==request.answer.digest)throw Error('The separate helper changed. Open its current version from Files.');
 return {task,artifactId:artifact!.id,revision:current.revision,digest:current.digest,binding};
}
