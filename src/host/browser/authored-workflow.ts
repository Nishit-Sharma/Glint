import {createHash} from 'node:crypto';
import type {Companion} from '../../core/companion';
import {BrowserCoordinator,type BrowserPlanner,type BrowserPlan} from './coordinator';
import {currentBrowserWorkflow,resolveWorkflowText,workflowCheck,workflowInvocation,workflowTarget,type BrowserWorkflowRun} from '../../shared/browser-workflow';

type CoordinatorInput=Parameters<BrowserCoordinator['run']>[0];
export type BrowserWorkflowControls=Pick<CoordinatorInput,'authorizeStart'|'approveAction'|'headless'|'onWindowOwner'|'onProgress'|'control'>;

/** Authored data is interpreted by a finite deterministic planner, never evaluated as code.
 * Only observed operations advance its index. Stale proposals cannot skip a step. */
export async function executeBrowserWorkflow(core:Companion,input:BrowserWorkflowRun,controls:BrowserWorkflowControls){
 const workflow=currentBrowserWorkflow(await core.getTask(input.taskId),input.workflow),invocation=workflowInvocation(workflow,input.url,input.inputs);
 const endpointKey='authored-workflow-v1:'+createHash('sha256').update(JSON.stringify({workflow:input.workflow,...invocation})).digest('hex');
 const assertCurrent=async()=>{currentBrowserWorkflow(await core.getTask(input.taskId),input.workflow);};
 const planner:BrowserPlanner={endpointKey,async plan({observation,signal}):Promise<BrowserPlan>{
  if(signal.aborted)throw Error('Stopped before the next workflow step.');
  const task=await core.getTask(input.taskId);currentBrowserWorkflow(task,input.workflow);
  if(new URL(observation.url).origin!==workflow.origin||!new URL(observation.url).pathname.startsWith(workflow.pathPrefix))throw Error('The browser left the authored workflow path. Review the page before another attempt.');
  const run=task.session?.runs.find(run=>run.id===input.requestId),observed=run?.operations.filter(operation=>operation.status==='observed')??[],index=observed.length;
  if(run?.operations.some(operation=>operation.status==='retired'&&operation.error==='The intended form values did not match the current page. No submission was offered or executed.'))throw Error('The authored form fields do not match the current form. Edit and review the workflow before another fresh attempt.');
  if(index>workflow.steps.length)throw Error('The workflow execution no longer matches its saved steps.');
  if(index)for(const check of workflow.steps[index-1].after)workflowCheck(check,observation,invocation.inputs);
  if(index===workflow.steps.length){
   const checked=workflow.steps.map((step,index)=>{const result=observed[index].result;if(!result)throw Error('A workflow step has no observed result.');return step.name+'\n'+step.after.map(check=>'  - '+workflowCheck(check,result,invocation.inputs)).join('\n');});
   return {kind:'answer',markdown:`## ${workflow.name}\n\nSaved workflow revision ${input.workflow.revision}. All ${workflow.steps.length} authored steps ran in a fresh isolated browser and their visible checks passed.\n\nStarting target: ${invocation.url}\n\n${checked.map((step,index)=>(index+1)+'. '+step).join('\n\n')}\n\nThese are visible page and ordinary-field checks, not independent verification of a website effect. This was an authored workflow, not automatic learning from a recording.`,modules:[]};
  }
  const step=workflow.steps[index];for(const check of step.before)workflowCheck(check,observation,invocation.inputs);
  const target=workflowTarget(observation,step.action.target),action=step.action;
  return {kind:'action',reason:`Saved workflow revision ${input.workflow.revision}, step ${index+1}/${workflow.steps.length}: ${step.name}. The authored before checks passed.`,action:action.kind==='click'?{kind:'click',targetId:target.id,expectedFields:action.fields.map(field=>({targetId:workflowTarget(observation,field.target).id,value:resolveWorkflowText(field.value,invocation.inputs)}))}:{kind:action.kind,targetId:target.id,value:resolveWorkflowText(action.value,invocation.inputs)}};
 }};
 return new BrowserCoordinator(core,planner).run({taskId:input.taskId,requestId:input.requestId,goal:`Run saved browser workflow “${workflow.name}” revision ${input.workflow.revision}.`,origin:workflow.origin,url:invocation.url,pathPrefix:workflow.pathPrefix,workflow:input.workflow,transmissionApproved:true,expectedArtifacts:[input.workflow],...controls,
  authorizeStart:async signal=>{await assertCurrent();if(!controls.authorizeStart)throw Error('Host approval is required before opening a workflow browser.');await controls.authorizeStart(signal);await assertCurrent();},
  approveAction:async current=>{await assertCurrent();const decision=await controls.approveAction(current);await assertCurrent();return decision;},
 });
}
