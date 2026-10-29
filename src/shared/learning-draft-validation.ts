export type LearningDraftValidationReason='too-large'|'text-too-long'|'invalid-data'|'shape-changed';
export class LearningDraftValidationError extends Error{
 constructor(readonly reason:LearningDraftValidationReason,message:string){super(message);this.name='LearningDraftValidationError';}
}
export const invalidLearningDraft=(message:string,reason:LearningDraftValidationReason='invalid-data')=>new LearningDraftValidationError(reason,message);
