import {createHash} from 'node:crypto';
import {Schema} from 'effect';
import type {Companion,RequestOutput} from './companion';
import type {ArtifactRef,Task,SourceRef,SessionCommitGuard,ModuleStateRef} from './types';
import {workflowLab,type WorkflowData} from '../learning/workflow-lab';
import {workflowStatus} from '../learning/workflow-grounding';
import {parseModuleAnswer} from './interactive-modules';
import {workflowExample} from '../learning/workflow-example';
import {checkWorkflowReview} from '../learning/workflow-review';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sameRef=(a:SourceRef,b:SourceRef)=>a.sourceId===b.sourceId&&a.version===b.version&&a.digest===b.digest;
const text=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(500));
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const ReviewedRulesSchema=Schema.Struct({acknowledgement:Schema.Literal('reviewed-rules'),ruleCitations:Schema.Array(Schema.Struct({ruleId:id,reason:text,sourceId:id,start:Schema.Int.pipe(Schema.nonNegative()),end:Schema.Int.pipe(Schema.positive()),quote:text,interpretation:Schema.optional(Schema.Literal('source-stated','user-interpreted'))})).pipe(Schema.minItems(1),Schema.maxItems(24))});
type ReviewedRules=typeof ReviewedRulesSchema.Type;
export type WorkflowReview=ReviewedRules & {readonly basis:ArtifactRef};
const SOURCE_SCOPE='Only the explicitly cited transition rules are source-bound. State/event names, the initial state and event sequence are reviewer-supplied modeling choices. Later edits are hypothetical; no real procedure is executed.';

