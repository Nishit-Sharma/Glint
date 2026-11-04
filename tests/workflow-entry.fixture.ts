import type {Page} from '@playwright/test';
import {OnboardingFixture} from './onboarding-fixture';
import {createWorkflowArtifact,createWorkflowExample} from '../src/core/workflow-lab-host';
import {workflowRuleCitations,workflowSourceText,reviewedWorkflowDefinition} from './workflow-source-fixture';
import type {Command} from '../src/shared/bridge';

/** Actual offline App, bridge, ready bot, Companion ledger and disposable store.
 * OS/provider boundaries remain OnboardingFixture substitutes. The reviewed mode
 * injects an explicitly reviewed owned-text fixture through the real host API;
 * it is not a product review UI, live inference or a screen capture. */
export async function workflowEntry(page:Page,reviewed=false){
 const fixture=await OnboardingFixture.open(page,{ready:true,port:Number(process.env.WINDOW_COMPANION_TEST_PORT??4180)});
 const catalog=await fixture.ready(),task=await fixture.core.createTask({title:reviewed?'Reviewed synthetic workflow fixture':'Offline workflow practice',assignedBotId:catalog.defaultBotId});
 const counters={exampleRequests:[] as {taskId:string;requestId:string}[]};
 const invoke=fixture.invoke.bind(fixture);
 fixture.invoke=async(command:Command)=>{
  if(command.type!=='workflow.example')return invoke(command);
  fixture.commands.push(structuredClone(command));counters.exampleRequests.push({taskId:command.taskId,requestId:command.requestId});
  const request=await createWorkflowExample(fixture.core,{taskId:command.taskId,requestId:command.requestId});
  if(request.status!=='completed'||!request.artifactId)throw Error(request.error??'Offline workflow example did not complete.');
  const current=await fixture.core.getTask(command.taskId),artifact=current.artifacts.find(artifact=>artifact.id===request.artifactId)!;
  await fixture.emit({type:'changed',taskId:command.taskId});
  return {task:current,artifactId:artifact.id,revision:artifact.revisions.at(-1)!.revision};
 };
 const sourceLabel='Owned synthetic workflow rules — reviewed fixture';let sourceId:string|undefined;
 if(reviewed){
  const sourced=await fixture.core.putSource(task.id,{id:'owned-reviewed-workflow-rules',kind:'text',role:'fact',label:sourceLabel,content:workflowSourceText});sourceId=sourced.sources[0].id;
  const source=sourced.sources[0],version=source.versions.at(-1)!;
  const basis=await fixture.core.saveArtifact(task.id,{title:'Explicitly reviewed synthetic rule text',content:'Owned synthetic text supplied for test review. This fixture is admitted by the real host API; no product review UI or automatic inference is claimed.',mimeType:'text/markdown',sourceRefs:[{sourceId:source.id,version:version.version,digest:version.digest}]});
  const request=await createWorkflowArtifact(fixture.core,{taskId:task.id,requestId:'owned-reviewed-fixture',definition:reviewedWorkflowDefinition,review:{basis:{artifactId:basis.artifactId,revision:basis.revision.revision,digest:basis.revision.digest},acknowledgement:'reviewed-rules',ruleCitations:workflowRuleCitations(source.id)}});
  if(request.status!=='completed')throw Error(request.error??'Reviewed fixture admission failed.');
 }
 await fixture.viewPreferences.select(task.id);await fixture.restart();
 await page.getByRole('button',{name:task.title,exact:true}).click();await page.locator('.workspace').getByRole('heading',{name:task.title,exact:true}).waitFor();
 return {fixture,task,counters,sourceLabel,
  async changeSource(){if(!sourceId)throw Error('This case has no reviewed source.');await fixture.core.putSource(task.id,{id:sourceId,kind:'text',role:'fact',label:sourceLabel,content:workflowSourceText+'\nSynthetic revision changed after review.'});await fixture.emit({type:'changed',taskId:task.id});},
 };
}
