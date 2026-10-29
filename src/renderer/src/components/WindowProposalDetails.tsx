import type {WindowWorkflowReviewCandidate} from '../../../learning/window-workflow-proposal';
export function WindowProposedName({entry}:{entry:WindowWorkflowReviewCandidate['proposal']['states'][number]}){
 const name=entry.name,citations=name.kind==='transcribed'?[name.citationId]:name.citationIds;
 return <div className="window-proposed-name"><p>Original proposed {entry.id}: {name.kind==='unresolved'?'Unresolved':name.label} ({name.kind})</p>{name.kind!=='transcribed'&&<p>Original reasoning: {name.reason}</p>}<p>Original evidence quote IDs: {citations.join(', ')||'None supplied'}</p></div>;
}
export function WindowProposedInitialState({candidate}:{candidate:WindowWorkflowReviewCandidate}){
 const choice=candidate.proposal.initialState;
 return <section aria-label="Original proposed starting state"><h4>Original proposed starting state</h4><p>{choice.kind==='inferred'?`Proposed starting state: ${choice.stateId} (inferred)`:'The original starting state was unresolved.'}</p><p>Original reasoning: {choice.reason}</p><p>Original evidence quote IDs: {choice.citationIds.join(', ')||'None supplied'}</p><p>This proposal does not choose the local experiment starting state for you.</p></section>;
}
export function WindowQuotedText({text}:{text:string}){return <q className="window-review-quote">{text}</q>;}
