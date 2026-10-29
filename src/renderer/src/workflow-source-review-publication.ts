import type {ArtifactRef,SourceRef,Task} from '../../core/types';
import {parseModuleAnswer} from '../../core/interactive-modules';
import {MODULE_MIME} from '../../shared/module-contract';
import {learningDraftTaskId,serializeLearningDraftJson,type LearningDraftOwner} from '../../shared/learning-drafts';
import type {WorkflowReview,WorkflowReviewPreparation} from '../../learning/workflow-review';
import type {createLearningDrafts} from './learning-drafts';
import {prepareWindowRequestIntent,startSeparateWindowAttempt} from './window-request-intent';
import {workflowSourcePublicationSlot} from './workflow-source-review-form';

type Cache=ReturnType<typeof createLearningDrafts>;
export type LiteralWorkflowResult={task:Task;artifactId:string;revision:number};
const sameRef=(a:ArtifactRef,b:ArtifactRef)=>a.artifactId===b.artifactId&&a.revision===b.revision&&a.digest===b.digest;
const sameSourceSet=(left:readonly SourceRef[],right:readonly SourceRef[])=>left.length===right.length&&left.every(ref=>right.some(expected=>ref.sourceId===expected.sourceId&&ref.version===expected.version&&ref.digest===expected.digest));
/** Inspect an existing trusted core receipt. This never publishes or acknowledges raw input. */
export function literalWorkflowReceipt(task:Task,requestId:string,prepared:Pick<WorkflowReviewPreparation,'basis'|'sourceRefs'>):ArtifactRef|undefined{
 const request=task.requests.find(request=>request.id===requestId),answer=request?.status==='completed'?request.answer:undefined,revision=answer&&task.artifacts.find(artifact=>artifact.id===answer.artifactId)?.revisions.find(revision=>revision.revision===answer.revision&&revision.digest===answer.digest);
 if(!answer||request?.artifactId!==answer.artifactId||!revision||revision.mimeType!==MODULE_MIME||request?.kind!=='experiment'||!sameSourceSet(request.sourceRefs,prepared.sourceRefs)||!sameSourceSet(revision.sourceRefs,prepared.sourceRefs))return;
 try{const module=parseModuleAnswer(JSON.parse(revision.content)).modules.find(module=>module.data.kind==='workflow-lab'&&module.data.basis.kind==='reviewed-source'&&module.data.basis.taskId===task.id&&sameRef(module.data.basis.artifact,prepared.basis));if(!module||module.data.kind!=='workflow-lab'||module.data.basis.kind!=='reviewed-source')return;const refs=module.data.basis.sourceRefs;if(refs.length!==prepared.sourceRefs.length||refs.some((ref,index)=>{const expected=prepared.sourceRefs[index];return ref.sourceId!==expected.sourceId||ref.version!==expected.version||ref.digest!==expected.digest;}))return;return answer;}catch{return;}
}
type Intent={cache:Cache;owner:LearningDraftOwner;basis:string;prepared:WorkflowReviewPreparation;review:WorkflowReview;isCurrent:()=>boolean;newId?:()=>string};
async function intentInput(input:Intent){
 const bytes=new TextEncoder().encode(serializeLearningDraftJson({basis:input.prepared.basis,sourceRefs:input.prepared.sourceRefs,review:input.review},'workflow-source-review')),hash=await crypto.subtle.digest('SHA-256',bytes),binding='literal-workflow-review-v1:'+ [...new Uint8Array(hash)].map(value=>value.toString(16).padStart(2,'0')).join('');
 return {cache:input.cache,owner:input.owner,slot:workflowSourcePublicationSlot,basis:input.basis,binding,newId:input.newId??(()=>crypto.randomUUID()),isCurrent:input.isCurrent};
}
/** A deliberate retry repeats the exact command ID through existing host/core
 * validation. A lost reply never authorizes a second module or an automatic replay. */
export async function publishLiteralWorkflow(input:Intent&{publish:(requestId:string)=>Promise<LiteralWorkflowResult|undefined>}):Promise<{result:LiteralWorkflowResult;ref:ArtifactRef;requestId:string;current:boolean}>{
 if(!input.isCurrent())throw Error('Review the current inputs and confirm them again.');
 const requestId=await prepareWindowRequestIntent(await intentInput(input));
 if(!input.isCurrent()||input.cache.getSnapshot().frozen||input.cache.getSnapshot().maintenance)throw Error('Review the current inputs and confirm them again.');
 const result=await input.publish(requestId);
 if(!result||result.task.id!==learningDraftTaskId(input.owner))throw Error('Publication was not confirmed. Your raw review and attempt are kept. Check Activity, then retry this same confirmed input.');
 const ref=literalWorkflowReceipt(result.task,requestId,input.prepared);
 if(!ref||ref.artifactId!==result.artifactId||ref.revision!==result.revision)throw Error('The saved publication receipt did not match this review. Your raw input is kept.');
 return {result,ref,requestId,current:input.isCurrent()};
}
export async function separateLiteralAttempt(input:Intent&{readTask:()=>Promise<Task>}){await startSeparateWindowAttempt({...await intentInput(input),readTask:input.readTask});}
