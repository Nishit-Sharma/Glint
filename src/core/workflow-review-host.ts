import {Schema} from 'effect';
import {createHash} from 'node:crypto';
import {GroundingArtifactRefSchema,GroundingSourceRefSchema} from '../learning/grounded-join';
import {prepareWorkflowSourceContext,createWorkflowArtifact} from './workflow-lab-host';
import {prepareWorkflowPassages,checkWorkflowReview,workflowReviewAssumptions,workflowReviewLimits} from '../learning/workflow-review';
import {workflowExample} from '../learning/workflow-example';
import {contextualWorkflowIntent,CONTEXTUAL_WORKFLOW_MODULE_PREFIX} from '../learning/contextual-workflow-admission';
import {serializeLearningDraftJson} from '../shared/learning-drafts';
import type {WorkflowData} from '../learning/workflow-lab';
import type {Companion} from './companion';
import type {Task,ArtifactRef} from './types';
import type {WorkflowReviewPreparation} from '../learning/workflow-review';
const hostId=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const preparationSchema=Schema.Struct({taskId:hostId,basis:GroundingArtifactRefSchema});
function reviewContext(task:Task,basis:ArtifactRef){
 const context=prepareWorkflowSourceContext(task,basis),revision=task.artifacts.find(artifact=>artifact.id===basis.artifactId)!.revisions.at(-1)!;
 if(!revision.mimeType.startsWith('text/')||revision.encoding==='base64')throw Error('Open a saved text document to review its linked text sources.');
 return context;
}
export async function prepareWorkflowReview(core:Companion,input:unknown):Promise<WorkflowReviewPreparation>{
 let value:typeof preparationSchema.Type;
 try{value=Schema.decodeUnknownSync(preparationSchema,{onExcessProperty:'error'})(input);}catch{throw Error('Choose an exact saved document revision to review its linked text sources.');}
 const task=await core.getTask(value.taskId),context=reviewContext(task,value.basis);
 const sources=context.sources.map(source=>({ref:source.ref,label:source.version.label,text:source.version.content}));
 return {basis:context.artifact,sourceRefs:context.sourceRefs,sources:sources.some(source=>source.text.length>workflowReviewLimits.sourceCharacters)?[]:sources,...prepareWorkflowPassages(sources.map(source=>({sourceId:source.ref.sourceId,text:source.text}))),assumptions:workflowReviewAssumptions};
}
const creationSchema=Schema.Struct({taskId:hostId,requestId:hostId,basis:GroundingArtifactRefSchema,expectedSourceRefs:Schema.Array(GroundingSourceRefSchema).pipe(Schema.minItems(1),Schema.maxItems(2)),review:Schema.Unknown});
export async function createReviewedWorkflow(core:Companion,input:unknown):Promise<{task:Task;artifactId:string;revision:number}>{
 let value:typeof creationSchema.Type;
 try{value=Schema.decodeUnknownSync(creationSchema,{onExcessProperty:'error'})(input);}catch{throw Error('Review the current saved document and submit only its quoted rules and experiment choices.');}
 const task=await core.getTask(value.taskId),context=reviewContext(task,value.basis);
 if(value.expectedSourceRefs.length!==context.sourceRefs.length||!value.expectedSourceRefs.every((ref,index)=>{const current=context.sourceRefs[index];return ref.sourceId===current.sourceId&&ref.version===current.version&&ref.digest===current.digest;}))throw Error('The linked source selection changed. Open a new review of the current document.');
 const checked=checkWorkflowReview(context.sources.map(source=>({sourceId:source.ref.sourceId,text:source.version.content})),value.review);
 if(checked.kind==='invalid')throw Error(checked.issues.map(issue=>issue.message).filter((message,index,all)=>all.indexOf(message)===index).slice(0,4).join(' '));
 const review=checked.value,stateLabels=[...new Set(review.rules.flatMap(rule=>[rule.from,rule.to]))],eventLabels=[...new Set(review.rules.map(rule=>rule.event))];
 const stateId=(label:string)=>'state-'+(stateLabels.indexOf(label)+1),eventId=(label:string)=>'event-'+(eventLabels.indexOf(label)+1);
 const identity=createHash('sha256').update(JSON.stringify({basis:context.artifact,review})).digest('hex').slice(0,16);
 const title=('Workflow: '+task.artifacts.find(artifact=>artifact.id===value.basis.artifactId)!.revisions.at(-1)!.title).slice(0,160).replace(/[\uD800-\uDBFF]$/u,'');
 const definition:WorkflowData={kind:'workflow-lab',schemaVersion:1,id:'reviewed-'+identity,version:1,title,basis:{kind:'local-sample',contextDigest:'host-construction'},citations:[],assumptions:[...workflowReviewAssumptions,...review.assumptions.map(assumption=>'User assumption: '+assumption)],ruleOrigins:review.rules.map((rule,index)=>({ruleId:'rule-'+(index+1),reason:rule.reason,citationId:null})),practice:{id:'reviewed-practice',title:'Reviewed source experiment',states:stateLabels.map(label=>({id:stateId(label),label})),events:eventLabels.map(label=>({id:eventId(label),label})),rules:review.rules.map((rule,index)=>({id:'rule-'+(index+1),fromStateId:stateId(rule.from),eventId:eventId(rule.event),toStateId:stateId(rule.to),enabled:true})),initialStateId:stateId(review.initialState),eventIds:review.eventSequence.map(eventId)},transfer:workflowExample.transfer};
 const result=await createWorkflowArtifact(core,{taskId:value.taskId,requestId:value.requestId,definition,review:{basis:context.artifact,acknowledgement:'reviewed-rules',ruleCitations:review.rules.map((rule,index)=>({ruleId:'rule-'+(index+1),sourceId:rule.sourceId,start:rule.start,end:rule.end,quote:rule.quote,reason:rule.reason,interpretation:rule.interpretation}))}});
 if(result.status!=='completed'||!result.artifactId)throw Error(result.error??'The reviewed workflow could not be created. Open a new review before trying again.');
 const saved=await core.getTask(value.taskId),artifact=saved.artifacts.find(artifact=>artifact.id===result.artifactId)!;
 return {task:saved,artifactId:artifact.id,revision:artifact.revisions.at(-1)!.revision};
}

