import {Schema} from 'effect';
import type {Companion} from '../core/companion';
import type {Command} from '../shared/bridge';
import {assertRevisionInstructionRequest} from '../shared/revision-instructions';
import {DOCUMENT_SUGGESTIONS_MIME,documentSuggestions,finishDocumentSuggestions,readDocumentSuggestions,suggestionDocument} from '../shared/document-edit-suggestions';
import type {Task} from '../core/types';

const modelOutput=Schema.Struct({content:Schema.String.pipe(Schema.maxLength(100_000)),evidence:Schema.Array(Schema.Struct({reason:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(2000)),anchors:Schema.Array(Schema.Struct({sourceId:Schema.String,version:Schema.Int,digest:Schema.String,start:Schema.Int.pipe(Schema.nonNegative()),quote:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(4000))})).pipe(Schema.minItems(1),Schema.maxItems(8))})).pipe(Schema.maxItems(1000))});
export async function prepareDocumentSuggestions(core:Companion,task:Task,command:Extract<Command,{type:'model.run'}>,assertCurrent:()=>void){
 if(command.suggestEdits!==true)return;
 if(command.kind!=='revise'||!command.artifactId||!command.revisionBasis||command.canvasContext||command.briefAction||command.submittedDraft||command.conversationAttempt||command.explainDepth||command.explanationBasis)throw Error('Suggestions require exact saved document revision instructions.');
 const target=assertRevisionInstructionRequest(task,command.artifactId,command.revisionBasis,command.sourceIds,command.expectedSourceRefs);
 if(!suggestionDocument(target))throw Error('Suggestions support saved Markdown/plain text documents up to 100,000 characters.');
 const prepared=await core.beginDocumentEditSuggestions({taskId:task.id,artifactId:command.artifactId,basis:command.revisionBasis,requestId:command.requestId,prompt:command.prompt},assertCurrent);
 return {
  request:{taskId:task.id,requestId:command.requestId,kind:'revise',prompt:command.prompt,artifactId:prepared.artifactId,expectedRevision:1,sourceIds:command.sourceIds,expectedSourceRefs:command.expectedSourceRefs,expectedArtifacts:[{artifactId:command.artifactId,revision:target.revision,digest:target.digest}],executionScope:'document-edit-suggestions:v1:'+prepared.artifactId},
  bind(projected:Task){
   // Only the outgoing projection may supply text; a hidden target has no raw fallback.
   const proposal=projected.artifacts.find(item=>item.id===prepared.artifactId)?.revisions.at(-1),pending=proposal&&documentSuggestions(proposal),saved=projected.artifacts.find(item=>item.id===command.artifactId)?.revisions.at(-1);
   if(!pending||pending.phase!=='pending'||!saved||saved.revision!==pending.target.revision||saved.digest!==pending.target.digest||saved.content!==pending.target.content)throw Error('The saved document is unavailable in the selected request context. Review its sources and skill before asking.');
   const sources=pending.sourceRefs.map(ref=>{const source=projected.sources.find(item=>item.id===ref.sourceId),version=source?.versions.at(-1);if(!source||!version||version.kind!=='text'||version.version!==ref.version||version.digest!==ref.digest)throw Error('Evidence-linked corrections require current readable text sources.');return {sourceId:source.id,...version};});
   if(!sources.length)throw Error('Select a linked text source before requesting evidence-linked corrections.');
   return {
    prompt:`${command.prompt}\n\nReturn only JSON {"content":"complete revised document","evidence":[{"reason":"why this change follows from the cited evidence","anchors":[{"sourceId":"exact source ID","version":1,"digest":"exact source digest","start":0,"quote":"exact source excerpt"}]}]}. Evidence must contain one item per changed contiguous line block, in document order, matching an exact line diff of the original document against content. Each item needs a reason and at least one exact, nonempty quote with its UTF-16 start offset from the selected text sources. The quotes support your proposed correction, not verified truth. Keep unchanged text exact. If there is no change, return the original content and empty evidence. Original document:\n${saved.content}\n\nEvidence source identities: ${JSON.stringify(sources.map(({sourceId,version,digest})=>({sourceId,version,digest})))}`,
    finish(content:string){
     if(content.length>1_000_000)throw Error('The correction response exceeds the review limit. The saved document is unchanged.');
     const output=Schema.decodeUnknownSync(modelOutput,{onExcessProperty:'error'})(JSON.parse(content)),finished=finishDocumentSuggestions(pending,output.content);
     if(output.evidence.length!==finished.hunks.length)throw Error('Every proposed change needs its own quoted evidence and reason. The saved document is unchanged.');
     finished.hunks=finished.hunks.map((hunk,index)=>({...hunk,evidence:{reason:output.evidence[index].reason,anchors:output.evidence[index].anchors.map(({sourceId,version,digest,start,quote})=>{const source=sources.find(source=>source.sourceId===sourceId&&source.version===version&&source.digest===digest);if(!source||source.content.slice(start,start+quote.length)!==quote)throw Error('A correction quote does not match its exact selected source. The saved document is unchanged.');return {source:{sourceId,version,digest},start,quote};})}}));
     return {title:'Suggestions for '+saved.title,content:JSON.stringify(readDocumentSuggestions(finished)),mimeType:DOCUMENT_SUGGESTIONS_MIME};
    },
   };
  },
 };
}
