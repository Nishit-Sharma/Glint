import {tableWorkflow} from '../learning/table-workflow';
import type {Artifact,Task} from '../core/types';
import {parseModuleAnswer} from '../core/interactive-modules';
import {documentRecipe} from '../learning/document-recipe';
import {helperStudio,type HelperDefinition} from '../learning/reusable-helper';
import {pickingHelper} from '../learning/picking-helper';
import {semanticHelper} from '../learning/semantic-helper';
import {runSemanticProcedure,type SemanticRecord} from '../learning/semantic-procedure';
import {MODULE_MIME} from './module-contract';

type HelperExample=Pick<HelperDefinition['tests'][number],'input'|'expected'>;
export interface SavedHelperEntry{
 taskId:string;taskTitle:string;artifactId:string;artifactRevision:number;artifactDigest:string;
 moduleId:string;helperId:string;stateRevision:number;
 name:string;description:string;invocation:string;version:number;activeVersion:number|null;savedVersionCount:number;
 example:HelperExample|undefined;
 recordExample?:{input:SemanticRecord;output:SemanticRecord};scope?:'record'|'table';activationGeneration?:number;
}

export function savedHelpers(tasks:readonly Task[]):SavedHelperEntry[]{
 const entries:SavedHelperEntry[]=[];
 for(const task of tasks)for(const artifact of task.artifacts){
  const revision=artifact.revisions.at(-1);
  if(revision?.mimeType!==MODULE_MIME)continue;
  try{
   const answer=parseModuleAnswer(JSON.parse(revision.content));
   for(const module of answer.modules){
    try{
     if(module.data.kind==='document-recipe'){
      const saved=task.session?.moduleStates.find(item=>item.artifactId===artifact.id&&item.artifactRevision===revision.revision&&item.moduleId===module.id);if(!saved)continue;
      const state=documentRecipe.parseState(saved.state),version=state.versions.find(item=>item.version===state.activeVersion)??state.versions.at(-1);if(!version)continue;
      entries.push({taskId:task.id,taskTitle:task.title,artifactId:artifact.id,artifactRevision:revision.revision,artifactDigest:revision.digest,moduleId:module.id,helperId:module.data.id,stateRevision:state.revision,name:version.definition.name,description:version.definition.intent,invocation:'Local document recipe',version:version.version,activeVersion:state.activeVersion,savedVersionCount:state.versions.length,example:undefined});continue;
     }
     if(module.data.kind!=='helper-studio')continue;
     const matches=task.session?.moduleStates.filter(saved=>saved.artifactId===artifact.id&&saved.artifactRevision===revision.revision&&(saved.moduleId===module.id||(saved.moduleId===undefined&&answer.modules.length===1)))??[];
     if(matches.length!==1)continue;
     if(matches[0].state.format==='table-workflow-v1'){const state=tableWorkflow.parseState(module.data.id,matches[0].state),saved=state.versions.find(item=>item.version===state.activeVersion)??state.versions.at(-1);if(!saved)continue;entries.push({taskId:task.id,taskTitle:task.title,artifactId:artifact.id,artifactRevision:revision.revision,artifactDigest:revision.digest,moduleId:module.id,helperId:module.data.id,stateRevision:state.revision,name:saved.definition.name,description:saved.definition.intent,invocation:'Local table workflow',version:saved.version,activeVersion:state.activeVersion,savedVersionCount:state.versions.length,example:undefined});continue;}
     if(matches[0].state.format==='semantic-table-v2'){
      const state=pickingHelper.parseState(module.data.id,matches[0].state),saved=state.releases.find(r=>r.version===state.activation.version)??state.releases.at(-1);if(!saved)continue;
      const observed=state.observations.find(o=>saved.observations.some(ref=>ref.id===o.id&&ref.digest===o.digest)),context=observed&&state.contexts.find(c=>c.id===observed.contextId);
      entries.push({taskId:task.id,taskTitle:task.title,artifactId:artifact.id,artifactRevision:revision.revision,artifactDigest:revision.digest,moduleId:module.id,helperId:module.data.id,stateRevision:state.revision,name:'Local picking manifest',description:saved.definition.intent,invocation:'Prepare a local manifest',version:saved.version,activeVersion:state.activation.version,savedVersionCount:state.releases.length,activationGeneration:state.activation.generation,example:undefined,scope:'table',...(observed&&context?{recordExample:{input:context.request,output:observed.output}}:{})});continue;
     }
     if(matches[0].state.format==='semantic-record-v1'){
      const state=semanticHelper.parseState(module.data.id,matches[0].state),saved=state.versions.find(item=>item.version===state.activeVersion)??state.versions.at(-1);
      if(!saved)continue;
      const procedure=saved.candidate.procedure,recording=saved.candidate.recordings.map(item=>({input:item.input,result:runSemanticProcedure(procedure,item.input)})).find(item=>item.result.status==='completed');
      const recordExample=recording?.result.status==='completed'?{input:recording.input,output:recording.result.output}:undefined;
      entries.push({taskId:task.id,taskTitle:task.title,artifactId:artifact.id,artifactRevision:revision.revision,artifactDigest:revision.digest,moduleId:module.id,helperId:module.data.id,stateRevision:state.revision,name:`${module.data.title} · ${procedure.input.name}`,description:procedure.intent,invocation:'Local record',version:saved.version,activeVersion:state.activeVersion,savedVersionCount:state.versions.length,example:undefined,scope:'record',...(recordExample?{recordExample}:{})});
      continue;
     }
     const state=helperStudio.parseState(module.data,matches[0].state),saved=state.versions.find(item=>item.version===state.activeVersion)??state.versions.at(-1);
     if(!saved)continue;
     const definition=saved.definition,example=definition.tests.find(test=>test.role==='example');
     entries.push({taskId:task.id,taskTitle:task.title,artifactId:artifact.id,artifactRevision:revision.revision,artifactDigest:revision.digest,moduleId:module.id,helperId:module.data.id,stateRevision:state.revision,name:definition.name,description:definition.description,invocation:definition.invocation,version:saved.version,activeVersion:state.activeVersion,savedVersionCount:state.versions.length,example:example?{input:example.input,expected:{...example.expected}}:undefined});
    }catch{/* An invalid saved state stays in its original task for review. */}
   }
  }catch{/* Invalid envelopes stay available in their original task for review. */}
 }
 return entries;
}

export function resolveSavedHelper(task:Task,entry:SavedHelperEntry):Artifact{
 const current=savedHelpers([task]).find(candidate=>candidate.taskId===entry.taskId&&candidate.artifactId===entry.artifactId&&candidate.artifactRevision===entry.artifactRevision&&candidate.artifactDigest===entry.artifactDigest&&candidate.moduleId===entry.moduleId&&candidate.helperId===entry.helperId&&candidate.stateRevision===entry.stateRevision&&candidate.version===entry.version&&candidate.activeVersion===entry.activeVersion&&candidate.savedVersionCount===entry.savedVersionCount&&candidate.activationGeneration===entry.activationGeneration);
 const artifact=current&&task.artifacts.find(item=>item.id===current.artifactId);
 if(!artifact)throw Error('This saved helper changed or is no longer available. Refresh Saved helpers and choose it again.');
 return artifact;
}
