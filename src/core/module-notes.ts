import type {ArtifactRef,ModuleStateRef} from './companion';
import type {SourceRef,Task} from './types';
import {parseModuleAnswer,readableModuleIntro,moduleText} from './interactive-modules';
import {emptyTaskSession} from './task-session';
import {isTruthModuleId,isTruthPredictionId,readTruthBinding,parseBinaryAssignment,truthPredictionText} from '../learning/truth-table';
import {truthTableGuard} from './truth-table-host';
import {groundedJoinCommitGuard} from './grounded-join-host';
import {workflowCommitGuard} from './workflow-lab-host';

export type ModuleNotesInput={taskId:string;artifactId:string;artifactRevision:number;sessionRevision:number};
export function readModuleNotesInput(value:unknown):ModuleNotesInput{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='artifactId,artifactRevision,sessionRevision,taskId')throw Error('Invalid module notes selection.');
 const input=value as ModuleNotesInput;
 if([input.taskId,input.artifactId].some(id=>typeof id!=='string'||!id.trim()||id.length>200)||!Number.isSafeInteger(input.artifactRevision)||input.artifactRevision<1||!Number.isSafeInteger(input.sessionRevision)||input.sessionRevision<0)throw Error('Invalid module notes selection.');
 return {...input};
}
/** Only canonical current module choices can supply note bytes or provenance. */
export function moduleNotesPublication(task:Task,input:ModuleNotesInput){
 const artifact=task.artifacts.find(item=>item.id===input.artifactId),revision=artifact?.revisions.at(-1),session=task.session??emptyTaskSession();
 if(task.id!==input.taskId||!artifact||!revision||revision.revision!==input.artifactRevision||revision.mimeType!=='application/vnd.window-companion.modules+json'||session.revision!==input.sessionRevision)throw Error('Your answer or choices changed. Review them before saving the document.');
 const answer=parseModuleAnswer(JSON.parse(revision.content)),observedUrls=[...new Set(answer.modules.flatMap(module=>module.provenance.map(source=>source.url)))];
 for(const module of answer.modules){
  const matches=session.moduleStates.filter(saved=>saved.artifactId===artifact.id&&saved.artifactRevision===revision.revision&&(saved.moduleId===module.id||(saved.moduleId===undefined&&answer.modules.length===1)));
  if(matches.length>1)throw Error('Your answer or choices changed. Review them before saving the document.');
  if(module.data.kind==='helper-studio'&&matches[0]?.state.format==='table-workflow-v1')throw Error('Save this local table workflow from its original single-helper answer.');
 }
  const expectedArtifacts:ArtifactRef[]=[{artifactId:artifact.id,revision:revision.revision,digest:revision.digest}],expectedModuleStates:ModuleStateRef[]=[],guardedSourceRefs:SourceRef[]=[];
  const stateFor=(moduleId:string)=>session.moduleStates.find(saved=>saved.artifactId===artifact.id&&saved.artifactRevision===revision.revision&&(saved.moduleId===moduleId||(saved.moduleId===undefined&&answer.modules.length===1)))?.state;
  const content = [readableModuleIntro(answer,stateFor), ...answer.modules.map(module => {
    const saved = session.moduleStates.find(saved => saved.artifactId === artifact.id && saved.artifactRevision === revision.revision && (saved.moduleId === module.id || (saved.moduleId === undefined && answer.modules.length === 1)));
    expectedModuleStates.push({artifactId:artifact.id,artifactRevision:revision.revision,moduleId:module.id,stateRevision:saved?.state.revision??0});
    if(module.data.kind==='grounded-join'||module.data.kind==='workflow-lab'||module.data.kind==='helper-studio'||isTruthModuleId(module.id)){
      const output={artifactId:artifact.id,revision:revision.revision,digest:revision.digest};
      const guard=truthTableGuard(task,answer,output)??(module.data.kind==='grounded-join'?groundedJoinCommitGuard(task,module.data,output):module.data.kind==='workflow-lab'?workflowCommitGuard(task,module.data,output):{sourceRefs:[...revision.sourceRefs],artifactRefs:[output]});
      for(const ref of guard.artifactRefs)if(!expectedArtifacts.some(other=>other.artifactId===ref.artifactId))expectedArtifacts.push(ref);
      guardedSourceRefs.push(...guard.sourceRefs);
    }
    if(isTruthPredictionId(module.id)){const binding=readTruthBinding(answer.markdown,module.id),rule=binding&&parseBinaryAssignment(binding.quote);if(!rule)throw Error('This saved prediction needs review.');const state=saved?.state;if(state?.kind!=='comparison'&&state!==undefined)throw Error('This saved prediction needs review.');return truthPredictionText(rule,state?.selectedRowId as string|undefined);}
    return moduleText(module.data, saved?.state);
  }), ...(observedUrls.length ? ['Observed pages\n' + observedUrls.map(url => `- ${url}`).join('\n')] : [])].join('\n\n');
  const title = (revision.title.slice(0, 190) + ' notes').slice(0, 200);
  return {title,content,mimeType:'text/markdown',sourceRefs:revision.sourceRefs,expectedArtifacts,expectedModuleStates,guardedSourceRefs};
}
