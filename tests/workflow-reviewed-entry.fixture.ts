import type {Page} from '@playwright/test';
import {OnboardingFixture} from './onboarding-fixture';
import {prepareWorkflowReview,createReviewedWorkflow} from '../src/core/workflow-review-host';
import type {Command} from '../src/shared/bridge';
import type {SourceRef} from '../src/core/types';
import type {WorkflowReviewPreparation} from '../src/learning/workflow-review';

export const literalWorkflowText=[
 'Draft + Submit -> In review',
 'In review + Approve -> Ready',
 'Ready + Edit -> Draft',
 'Draft + Edit -> Draft',
 'In review + Edit -> Draft',
 'In review + Request changes -> Draft',
].join('\n');
export const interpretedWorkflowText=[
 'Draft + Submit -> In review',
 'In review + Approve -> Ready',
 'Ready + Edit -> Draft',
 'Editing a ready document returns it to review in this synthetic policy.',
].join('\n');

/** Only ordinary owned source text and its saved document are seeded.
 * Workflow preparation, review and module creation are driven by the actual App.
 * OS/provider boundaries retain the existing disconnected fixture substitutes. */
export async function reviewedWorkflowEntry(page:Page,kind:'literal'|'ambiguous'='literal'){
 const fixture=await OnboardingFixture.open(page,{ready:true,port:4180});
 const catalog=await fixture.ready(),task=await fixture.core.createTask({title:kind==='literal'?'Owned source workflow review':'Owned ambiguous workflow review',assignedBotId:catalog.defaultBotId});
 const documentTitle='Owned workflow source notes',sourceLabels=['Owned synthetic workflow rules','Owned conflicting synthetic rule'];
 const sourceTexts=kind==='literal'?[literalWorkflowText]:[interpretedWorkflowText,'Ready + Edit -> In review'];
 const sourceIds=sourceTexts.map((_,index)=>'owned-workflow-source-'+(index+1));
 const refs:SourceRef[]=[];
 for(let index=0;index<sourceTexts.length;index++){
  const current=await fixture.core.putSource(task.id,{id:sourceIds[index],kind:'text',role:'fact',label:sourceLabels[index],content:sourceTexts[index]});
  const source=current.sources.find(source=>source.id===sourceIds[index])!,version=source.versions.at(-1)!;
  refs.push({sourceId:source.id,version:version.version,digest:version.digest});
 }
 const basis=await fixture.core.saveArtifact(task.id,{title:documentTitle,content:'This owned synthetic document links the rule text used for a local workflow experiment. Its body is intentionally different from the linked source rules. No live procedure or screen inference is claimed.',mimeType:'text/markdown',sourceRefs:refs});
 const counters={preparations:[] as WorkflowReviewPreparation[],reviewRequests:[] as Extract<Command,{type:'workflow.review'}>[],createdArtifactIds:[] as string[]};
 const invoke=fixture.invoke.bind(fixture);
 fixture.invoke=async(command:Command)=>{
  if(command.type==='workflow.prepare'){
   fixture.commands.push(structuredClone(command));const {type,...input}=command;
   const prepared=await prepareWorkflowReview(fixture.core,input);counters.preparations.push(structuredClone(prepared));return prepared;
  }
  if(command.type==='workflow.review'){
   fixture.commands.push(structuredClone(command));counters.reviewRequests.push(structuredClone(command));const {type,...input}=command;
   const created=await createReviewedWorkflow(fixture.core,input);counters.createdArtifactIds.push(created.artifactId);await fixture.emit({type:'changed',taskId:command.taskId});return created;
  }
  return invoke(command);
 };
 await fixture.viewPreferences.select(task.id);await fixture.restart();
 await page.getByRole('button',{name:task.title,exact:true}).click();await page.locator('.workspace').getByRole('heading',{name:task.title,exact:true}).waitFor();
 return {fixture,task,documentTitle,basisArtifactId:basis.artifactId,sourceIds,sourceLabels,counters,
  async changeSourceAndRebind(){
   const updated=await fixture.core.putSource(task.id,{id:sourceIds[0],kind:'text',role:'fact',label:sourceLabels[0],content:sourceTexts[0]+'\nOwned synthetic source revision after preparation.'});
   const currentBasis=updated.artifacts.find(artifact=>artifact.id===basis.artifactId)!.revisions.at(-1)!;
   const currentRefs=sourceIds.map(sourceId=>{const source=updated.sources.find(source=>source.id===sourceId)!,version=source.versions.at(-1)!;return {sourceId,version:version.version,digest:version.digest};});
   await fixture.core.saveArtifact(task.id,{artifactId:basis.artifactId,expectedRevision:currentBasis.revision,title:documentTitle,content:currentBasis.content,mimeType:'text/markdown',sourceRefs:currentRefs});
   await fixture.emit({type:'changed',taskId:task.id});
  },
 };
}
