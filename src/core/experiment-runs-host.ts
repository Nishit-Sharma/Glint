import type {Companion} from './companion';
import type {RequestInput,Task} from './types';
import {readExperimentRunInput,experimentRunId,reviewedExperimentRun,type ExperimentRunInput} from '../learning/experiment-runs';
import {pickingDigest} from '../shared/picking-digest';
export function experimentRunRequest(input:ExperimentRunInput,index:number):RequestInput{return {taskId:input.taskId,requestId:experimentRunId(input,index),kind:'experiment',prompt:'Save an explicitly requested deterministic experiment run.',executionScope:'experiment-run-v1:'+pickingDigest(input),sourceIds:input.sourceRefs.map(ref=>ref.sourceId),expectedSourceRefs:[...input.sourceRefs],expectedArtifacts:[input.basis,...(input.parent?[input.parent]:[])]};}
export function inspectExperimentRun(task:Task,input:ExperimentRunInput){
 let latest:Task['requests'][number]|undefined,index=0;
 for(;index<8;index++){const request=task.requests.find(item=>item.id===experimentRunId(input,index));if(!request)break;if(latest&&!['failed','cancelled','interrupted'].includes(latest.status))throw Error('The saved run attempt order needs inspection.');if(request.kind!=='experiment'||request.prompt!==experimentRunRequest(input,index).prompt||pickingDigest([...request.sourceRefs].sort((a,b)=>a.sourceId.localeCompare(b.sourceId)))!==pickingDigest([...input.sourceRefs].sort((a,b)=>a.sourceId.localeCompare(b.sourceId))))throw Error('The saved run request changed.');latest=request;}
 if(!latest)return {kind:'not-saved' as const};
 if(latest.status==='completed'){const artifact=task.artifacts.find(item=>item.id===latest!.artifactId),revision=artifact?.revisions.find(item=>item.revision===latest!.answer?.revision&&item.digest===latest!.answer.digest);if(!artifact||!revision)throw Error('The original saved run is unavailable.');reviewedExperimentRun(task,artifact.id,revision);return {kind:'saved' as const,artifactId:artifact.id,revision:revision.revision,digest:revision.digest};}
 if(latest.status==='running')return {kind:'running' as const,requestId:latest.id};
 if(latest.artifactId||latest.answer)throw Error('Inspect the previous saved run outcome before retrying.');
 return {kind:'terminal' as const,requestId:latest.id,status:latest.status,canRetry:index<8};
}
export async function inspectExperimentRunSave(core:Companion,raw:unknown){const input=readExperimentRunInput(raw);return inspectExperimentRun(await core.getTask(input.taskId),input);}
/** The core computes and publishes this local packet; no inference runner is admitted. */
export function saveExperimentRun(core:Companion,raw:unknown,assertCurrent:()=>void=()=>{}){return core.saveExperimentRun(raw,assertCurrent);}
