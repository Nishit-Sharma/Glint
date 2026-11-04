import {createHash,randomUUID} from 'node:crypto';
import type {Companion} from './companion';
import type {Task,RequestInput} from './types';
import {MODULE_MIME} from '../shared/module-contract';
import {previewDocumentRecipe,readDocumentRecipeCreate,readDocumentRecipeSave,readDocumentRecipeInspection,type DocumentRecipeSaved,type DocumentRecipeSave} from '../shared/document-recipe';

export async function createDocumentRecipe(core:Companion,value:unknown,assertCurrent:()=>void=()=>{}){
 const input=readDocumentRecipeCreate(value);assertCurrent();
 const request=await core.runRequest({...input,kind:'create',prompt:'Create a local document recipe to demonstrate, review and test.',executionScope:'local-document-recipe:create:v1',sourceIds:[],expectedSourceRefs:[]},async()=>({title:'Document recipe',mimeType:MODULE_MIME,content:JSON.stringify({schemaVersion:1,markdown:'Demonstrate a local document layout from labelled notes, review its fields and declare checks before saving or activation. No browser or OS actions are recorded.',modules:[{id:randomUUID(),version:1,data:{kind:'document-recipe',schemaVersion:1,id:randomUUID(),title:'Document recipe'},provenance:[]}]})}),assertCurrent);
 if(request.status!=='completed'||!request.artifactId||!request.answer)throw Error(request.error??'The document recipe could not be confirmed. Check Files before creating another.');
 const task=await core.getTask(input.taskId),artifact=task.artifacts.find(item=>item.id===request.artifactId),revision=artifact?.revisions.at(-1);
 if(!revision||revision.digest!==request.answer.digest||revision.revision!==request.answer.revision)throw Error('The document recipe changed. Open its current version from Files.');
 return {task,artifactId:artifact!.id,revision:revision.revision};
}
function saveRequest(input:ReturnType<typeof readDocumentRecipeInspection>,attempt=0):RequestInput{return {taskId:input.taskId,requestId:`document-recipe-${input.binding}${attempt?`-retry-${attempt}`:''}`,kind:'create',prompt:'Save the explicitly reviewed local document recipe result as a new ordinary document.',executionScope:'local-document-recipe:save:v1',sourceIds:[input.sourceRef.sourceId],expectedSourceRefs:[input.sourceRef],expectedArtifacts:[{artifactId:input.artifactId,revision:input.artifactRevision,digest:input.artifactDigest}],expectedModuleStates:[{artifactId:input.artifactId,artifactRevision:input.artifactRevision,moduleId:input.moduleId,stateRevision:input.stateRevision}]};}
/** A binding can have several finished no-output attempts, followed by at most one completed output. */
function saveSeries(task:Task,input:ReturnType<typeof readDocumentRecipeInspection>):{receipt:DocumentRecipeSaved;nextAttempt:number}{
 const base=`document-recipe-${input.binding}`,attempts=new Map(task.requests.filter(item=>item.id===base||item.id.startsWith(base+'-retry-')).map(item=>[item.id,item]));
 let terminalStatus:'failed'|'cancelled'|'interrupted'|undefined;
 for(let attempt=0;attempt<=attempts.size;attempt++){
  const payload=saveRequest(input,attempt),request=attempts.get(payload.requestId);
  if(!request){if(attempt!==attempts.size)throw Error('The original save history is incomplete. Review Files before another save.');return {receipt:{kind:'not-saved',taskId:input.taskId,binding:input.binding,...(terminalStatus?{terminalStatus}:{})},nextAttempt:attempt};}
  const expectedDigest=createHash('sha256').update(JSON.stringify({...payload,sourceIds:[input.sourceRef.sourceId],sourceRefs:[input.sourceRef]})).digest('hex');
  if(request.digest!==expectedDigest)throw Error('This save identity belongs to a different local operation. Review Files before continuing.');
  if((request.status==='failed'||request.status==='cancelled'||request.status==='interrupted')&&request.finishedAt&&!request.answer&&!request.artifactId){terminalStatus=request.status;continue;}
  if(request.status!=='completed'||!request.answer)throw Error('This document save is not confirmed. Keep the preview and check again.');
  if(attempt!==attempts.size-1)throw Error('The original save history has conflicting outcomes. Review Files before another save.');
  const artifact=task.artifacts.find(item=>item.id===request.answer!.artifactId),revision=artifact?.revisions.find(item=>item.revision===request.answer!.revision&&item.digest===request.answer!.digest);
  if(!artifact||!revision)throw Error('The saved document is no longer available. Review Files before creating another.');
  return {receipt:{kind:'saved',taskId:input.taskId,binding:input.binding,artifactId:artifact.id,revision:revision.revision,digest:revision.digest},nextAttempt:attempt};
 }
 throw Error('The original save history is unavailable. Review Files before another save.');
}
export async function inspectDocumentRecipeSave(core:Companion,value:unknown):Promise<DocumentRecipeSaved>{
 const input=readDocumentRecipeInspection(value);return saveSeries(await core.getTask(input.taskId),input).receipt;
}
export function documentRecipeSaveResult(task:Task,value:DocumentRecipeSave):DocumentRecipeSaved{
 const {confirmed:_confirmed,...inspection}=value;return saveSeries(task,inspection).receipt;
}
export function documentRecipePublication(task:Task,input:DocumentRecipeSave){
 const {binding,confirmed:_confirmed,...request}=input,existing=saveSeries(task,{...request,binding});if(existing.receipt.kind==='saved')return {kind:'existing' as const,result:existing.receipt};
 const preview=previewDocumentRecipe(task,request);if(binding!==preview.binding||preview.result.kind!=='output')throw Error('This preview changed or did not produce a document. Review it again.');
 return {kind:'new' as const,request:saveRequest(input,existing.nextAttempt),artifact:{title:preview.title,mimeType:'text/plain',content:preview.result.text}};
}
export function saveDocumentRecipe(core:Companion,value:unknown,assertCurrent:()=>void=()=>{}):Promise<DocumentRecipeSaved>{return core.saveDocumentRecipe(value,assertCurrent);}
