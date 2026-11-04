import type {Companion} from './companion';
import type {Task,RequestInput} from './types';
import {readSourceFormulaCommand,readSourceFormulaInput,sourceFormulaPreview,sourceFormulaBinding,sourceFormulaRequestId,sourceFormulaAttempt,reviewedSourceFormula,SOURCE_FORMULA_MIME,type SourceFormulaInput,type SourceFormulaPacket} from '../learning/source-formula';

function requestInput(input:SourceFormulaInput,index:number):RequestInput{return {taskId:input.taskId,requestId:sourceFormulaRequestId(input,index),kind:'experiment',prompt:'Save the explicitly reviewed local source formula transcription.',executionScope:'source-formula-v1:'+sourceFormulaBinding(input),sourceIds:[input.sourceRef.sourceId],expectedSourceRefs:[input.sourceRef]};}
// Historical request digests include project guidance not retained in RequestRecord; verify the bound publication and exact source snapshots.
function verify(input:SourceFormulaInput,index:number,request:Task['requests'][number]){const value=requestInput(input,index);if(request.id!==value.requestId||request.prompt!==value.prompt||request.kind!=='experiment'||JSON.stringify(request.sourceRefs)!==JSON.stringify([input.sourceRef]))throw Error('The original formula save request needs inspection.');}
function saved(task:Task,input:SourceFormulaInput,index:number,request:Task['requests'][number]){
 verify(input,index,request);const artifact=request.artifactId&&task.artifacts.find(item=>item.id===request.artifactId),revision=artifact&&request.answer&&artifact.revisions.find(item=>item.revision===request.answer!.revision&&item.digest===request.answer!.digest);
 if(request.status!=='completed'||!artifact||!revision)throw Error('The original formula publication is unavailable. Inspect its saved history.');
 const packet=reviewedSourceFormula(task,artifact.id,revision);if(packet.publication.binding!==sourceFormulaBinding(input)||packet.publication.requestId!==request.id)throw Error('The original reviewed formula payload changed.');
 return {kind:'saved' as const,taskId:task.id,binding:packet.publication.binding,artifactId:artifact.id,revision:revision.revision,digest:revision.digest};
}
export type SourceFormulaInspection=ReturnType<typeof saved>|{kind:'not-saved';taskId:string;binding:string}|{kind:'running';taskId:string;binding:string;requestId:string}|{kind:'terminal';taskId:string;binding:string;requestId:string;status:'failed'|'cancelled'|'interrupted';canRetry:boolean};
/** Original-payload reconciliation precedes current-source admission and never
 * rewrites a completed publication or silently substitutes a newer source. */
export function inspectSourceFormulaTask(task:Task,raw:unknown):SourceFormulaInspection{
 const input=readSourceFormulaInput(raw),binding=sourceFormulaBinding(input);let latest:Task['requests'][number]|undefined,index=0;
 for(;index<8;index++){const request=task.requests.find(item=>item.id===sourceFormulaRequestId(input,index));if(!request)break;if(latest&&!['failed','cancelled','interrupted'].includes(latest.status))throw Error('The formula publication attempt order needs inspection.');verify(input,index,request);latest=request;}
 if(!latest)return {kind:'not-saved',taskId:task.id,binding};if(latest.status==='completed')return saved(task,input,index-1,latest);if(latest.status==='running')return {kind:'running',taskId:task.id,binding,requestId:latest.id};if(latest.artifactId!==undefined||latest.answer!==undefined)throw Error('The previous formula save has an unsupported outcome. Inspect Files before retrying.');
 return {kind:'terminal',taskId:task.id,binding,requestId:latest.id,status:latest.status,canRetry:index<8};
}
export async function inspectSourceFormulaSave(core:Companion,raw:unknown):Promise<SourceFormulaInspection>{const input=readSourceFormulaInput(raw);return inspectSourceFormulaTask(await core.getTask(input.taskId),input);}
export function sourceFormulaPublication(task:Task,command:ReturnType<typeof readSourceFormulaCommand>){
 const input=command.input,prior=inspectSourceFormulaTask(task,input);if(prior.kind==='saved')return {kind:'existing' as const,result:{...prior,alreadySaved:true}};
 if(prior.kind==='running')throw Error('The original local formula save is still running. Check it before retrying.');let index=0;if(prior.kind==='terminal'){if(!prior.canRetry||command.retryOf!==prior.requestId)throw Error('Check the interrupted formula save and explicitly retry that original payload.');index=sourceFormulaAttempt(input,prior.requestId)+1;}else if(command.retryOf!==undefined)throw Error('There is no terminal original formula save to retry.');
 const preview=sourceFormulaPreview(task,input),packet:SourceFormulaPacket={format:'source-formula-v1',input:preview.input,citation:preview.citation,draft:preview.draft,publication:{binding:preview.binding,requestId:sourceFormulaRequestId(input,index)}},content=JSON.stringify(packet);if(content.length>64000)throw Error('The complete cited formula exceeds its supported saved size. Nothing was truncated.');return {kind:'new' as const,index,request:requestInput(input,index),artifact:{title:preview.draft.title,content,mimeType:SOURCE_FORMULA_MIME}};
}
export {saved as sourceFormulaResult};
export function saveSourceFormula(core:Companion,raw:unknown,assertCurrent:()=>void=()=>{}){return core.saveSourceFormula(raw,assertCurrent);}
