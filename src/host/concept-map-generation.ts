import type {Command} from '../shared/bridge';
import type {RequestContext,RequestInput,RequestOutput,Task} from '../core/types';
import {CONCEPT_MAP_MIME,CONCEPT_MAP_PROMPT,CONCEPT_MAP_PROGRESS,conceptMapPrompt,parseConceptMapModel,selectConceptMapSources} from '../shared/concept-map';
export function prepareConceptMapGeneration(task:Task,command:Extract<Command,{type:'model.run'}>){
 if(command.kind!=='concept-map')return undefined;
 if(task.id!==command.taskId||command.prompt!==CONCEPT_MAP_PROMPT||command.artifactId!==undefined||command.briefAction!==undefined||command.submittedDraft!==undefined||!command.sourceIds||!command.expectedSourceRefs)throw Error('Choose the concept map action with explicit current text sources.');
 const sources=selectConceptMapSources(task,command.sourceIds,command.expectedSourceRefs);
 const request:RequestInput={taskId:task.id,requestId:command.requestId,kind:'concept-map',prompt:CONCEPT_MAP_PROMPT,sourceIds:sources.map(source=>source.ref.sourceId),expectedSourceRefs:sources.map(source=>source.ref),executionScope:'source-concept-map-v1'};
 return {request,bind(context:Pick<RequestContext,'task'|'sourceRefs'>){
  const current=selectConceptMapSources(context.task,request.sourceIds!,context.sourceRefs);
  if(JSON.stringify(current)!==JSON.stringify(sources))throw Error('The selected concept map text changed.');
  return {kind:'concept-map' as const,prompt:conceptMapPrompt(current),progress:CONCEPT_MAP_PROGRESS,finish(content:string):RequestOutput{
   const map=parseConceptMapModel(content,current);return map.kind==='unsupported-source'?{title:'Concept map needs more evidence',content:'A concept map could not be prepared. '+map.reason,mimeType:'text/markdown'}:{title:map.title,content:JSON.stringify(map),mimeType:CONCEPT_MAP_MIME};
  }};
 }};
}