/** No extraction or provider: this admits an explicit reviewed interpretation of exact frozen text. */
export function prepareWorkflowSourceContext(task:Task,basis:ArtifactRef){
 const current=task.artifacts.find(a=>a.id===basis.artifactId)?.revisions.at(-1);
 if(!current||current.revision!==basis.revision||current.digest!==basis.digest)throw Error('The workflow source artifact changed. Review its current revision.');
 if(current.sourceRefs.length<1||current.sourceRefs.length>2||new Set(current.sourceRefs.map(r=>r.sourceId)).size!==current.sourceRefs.length)throw Error('A reviewed workflow needs one or two exact fact-source references.');
 const sources=current.sourceRefs.map(ref=>{
  const source=task.sources.find(s=>s.id===ref.sourceId),version=source?.versions.at(-1);
  if(!source||!version||source.freshness!=='fresh'||source.currentVersion!==ref.version||version.id!==ref.sourceId||version.version!==ref.version||version.digest!==ref.digest)throw Error('A workflow source changed or needs a fresh capture.');
  if(version.kind!=='text'||version.role!=='fact')throw Error('Reviewed workflow rules require explicitly selected text fact sources. No image inference is performed.');
  return {ref,version};
 });
 return {artifact:{...basis},sources,sourceRefs:sources.map(s=>s.ref)};
}
export function localWorkflow(definition:unknown):WorkflowData{
 const data=workflowLab.parse(definition);
 if(data.basis.kind!=='local-sample'||data.citations.length||data.ruleOrigins.some(o=>o.citationId!==null))throw Error('A local sample cannot claim source provenance. Source rules require host review admission.');
 const {basis:_basis,...body}=data;
 return workflowLab.parse({...body,basis:{kind:'local-sample',contextDigest:hash(body)}});
}
export function admitReviewedWorkflow(task:Task,input:{definition:unknown;review:WorkflowReview}):WorkflowData{
 const definition=localWorkflow(input.definition),{basis,...reviewValue}=input.review;
 const review=Schema.decodeUnknownSync(ReviewedRulesSchema,{onExcessProperty:'error'})(reviewValue),context=prepareWorkflowSourceContext(task,basis);
 if(review.ruleCitations.length!==definition.practice.rules.length||new Set(review.ruleCitations.map(r=>r.ruleId)).size!==review.ruleCitations.length)throw Error('Every finite practice rule needs exactly one reviewed source citation.');
 const citations=review.ruleCitations.map((r,index)=>{
  if(!definition.practice.rules.some(rule=>rule.id===r.ruleId))throw Error('A reviewed rule is outside this workflow definition.');
  const source=context.sources.find(s=>s.ref.sourceId===r.sourceId);
  if(!source||r.end<=r.start||r.end>source.version.content.length||source.version.content.slice(r.start,r.end)!==r.quote)throw Error('A rule citation must match the exact selected source characters. Ambiguous or unreadable rules need explicit correction before admission.');
  return {id:'rule-citation-'+(index+1),sourceRef:source.ref,location:{kind:'text-range' as const,start:r.start,end:r.end,quote:r.quote}};
 });
 if(review.ruleCitations.some(citation=>citation.interpretation!==undefined)){
  if(review.ruleCitations.some(citation=>citation.interpretation==='source-stated'&&!definition.practice.rules.find(rule=>rule.id===citation.ruleId)!.enabled))throw Error('A disabled rule is a user interpretation, not a source-stated literal transition.');
  const namedState=(id:string)=>definition.practice.states.find(state=>state.id===id)!.label,namedEvent=(id:string)=>definition.practice.events.find(event=>event.id===id)!.label;
  const checked=checkWorkflowReview(context.sources.map(source=>({sourceId:source.ref.sourceId,text:source.version.content})),{rules:review.ruleCitations.map(citation=>{const rule=definition.practice.rules.find(rule=>rule.id===citation.ruleId)!;return {sourceId:citation.sourceId,start:citation.start,end:citation.end,quote:citation.quote,from:namedState(rule.fromStateId),event:namedEvent(rule.eventId),to:namedState(rule.toStateId),interpretation:citation.interpretation??'user-interpreted',reason:citation.reason};}),initialState:namedState(definition.practice.initialStateId),eventSequence:definition.practice.eventIds.map(namedEvent),assumptions:[],confirmed:true});
  if(checked.kind==='invalid')throw Error(checked.issues.map(issue=>issue.message).filter((message,index,all)=>all.indexOf(message)===index).slice(0,4).join(' '));
 }
 const {basis:_basis,...body}=definition;
 const bound={...body,assumptions:[...body.assumptions,SOURCE_SCOPE],citations,ruleOrigins:review.ruleCitations.map((r,index)=>({ruleId:r.ruleId,reason:r.reason,citationId:citations[index].id,...(r.interpretation?{interpretation:r.interpretation}:{})}))};
 return workflowLab.parse({...bound,basis:{kind:'reviewed-source',taskId:task.id,artifact:context.artifact,sourceRefs:context.sourceRefs,contextDigest:hash({...bound,taskId:task.id,artifact:context.artifact,sourceRefs:context.sourceRefs})}});
}
export function workflowCommitGuard(task:Task,value:unknown,output:ArtifactRef):SessionCommitGuard{
 const data=workflowLab.parse(value),status=workflowStatus(data,task);
 if(status.kind!=='current')throw Error(status.reason);
 const current=task.artifacts.find(a=>a.id===output.artifactId)?.revisions.at(-1);
 if(!current||current.revision!==output.revision||current.digest!==output.digest)throw Error('The workflow experiment artifact changed. Reload it.');
 const refs=data.basis.kind!=='local-sample'?data.basis.sourceRefs:[];
 if(current.sourceRefs.length!==refs.length||!current.sourceRefs.every(r=>refs.some(other=>sameRef(r,other))))throw Error('Workflow output references do not match its admitted source context.');
 return {sourceRefs:[...refs],artifactRefs:[output,...(data.basis.kind==='reviewed-window'?[data.basis.artifact,data.basis.candidate]:data.basis.kind==='reviewed-source'?[data.basis.artifact]:[])]};
}
export async function createWorkflowArtifact(core:Companion,input:{taskId:string;requestId:string;definition:unknown;review?:WorkflowReview;target?:{artifactId:string;expectedRevision:number};admission?:'contextual-sequence-v1'}){
 if(input.review&&input.target?.artifactId===input.review.basis.artifactId)throw Error('The workflow source basis and output must be separate artifacts.');
 const task=await core.getTask(input.taskId),data=input.review?admitReviewedWorkflow(task,{definition:input.definition,review:input.review}):localWorkflow(input.definition);
 const sourceRefs=data.basis.kind!=='local-sample'?data.basis.sourceRefs:[];
 return core.runRequest({taskId:input.taskId,requestId:input.requestId,kind:'experiment',prompt:'Predict, change and inspect a bounded finite workflow model.',executionScope:(input.admission==='contextual-sequence-v1'?'workflow:contextual-sequence-v1:':'workflow:')+hash({data,target:input.target??null}),sourceIds:sourceRefs.map(r=>r.sourceId),expectedSourceRefs:[...sourceRefs],expectedArtifacts:data.basis.kind==='reviewed-window'?[data.basis.artifact,data.basis.candidate]:data.basis.kind==='reviewed-source'?[data.basis.artifact]:[],...(input.target??{})},async current=>{
  const admitted=input.review?admitReviewedWorkflow(current.task,{definition:input.definition,review:input.review}):localWorkflow(input.definition);
  return {title:admitted.title,mimeType:'application/vnd.window-companion.modules+json',content:JSON.stringify({schemaVersion:1,markdown:admitted.basis.kind==='local-sample'?'Illustrative local workflow sample. It does not observe or change a real procedure.':'Explicit reviewed interpretation of cited text rules. The finite event sequence and later changes are local experiments.',modules:[{id:admitted.id,version:admitted.version,data:admitted,provenance:[]}]})};
 });
}
/** Deliberate product entry: the host selects the bundled sample; no source/model inference. */
export function createWorkflowExample(core:Companion,input:{taskId:string;requestId:string}){
 return createWorkflowArtifact(core,{taskId:input.taskId,requestId:input.requestId,definition:workflowExample});
}
/** Only the active stage is projected; unstarted transfer definitions never reach explanations. */
export function workflowExplanationContext(task:Task,ref:ModuleStateRef){
 const artifact=task.artifacts.find(a=>a.id===ref.artifactId),current=artifact?.revisions.at(-1);
 if(!artifact||!current||current.revision!==ref.artifactRevision||current.mimeType!=='application/vnd.window-companion.modules+json')throw Error('The workflow explanation artifact changed.');
 const answer=parseModuleAnswer(JSON.parse(current.content)),module=answer.modules.find(m=>m.id===ref.moduleId);
 if(!module||module.data.kind!=='workflow-lab')throw Error('The workflow experiment is unavailable.');
 const saved=task.session?.moduleStates.find(s=>s.artifactId===ref.artifactId&&s.artifactRevision===ref.artifactRevision&&(s.moduleId===ref.moduleId||(s.moduleId===undefined&&answer.modules.length===1)));
 const state=workflowLab.parseState(module.data,saved?.state??workflowLab.initial(module.data));
 if(state.revision!==ref.stateRevision)throw Error('The workflow observation changed.');
 const guard=workflowCommitGuard(task,module.data,{artifactId:artifact.id,revision:current.revision,digest:current.digest});
 return {identity:{taskId:task.id,...ref,artifactDigest:current.digest,moduleVersion:module.version,contextDigest:module.data.basis.contextDigest,sourceRefs:guard.sourceRefs},guard,observation:workflowLab.observe(module.data,state)};
}
export async function explainWorkflow(core:Companion,input:{taskId:string;requestId:string;observation:ModuleStateRef},runner:(context:ReturnType<typeof workflowExplanationContext>,signal:AbortSignal)=>Promise<RequestOutput>){
 const context=workflowExplanationContext(await core.getTask(input.taskId),input.observation);
 return core.runRequest({taskId:input.taskId,requestId:input.requestId,kind:'explain',prompt:'Explain only the finite workflow observation and its explicit assumptions.',executionScope:'workflow-observation:'+hash(context),sourceIds:context.guard.sourceRefs.map(r=>r.sourceId),expectedSourceRefs:context.guard.sourceRefs,expectedArtifacts:context.guard.artifactRefs,expectedModuleStates:[input.observation]},async request=>runner(workflowExplanationContext(request.task,input.observation),request.signal));
}
