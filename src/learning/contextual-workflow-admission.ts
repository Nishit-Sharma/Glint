import type {ArtifactRef,SourceRef} from '../core/types';
import type {WorkflowReview} from './workflow-review';
import type {WorkflowCase} from './workflow-lab';
import {deriveContextualWorkflowTransfer,CONTEXTUAL_WORKFLOW_POLICY} from './workflow-contextual-transfer';

export const CONTEXTUAL_WORKFLOW_MODULE_PREFIX='contextual-v1-';
/** Input is a reviewed interpretation; exact source admission remains host-owned. */
export function contextualWorkflowIntent(input:{basis:ArtifactRef;sourceRefs:readonly SourceRef[];review:WorkflowReview}){
 const {review}=input,states=[...new Set(review.rules.flatMap(rule=>[rule.from,rule.to]))],events=[...new Set(review.rules.map(rule=>rule.event))];
 const stateId=(label:string)=>'state-'+(states.indexOf(label)+1),eventId=(label:string)=>'event-'+(events.indexOf(label)+1);
 const practice:WorkflowCase={id:'reviewed-practice',title:'Reviewed source experiment',states:states.map(label=>({id:stateId(label),label})),events:events.map(label=>({id:eventId(label),label})),rules:review.rules.map((rule,index)=>({id:'rule-'+(index+1),fromStateId:stateId(rule.from),eventId:eventId(rule.event),toStateId:stateId(rule.to),enabled:true})),initialStateId:stateId(review.initialState),eventIds:review.eventSequence.map(eventId)};
 const generated=deriveContextualWorkflowTransfer(practice);
 if(generated.kind!=='ready')throw Error(generated.message);
 return {policy:CONTEXTUAL_WORKFLOW_POLICY,basis:input.basis,sourceRefs:input.sourceRefs,review,practice,transfer:generated.transfer};
}
