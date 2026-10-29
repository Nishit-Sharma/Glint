import type {createRevisionInstructionsController} from '../revision-instructions-controller';
import type {createLearningDrafts} from '../learning-drafts';
import {LearningDraftEditFeedback} from './LearningDraftEditFeedback';
export function RevisionInstructionsStatus({controller,cache}:{controller:ReturnType<typeof createRevisionInstructionsController>;cache:ReturnType<typeof createLearningDrafts>}){
 const view=controller.snapshot(),state=cache.getSnapshot(),rejection=cache.getEditRejection(view.owner,view.slot),recovery=view.form.status==='recovery'||view.changed;
 return <div className="learning-draft-status">
  {recovery&&<section role="alert"><p>This document or its linked sources changed. Earlier revision instructions are kept for review and will not run automatically.</p><details><summary>Earlier revision instructions</summary><label>Earlier instructions<textarea readOnly value={view.raw.text}/></label></details></section>}
  {view.frozen?<p role="status">Editing is paused while the app saves before closing. Your revision instructions are kept.</p>:view.form.preparationError?<p role="alert">These revision instructions exceed the supported input or basis limits. No partial input was loaded.</p>:view.message||view.form.error||state.error?<p role={view.operation?'status':'alert'}>{view.message||'Revision instructions could not be saved. Your input is kept; resolve this before closing.'}</p>:view.raw.present?<p role="status">{view.entry?.status==='clean'?'Unsent revision instructions saved on this Mac.':'Saving unsent revision instructions…'}</p>:null}
  {(view.form.error||state.error||view.pendingClear)&&<button type="button" disabled={view.operation||state.frozen||state.maintenance} onClick={()=>void controller.check()}>Check instruction storage</button>}
  {recovery&&<button type="button" disabled={view.operation||state.frozen||state.maintenance||!view.entry?.canDiscard} onClick={()=>void controller.discard(view.entry?.generation)}>Discard earlier revision instructions</button>}
  {rejection&&<LearningDraftEditFeedback rejection={rejection} disabled={state.frozen||state.maintenance} onUseAccepted={()=>cache.dismissEditRejection(view.owner,view.slot,rejection.id)}/>}
 </div>;
}
