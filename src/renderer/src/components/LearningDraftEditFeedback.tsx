import type {LearningDraftEditRejection} from '../learning-drafts';
const reasons={
 'too-large':'The complete form is too large.',
 'text-too-long':'A field exceeds the supported text length.',
 'invalid-data':'The change contains unsupported fields or values.',
 'shape-changed':'The change does not match this form’s fields.',
};
/** Only sanitized metadata is presented. The attempted payload is not retained. */
export function LearningDraftEditFeedback({rejection,disabled,onUseAccepted}:{rejection:LearningDraftEditRejection;disabled:boolean;onUseAccepted:()=>void}){
 return <div className="learning-draft-edit-rejection"><p role="alert">This change was not applied. {reasons[rejection.reason]} The shown input is the last accepted value. Shorten or correct it before trying again.</p><button type="button" disabled={disabled} onClick={onUseAccepted}>Use shown accepted values</button></div>;
}
