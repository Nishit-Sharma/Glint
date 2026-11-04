import {inferredWindowCandidate} from './window-review-repair.fixture';
import {expect,type Page} from '@playwright/test';
import {OnboardingFixture} from './onboarding-fixture';
import type {Command} from '../src/shared/bridge';
import {prepareBriefActionPlan} from '../src/host/brief-action-plan';
import {createWindowWorkflow,windowWorkflowCandidateForReview} from '../src/core/window-workflow-host';
import {createWindowWorkflowCaptureFence} from '../src/host/window-workflow-capture';
import {syntheticCandidate} from './window-learning.fixture';
/** Actual App/core/draft stores. Provider response, consent, native capture/target/privacy and pixels are disclosed synthetic boundaries. No provider adapter is called. */
export async function windowLearningEntry(page:Page,options:{inferred?:boolean}={}){
 const fixture=await OnboardingFixture.open(page,{ready:true,port:Number(process.env.WINDOW_COMPANION_TEST_PORT??4193)});fixture.configured=true;
 const catalog=await fixture.ready(),task=await fixture.core.createTask({title:'Owned synthetic image FSM',assignedBotId:catalog.defaultBotId});
 const capturedAt=new Date().toISOString(),capture={sourceVersion:'owned-synthetic-capture',imageSha256:'a'.repeat(64),capturedAt};let live=true,privacy=true;
 const withSource=await fixture.core.putSource(task.id,{id:'owned-window',kind:'window',role:'fact',label:'Owned synthetic FSM window',windowId:'disposable-window',documentToken:'disposable-diagram',content:JSON.stringify({captureId:capture.sourceVersion,imageSha256:capture.imageSha256,capturedAt,transform:{pixelWidth:800,pixelHeight:400},freshness:'frozen-explicit-capture'})});
 const source=withSource.sources[0],version=source.versions[0],ref={sourceId:source.id,version:version.version,digest:version.digest};
 // The brief is a completed answer in the normal request journal: an unjournaled saveArtifact JSON revision has an
 // unverifiable context origin and is refused for AI reuse (src/core/request-context.ts artifactContextUncertain).
 const briefRecord=await fixture.core.runRequest({taskId:task.id,requestId:'owned-synthetic-screen-brief',kind:'create',prompt:'Create the disclosed synthetic screen brief.',sourceIds:[ref.sourceId],expectedSourceRefs:[ref]},async()=>({title:'Screen brief',mimeType:'application/json',content:JSON.stringify({schemaVersion:1,kind:'screen-brief',insight:'Owned synthetic finite diagram for UI testing. No OCR or live inference is claimed.',actions:[]})}));
 if(briefRecord.status!=='completed'||!briefRecord.artifactId)throw Error(briefRecord.error??'Synthetic screen brief was not saved');
 const saved={artifactId:briefRecord.artifactId,revision:(await fixture.core.getTask(task.id)).artifacts.find(item=>item.id===briefRecord.artifactId)!.revisions[0]};
 const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400"><rect width="800" height="400" fill="#f6f6f2"/><text x="40" y="70" font-family="sans-serif" font-size="24">Owned synthetic FSM fixture</text><text x="80" y="200" font-family="sans-serif" font-size="30">Idle</text><text x="560" y="200" font-family="sans-serif" font-size="30">Busy</text><path d="M170 180 H520 L505 170 M520 180 L505 190" fill="none" stroke="#222" stroke-width="3"/><text x="280" y="155" font-family="sans-serif" font-size="24">Start</text><path d="M550 230 H180 L195 220 M180 230 L195 240" fill="none" stroke="#222" stroke-width="3"/><text x="280" y="270" font-family="sans-serif" font-size="24">Finish</text></svg>';
 const counts={syntheticTransports:0,publications:0};let losePublicationReply=false;
 const invoke=fixture.invoke.bind(fixture);
 fixture.invoke=async(command:Command)=>{
  if(command.type==='source.preview'){fixture.commands.push(structuredClone(command));return live&&privacy&&command.taskId===task.id&&command.reference?.digest===ref.digest?{dataUrl:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg),capturedAt,reference:ref}:null;}
  if(command.type==='model.run'&&command.briefAction&&'kind' in command.briefAction){
   fixture.commands.push(structuredClone(command));const current=await fixture.core.getTask(command.taskId),plan=prepareBriefActionPlan(current,command)!;
   let assertCurrent=()=>{};
   const result=await fixture.core.runRequest(plan.request,async context=>{const response=plan.bind(context);if(response.kind!=='window-workflow-proposal')throw Error('Expected saved WINDOW entry');const provenance=windowWorkflowContext(context.task,saved.artifactId,saved.revision.digest);
    const nativeFence=createWindowWorkflowCaptureFence(provenance,{now:Date.now,readCapture:()=>live?capture:undefined,assertScope:()=>{if(!privacy)throw Error('Synthetic privacy retired');},checkTarget:async()=>{}});assertCurrent=nativeFence.assertCurrent;await nativeFence.check();
    counts.syntheticTransports++;const syntheticResponse=JSON.stringify((options.inferred?inferredWindowCandidate():syntheticCandidate()).proposal);await nativeFence.check();return response.finish(syntheticResponse);
   },()=>assertCurrent());
   await fixture.emit({type:'changed',taskId:task.id});if(result.status!=='completed')throw Error(result.error??'Synthetic request failed');return fixture.core.getTask(task.id);
  }
  if(command.type==='workflow.window.review'){
   fixture.commands.push(structuredClone(command));const candidate=windowWorkflowCandidateForReview(await fixture.core.getTask(command.taskId),command.candidate),{type,...input}=command;
   const fence=createWindowWorkflowCaptureFence(candidate.provenance,{now:Date.now,readCapture:()=>live?capture:undefined,assertScope:()=>{if(!privacy)throw Error('Synthetic privacy retired');},checkTarget:async()=>{}});
   const result=await createWindowWorkflow(fixture.core,input,fence);await fixture.emit({type:'changed',taskId:task.id});if(result.status!=='completed'||!result.answer)throw Error(result.error??'Synthetic review refused');counts.publications++;
   if(losePublicationReply){losePublicationReply=false;throw Error('Synthetic lost publication reply after durable commit');}
   return {task:await fixture.core.getTask(task.id),artifactId:result.answer.artifactId,revision:result.answer.revision};
  }
  return invoke(command);
 };
 await page.reload();
 // Select through the mounted App; a saved preference alone does not navigate it.
 const selectedTask=page.getByRole('complementary',{name:'Task navigation',exact:true}).getByRole('navigation',{name:'Saved tasks',exact:true}).getByRole('button',{name:task.title,exact:true});
 await selectedTask.click();await expect(selectedTask).toHaveAttribute('aria-current','page');await expect(page.locator('.workspace').getByRole('heading',{level:1,name:task.title,exact:true})).toBeVisible();
 // Read-only real-core precondition: the visible owner must retain this exact WINDOW/brief basis before Files.
 const chosenOwner=await fixture.core.getTask(task.id);expect({id:chosenOwner.id,title:chosenOwner.title}).toEqual({id:task.id,title:task.title});
 const chosenSource=chosenOwner.sources.find(item=>item.id==='owned-window'),chosenVersion=chosenSource?.versions.find(item=>item.version===chosenSource.currentVersion);
 expect({sourceId:chosenSource?.id,currentVersion:chosenSource?.currentVersion,digest:chosenVersion?.digest,kind:chosenVersion?.kind,role:chosenVersion?.role}).toEqual({sourceId:'owned-window',currentVersion:ref.version,digest:ref.digest,kind:'window',role:'fact'});
 const chosenBrief=chosenOwner.artifacts.find(item=>item.id===saved.artifactId),chosenBriefRevision=chosenBrief?.revisions.at(-1);
 expect({artifactId:chosenBrief?.id,revision:chosenBriefRevision?.revision,digest:chosenBriefRevision?.digest}).toEqual({artifactId:saved.artifactId,revision:1,digest:saved.revision.digest});expect(chosenBriefRevision?.title).toBe('Screen brief');expect(chosenBriefRevision?.sourceRefs).toEqual([ref]);
 return {fixture,task,counts,basis:{artifactId:saved.artifactId,revision:1,digest:saved.revision.digest},retire:async()=>{live=false;await fixture.emit({type:'capture.retired'});},retirePrivacy:()=>{privacy=false;},loseNextReply:()=>{losePublicationReply=true;},restart:async()=>{live=false;await fixture.restart();}};
}
import {prepareWindowWorkflowSourceContext} from '../src/core/window-workflow-host';
import type {Task} from '../src/core/types';
function windowWorkflowContext(task:Task,artifactId:string,digest:string){return prepareWindowWorkflowSourceContext(task,{artifactId,revision:1,digest});}
