import {LEARNING_DRAFT_LIMITS,LearningDraftValidationError,serializeLearningDraftJson,type LearningDraftJson} from '../../shared/learning-drafts';
export type NavigationFormIdentity={slot:string;variableArrays?:readonly string[];dispatchFence?:number}&({basisMode:'explicit';basis:string}|{basisMode?:undefined;basis?:string});
/** Explicit mode avoids duplicating initial content; the cache still binds initial bytes and shape separately. Neither mode grants authority. */
export function navigationFormBasis(initial:LearningDraftJson,identity?:NavigationFormIdentity):string{
 if(identity?.basisMode==='explicit'){
  if(typeof identity.basis!=='string'||!identity.basis.trim())throw new LearningDraftValidationError('invalid-data','An explicit form basis requires bounded nonempty identity text.');
  const basis=serializeLearningDraftJson({basis:identity.basis,variableArrays:[...(identity.variableArrays??[])]});
  if(basis.length>LEARNING_DRAFT_LIMITS.basisLength)throw new LearningDraftValidationError('text-too-long','The explicit form basis is too long.');
  return basis;
 }
 return serializeLearningDraftJson({initial,basis:identity?.basis??'',variableArrays:[...(identity?.variableArrays??[])]});
}
