import type {ArtifactRef,ArtifactRevision,SourceRef,Task} from './types';
import {STUDY_SET_MIME,STUDY_LIMITS,readStudySet,readStudyState,initialStudyState,readStudyAction,studyAnswerKey,type StudyAction,type StudySet,type StudyState,type StudyProgressEvent,type StudyAttempt} from '../shared/study-workbench';

export const STUDY_MODULE_ID='study-workbench';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function studyMaterial(task:Task,reference:SourceRef){
 const source=task.sources.find(source=>source.id===reference.sourceId),version=source?.versions.find(version=>version.version===reference.version&&version.digest===reference.digest);
 if(!source||!version||version.kind!=='text'||source.freshness!=='fresh'||source.currentVersion!==version.version)throw Error('The study notes changed. Choose and review the current text source.');
 return {reference:{...reference},label:version.label,text:version.content};
}
export function studyDeck(task:Task,reference:ArtifactRef,latest=true):{deck:StudySet;revision:ArtifactRevision;state:StudyState}{
 const artifact=task.artifacts.find(item=>item.id===reference.artifactId),revision=artifact?.revisions.find(item=>item.revision===reference.revision&&item.digest===reference.digest);
 if(!artifact||!revision||revision.mimeType!==STUDY_SET_MIME||latest&&artifact.revisions.at(-1)!==revision)throw Error('This study-set version changed. Reopen its current saved version.');
 const deck=readStudySet(JSON.parse(revision.content)),saved=task.session?.moduleStates.find(item=>item.artifactId===reference.artifactId&&item.artifactRevision===reference.revision&&item.moduleId===STUDY_MODULE_ID),state=saved?readStudyState(saved.state):initialStudyState();
 for(const attempt of state.attempts)if(!same(attempt.deckRef,reference))throw Error('This study history has a different saved-set basis.');
 return {deck,revision,state};
}
export function updateStudyState(deck:StudySet,reference:ArtifactRef,previous:StudyState,value:StudyAction,now:string):StudyState{
 const action=readStudyAction(value),state=readStudyState(previous),cards=new Map(deck.cards.map(card=>[card.id,card]));
 if(!deck.material||!cards.size)throw Error('Save reviewed source cards before starting a study quiz.');
 const existing=state.attempts.find(attempt=>attempt.id===action.attemptId);
 if(action.kind==='start'&&existing){if(existing.mode!==action.mode||!same(existing.questionIds,action.questionIds))throw Error('This study attempt identity already has different questions.');return state;}
 if(action.kind==='submit'&&existing?.status==='completed')return state;
 if(state.revision!==action.expectedRevision)throw Error('Your study progress changed. Reload before continuing this exact attempt.');
 let attempts=[...state.attempts],activeAttemptId=state.activeAttemptId;
 if(action.kind==='start'){
  if(attempts.length>=STUDY_LIMITS.attempts)throw Error('This saved version reached50 attempts. Preserve its history and save a new study-set version.');
  if(new Set(action.questionIds).size!==action.questionIds.length||action.questionIds.some(id=>!cards.has(id)))throw Error('Choose distinct questions from this exact saved study set.');
  attempts.push({id:action.attemptId,deckRef:{...reference},status:'answering',mode:action.mode,startedAt:now,questionIds:[...action.questionIds],index:0,responses:[],results:[]});activeAttemptId=action.attemptId;
 }else{
  if(!existing)throw Error('This saved study attempt was not found.');if(existing.status!=='answering')throw Error('This attempt is completed. Its original score cannot be changed.');
  let updated=existing;
  if(action.kind==='resume'){activeAttemptId=existing.id;if(action.cardId){const index=existing.questionIds.indexOf(action.cardId);if(index<0)throw Error('This question belongs to a different study attempt.');updated={...existing,index};}}
  if(action.kind==='navigate'){if(action.index>=existing.questionIds.length)throw Error('Choose a question in this attempt.');updated={...existing,index:action.index};}
  if(action.kind==='answer'||action.kind==='hint'){
   if(!existing.questionIds.includes(action.cardId))throw Error('This question belongs to a different study attempt.');
   const saved=existing.responses.find(response=>response.cardId===action.cardId),response=action.kind==='answer'?{cardId:action.cardId,given:action.answer,hintUsed:saved?.hintUsed??false}:{cardId:action.cardId,given:saved?.given??'',hintUsed:true};
   updated={...existing,responses:[...existing.responses.filter(item=>item.cardId!==action.cardId),response]};
  }
  if(action.kind==='submit'){
   if(existing.questionIds.some(id=>!existing.responses.find(response=>response.cardId===id)?.given.trim()))throw Error('Save an answer for every question before submitting.');
   const results=existing.questionIds.map(id=>{const card=cards.get(id)!,given=existing.responses.find(response=>response.cardId===id)!.given;return {cardId:id,question:card.question,topic:card.topic,given,expected:card.answer,correct:studyAnswerKey(given)===studyAnswerKey(card.answer),anchor:{...card.anchor}};});updated={...existing,results,status:'completed',finishedAt:now,completedRevision:state.revision+1};
  }
  attempts=attempts.map(attempt=>attempt.id===updated.id?updated:attempt);
 }
 return readStudyState({kind:'study-workbench',revision:state.revision+1,attempts,activeAttemptId});
}

