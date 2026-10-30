import {Schema} from 'effect';
import {LOCAL_HELPER_CONTEXT_NOTICE} from '../core/interactive-modules';

const HistoryReview=Schema.Struct({
 title:Schema.String,goal:Schema.String,
 previousTurns:Schema.Array(Schema.Struct({userRequest:Schema.Struct({text:Schema.String})})),
 checkpoints:Schema.Array(Schema.Struct({note:Schema.String})),
 sourceResume:Schema.optional(Schema.Struct({sources:Schema.Array(Schema.Struct({status:Schema.String})),relatedCheckpoints:Schema.Array(Schema.Struct({note:Schema.String})),omittedRelatedCheckpoints:Schema.Number,affectedProcedures:Schema.optional(Schema.Array(Schema.Struct({currentRevision:Schema.Number,revisions:Schema.Array(Schema.Struct({revision:Schema.Number,omittedSourceRefs:Schema.optional(Schema.Number)})),omittedRevisions:Schema.optional(Schema.Number)}))),omissions:Schema.optional(Schema.Struct({affectedProcedures:Schema.optional(Schema.Number),procedureRevisions:Schema.optional(Schema.Number),procedureSourceRefs:Schema.optional(Schema.Number)}))})),
 savedUserModuleChoices:Schema.Array(Schema.Unknown),unresolvedOperations:Schema.Array(Schema.Unknown),
 omissions:Schema.Struct({olderRequests:Schema.Number,olderCheckpoints:Schema.Number,localHelperContentsExcluded:Schema.optional(Schema.Boolean)}),
});
const line=(text:string,limit:number)=>{const clean=text.replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/g,' ').trim();return clean.length>limit?clean.slice(0,limit)+'…':clean;};

const quantity=(count:number,label:string)=>`${count} ${label}${count===1?'':'s'}`;

/** Describes the host-generated context being shared, without exposing storage syntax in the approval. */
export function taskHistoryReview(context:string):string{
 const history=Schema.decodeUnknownSync(HistoryReview)(JSON.parse(context));
 const count=history.previousTurns.length,choices=history.savedUserModuleChoices.length,notes=history.checkpoints.length,unresolved=history.unresolvedOperations.length;
 const relatedNotes=history.sourceResume?.relatedCheckpoints??[];
 const details=[`Task: “${line(history.title,160)}”.`,...(history.goal?[`Task goal: ${line(history.goal,240)}`]:[])];
 if(history.sourceResume&&(relatedNotes.length||history.sourceResume.sources.some(source=>source.status==='refresh-required'))){details.push(`Source continuity includes ${history.sourceResume.sources.filter(source=>source.status==='refresh-required').length} changed or unverified references and ${relatedNotes.length} related saved notes. Earlier decisions in those notes may be shared.`);if(relatedNotes[0])details.push(`Related saved note: ${line(relatedNotes[0].note,240)}`);}
 const procedures=history.sourceResume?.affectedProcedures??[];
 if(procedures.length){
  const current=procedures.filter(procedure=>procedure.revisions.some(revision=>revision.revision===procedure.currentRevision)).length;
  details.push(`The request includes dependency references from ${quantity(procedures.length,'saved procedure')}; among these summaries, ${quantity(current,'current revision')} ${current===1?'needs':'need'} source review. This shares procedure IDs, procedure revision numbers, source IDs, source version numbers and source digests, including dependencies on sources you did not select for this request. The dependency summary excludes procedure steps and cannot activate or run a procedure.`);
 }
 const omitted=history.sourceResume?.omissions;
 if(omitted?.affectedProcedures||omitted?.procedureRevisions||omitted?.procedureSourceRefs)details.push(`Omitted dependency metadata: ${quantity(omitted.affectedProcedures??0,'entire procedure')}, ${quantity(omitted.procedureRevisions??0,'revision')} and ${quantity(omitted.procedureSourceRefs??0,'source reference')}. Omitted dependencies remain unknown.`);
 if(count||choices||notes||unresolved){
  details.push(`This request also shares this task’s saved conversation and choices (${count} earlier exchanges, ${choices} saved choices, ${notes} notes).`);
  const recent=history.previousTurns.at(-1);if(recent)details.push(`Most recent question: “${line(recent.userRequest.text,200)}”.`);
  const note=history.checkpoints.at(-1);if(note)details.push(`Latest saved note: ${line(note.note,500)}`);
  if(unresolved)details.push(`${unresolved} unfinished actions are included as context. They cannot run from this request.`);
  if(history.omissions.olderRequests||history.omissions.olderCheckpoints)details.push('Some older conversation is omitted. The response must treat missing history as unknown.');
 }
 if(history.omissions.localHelperContentsExcluded)details.push(LOCAL_HELPER_CONTEXT_NOTICE);
 return details.join('\n');
}
