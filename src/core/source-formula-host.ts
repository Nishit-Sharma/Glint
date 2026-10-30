import {createHash} from 'node:crypto';
import type {Companion} from './companion';
import type {Task,RequestInput} from './types';
import {readSourceFormulaCommand,readSourceFormulaInput,sourceFormulaPreview,sourceFormulaBinding,sourceFormulaRequestId,sourceFormulaAttempt,reviewedSourceFormula,SOURCE_FORMULA_MIME,type SourceFormulaInput,type SourceFormulaPacket} from '../learning/source-formula';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function requestInput(input:SourceFormulaInput,index:number):RequestInput{return {taskId:input.taskId,requestId:sourceFormulaRequestId(input,index),kind:'experiment',prompt:'Save the explicitly reviewed local source formula transcription.',executionScope:'source-formula-v1:'+sourceFormulaBinding(input),sourceIds:[input.sourceRef.sourceId],expectedSourceRefs:[input.sourceRef]};}
function verify(input:SourceFormulaInput,index:number,request:Task['requests'][number]){const value=requestInput(input,index),digest=hash({...value,sourceIds:[input.sourceRef.sourceId],sourceRefs:[input.sourceRef]});if(request.digest!==digest||request.kind!=='experiment'||JSON.stringify(request.sourceRefs)!==JSON.stringify([input.sourceRef]))throw Error('The original formula save request needs inspection.');}
function saved(task:Task,input:SourceFormulaInput,index:number,request:Task['requests'][number]){
 verify(input,index,request);const artifact=request.artifactId&&task.artifacts.find(item=>item.id===request.artifactId),revision=artifact&&request.answer&&artifact.revisions.find(item=>item.revision===request.answer!.revision&&item.digest===request.answer!.digest);
 if(request.status!=='completed'||!artifact||!revision)throw Error('The original formula publication is unavailable. Inspect its saved history.');
 const packet=reviewedSourceFormula(task,artifact.id,revision);if(packet.publication.binding!==sourceFormulaBinding(input))throw Error('The original reviewed formula payload changed.');
 return {kind:'saved' as const,taskId:task.id,binding:packet.publication.binding,artifactId:artifact.id,revision:revision.revision,digest:revision.digest};
}
export type SourceFormulaInspection=ReturnType<typeof saved>|{kind:'not-saved';taskId:string;binding:string}|{kind:'running';taskId:string;binding:string;requestId:string}|{kind:'terminal';taskId:string;binding:string;requestId:string;status:'failed'|'cancelled'|'interrupted';canRetry:boolean};
/** Original-payload reconciliation precedes current-source admission and never
 * rewrites a completed publication or silently substitutes a newer source. */
export async function inspectSourceFormulaSave(core:Companion,raw:unknown):Promise<SourceFormulaInspection>{
 const input=readSourceFormulaInput(raw),task=await core.getTask(input.taskId),binding=sourceFormulaBinding(input);let latest:Task['requests'][number]|undefined,index=0;
 for(;index<8;index++){const request=task.requests.find(item=>item.id===sourceFormulaRequestId(input,index));if(!request)break;if(latest&&!['failed','cancelled','interrupted'].includes(latest.status))throw Error('The formula publication attempt order needs inspection.');verify(input,index,request);latest=request;}
 if(!latest)return {kind:'not-saved',taskId:task.id,binding};if(latest.status==='completed')return saved(task,input,index-1,latest);if(latest.status==='running')return {kind:'running',taskId:task.id,binding,requestId:latest.id};if(latest.artifactId!==undefined||latest.answer!==undefined)throw Error('The previous formula save has an unsupported outcome. Inspect Files before retrying.');
 return {kind:'terminal',taskId:task.id,binding,requestId:latest.id,status:latest.status,canRetry:index<8};
}
export async function saveSourceFormula(core:Companion,raw:unknown,assertCurrent:()=>void=()=>{}){
 const command=readSourceFormulaCommand(raw),input=command.input,prior=await inspectSourceFormulaSave(core,input);assertCurrent();if(prior.kind==='saved')return {...prior,alreadySaved:true};
 if(prior.kind==='running')throw Error('The original local formula save is still running. Check it before retrying.');let index=0;
 if(prior.kind==='terminal'){if(!prior.canRetry||command.retryOf!==prior.requestId)throw Error('Check the interrupted formula save and explicitly retry that original payload.');index=sourceFormulaAttempt(input,prior.requestId)+1;}
 else if(command.retryOf!==undefined)throw Error('There is no terminal original formula save to retry.');
 sourceFormulaPreview(await core.getTask(input.taskId),input);assertCurrent();
 const request=await core.runRequest(requestInput(input,index),async context=>{assertCurrent();const preview=sourceFormulaPreview(context.task,input),packet:SourceFormulaPacket={format:'source-formula-v1',input:preview.input,citation:preview.citation,draft:preview.draft,publication:{binding:preview.binding,requestId:sourceFormulaRequestId(input,index)}},content=JSON.stringify(packet);if(content.length>64000)throw Error('The complete cited formula exceeds its supported saved size. Nothing was truncated.');return {title:preview.draft.title,content,mimeType:SOURCE_FORMULA_MIME};});
 assertCurrent();if(request.status!=='completed')throw Error('The formula save was not confirmed. Keep the original payload and check its outcome.');return {...saved(await core.getTask(input.taskId),input,index,request),alreadySaved:false};
}
