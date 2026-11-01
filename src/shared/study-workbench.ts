import {Schema} from 'effect';
import type {ArtifactRef,SourceRef} from '../core/types';

export const STUDY_SET_MIME='application/vnd.glint.study-set+json';
export const STUDY_LIMITS={notes:100_000,cards:200,answer:4_000,attempts:50} as const;
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200)),text=(n:number)=>Schema.String.pipe(Schema.maxLength(n)),nonempty=(n:number)=>text(n).pipe(Schema.minLength(1)),revision=Schema.Int.pipe(Schema.nonNegative());
const sourceRef=Schema.Struct({sourceId:id,version:Schema.Int.pipe(Schema.positive()),digest:id});
const anchor=Schema.Struct({start:Schema.Int.pipe(Schema.nonNegative()),end:Schema.Int.pipe(Schema.positive()),quote:nonempty(8_000),termStart:Schema.Int.pipe(Schema.nonNegative()),termEnd:Schema.Int.pipe(Schema.positive())});
export const StudyCardSchema=Schema.Struct({id,term:nonempty(200),topic:nonempty(200),question:nonempty(2_000),answer:nonempty(STUDY_LIMITS.answer),hint:text(1_000),anchor});
export type StudyCard=typeof StudyCardSchema.Type;
export const StudySetSchema=Schema.Struct({kind:Schema.Literal('study-set'),schemaVersion:Schema.Literal(1),creationId:id,name:nonempty(200),material:Schema.optional(Schema.Struct({reference:sourceRef,label:nonempty(200),text:text(STUDY_LIMITS.notes)})),cards:Schema.Array(StudyCardSchema).pipe(Schema.maxItems(STUDY_LIMITS.cards))});
export type StudySet=typeof StudySetSchema.Type;
export const readStudySet=(value:unknown):StudySet=>{
 const deck=Schema.decodeUnknownSync(StudySetSchema,{onExcessProperty:'error'})(value);if(!deck.name.trim()||deck.cards.some(card=>![card.term,card.topic,card.question,card.answer].every(field=>field.trim())))throw Error('Study names, questions, answer keys and topics must contain text.');if(new Set(deck.cards.map(card=>card.id)).size!==deck.cards.length)throw Error('Study cards need unique identities.');
 if(deck.cards.length&&!deck.material)throw Error('Choose reviewed source notes before saving study cards.');
 for(const card of deck.cards){const a=card.anchor,notes=deck.material!.text;if(a.start>=a.end||a.end>notes.length||notes.slice(a.start,a.end)!==a.quote||a.termStart<a.start||a.termEnd>a.end||a.termStart>=a.termEnd||notes.slice(a.termStart,a.termEnd)!==card.term)throw Error('A study card source excerpt changed. Review its exact source span.');}
 const keys=new Map<string,string>();for(const card of deck.cards){const key=JSON.stringify([studyAnswerKey(card.topic),studyAnswerKey(card.question)]),answer=studyAnswerKey(card.answer),previous=keys.get(key);if(previous!==undefined&&previous!==answer)throw Error('Conflicting study answer keys need distinct question wording or removal before saving.');keys.set(key,answer);}
 return deck;
};
export type StudyIssue={start:number;end:number;quote:string;reason:string};
/** Finite local extraction, never an AI assessment or general prose understanding. */
export function parseStudyNotes(notes:string):{cards:StudyCard[];issues:StudyIssue[]}{
 if(!notes.trim()||notes.length>STUDY_LIMITS.notes)throw Error('Choose nonempty study notes up to100,000 characters.');
 const cards:StudyCard[]=[],issues:StudyIssue[]=[];let offset=0,topic='Notes';
 for(const raw of notes.split(/(?<=\n)/)){
  const line=raw.replace(/\r?\n$/,''),start=offset;offset+=raw.length;if(!line.trim())continue;
  const heading=/^\s*#{1,6}\s+(.+?)\s*$/.exec(line);if(heading){topic=heading[1].slice(0,200);continue;}
  const clozes=[...line.matchAll(/\{\{(?:c\d+::)?([^{}]+)\}\}/g)];let term:string|undefined,answer:string|undefined,question:string|undefined,termStart=0;
  if(clozes.length===1){const found=clozes[0];answer=found[1].trim();term=answer;question=line.slice(0,found.index)+'_____'+line.slice(found.index!+found[0].length);const prefix=/^\{\{(?:c\d+::)?/.exec(found[0])![0].length;termStart=start+found.index!+prefix+found[1].indexOf(answer);}
  else if(clozes.length>1){issues.push({start,end:start+line.length,quote:line,reason:'Use one cloze per line, or split this line into separate reviewed cards.'});continue;}
  else{
   const definition=/^\s*(?:[-*]\s+)?([^:\n]{1,200}?)\s*(?:::|:|\s[—–]\s|\s=\s)\s+(.+?)\s*$/.exec(line);
   if(definition){term=definition[1].trim();answer=definition[2].trim();question=`What is ${term}?`;termStart=start+line.indexOf(definition[1])+definition[1].indexOf(term);}
  }
  if(!term||!answer||!question){issues.push({start,end:start+line.length,quote:line,reason:'No explicit definition or single cloze found. Edit the source into an explicit definition or one cloze per line, then preview it again.'});continue;}
  if(answer.length>STUDY_LIMITS.answer||question.length>2_000||term.length>200||line.length>8_000){issues.push({start,end:start+line.length,quote:line.slice(0,8_000),reason:'This line exceeds the displayed card limits; split it before creating cards.'});continue;}
  if(cards.length===STUDY_LIMITS.cards){issues.push({start,end:start+line.length,quote:line.slice(0,8_000),reason:'This set reached200 cards. Choose a smaller source section.'});continue;}
  cards.push({id:`card-${start}-${start+line.length}`,term,topic,question,answer,hint:`The keyed answer starts with “${[...answer].slice(0,2).join('')}”.`,anchor:{start,end:start+line.length,quote:line,termStart,termEnd:termStart+term.length}});
 }
 const byQuestion=new Map<string,StudyCard[]>();for(const card of cards){const key=JSON.stringify([studyAnswerKey(card.topic),studyAnswerKey(card.question)]),group=byQuestion.get(key)??[];group.push(card);byQuestion.set(key,group);}
 for(const group of byQuestion.values())if(new Set(group.map(card=>studyAnswerKey(card.answer))).size>1)for(const card of group)issues.push({start:card.anchor.start,end:card.anchor.end,quote:card.anchor.quote,reason:'Ambiguous question: this topic and question have conflicting answer keys. Edit their wording to distinguish them or remove a card before saving.'});
 return {cards,issues};
}
export function studyAnswerKey(value:string){return value.normalize('NFKC').trim().replace(/\s+/gu,' ').toLocaleLowerCase('en-US');}
const deckRef=Schema.Struct({artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest:id});
const response=Schema.Struct({cardId:id,given:text(STUDY_LIMITS.answer),hintUsed:Schema.Boolean});
const result=Schema.Struct({cardId:id,question:nonempty(2_000),topic:nonempty(200),given:text(STUDY_LIMITS.answer),expected:nonempty(STUDY_LIMITS.answer),correct:Schema.Boolean,anchor});
export const StudyAttemptSchema=Schema.Struct({id,deckRef,status:Schema.Literal('answering','completed'),startedAt:id,finishedAt:Schema.optional(id),completedRevision:Schema.optional(Schema.Int.pipe(Schema.positive())),mode:Schema.Literal('diagnostic','review'),questionIds:Schema.Array(id).pipe(Schema.minItems(1),Schema.maxItems(STUDY_LIMITS.cards)),index:Schema.Int.pipe(Schema.between(0,STUDY_LIMITS.cards-1)),responses:Schema.Array(response).pipe(Schema.maxItems(STUDY_LIMITS.cards)),results:Schema.Array(result).pipe(Schema.maxItems(STUDY_LIMITS.cards))}).pipe(Schema.filter(attempt=>attempt.status!=='completed'||attempt.completedRevision!==undefined&&attempt.finishedAt!==undefined));
export type StudyAttempt=typeof StudyAttemptSchema.Type;
export const StudyStateSchema=Schema.Struct({kind:Schema.Literal('study-workbench'),revision,attempts:Schema.Array(StudyAttemptSchema).pipe(Schema.maxItems(STUDY_LIMITS.attempts)),activeAttemptId:Schema.NullOr(id)});
export type StudyState=typeof StudyStateSchema.Type;
export const readStudyState=Schema.decodeUnknownSync(StudyStateSchema,{onExcessProperty:'error'});
export const initialStudyState=():StudyState=>({kind:'study-workbench',revision:0,attempts:[],activeAttemptId:null});
const action=Schema.Union(
 Schema.Struct({kind:Schema.Literal('start'),expectedRevision:revision,attemptId:id,mode:Schema.Literal('diagnostic','review'),questionIds:Schema.Array(id).pipe(Schema.minItems(1),Schema.maxItems(STUDY_LIMITS.cards))}),
 Schema.Struct({kind:Schema.Literal('answer'),expectedRevision:revision,attemptId:id,cardId:id,answer:text(STUDY_LIMITS.answer)}),
 Schema.Struct({kind:Schema.Literal('hint'),expectedRevision:revision,attemptId:id,cardId:id}),
 Schema.Struct({kind:Schema.Literal('navigate'),expectedRevision:revision,attemptId:id,index:Schema.Int.pipe(Schema.between(0,STUDY_LIMITS.cards-1))}),
 Schema.Struct({kind:Schema.Literal('resume'),expectedRevision:revision,attemptId:id,cardId:Schema.optional(id)}),
 Schema.Struct({kind:Schema.Literal('submit'),expectedRevision:revision,attemptId:id}),
);
export type StudyAction=typeof action.Type;
export const readStudyAction=Schema.decodeUnknownSync(action,{onExcessProperty:'error'});
const commands=Schema.Union(
 Schema.Struct({type:Schema.Literal('study.create'),taskId:id,intentId:id}),
 Schema.Struct({type:Schema.Literal('study.preview'),taskId:id,reference:sourceRef}),
 Schema.Struct({type:Schema.Literal('study.save'),taskId:id,artifactId:id,expectedRevision:Schema.Int.pipe(Schema.positive()),name:nonempty(200),reference:sourceRef,cards:Schema.Array(StudyCardSchema).pipe(Schema.minItems(1),Schema.maxItems(STUDY_LIMITS.cards))}),
 Schema.Struct({type:Schema.Literal('study.view'),taskId:id,deckRef}),
 Schema.Struct({type:Schema.Literal('study.action'),taskId:id,deckRef,action}),
);
export type StudyCommand=typeof commands.Type;
export const isStudyCommand=(value:{type:string}):value is StudyCommand=>value.type.startsWith('study.');
export const readStudyCommand=Schema.decodeUnknownSync(commands,{onExcessProperty:'error'});
export type StudyRequestRef={kind:'study-attempt';taskId:string;deckRef:ArtifactRef;attemptId:string};
export type StudySelection={taskId:string;deckRef:ArtifactRef;attemptId:string;cardId?:string};
/** Persisted local study state is the event source. This does not create notifications. */
export type StudyProgressEvent={kind:'needs-input'|'completed';taskId:string;deckRef:ArtifactRef;attemptId:string;requestRef:StudyRequestRef;stateRevision:number;applicable:boolean;blockedReason?:string;summary:string;question?:{cardId:string;sourceRef:SourceRef;anchor:StudyCard['anchor']};score?:{correct:number;total:number};sourceRefs:SourceRef[]};

export const STUDY_PUBLIC_MESSAGES=['Study names, questions, answer keys and topics must contain text.','Conflicting study answer keys need distinct question wording or removal before saving.','Study cards need unique identities.', 'Choose reviewed source notes before saving study cards.', 'A study card source excerpt changed. Review its exact source span.', 'Choose nonempty study notes up to100,000 characters.', 'The study notes changed. Choose and review the current text source.', 'This study-set version changed. Reopen its current saved version.', 'This study history has a different saved-set basis.', 'Save reviewed source cards before starting a study quiz.', 'This study attempt identity already has different questions.', 'Your study progress changed. Reload before continuing this exact attempt.', 'This saved version reached50 attempts. Preserve its history and save a new study-set version.', 'Choose distinct questions from this exact saved study set.', 'This saved study attempt was not found.', 'This attempt is completed. Its original score cannot be changed.', 'This question belongs to a different study attempt.', 'Choose a question in this attempt.', 'Save an answer for every question before submitting.', 'Choose a study-set save action.', 'Resume the owning task before saving study work.', 'The saved study set is unavailable.', 'Choose a study action.', 'Resume the owning task before continuing study.', 'The study owner task changed. Your saved work is kept.', 'The exact saved study question is unavailable. Its target was not replaced.'] as const;
