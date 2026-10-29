import {Schema} from 'effect';
import {WorkflowCaseSchema,validateWorkflowCase,workflowPathsDiffer,evaluateWorkflowCase,workflowLimits,type WorkflowCase} from './workflow-lab';

export const CONTEXTUAL_WORKFLOW_POLICY='contextual-sequence-v1' as const;
export const CONTEXTUAL_WORKFLOW_MAX_CANDIDATES=512;
type ContextualTransfer=
 | {kind:'ready';policy:typeof CONTEXTUAL_WORKFLOW_POLICY;transfer:WorkflowCase;checkedCandidates:number}
 | {kind:'unsupported';policy:typeof CONTEXTUAL_WORKFLOW_POLICY;code:'no-distinct-supported-case'|'candidate-budget-exhausted';message:string;checkedCandidates:number};

function* conditions(practice:WorkflowCase){
 for(const state of practice.states)yield {initialStateId:state.id,eventIds:practice.eventIds};
 for(let index=0;index<practice.eventIds.length;index++){
  for(const event of practice.events){
   if(event.id===practice.eventIds[index])continue;
   const eventIds=practice.eventIds.map((id,offset)=>offset===index?event.id:id);
   for(const state of practice.states)yield {initialStateId:state.id,eventIds};
  }
 }
}

/** Synthetic challenges first vary a start or one event. If none differs, a single
 * appended event may challenge the learner with a new state transition or blocked event.
 * Rules remain unchanged. Exhaustion does not establish universal equivalence. */
export function deriveContextualWorkflowTransfer(value:unknown,candidateBudget=CONTEXTUAL_WORKFLOW_MAX_CANDIDATES):ContextualTransfer{
 if(!Number.isSafeInteger(candidateBudget)||candidateBudget<1||candidateBudget>CONTEXTUAL_WORKFLOW_MAX_CANDIDATES)throw Error('The contextual challenge budget is unsupported.');
 let practice:WorkflowCase;
 try{practice=Schema.decodeUnknownSync(WorkflowCaseSchema,{onExcessProperty:'error'})(value);validateWorkflowCase(practice);}catch{throw Error('Review a supported finite model before preparing its contextual challenge.');}
 let checkedCandidates=0;
 for(const condition of conditions(practice)){
  if(condition.initialStateId===practice.initialStateId&&condition.eventIds.every((id,index)=>id===practice.eventIds[index]))continue;
  if(checkedCandidates===candidateBudget)return {kind:'unsupported',policy:CONTEXTUAL_WORKFLOW_POLICY,code:'candidate-budget-exhausted',message:'The bounded challenge search stopped before checking all supported starting-state and single-event choices. No challenge was created.',checkedCandidates};
  checkedCandidates++;
  const transfer:WorkflowCase={...structuredClone(practice),id:practice.id==='contextual-transfer'?'contextual-transfer-v1':'contextual-transfer',title:'Unseen start or event challenge',initialStateId:condition.initialStateId,eventIds:[...condition.eventIds]};
  if(workflowPathsDiffer(practice,transfer))return {kind:'ready',policy:CONTEXTUAL_WORKFLOW_POLICY,transfer,checkedCandidates};
 }
 if(practice.eventIds.length<workflowLimits.steps){
  const original=evaluateWorkflowCase(practice);
  for(const event of practice.events){
   if(checkedCandidates===candidateBudget)return {kind:'unsupported',policy:CONTEXTUAL_WORKFLOW_POLICY,code:'candidate-budget-exhausted',message:'The bounded challenge search stopped before checking all supported conditions. No challenge was created.',checkedCandidates};
   checkedCandidates++;
   const transfer:WorkflowCase={...structuredClone(practice),id:practice.id==='contextual-transfer'?'contextual-transfer-v1':'contextual-transfer',title:'Unseen additional event challenge',eventIds:[...practice.eventIds,event.id]};
   const last=evaluateWorkflowCase(transfer).steps.at(-1)!;
   // A repeated no-op does not become a challenge merely because its trace is longer.
   const meaningful=last.fromStateId!==last.toStateId||(last.status==='blocked'&&original.blockedCount===0);
   if(meaningful&&workflowPathsDiffer(practice,transfer))return {kind:'ready',policy:CONTEXTUAL_WORKFLOW_POLICY,transfer,checkedCandidates};
  }
 }
 return {kind:'unsupported',policy:CONTEXTUAL_WORKFLOW_POLICY,code:'no-distinct-supported-case',message:'No structurally distinct starting-state, single-event substitution or meaningful additional-event challenge was found in this finite model. No challenge was created.',checkedCandidates};
}
