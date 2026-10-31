import type {BrowserControl} from './control';
import {dialog,type BrowserWindow} from 'electron';
import type {Companion} from '../../core/companion';
import type {BrowserWindowOwner} from './local-browser';
import {currentBrowserWorkflow,workflowInvocation,type BrowserWorkflowRun} from '../../shared/browser-workflow';
import {executeBrowserWorkflow} from './authored-workflow';

/** Native dialogs own all authority; renderer inputs and saved steps never grant it. */
export async function runAuthoredBrowserWorkflow(core:Companion,input:BrowserWorkflowRun,options:{control:BrowserControl;panel:()=>BrowserWindow;assertCurrent:()=>void;changed:(taskId:string)=>void;headless?:boolean;onWindowOwner?:BrowserWindowOwner}){
 options.assertCurrent();
 const workflow=currentBrowserWorkflow(await core.getTask(input.taskId),input.workflow),invocation=workflowInvocation(workflow,input.url,input.inputs);
 const result=await executeBrowserWorkflow(core,input,{
  control:options.control,headless:options.headless??false,onWindowOwner:options.onWindowOwner,onProgress:()=>options.changed(input.taskId),
  authorizeStart:async signal=>{
   options.assertCurrent();
   const decision=await dialog.showMessageBox(options.panel(),{type:'question',signal,message:'Try this saved browser workflow?',detail:`Workflow: ${workflow.name}\nSaved revision: ${input.workflow.revision}\nFresh target: ${invocation.url}\nAllowed path: ${workflow.pathPrefix}\n\nInputs:\n${workflow.inputs.map(slot=>slot.label+': '+invocation.inputs[slot.key]).join('\n')}\n\n${workflow.steps.length} authored steps run in a fresh browser without personal cookies or sign-ins. No model request is made. Every interaction asks for separate approval. Pause and take control waits for a started interaction to settle; returning requires native review. Visible before/after checks stop the sequence when they fail. These checks do not independently verify website effects.\n\nOnly URLs within the saved origin and path prefix are allowed, including page assets and form destinations. GET and HEAD requests within that path can change the website. Other writes require exact form approval. Redirects, other origins, uploads, downloads and sensitive fields remain blocked.`,buttons:['Cancel','Open fresh browser'],defaultId:0,cancelId:0});
   options.assertCurrent();if(decision.response!==1||signal.aborted)throw Error('The workflow browser was not authorized.');
  },
  approveAction:async current=>{
   options.assertCurrent();const action=current.proposal.intent,review=current.review;
   const choice=action.kind==='select'?review.target.options?.find(option=>option.value===action.value):undefined;
   if(action.kind==='select'&&!choice)throw Error('The authored option is no longer available.');
   const fields=review.write?[...new URLSearchParams(review.write.body)].map(([key,value])=>key+': '+(/token|csrf|secret|password/i.test(key)?'(website verification field)':value)).join('\n'):'';
   const decision=await dialog.showMessageBox(options.panel(),{type:'question',signal:current.signal,message:review.write?'Submit this workflow form?':'Allow this workflow step?',detail:`${current.reason}\nPage: ${current.observation.url}\nControl: ${review.target.label}\n\n${action.kind==='fill'?'Text: '+action.value:action.kind==='select'?'Option: '+choice!.label+'\nValue: '+action.value:review.write?'Destination: '+review.write.url+'\n'+fields:review.target.href?'Open: '+review.target.href:'Click this exact control once.'}\n\nThis approves this exact interaction once, including the GET/HEAD requests within the saved path it causes; their effects may be unknown. ${review.write?'Only this exact form body is approved for a write.':'POST, PUT, PATCH and DELETE remain blocked.'} A visible result does not independently verify a website effect.`,buttons:['Cancel',review.write?'Submit once':'Allow once','Pause and take control'],defaultId:0,cancelId:0});
   options.assertCurrent();if(decision.response===2&&!current.signal.aborted)options.control.take();return decision.response===1&&!current.signal.aborted?{approved:true,...(review.write?{write:review.write}:{})}:{approved:false};
  },
 });
 options.changed(input.taskId);
 return {task:await core.getTask(input.taskId),requestId:result.id,status:result.status,...(result.error?{error:result.error}:{})};
}
