import {createHash} from 'node:crypto';
import type {Companion} from './companion';
import {BROWSER_WORKFLOW_MIME,currentBrowserWorkflow,readBrowserWorkflow,type BrowserWorkflowSave,type BrowserWorkflowSaved} from '../shared/browser-workflow';

export async function saveBrowserWorkflow(core:Companion,input:BrowserWorkflowSave):Promise<BrowserWorkflowSaved>{
 const definition=readBrowserWorkflow(input.definition),task=await core.getTask(input.taskId);
 if(task.status!=='active')throw Error('Resume this task before saving its browser workflow.');
 const saved=await core.runRequest({taskId:task.id,requestId:input.requestId,kind:'browser-workflow-authoring',prompt:'Save an explicitly authored browser workflow.',sourceIds:[],executionScope:'authored-browser-workflow:'+createHash('sha256').update(JSON.stringify({definition,artifact:input.artifact})).digest('hex'),...(input.artifact?{artifactId:input.artifact.artifactId,expectedRevision:input.artifact.revision,expectedArtifacts:[input.artifact]}:{})},async context=>{if(input.artifact)currentBrowserWorkflow(context.task,input.artifact);return {title:definition.name,mimeType:BROWSER_WORKFLOW_MIME,content:JSON.stringify(definition)};});
 if(saved.status!=='completed'||!saved.answer)throw Error(saved.error??'The browser workflow save could not be confirmed. Check Files before another save.');
 return {task:await core.getTask(task.id),artifactId:saved.answer.artifactId,revision:saved.answer.revision};
}
