import {Schema} from 'effect';
import type {ArtifactRef,ArtifactRevision,Task} from '../core/types';
import {EXPLANATION_MIME,readExplanation,explanationSourcesValid,type Explanation} from './explanation-modes';
export const TEACHBACK_MIME='application/vnd.glint.explanation-teachback+json';
export const TEACHBACK_TEXT_REQUIRED='To get teach-back feedback, add a text source and request a new deep explanation linked to it. Your saved answers are kept.';
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
const positive=Schema.Int.pipe(Schema.positive());
const text=(max:number)=>Schema.String.pipe(Schema.minLength(1),Schema.maxLength(max),Schema.filter(value=>!!value.trim()&&!value.includes('\0')));
const ref=Schema.Struct({artifactId:id,revision:positive,digest});
const source=Schema.Struct({sourceId:id,version:positive,digest});
const quote=Schema.Struct({start:Schema.Int.pipe(Schema.nonNegative()),quote:text(2000)});
export const TeachbackInputSchema=Schema.Struct({basis:ref,replyTo:Schema.optional(ref),answer:text(4000)});
export type TeachbackInput=typeof TeachbackInputSchema.Type;
export const readTeachbackInput=Schema.decodeUnknownSync(TeachbackInputSchema,{onExcessProperty:'error'});
const FeedbackSchema=Schema.Struct({learner:quote,explanation:Schema.Struct({...quote.fields,section:Schema.Literal('answer','coreIdea','workedExample','checkAnswer')}),sources:Schema.Array(Schema.Struct({...quote.fields,source})).pipe(Schema.minItems(1),Schema.maxItems(8)),feedback:text(5000),followUp:Schema.optional(text(800))});
export type TeachbackFeedback=typeof FeedbackSchema.Type;
const BodySchema=Schema.Struct({kind:Schema.Literal('explanation-teachback'),schemaVersion:Schema.Literal(1),taskId:id,requestId:id,input:TeachbackInputSchema,question:text(800),turn:Schema.Literal(1,2),phase:Schema.Literal('pending','ready'),feedback:Schema.optional(FeedbackSchema)});
export type TeachbackBody=typeof BodySchema.Type;
export function readTeachbackBody(value:unknown):TeachbackBody{
 const body=Schema.decodeUnknownSync(BodySchema,{onExcessProperty:'error'})(value);
 if((body.turn===2)!==!!body.input.replyTo||(body.phase==='ready')!==!!body.feedback||body.feedback&&(body.turn===1)!==!!body.feedback.followUp)throw Error('The teach-back turn is inconsistent.');
 return body;
}
export function teachbackBody(revision:ArtifactRevision):TeachbackBody|undefined{if(revision.mimeType!==TEACHBACK_MIME)return;try{return readTeachbackBody(JSON.parse(revision.content));}catch{return;}}
export function confirmedTeachback(task:Task,artifactId:string,revision:ArtifactRevision):TeachbackBody|undefined{
 const body=teachbackBody(revision),request=task.requests.find(request=>request.id===body?.requestId);
 return body?.taskId===task.id&&body.phase==='ready'&&request?.status==='completed'&&request.kind==='revise'&&request.prompt===body.input.answer&&request.targetArtifactId===artifactId&&request.expectedRevision===1&&request.answer?.artifactId===artifactId&&request.answer.revision===revision.revision&&request.answer.digest===revision.digest?body:undefined;
}
export function teachbackExplanation(task:Task,basis:ArtifactRef){
 const artifact=task.artifacts.find(item=>item.id===basis.artifactId),revision=artifact?.revisions.at(-1),explanation=revision?.mimeType===EXPLANATION_MIME?readExplanation(revision.content):undefined;
 const sources=revision?.sourceRefs.flatMap(ref=>task.sources.find(source=>source.id===ref.sourceId)?.versions.filter(version=>version.version===ref.version&&version.digest===ref.digest)??[])??[];
 if(!revision||revision.revision!==basis.revision||revision.digest!==basis.digest||!explanation?.deep||!explanationSourcesValid(explanation,revision.sourceRefs,sources)||!task.requests.some(request=>request.status==='completed'&&request.explainDepth==='deep'&&request.answer?.artifactId===basis.artifactId&&request.answer.revision===basis.revision&&request.answer.digest===basis.digest))throw Error('Open the current saved deep explanation before requesting feedback.');
 return {revision,explanation,sources};
}
export function teachbackQuestion(task:Task,input:TeachbackInput){
 const {revision,explanation,sources}=teachbackExplanation(task,input.basis);
 if(!sources.some(source=>source.kind==='text'))throw Error(TEACHBACK_TEXT_REQUIRED);
 let question=explanation.deep!.check.question;
 if(input.replyTo){const parentArtifact=task.artifacts.find(item=>item.id===input.replyTo!.artifactId),parent=parentArtifact?.revisions.at(-1),body=parent&&confirmedTeachback(task,parentArtifact!.id,parent);if(!parent||parent.revision!==input.replyTo.revision||parent.digest!==input.replyTo.digest||body?.turn!==1||JSON.stringify(body.input.basis)!==JSON.stringify(input.basis)||!body.feedback?.followUp)throw Error('Open the exact saved first feedback before answering its follow-up.');question=body.feedback.followUp;}
 return {revision,explanation,sources,question};
}
export const explanationSection=(explanation:Explanation,section:TeachbackFeedback['explanation']['section'])=>section==='answer'?explanation.answer:section==='coreIdea'?explanation.deep!.coreIdea:section==='workedExample'?explanation.deep!.workedExample:explanation.deep!.check.answer;
export function finishTeachback(pending:TeachbackBody,content:string,task:Task):TeachbackBody{
 if(content.length>100_000)throw Error('The feedback response exceeds its review limit.');
 const feedback=Schema.decodeUnknownSync(FeedbackSchema,{onExcessProperty:'error'})(JSON.parse(content)),context=teachbackQuestion(task,pending.input),matches=(text:string,anchor:{start:number;quote:string})=>text.slice(anchor.start,anchor.start+anchor.quote.length)===anchor.quote;
 if(!matches(pending.input.answer,feedback.learner)||!matches(explanationSection(context.explanation,feedback.explanation.section),feedback.explanation)||feedback.sources.some(anchor=>{const version=context.sources.find(source=>source.id===anchor.source.sourceId&&source.version===anchor.source.version&&source.digest===anchor.source.digest);return !version||version.kind!=='text'||!matches(version.content,anchor);}))throw Error('A learner, explanation or source quote did not match its exact saved text.');
 return readTeachbackBody({...pending,phase:'ready',feedback});
}
export const TeachbackOwnerSchema=Schema.Struct({kind:Schema.Literal('explanation-teachback'),taskId:id,artifactId:id,artifactRevision:positive,artifactDigest:digest});
export type TeachbackOwner=typeof TeachbackOwnerSchema.Type;
export const emptyTeachbackDraft={text:'',requestId:''};
const Raw=Schema.Struct({text:Schema.String.pipe(Schema.maxLength(4000)),requestId:Schema.String.pipe(Schema.maxLength(200))});
export const readTeachbackDraft=Schema.decodeUnknownSync(Raw,{onExcessProperty:'error'});
export const teachbackSlot=(replyTo?:ArtifactRef)=>replyTo?'teachback:reply:'+JSON.stringify(replyTo):'teachback:first';
export function teachbackReply(slot:string):ArtifactRef|undefined{if(slot==='teachback:first')return;if(!slot.startsWith('teachback:reply:'))throw Error('Unknown teach-back draft slot.');return Schema.decodeUnknownSync(ref,{onExcessProperty:'error'})(JSON.parse(slot.slice('teachback:reply:'.length)));}
export const teachbackDraftBasis=(owner:TeachbackOwner,slot:string)=>JSON.stringify({basis:JSON.stringify(['explanation-teachback-v1',owner,slot]),variableArrays:[]});