export async function createContextualReviewedWorkflow(core:Companion,input:unknown):Promise<{task:Task;artifactId:string;revision:number}>{
 let value:typeof creationSchema.Type;
 try{value=Schema.decodeUnknownSync(creationSchema,{onExcessProperty:'error'})(input);}catch{throw Error('Review the current saved document and submit only its quoted rules and experiment choices.');}
 const task=await core.getTask(value.taskId),context=reviewContext(task,value.basis);
 if(value.expectedSourceRefs.length!==context.sourceRefs.length||!value.expectedSourceRefs.every((ref,index)=>{const current=context.sourceRefs[index];return ref.sourceId===current.sourceId&&ref.version===current.version&&ref.digest===current.digest;}))throw Error('The linked source selection changed. Open a new review of the current document.');
 const checked=checkWorkflowReview(context.sources.map(source=>({sourceId:source.ref.sourceId,text:source.version.content})),value.review);
 if(checked.kind==='invalid')throw Error(checked.issues.map(issue=>issue.message).filter((message,index,all)=>all.indexOf(message)===index).slice(0,4).join(' '));
 const review=checked.value,intent=contextualWorkflowIntent({basis:context.artifact,sourceRefs:context.sourceRefs,review}),identity=createHash('sha256').update(serializeLearningDraftJson(intent,'workflow-source-review')).digest('hex');
 const title=('Workflow: '+task.artifacts.find(artifact=>artifact.id===value.basis.artifactId)!.revisions.at(-1)!.title).slice(0,160).replace(/[\uD800-\uDBFF]$/u,'');
 const definition:WorkflowData={kind:'workflow-lab',schemaVersion:1,id:CONTEXTUAL_WORKFLOW_MODULE_PREFIX+identity,version:1,title,basis:{kind:'local-sample',contextDigest:'host-construction'},citations:[],assumptions:[...workflowReviewAssumptions,...review.assumptions.map(assumption=>'User assumption: '+assumption)],ruleOrigins:review.rules.map((rule,index)=>({ruleId:'rule-'+(index+1),reason:rule.reason,citationId:null})),practice:intent.practice,transfer:intent.transfer};
 const result=await createWorkflowArtifact(core,{taskId:value.taskId,requestId:value.requestId,definition,admission:'contextual-sequence-v1',review:{basis:context.artifact,acknowledgement:'reviewed-rules',ruleCitations:review.rules.map((rule,index)=>({ruleId:'rule-'+(index+1),sourceId:rule.sourceId,start:rule.start,end:rule.end,quote:rule.quote,reason:rule.reason,interpretation:rule.interpretation}))}});
 if(result.status!=='completed'||!result.artifactId)throw Error(result.error??'The contextual workflow could not be created. Your raw review is kept.');
 const saved=await core.getTask(value.taskId),artifact=saved.artifacts.find(artifact=>artifact.id===result.artifactId)!;
 return {task:saved,artifactId:artifact.id,revision:artifact.revisions.at(-1)!.revision};
}
