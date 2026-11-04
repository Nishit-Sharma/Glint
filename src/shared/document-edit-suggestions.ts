import {Schema} from 'effect';
import {diffLines} from 'diff';
import type {ArtifactRef,ArtifactRevision,Task} from '../core/types';
import {pickingTextDigest} from './picking-digest';
import {sameDocumentRefs} from './saved-document-draft';

export const DOCUMENT_SUGGESTIONS_MIME='application/vnd.glint.document-edit-suggestions+json';
export const SUGGESTION_TEXT_LIMIT=100_000;
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
const positive=Schema.Int.pipe(Schema.positive());
const ref=Schema.Struct({artifactId:id,revision:positive,digest});
const source=Schema.Struct({sourceId:id,version:positive,digest});
const text=Schema.String.pipe(Schema.maxLength(SUGGESTION_TEXT_LIMIT),Schema.filter(value=>!value.includes('\0')));
const anchor=Schema.Struct({source:source,start:Schema.Int.pipe(Schema.nonNegative()),quote:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(4000))});
const evidence=Schema.Struct({reason:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(2000)),anchors:Schema.Array(anchor).pipe(Schema.minItems(1),Schema.maxItems(8))});
const hunk=Schema.mutable(Schema.Struct({start:Schema.Int.pipe(Schema.nonNegative()),remove:text,insert:text,evidence:Schema.optional(evidence)}));
const decision=Schema.Literal('pending','accepted','rejected');
const event=Schema.Struct({intentId:id,commandDigest:digest});
const bodySchema=Schema.mutable(Schema.Struct({
 kind:Schema.Literal('document-edit-suggestions'),schemaVersion:Schema.Literal(1),taskId:id,requestId:id,prompt:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(16000)),basis:Schema.String.pipe(Schema.maxLength(16384)),
 target:Schema.Struct({...ref.fields,title:Schema.String.pipe(Schema.maxLength(500)),mimeType:Schema.Literal('text/plain','text/markdown'),encoding:Schema.optional(Schema.Literal('utf8')),content:text}),sourceRefs:Schema.mutable(Schema.Array(source)).pipe(Schema.maxItems(64)),
 phase:Schema.Literal('pending','ready','closed'),candidate:text,hunks:Schema.mutable(Schema.Array(hunk)).pipe(Schema.maxItems(1000)),decisions:Schema.mutable(Schema.Array(decision)).pipe(Schema.maxItems(1000)),applied:ref,events:Schema.mutable(Schema.Array(event)).pipe(Schema.maxItems(2000)),undo:Schema.optional(Schema.Struct({intentId:id,commandDigest:digest,target:ref,decisions:Schema.Array(decision).pipe(Schema.maxItems(1000))})),
}));
export type DocumentSuggestions=typeof bodySchema.Type;
export type SuggestionHunk=typeof hunk.Type;
const commandSchema=Schema.Struct({type:Schema.Literal('document-suggestions.decide'),taskId:id,proposal:ref,intentId:id,choice:Schema.Literal('accept','reject','accept-all','reject-all','undo'),undoOf:Schema.optional(id),undoTarget:Schema.optional(ref),index:Schema.optional(Schema.Int.pipe(Schema.nonNegative()))});
export type DocumentSuggestionDecision=typeof commandSchema.Type;
export const readDocumentSuggestionDecision=(value:unknown)=>{
 const command=Schema.decodeUnknownSync(commandSchema,{onExcessProperty:'error'})(value);
 if((command.choice==='undo')!==(command.undoOf!==undefined)||(command.choice==='undo')!==(command.undoTarget!==undefined))throw Error('Undo requires the exact saved acceptance receipt.');
 if((command.choice==='accept'||command.choice==='reject')!==(command.index!==undefined))throw Error('Choose one exact suggestion or a remaining-suggestions action.');
 return command;
};
export const suggestionDocument=(value:ArtifactRevision)=>['text/plain','text/markdown'].includes(value.mimeType)&&value.encoding!=='base64'&&value.content.length<=SUGGESTION_TEXT_LIMIT;
export function suggestionText(base:string,hunks:readonly SuggestionHunk[],accepted:readonly boolean[]):string{
 let offset=0,result='';
 for(let index=0;index<hunks.length;index++){
  const item=hunks[index];
  if(item.start<offset||base.slice(item.start,item.start+item.remove.length)!==item.remove||!item.remove&&!item.insert)throw Error('The exact suggestion ranges are invalid.');
  result+=base.slice(offset,item.start)+(accepted[index]?item.insert:item.remove);offset=item.start+item.remove.length;
 }
 return result+base.slice(offset);
}
export function suggestionHunks(before:string,after:string):SuggestionHunk[]{
 if(before.length>SUGGESTION_TEXT_LIMIT||after.length>SUGGESTION_TEXT_LIMIT)throw Error('Suggestions support documents and results up to 100,000 characters. The saved document is unchanged.');
 const parts=diffLines(before,after,{timeout:100,maxEditLength:4000});
 if(!parts)throw Error('These changes exceed the inline review limit. The saved document is unchanged.');
 const hunks:SuggestionHunk[]=[];let offset=0,current:SuggestionHunk|undefined;
 const flush=()=>{if(current){hunks.push(current);current=undefined;}};
 for(const part of parts){
  if(!part.added&&!part.removed){flush();offset+=part.value.length;continue;}
  current??={start:offset,remove:'',insert:''};
  if(part.removed){current.remove+=part.value;offset+=part.value.length;}else current.insert+=part.value;
 }
 flush();
 if(hunks.length>1000||suggestionText(before,hunks,hunks.map(()=>true))!==after)throw Error('The complete changes could not be prepared for exact review. The saved document is unchanged.');
 return hunks;
}
export function readDocumentSuggestions(value:unknown):DocumentSuggestions{
 const body=Schema.decodeUnknownSync(bodySchema,{onExcessProperty:'error'})(value);
 if(body.applied.artifactId!==body.target.artifactId||body.applied.revision<body.target.revision||pickingTextDigest(body.target.content)!==body.target.digest||body.hunks.length!==body.decisions.length||new Set(body.sourceRefs.map(item=>item.sourceId)).size!==body.sourceRefs.length||new Set(body.events.map(item=>item.intentId)).size!==body.events.length)throw Error('Suggestion identity or decisions need review.');
 if(body.undo&&(body.undo.decisions.length!==body.hunks.length||body.undo.target.artifactId!==body.target.artifactId||body.undo.target.revision!==body.applied.revision||body.undo.target.digest!==body.applied.digest||!body.events.some(event=>event.intentId===body.undo!.intentId&&event.commandDigest===body.undo!.commandDigest)))throw Error('The undo receipt does not match its saved acceptance.');
 if(body.hunks.some(hunk=>hunk.evidence?.anchors.some(anchor=>!body.sourceRefs.some(ref=>JSON.stringify(ref)===JSON.stringify(anchor.source)))))throw Error('A correction anchor is outside the frozen source selection.');
 if(body.phase==='pending'&&(body.candidate!==''||body.hunks.length||body.events.length))throw Error('Pending suggestions have no accepted output.');
 if(body.phase!=='pending'&&body.hunks.length&&suggestionText(body.target.content,body.hunks,body.hunks.map(()=>true))!==body.candidate)throw Error('The frozen proposed text does not match its changes.');
 if(body.phase==='ready'&&!body.decisions.includes('pending')||body.phase==='closed'&&body.decisions.includes('pending'))throw Error('Suggestion completion state is invalid.');
 if(pickingTextDigest(suggestionText(body.target.content,body.hunks,body.decisions.map(item=>item==='accepted')))!==body.applied.digest)throw Error('Accepted suggestions do not match the saved result.');
 return body;
}
export function documentSuggestions(revision:ArtifactRevision):DocumentSuggestions|undefined{
 if(revision.mimeType!==DOCUMENT_SUGGESTIONS_MIME)return;
 try{return readDocumentSuggestions(JSON.parse(revision.content));}catch{return;}
}
export function finishDocumentSuggestions(pending:DocumentSuggestions,content:string):DocumentSuggestions{
 const hunks=suggestionHunks(pending.target.content,content);
 return readDocumentSuggestions({...pending,phase:hunks.length?'ready':'closed',candidate:content,hunks,decisions:hunks.map(()=>'pending')});
}
export function confirmedSuggestionResult(task:Task,requestId:string,target:ArtifactRef,prompt:string):boolean{
 const requests=task.requests.filter(item=>item.id===requestId),request=requests.length===1?requests[0]:undefined;
 const artifact=task.artifacts.find(item=>item.id===request?.answer?.artifactId),initial=artifact?.revisions[0],answer=artifact?.revisions.find(item=>item.revision===request?.answer?.revision&&item.digest===request.answer.digest),body=answer&&documentSuggestions(answer);
 return !!(request?.status==='completed'&&request.kind==='revise'&&request.prompt===prompt&&request.targetArtifactId===artifact?.id&&request.expectedRevision===1&&initial&&documentSuggestions(initial)?.phase==='pending'&&request.answer?.revision===2&&body&&body.requestId===requestId&&body.taskId===task.id&&JSON.stringify({artifactId:body.target.artifactId,revision:body.target.revision,digest:body.target.digest})===JSON.stringify(target)&&sameDocumentRefs(body.sourceRefs,request.sourceRefs));
}
export type DocumentSuggestionInspectionCommand={type:'document-suggestions.inspect';decision:DocumentSuggestionDecision};
export type DocumentSuggestionInspection={kind:'applied'|'not-observed'|'unapplied-stale';task:Task;intentId:string;commandDigest:string};
export function readDocumentSuggestionInspectionCommand(value:unknown):DocumentSuggestionInspectionCommand{
 const input=Schema.decodeUnknownSync(Schema.Struct({type:Schema.Literal('document-suggestions.inspect'),decision:commandSchema}),{onExcessProperty:'error'})(value);
 return {type:input.type,decision:readDocumentSuggestionDecision(input.decision)};
}
export function inspectSuggestionDecision(task:Task,command:DocumentSuggestionDecision):DocumentSuggestionInspection{
 const artifact=task.artifacts.find(item=>item.id===command.proposal.artifactId),revision=artifact?.revisions.at(-1),body=revision&&documentSuggestions(revision),commandDigest=pickingTextDigest(JSON.stringify(command));
 if(task.id!==command.taskId||!revision||!body||body.taskId!==task.id)throw Error('The original suggestion review is unavailable. Keep the pending decision.');
 const event=body.events.find(item=>item.intentId===command.intentId);
 if(event&&event.commandDigest!==commandDigest)throw Error('This decision identity belongs to a different action.');
 if(!event&&(revision.revision<command.proposal.revision||revision.revision===command.proposal.revision&&revision.digest!==command.proposal.digest))throw Error('The suggestion history does not match the pending decision.');
 return {kind:event?'applied':revision.revision>command.proposal.revision?'unapplied-stale':'not-observed',task,intentId:command.intentId,commandDigest};
}
export function confirmedSuggestionInspection(result:DocumentSuggestionInspection,command:DocumentSuggestionDecision){
 const expected=inspectSuggestionDecision(result.task,command);
 if(result.kind!==expected.kind||result.intentId!==expected.intentId||result.commandDigest!==expected.commandDigest)throw Error('The decision inspection did not match its original intent.');
 return result;
}