export function studyProgress(deck:StudySet,state:StudyState){
 const latest=new Map<string,StudyAttempt['results'][number]>();for(const attempt of [...state.attempts].filter(attempt=>attempt.status==='completed').sort((a,b)=>a.completedRevision!-b.completedRevision!))for(const result of attempt.results)latest.set(result.cardId,result);
 return [...new Set(deck.cards.map(card=>card.topic))].map(topic=>{const cards=deck.cards.filter(card=>card.topic===topic),assessed=cards.filter(card=>latest.has(card.id)),correct=assessed.filter(card=>latest.get(card.id)!.correct).length,review=cards.filter(card=>!latest.get(card.id)?.correct);return {topic,cards:cards.length,assessed:assessed.length,correct,unseen:cards.length-assessed.length,reviewCardIds:review.map(card=>card.id)};});
}
export function studyProgressEvents(task:Task):StudyProgressEvent[]{
 const events:StudyProgressEvent[]=[];
 for(const saved of task.session?.moduleStates??[]){if(saved.moduleId!==STUDY_MODULE_ID)continue;const revision=task.artifacts.find(artifact=>artifact.id===saved.artifactId)?.revisions.find(revision=>revision.revision===saved.artifactRevision);if(!revision||revision.mimeType!==STUDY_SET_MIME)continue;
  try{const reference={artifactId:saved.artifactId,revision:revision.revision,digest:revision.digest},{deck,state}=studyDeck(task,reference,false);if(!deck.material)continue;
   let blockedReason:string|undefined;if(task.status!=='active'||task.archive)blockedReason='Resume the owning task before continuing this saved study attempt.';else if(task.artifacts.find(item=>item.id===reference.artifactId)?.revisions.at(-1)?.digest!==reference.digest)blockedReason='This study set has a newer saved version. The original unanswered question is retained for inspection.';else try{studyMaterial(task,deck.material.reference);}catch{blockedReason='The study source changed. Review this preserved question and explicitly create a fresh study basis.';}
   for(const attempt of state.attempts){const unanswered=attempt.status==='answering'?[attempt.questionIds[attempt.index],...attempt.questionIds].find(id=>!attempt.responses.find(response=>response.cardId===id)?.given.trim()):undefined,card=deck.cards.find(card=>card.id===unanswered);const score=attempt.status==='completed'?{correct:attempt.results.filter(result=>result.correct).length,total:attempt.results.length}:undefined;events.push({kind:score?'completed':'needs-input',taskId:task.id,deckRef:reference,attemptId:attempt.id,requestRef:{kind:'study-attempt',taskId:task.id,deckRef:reference,attemptId:attempt.id},stateRevision:attempt.completedRevision??state.revision,applicable:!blockedReason,...(blockedReason?{blockedReason}:{}),summary:score?`${deck.name}: ${score.correct}/${score.total} keyed answers matched.`:card?`${deck.name}: ${card.question}`:`${deck.name}: All answers are saved; submit this quiz to record its score.`,question:card?{cardId:card.id,sourceRef:{...deck.material.reference},anchor:{...card.anchor}}:undefined,score,sourceRefs:[{...deck.material.reference}]});}
  }catch{/* Preserve unavailable historical records; they are not silently retargeted. */}
 }
 return events;
}
