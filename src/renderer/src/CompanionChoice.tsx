import {useEffect,useRef,useState,type KeyboardEvent,type CSSProperties} from 'react';
import {CHARACTER_COLORS,type CharacterProfile} from '../../shared/character-catalog';
import {ONBOARDING_SHAPES,pickForMe,botNameOptions} from '../../shared/bot-catalog';
import {BotActor} from './bot-art';
import './onboarding.css';

function move(event:KeyboardEvent<HTMLDivElement>){
 const direction=event.key==='ArrowRight'||event.key==='ArrowDown'?1:event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:0;
 if(!direction&&event.key!=='Home'&&event.key!=='End')return;
 const options=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')),index=options.indexOf(document.activeElement as HTMLButtonElement);
 const next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+direction+options.length)%options.length;
 event.preventDefault();options[next]?.focus();options[next]?.click();
}
export function CompanionChoice({initial,onDraft,onContinue,title='Choose your companion',action='Continue',onCancel}:{initial:CharacterProfile;onDraft?:(profile:CharacterProfile)=>Promise<void>;onContinue:(profile:CharacterProfile)=>Promise<void>;title?:string;action?:string;onCancel?:()=>void}){
 const [value,setValue]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const latest=useRef(initial),queue=useRef(Promise.resolve()),mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 function change(next:CharacterProfile){setValue(next);latest.current=next;setError('');if(onDraft&&(!next.personalName||[...next.personalName].length<=40&&!/[\p{Cc}\p{Cf}]/u.test(next.personalName)))queue.current=queue.current.then(()=>onDraft(next)).catch(()=>{if(mounted.current)setError('Your choice could not be saved yet. Keep this window open and try Continue again.');});}
 async function finish(){if(busy)return;setBusy(true);setError('');try{await queue.current;await onContinue(latest.current);}catch(error){setError(error instanceof Error?error.message:'Your choice could not be saved. Try again.');}finally{if(mounted.current)setBusy(false);}}
 const nameInvalid=!!value.personalName&&([...value.personalName].length>40||/[\p{Cc}\p{Cf}]/u.test(value.personalName));
 const color=CHARACTER_COLORS.find(color=>color.id===value.look.color)!;
 return <section className="companion-choice" aria-label={title} style={{'--choice-accent':color.hex} as CSSProperties}>
  <div className="choice-scroll" onFocusCapture={event=>{if(event.target instanceof HTMLElement)event.target.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});}}><div className="choice-intro"><div><h1>{title}</h1><p>Glint · Pick a shape. Change it anytime.</p></div><button type="button" className="choice-random" disabled={busy} onClick={()=>change(pickForMe(value))}>Pick for me</button></div>
  <div className="choice-shapes" role="radiogroup" aria-label="Companion shape" onKeyDown={move}>{ONBOARDING_SHAPES.map((shape,index)=><button type="button" role="radio" aria-checked={value.look.shape===shape.id} aria-label={botNameOptions(shape.id)[0]} tabIndex={value.look.shape===shape.id?0:-1} key={shape.id} disabled={busy} onClick={()=>change({...value,look:{...value.look,shape:shape.id}})}><span className="choice-check" aria-hidden="true">✓</span><BotActor profile={{...value,look:{...value.look,shape:shape.id}}} selected={value.look.shape===shape.id} seed={index}/><strong>{botNameOptions(shape.id)[0]}</strong></button>)}</div>
  <div className="choice-colors"><div>Color<small>{color.label}</small></div><div role="radiogroup" aria-label="Companion color" onKeyDown={move}>{CHARACTER_COLORS.map(color=><button key={color.id} type="button" role="radio" aria-label={color.label} aria-checked={value.look.color===color.id} tabIndex={value.look.color===color.id?0:-1} disabled={busy} style={{backgroundColor:color.hex}} onClick={()=>change({...value,look:{...value.look,color:color.id}})}><span aria-hidden="true">{value.look.color===color.id?'✓':''}</span></button>)}</div></div>
  <details className="choice-name"><summary>Add a name <span>Optional</span></summary><label>Companion name<input aria-label="Companion name" value={value.personalName??''} maxLength={80} aria-invalid={nameInvalid} aria-describedby="choice-name-help" disabled={busy} placeholder={botNameOptions(value.look.shape).join(' or ')} onChange={event=>change({...value,personalName:event.target.value||null})}/></label><p id="choice-name-help">{nameInvalid?'Use 40 characters or fewer, with no hidden formatting characters.':<>Leave blank for {botNameOptions(value.look.shape).join(' or ')}. You can rename your companion anytime.</>}</p></details>
  </div><footer className="choice-footer">{error&&<p role="alert">{error}</p>}{onCancel&&<button type="button" disabled={busy} onClick={onCancel}>Cancel</button>}<button type="button" className="choice-continue" disabled={busy||nameInvalid} onClick={()=>void finish()}>{busy?'Saving…':action}</button></footer>
 </section>;
}
