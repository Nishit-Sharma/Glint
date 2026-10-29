import type {PickingState} from '../../learning/picking-helper';
import {pickingDigest} from '../../shared/picking-digest';
export type PickingFamily='candidate'|'context'|'recording'|'cases'|'correction'|'run';
export function pickingHelperDraftBasis(state:PickingState,family:PickingFamily):string{
 const definition=state.candidate?pickingDigest(state.candidate.definition):null,context=state.contexts.find(c=>c.id===state.currentContextId);
 const basis=family==='candidate'?[definition,state.candidate?.observationId??null]:family==='context'?[definition,state.currentContextId]:family==='recording'?[state.recording?.id??null]:family==='cases'?[definition,state.observations.map(o=>o.digest),pickingDigest(state.cases)]:family==='correction'?[definition,state.candidate?.currentReason??null,state.corrections.length]:[state.activation,state.currentContextId,context?.target.revision??null];
 return JSON.stringify(['semantic-table-v2',family,basis]);
}
