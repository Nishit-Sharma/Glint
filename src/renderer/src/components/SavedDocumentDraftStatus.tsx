import type {createSavedDocumentDraftController} from '../saved-document-draft-controller';
import type {createLearningDrafts} from '../learning-drafts';
import {LearningDraftEditFeedback} from './LearningDraftEditFeedback';
export function SavedDocumentDraftStatus({controller,cache}:{controller:ReturnType<typeof createSavedDocumentDraftController>;cache:ReturnType<typeof createLearningDrafts>}){
 const view=controller.snapshot(),state=cache.getSnapshot(),rejection=cache.getEditRejection(view.owner,view.slot);
 return <div className="learning-draft-status">
  {(view.form.status==='recovery'||view.changed&&!view.operation)&&<section role="alert"><p>This document or its linked sources changed. Your earlier edits are kept for review; they cannot be saved onto the current version automatically.</p><details><summary>Earlier document edits</summary><label>Earlier document title<input readOnly value={view.fields.title}/></label><label>Earlier document content<textarea readOnly value={view.fields.content}/></label></details></section>}
  {view.frozen?<p role="status">Editing is paused while the app saves before closing. Your document edits are kept.</p>:view.form.preparationError?<p role="alert">This document exceeds the supported draft fields or basis limits. No partial draft was loaded.</p>:view.message||view.form.error||state.error?<p role={view.operation?'status':'alert'}>{view.message||'Document edits could not be saved. Your shown input is kept; resolve this before closing.'}</p>:view.raw.present?<p role="status">{view.entry?.status==='clean'?'Unapplied document edits saved on this Mac.':'Saving unapplied document edits…'}</p>:null}
  {(view.form.error||state.error||view.pending)&&<button type="button" disabled={view.operation||state.frozen||state.maintenance} onClick={()=>void controller.check()}>Check document draft storage</button>}
  {rejection&&<LearningDraftEditFeedback rejection={rejection} disabled={state.frozen||state.maintenance} onUseAccepted={()=>cache.dismissEditRejection(view.owner,view.slot,rejection.id)}/>}
 </div>;
}
