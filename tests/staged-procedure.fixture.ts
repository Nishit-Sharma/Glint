import type {SemanticExample} from '../src/learning/semantic-procedure';
import {stagedProcedure,stagedProcedureExample} from '../src/renderer/src/staged-semantic-procedure';
export const stagedInput={stock:30,reserved:6,requested:12,approved:true};
export const stagedDefinition=()=>stagedProcedure(stagedProcedureExample());
export function stagedEvidence(recordingId:string,ready='ready'){
 const examples:SemanticExample[]=[
  {id:'another-ready',role:'held-out',input:{stock:24,reserved:3,requested:14,approved:true},expected:{status:'completed',output:{available:21,remaining:7,route:ready}}},
  {id:'review-route',role:'held-out',input:{stock:12,reserved:3,requested:14,approved:true},expected:{status:'completed',output:{available:9,remaining:-5,route:'review'}}},
  {id:'approval',role:'counterexample',input:{...stagedInput,approved:false},expected:{status:'abstained',code:'precondition',haltedStepId:'staged-required-1'}},
  {id:'reservations',role:'exception',input:{...stagedInput,reserved:31},expected:{status:'abstained',code:'explicit-stop',haltedStepId:'stage-2-stop'}},
 ];
 return {rationales:[{id:'checkpoint-reason',kind:'inferred-rationale' as const,stepId:'stage-2',basis:[{recordingId,traceStepId:'stage-2'}],reason:'Review the computed stock before the request and choose a route from the computed remainder.'}],corrections:[],examples};
}
