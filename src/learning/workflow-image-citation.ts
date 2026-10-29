import type {WorkflowCitation} from './workflow-grounding';
type ImageCitation=Extract<WorkflowCitation,{original:unknown}>;
const region=(value:ImageCitation['location'])=>`${value.x}, ${value.y}, ${value.width}, ${value.height}`;
/** One evidence projection for the live view and saved notes, including region-only corrections. */
export function workflowImageCitationText(citation:ImageCitation):string{
 return `Reviewed normalized region: ${region(citation.location)}: “${citation.location.quote}”. Original proposed normalized region: ${region(citation.original)}: “${citation.original.quote}”. Classification: ${citation.classification}. Review: ${citation.reason}`;
}
/** Literal blocks preserve quote bytes when the readable projection is viewed as Markdown. */
export function workflowImageCitationMarkdown(citation:ImageCitation):string{
 return `Reviewed normalized region: ${region(citation.location)}\nReviewed transcription:\n\n\`\`\`window-transcription\n${citation.location.quote}\n\`\`\`\n\nOriginal proposed normalized region: ${region(citation.original)}\nOriginal proposed transcription:\n\n\`\`\`window-transcription\n${citation.original.quote}\n\`\`\`\n\nClassification: ${citation.classification}. Review: ${citation.reason}`;
}
