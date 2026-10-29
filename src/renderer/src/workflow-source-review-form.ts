import type {ArtifactRef,SourceRef,Task} from '../../core/types';
import {checkWorkflowReview,workflowReviewLimits,type WorkflowReviewPreparation,type WorkflowReviewRule} from '../../learning/workflow-review';
import {serializeLearningDraftJson} from '../../shared/learning-drafts';

export type WorkflowSourceRaw={rules:{included:boolean;rule:{from:string;event:string;to:string;interpretation:string;reason:string}}[];initialState:string;eventSequence:string[];assumptions:string};
export const workflowSourceReviewSlot='workflow-source:review';
export const workflowSourcePublicationSlot='workflow-source:publication';
export const workflowSourceRawSignature=(raw:unknown)=>serializeLearningDraftJson(raw,'workflow-source-review');
export type WorkflowSourceConfirmation={signature:string;generation:number;scope:string};
/** One live preparation predicate also drives the effect dependency, so a
 * cancelled pre-dispatch wait cannot leave a submit lock waiting for a callback. */
export function workflowSourcePreparationHeld(input:{held:boolean;rejected:boolean;intentReady:boolean;stale:boolean;confirmationScope:string|undefined;continuationScope:string}):boolean{
 return input.held||input.rejected||!input.intentReady||input.stale||input.confirmationScope!==input.continuationScope;
}
/** Read the live cache and ephemeral ref after awaits, before React must render
 * an edit or checkbox change. An edit/undo still advances the generation. */
export function workflowSourceConfirmationCurrent(entry:{generation:number;local:{value:string}|null;error?:string}|undefined,confirmation:WorkflowSourceConfirmation|undefined,expected:{signature:string;generation:number|undefined;scope:string}){
 return expected.generation!==undefined&&!entry?.error&&entry?.generation===expected.generation&&entry.local?.value===expected.signature&&confirmation?.generation===expected.generation&&confirmation.signature===expected.signature&&confirmation.scope===expected.scope;
}
export function advanceWorkflowReviewScope(previous:{identity:string;epoch:number},identity:string){return previous.identity===identity?previous:{identity,epoch:previous.epoch+1};}
export const workflowSourceOwner=(taskId:string,basis:ArtifactRef)=>({kind:'workflow-source-review' as const,taskId,artifactId:basis.artifactId,artifactRevision:basis.revision,artifactDigest:basis.digest});
export const workflowSourceBasis=(basis:ArtifactRef,sourceRefs:readonly SourceRef[])=>serializeLearningDraftJson({form:'literal-workflow-review-v1',basis,sourceRefs});
export function initialWorkflowSourceRaw(prepared:WorkflowReviewPreparation):WorkflowSourceRaw{
 const raw={rules:prepared.passages.map(passage=>({included:!!passage.candidate,rule:{from:passage.candidate?.from??'',event:passage.candidate?.event??'',to:passage.candidate?.to??'',interpretation:passage.candidate?'source-stated':'user-interpreted',reason:passage.candidate?'Literal transition line reviewed against this source quote.':''}})),initialState:'',eventSequence:[''],assumptions:''};
 validateWorkflowSourceRaw(prepared,raw);return raw;
}
/** Validate accepted raw size without normalizing, dropping or trusting evidence fields. */
export function validateWorkflowSourceRaw(prepared:WorkflowReviewPreparation,raw:WorkflowSourceRaw):void{
 workflowSourceRawSignature(raw);
 const keys=(value:object,expected:string)=>Object.keys(value).sort().join(',')===expected;
 if(!keys(raw,'assumptions,eventSequence,initialState,rules')||!Array.isArray(raw.rules)||!Array.isArray(raw.eventSequence)||raw.rules.length!==prepared.passages.length||raw.eventSequence.length<1||raw.eventSequence.length>workflowReviewLimits.steps)throw Error('The review fields no longer match this prepared source.');
 for(const row of raw.rules){if(!keys(row,'included,rule')||!keys(row.rule,'event,from,interpretation,reason,to')||typeof row.included!=='boolean'||!['source-stated','user-interpreted'].includes(row.rule.interpretation)||[row.rule.from,row.rule.event,row.rule.to].some(value=>typeof value!=='string'||value.length>workflowReviewLimits.label)||typeof row.rule.reason!=='string'||row.rule.reason.length>workflowReviewLimits.reason)throw Error('A review field exceeds its displayed limit.');}
 if(typeof raw.initialState!=='string'||raw.initialState.length>workflowReviewLimits.label||raw.eventSequence.some(value=>typeof value!=='string'||value.length>workflowReviewLimits.label)||typeof raw.assumptions!=='string'||raw.assumptions.length>workflowReviewLimits.assumptions*workflowReviewLimits.reason)throw Error('A review field exceeds its displayed limit.');
 workflowSourceRawSignature(raw);
}
export function workflowSourceReview(prepared:WorkflowReviewPreparation,raw:WorkflowSourceRaw,confirmed:boolean){
 validateWorkflowSourceRaw(prepared,raw);
 const rules=raw.rules.flatMap((row,index)=>{const passage=prepared.passages[index];return row.included?[{from:row.rule.from,event:row.rule.event,to:row.rule.to,interpretation:row.rule.interpretation,reason:row.rule.reason,sourceId:passage.sourceId,start:passage.start,end:passage.end,quote:passage.quote}]:[];});
 return checkWorkflowReview(prepared.sources.map(source=>({sourceId:source.ref.sourceId,text:source.text})),{rules,initialState:raw.initialState,eventSequence:raw.eventSequence,assumptions:raw.assumptions.split('\n').map(value=>value.trim()).filter(Boolean),confirmed});
}
export function workflowSourceCurrency(task:Task,owner:string,prepared:Pick<WorkflowReviewPreparation,'basis'|'sourceRefs'>):string|undefined{
 if(task.id!==owner)return 'This review belongs to another task. Return to the document and start a new review.';
 const latest=task.artifacts.find(item=>item.id===prepared.basis.artifactId)?.revisions.at(-1);
 if(!latest||latest.revision!==prepared.basis.revision||latest.digest!==prepared.basis.digest)return 'The saved document changed. Earlier raw review remains in Files → Unfinished practice. Start a new review of the current version.';
 if(latest.sourceRefs.length!==prepared.sourceRefs.length||latest.sourceRefs.some((ref,index)=>{const expected=prepared.sourceRefs[index];return ref.sourceId!==expected.sourceId||ref.version!==expected.version||ref.digest!==expected.digest;}))return 'The document’s source links changed. Earlier raw review remains in Files → Unfinished practice.';
 for(const ref of prepared.sourceRefs){const source=task.sources.find(item=>item.id===ref.sourceId),version=source?.versions.at(-1);if(!source||source.freshness!=='fresh'||source.currentVersion!==ref.version||!version||version.id!==ref.sourceId||version.version!==ref.version||version.digest!==ref.digest||version.kind!=='text'||version.role!=='fact')return 'A linked source changed. Your raw review is kept. Review the document’s current source links before starting a new review.';}
 return undefined;
}
export type WorkflowSourceEditableRule=Omit<WorkflowReviewRule,'sourceId'|'start'|'end'|'quote'>;
