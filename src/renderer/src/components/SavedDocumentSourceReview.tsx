import type {createSavedDocumentDraftController} from '../saved-document-draft-controller';
import {Button} from '../ui';
export function SavedDocumentSourceReview({controller}:{controller:ReturnType<typeof createSavedDocumentDraftController>}){
 const review=controller.snapshot().sourceReview;
 return <Button kind="text" disabled={!review} onClick={()=>{if(review)controller.reviewSources(review);}}>I reviewed them — use current versions</Button>;
}
