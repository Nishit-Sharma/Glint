import {useEffect,useRef,useState} from 'react';
import {ThumbsUp,ThumbsDown} from 'lucide-react';
import {answerRatingKey,readAnswerRatingState,type AnswerRatingSelection,type AnswerRatingState,type AnswerRatingCommand} from '../../../shared/answer-rating';
import {publicErrorMessage} from '../../../shared/public-messages';
import './answer-rating.css';

export function AnswerRating({selection,disabled,isCurrent}:{selection:AnswerRatingSelection;disabled:boolean;isCurrent:()=>boolean}){
 const identity=answerRatingKey(selection),[state,setState]=useState<AnswerRatingState>(),[working,setWorking]=useState(false),[message,setMessage]=useState(''),[needsRead,setNeedsRead]=useState(true);
 const alive=useRef(true),locked=useRef(false),generation=useRef(0),scope=useRef(isCurrent),latest=useRef(identity),loadedFor=useRef<string|undefined>(undefined),mustRead=useRef(true);scope.current=isCurrent;latest.current=identity;
 const current=()=>alive.current&&scope.current()&&latest.current===identity;
 async function act(command:AnswerRatingCommand){
  if(locked.current||disabled||!current()||command.type==='answerRating.set'&&mustRead.current)return;locked.current=true;setWorking(true);setMessage('');if(command.type==='answerRating.set'){mustRead.current=true;setNeedsRead(true);}const token=++generation.current;
  try{const result=readAnswerRatingState(await window.companion.invoke(command));if(!current()||token!==generation.current)return;if(answerRatingKey(result.selection)!==identity)throw Error('The rating response belongs to a different answer.');if(result.kind==='unavailable'){mustRead.current=true;setNeedsRead(true);setMessage(result.message+' Reload this rating before choosing again.');return;}if(command.type==='answerRating.set'&&(result.rating!==command.rating||result.revision<command.expectedRevision))throw Error('The saved rating acknowledgement does not match this choice.');setState(result);mustRead.current=false;setNeedsRead(false);setMessage(command.type==='answerRating.set'?'Private rating saved on this Mac.':result.rating?'Saved private rating loaded.':'This answer has no private rating yet.');}
  catch(error){if(current()&&token===generation.current){mustRead.current=true;setNeedsRead(true);setMessage(publicErrorMessage(error)+' Reload this rating to inspect the saved state before choosing again.');}}
  finally{if(token===generation.current){locked.current=false;if(alive.current)setWorking(false);}}
 }
 useEffect(()=>{const changed=loadedFor.current!==identity;loadedFor.current=identity;alive.current=true;locked.current=false;generation.current++;setWorking(false);if(changed){setState(undefined);setMessage('');mustRead.current=false;setNeedsRead(true);}if(!disabled&&!mustRead.current)void act({type:'answerRating.read',selection});return()=>{alive.current=false;generation.current++;};},[identity,disabled]);
 const available=state?.kind==='available'&&answerRatingKey(state.selection)===identity?state:undefined;
 function rate(rating:'up'|'down'){if(available)void act({type:'answerRating.set',selection,expectedRevision:available.revision,rating});}
 return <section className="answer-rating" aria-label="Private rating for this answer"><span className="tiny">Private rating · this Mac</span><div className="answer-rating-actions" role="group" aria-label="Rate this saved answer">
  <button type="button" aria-pressed={available?.rating==='up'} disabled={disabled||working||needsRead||!available} onClick={()=>rate('up')}><ThumbsUp size={13} aria-hidden="true"/>Helpful</button>
  <button type="button" aria-pressed={available?.rating==='down'} disabled={disabled||working||needsRead||!available} onClick={()=>rate('down')}><ThumbsDown size={13} aria-hidden="true"/>Not helpful</button>
  <button type="button" disabled={disabled||working} onClick={()=>void act({type:'answerRating.read',selection})}>{working?'Checking…':'Reload rating'}</button>
 </div><p role="status" className="tiny">{message}</p></section>;
}
