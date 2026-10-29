import type {Page} from '@playwright/test';
import {offlineTaskEntry} from './offline-task-entry.fixture';
import {prepareWorkflowReview,createReviewedWorkflow,createContextualReviewedWorkflow} from '../src/core/workflow-review-host';
import {createCompanion} from '../src/core/companion';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {BotPreferences} from '../src/host/bot-preferences';
import {TaskViewPreferences} from '../src/host/task-view-preferences';
import type {Command} from '../src/shared/bridge';
import type {WorkflowReviewPreparation} from '../src/learning/workflow-review';

/** No source/task/document/module/lesson seeds. Every normal mutation reaches
 * actual App commands and real local core/store. Only host transport and surface
 * boundaries are substituted. Restart is store recreation + renderer reload,
 * never a native process quit/relaunch. No provider or capture is allowed. */
export async function contextualPublicEntry(page:Page){
 const entry=await offlineTaskEntry(page),{fixture}=entry,invoke=fixture.invoke.bind(fixture);
 const preparations:WorkflowReviewPreparation[]=[],publications:Extract<Command,{type:'workflow.review'|'workflow.contextual.review'}>[]=[],published:{mode:'legacy'|'contextual';artifactId:string;requestId:string}[]=[];
 const phases:{phase:string;utc:string}[]=[{phase:'fresh empty current core/sidecar; onboarding uncompleted',utc:new Date().toISOString()}];
 fixture.invoke=async(command:Command)=>{
  if(command.type==='workflow.prepare'){fixture.commands.push(structuredClone(command));const {type,...input}=command,prepared=await prepareWorkflowReview(fixture.core,input);preparations.push(structuredClone(prepared));return prepared;}
  if(command.type==='workflow.review'||command.type==='workflow.contextual.review'){
   fixture.commands.push(structuredClone(command));publications.push(structuredClone(command));const {type,...input}=command,mode=type==='workflow.review'?'legacy':'contextual',result=await (mode==='legacy'?createReviewedWorkflow:createContextualReviewedWorkflow)(fixture.core,input);published.push({mode,artifactId:result.artifactId,requestId:command.requestId});await fixture.emit({type:'changed',taskId:command.taskId});return result;
  }
  return invoke(command);
 };
 return {fixture,creations:entry.creations,preparations,publications,published,phases,
  async recreateStoresAndReload(){
   await fixture.flushDrafts();await fixture.core.close();fixture.core=await createCompanion({dataDir:fixture.directory});fixture.bots=await BotPreferences.open(fixture.directory,fixture.core);fixture.learningDrafts=new LearningDraftStore({directory:fixture.directory,lookupTask:async id=>(await fixture.core.listTasks()).find(task=>task.id===id)});fixture.viewPreferences=new TaskViewPreferences(fixture.directory,async id=>(await fixture.core.listTasks()).some(task=>task.id===id));phases.push({phase:'closed/recreated core + sidecar + bot/view stores; renderer reload, not native quit',utc:new Date().toISOString()});await page.reload();
  },
  close:()=>entry.close(),
 };
}
