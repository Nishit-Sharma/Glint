import type { WorkflowData } from './workflow-lab';

export const workflowExample: WorkflowData = {
  kind: 'workflow-lab', schemaVersion: 1, id: 'review-workflow-lesson', version: 1,
  title: 'What happens to review after an edit?',
  basis: { kind: 'local-sample', contextDigest: 'review-workflow-sample-v1' },
  assumptions: ['These rules are an illustrative local sample, not an observed organization’s procedure.', 'An absent or disabled rule blocks an event and leaves the current state unchanged.', 'Events are processed one at a time in the displayed order; no external actions execute.'],
  citations: [],
  ruleOrigins: [
    { ruleId: 'draft-submit', reason: 'In this sample, submitting a draft starts review.', citationId: null },
    { ruleId: 'review-approve', reason: 'In this sample, approval during review marks the draft Ready.', citationId: null },
    { ruleId: 'ready-edit', reason: 'The original sample sends an edited Ready document back to Draft.', citationId: null },
    { ruleId: 'draft-edit', reason: 'Editing a Draft leaves it in Draft in this sample.', citationId: null },
    { ruleId: 'review-edit', reason: 'Editing during review restarts the draft in this sample.', citationId: null },
    { ruleId: 'review-changes', reason: 'A request for changes returns this sample to Draft.', citationId: null },
  ],
  practice: {
    id: 'document-review', title: 'Document review sample',
    states: [{ id: 'draft', label: 'Draft' }, { id: 'review', label: 'In review' }, { id: 'ready', label: 'Ready' }],
    events: [{ id: 'submit', label: 'Submit' }, { id: 'approve', label: 'Approve' }, { id: 'edit', label: 'Edit' }, { id: 'request-changes', label: 'Request changes' }],
    rules: [
      { id: 'draft-submit', fromStateId: 'draft', eventId: 'submit', toStateId: 'review', enabled: true },
      { id: 'review-approve', fromStateId: 'review', eventId: 'approve', toStateId: 'ready', enabled: true },
      { id: 'ready-edit', fromStateId: 'ready', eventId: 'edit', toStateId: 'draft', enabled: true },
      { id: 'draft-edit', fromStateId: 'draft', eventId: 'edit', toStateId: 'draft', enabled: true },
      { id: 'review-edit', fromStateId: 'review', eventId: 'edit', toStateId: 'draft', enabled: true },
      { id: 'review-changes', fromStateId: 'review', eventId: 'request-changes', toStateId: 'draft', enabled: true },
    ],
    initialStateId: 'draft', eventIds: ['submit', 'approve', 'edit', 'approve'],
  },
  transfer: {
    id: 'equipment-checkout', title: 'Unseen equipment checkout sample',
    states: [{ id: 'available', label: 'Available' }, { id: 'reserved', label: 'Reserved' }, { id: 'out', label: 'Checked out' }],
    events: [{ id: 'reserve', label: 'Reserve' }, { id: 'collect', label: 'Collect' }, { id: 'cancel', label: 'Cancel' }, { id: 'return', label: 'Return' }],
    rules: [
      { id: 'available-reserve', fromStateId: 'available', eventId: 'reserve', toStateId: 'reserved', enabled: true },
      { id: 'reserved-collect', fromStateId: 'reserved', eventId: 'collect', toStateId: 'out', enabled: true },
      { id: 'reserved-cancel', fromStateId: 'reserved', eventId: 'cancel', toStateId: 'available', enabled: true },
      { id: 'out-return', fromStateId: 'out', eventId: 'return', toStateId: 'available', enabled: true },
    ],
    initialStateId: 'available', eventIds: ['reserve', 'collect', 'cancel', 'return', 'collect'],
  },
};
