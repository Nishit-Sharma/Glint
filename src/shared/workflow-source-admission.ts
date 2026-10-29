export const workflowSourceAdmissions=Object.freeze({
 legacy:Object.freeze({mode:'legacy',reviewSlot:'workflow-source:review',publicationSlot:'workflow-source:publication',command:'workflow.review',bindingPrefix:'literal-workflow-review-v1:',heading:'Review workflow rules',createLabel:'Create workflow experiment',reviewLabel:'Workflow rule review',publicationLabel:'Workflow publication attempt'}),
 contextual:Object.freeze({mode:'contextual',reviewSlot:'workflow-source:contextual-review:v1',publicationSlot:'workflow-source:contextual-publication:v1',command:'workflow.contextual.review',bindingPrefix:'contextual-workflow-review-v1:',heading:'Review contextual workflow rules',createLabel:'Create contextual experiment',reviewLabel:'Contextual workflow review',publicationLabel:'Contextual workflow publication attempt'}),
} as const);
export type WorkflowSourceMode=keyof typeof workflowSourceAdmissions;
export const isWorkflowSourceReviewSlot=(slot:string)=>slot===workflowSourceAdmissions.legacy.reviewSlot||slot===workflowSourceAdmissions.contextual.reviewSlot;
export const isWorkflowSourceSlot=(slot:string)=>isWorkflowSourceReviewSlot(slot)||slot===workflowSourceAdmissions.legacy.publicationSlot||slot===workflowSourceAdmissions.contextual.publicationSlot;
export function workflowSourceDraftLabel(slot:string){
 for(const admission of Object.values(workflowSourceAdmissions)){
  if(slot===admission.reviewSlot)return admission.reviewLabel;
  if(slot===admission.publicationSlot)return admission.publicationLabel;
 }
}
