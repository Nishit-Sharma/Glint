import type {Command} from '../shared/bridge';
import type {RequestOutput,SourceVersion,Task} from '../core/types';
import {EXPLANATION_MIME,explainDepthLabel,explanationPrompt,explanationSourceDescriptors,parseExplanationModel,readExplainDepth,readExplanation,type ExplainDepth,type Explanation} from '../shared/explanation-modes';

export type ExplanationMode={depth:ExplainDepth;progress:string;prompt:(request:string,sources:readonly SourceVersion[],context:Task)=>string;finish:(content:string,sources:readonly SourceVersion[])=>RequestOutput};

/** Applies to an explicit depth on a new explanation, and to every revision of a saved explanation. */
export function prepareExplanationMode(task:Task,command:Extract<Command,{type:'model.run'}>):ExplanationMode|undefined{
 const target=command.artifactId?task.artifacts.find(artifact=>artifact.id===command.artifactId)?.revisions.at(-1):undefined;
 const saved=target?.mimeType===EXPLANATION_MIME?readExplanation(target.content):undefined;
 if(target?.mimeType===EXPLANATION_MIME&&!saved)throw Error('This saved explanation needs review before it can be revised.');
 if(command.explainDepth===undefined&&!saved)return undefined;
 if(command.briefAction||command.conversationAttempt||command.revisionBasis||command.canvasContext)throw Error('Explanation depth applies only to an ordinary explanation or its revision.');
 if(saved?command.kind!=='revise':command.kind!=='explain'||command.artifactId!==undefined)throw Error('Explanation depth applies only to an ordinary explanation or its revision.');
 if(saved&&(!command.explanationBasis||command.explanationBasis.artifactId!==command.artifactId||command.explanationBasis.revision!==target!.revision||command.explanationBasis.digest!==target!.digest))throw Error('The saved explanation changed. Open its current version before changing depth.');
 if(!saved&&command.explanationBasis)throw Error('Choose a saved explanation to revise.');
 const depth=command.explainDepth===undefined?saved!.depth:readExplainDepth(command.explainDepth);
 const revision:Explanation['revision']=saved&&target?{instruction:command.prompt,basisRevision:target.revision,previousDepth:saved.depth}:undefined;

 return {
  depth,progress:`Preparing a ${explainDepthLabel[depth].toLowerCase()} explanation…`,
  prompt:(request,sources,context)=>explanationPrompt({depth,request:saved?context.requests.find(item=>item.answer?.artifactId===command.artifactId&&item.kind==='explain')?.prompt??saved.title:request,sources:explanationSourceDescriptors(sources),...(revision?{revision}:{})}),
  finish(content,sources){
   const explanation=parseExplanationModel(content,{depth,sources,fallbackTitle:saved?.title??'Explanation',...(revision?{revision}:{})});
   return {title:saved&&target?target.title:explanation.title,content:JSON.stringify(explanation),mimeType:EXPLANATION_MIME};
  },
 };
}
