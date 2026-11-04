import type {Artifact,ArtifactRevision,Task} from '../../core/types';
import {TEACHBACK_MIME,teachbackBody} from '../../shared/explanation-teachback';
import {DOCUMENT_SUGGESTIONS_MIME,documentSuggestions} from '../../shared/document-edit-suggestions';

/** Some model answers are saved as host-owned JSON packets. Conversation surfaces show their readable
 * part instead of the packet; the stored revision is unchanged and opens in its own review. */
export function structuredAnswerText(revision:ArtifactRevision):string|undefined{
 if(revision.mimeType===TEACHBACK_MIME){
  const body=teachbackBody(revision);
  if(!body)return 'This teach-back feedback needs inspection. Its original content is kept.';
  if(!body.feedback)return 'Teach-back feedback is still being prepared.';
  return body.feedback.feedback+(body.feedback.followUp?'\n\nFollow-up question: '+body.feedback.followUp:'');
 }
 if(revision.mimeType===DOCUMENT_SUGGESTIONS_MIME){
  const body=documentSuggestions(revision);
  if(!body)return 'These suggestions need inspection. Their original content is kept.';
  if(body.phase==='pending')return `Suggestions for ${body.target.title} are still being prepared.`;
  const count=body.hunks.length;
  if(!count)return `No changes suggested to ${body.target.title}.`;
  return `${count} suggested ${count===1?'change':'changes'} to ${body.target.title}. Review ${count===1?'it':'them'} in the document.`;
 }
}
/** Where the reader goes next: the teach-back opens its own feedback view (with citations); suggestions are
 * reviewed in their target document, never in the saved suggestions record. */
export function structuredAnswerAction(task:Task,item:Artifact,revision:ArtifactRevision):{label:string;artifact:Artifact}|undefined{
 if(revision.mimeType===TEACHBACK_MIME)return {label:'Open teach-back',artifact:item};
 if(revision.mimeType===DOCUMENT_SUGGESTIONS_MIME){const target=documentSuggestions(revision)?.target.artifactId,artifact=task.artifacts.find(candidate=>candidate.id===target);return artifact?{label:'Review suggestions',artifact}:undefined;}
}
