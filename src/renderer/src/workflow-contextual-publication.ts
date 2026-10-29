import type {ArtifactRef,Task} from '../../core/types';
import {parseModuleAnswer} from '../../core/interactive-modules';
import {contextualWorkflowIntent,CONTEXTUAL_WORKFLOW_MODULE_PREFIX} from '../../learning/contextual-workflow-admission';
import {learningDraftTaskId,serializeLearningDraftJson} from '../../shared/learning-drafts';
import {workflowSourceAdmissions} from '../../shared/workflow-source-admission';
import {prepareWindowRequestIntent,startSeparateWindowAttempt} from './window-request-intent';
import {literalWorkflowReceipt,publishLiteralWorkflow} from './workflow-source-review-publication';

type Input=Parameters<typeof publishLiteralWorkflow>[0];
type Intent=Omit<Input,'publish'>;
const admission=workflowSourceAdmissions.contextual;
async function intentInput(input:Intent){
 const body=contextualWorkflowIntent({basis:input.prepared.basis,sourceRefs:input.prepared.sourceRefs,review:input.review}),bytes=new TextEncoder().encode(serializeLearningDraftJson(body,'workflow-source-review')),digest=await crypto.subtle.digest('SHA-256',bytes),binding=admission.bindingPrefix+[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
 return {cache:input.cache,owner:input.owner,slot:admission.publicationSlot,basis:input.basis,binding,newId:input.newId??(()=>crypto.randomUUID()),isCurrent:input.isCurrent};
}
export function contextualWorkflowReceipt(task:Task,requestId:string,prepared:Input['prepared'],binding:string):ArtifactRef|undefined{
 if(!binding.startsWith(admission.bindingPrefix))return;
 const identity=binding.slice(admission.bindingPrefix.length);if(!/^[a-f0-9]{64}$/.test(identity))return;
 const ref=literalWorkflowReceipt(task,requestId,prepared),saved=ref&&task.artifacts.find(artifact=>artifact.id===ref.artifactId)?.revisions.find(revision=>revision.revision===ref.revision&&revision.digest===ref.digest);
 if(!ref||!saved)return;
 try{const answer=parseModuleAnswer(JSON.parse(saved.content)),module=answer.modules[0];if(answer.modules.length!==1||module.id!==CONTEXTUAL_WORKFLOW_MODULE_PREFIX+identity||module.data.kind!=='workflow-lab'||module.data.id!==module.id)return;return ref;}catch{return;}
}
export async function publishContextualWorkflow(input:Input){
 if(!input.isCurrent())throw Error('Review the current inputs and confirm them again.');
 const intent=await intentInput(input),requestId=await prepareWindowRequestIntent(intent);
 if(!input.isCurrent()||input.cache.getSnapshot().frozen||input.cache.getSnapshot().maintenance)throw Error('Review the current inputs and confirm them again.');
 const result=await input.publish(requestId);
 if(!result||result.task.id!==learningDraftTaskId(input.owner))throw Error('Publication was not confirmed. Your raw review and attempt are kept. Check Activity, then retry this same confirmed input.');
 const ref=contextualWorkflowReceipt(result.task,requestId,input.prepared,intent.binding);
 if(!ref||ref.artifactId!==result.artifactId||ref.revision!==result.revision)throw Error('The saved publication receipt did not match this contextual review. Your raw input is kept.');
 return {result,ref,requestId,current:input.isCurrent()};
}
export async function separateContextualAttempt(input:Intent&{readTask:()=>Promise<Task>}){await startSeparateWindowAttempt({...await intentInput(input),readTask:input.readTask});}
