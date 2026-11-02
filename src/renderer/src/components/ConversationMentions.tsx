import {useEffect,useRef,useState,type MutableRefObject} from 'react';
import {readBotState} from '../../../shared/bot-catalog';
import {readRecurringWorkView} from '../../../shared/recurring-work';
import type {InstructionSkillCatalog} from '../../../shared/instruction-skill';
import {availableConversationMentions,conversationMentionToken,validateConversationMentions,type ConversationMention,type MentionRange} from '../../../shared/conversation-mentions';
import './conversation-mentions.css';
export type MentionControls={move:(direction:number)=>void;choose:()=>void};
type Props={taskId:string;ownerTitles?:Readonly<Record<string,string>>;value:string;range:MentionRange;isCurrent:(text:string)=>boolean;onInsert:(ref:ConversationMention)=>boolean;onDismiss:()=>void;controls:MutableRefObject<MentionControls|undefined>};
/** Read-only directories. Selecting a reference never selects or runs its entity. */
export function ConversationMentions(props:Props){
 const [entries,setEntries]=useState<ConversationMention[]>([]),[loading,setLoading]=useState(true),[working,setWorking]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState(0);
 const generation=useRef(0),alive=useRef(true),locked=useRef(false),latest=useRef(props);latest.current=props;
 const basis=JSON.stringify([props.taskId,props.value,props.range]);
 async function directory(){const [bots,routines,skills]=await Promise.all([window.companion.invoke({type:'bots.get'}),window.companion.invoke({type:'schedules.get'}),window.companion.invoke<InstructionSkillCatalog>({type:'skills.list',taskId:props.taskId})]);return {bots:readBotState(bots),routines:readRecurringWorkView(routines).items,skills:skills.entries};}
 useEffect(()=>{alive.current=true;const epoch=++generation.current;locked.current=false;setLoading(true);setError('');setEntries([]);setSelected(0);void directory().then(result=>{if(alive.current&&generation.current===epoch&&latest.current.isCurrent(props.value)){setEntries(availableConversationMentions(result));setLoading(false);}}).catch(()=>{if(alive.current&&generation.current===epoch){setError('Saved mention choices could not be loaded. Close this list and type @ again.');setLoading(false);}});return()=>{alive.current=false;generation.current++;};},[basis]);
 const matches=entries.filter(entry=>entry.name.toLocaleLowerCase().includes(props.range.query.toLocaleLowerCase())),index=Math.min(selected,Math.max(0,matches.length-1)),renderGeneration=generation.current;
 async function choose(ref:ConversationMention){
  if(locked.current||loading||working||!alive.current||generation.current!==renderGeneration||!props.isCurrent(props.value))return;
  locked.current=true;setWorking(true);setError('');const epoch=generation.current;
  try{const current=await directory();if(!alive.current||epoch!==generation.current||!latest.current.isCurrent(props.value))return;validateConversationMentions([ref],current);if(!latest.current.onInsert(ref))setError('The message or caret changed. Close this list and type @ again.');}catch{if(alive.current&&epoch===generation.current)setError('This exact named entity changed or is unavailable. Close this list and choose it again.');}finally{if(epoch===generation.current){locked.current=false;setWorking(false);}}
 }
 props.controls.current={move:direction=>{if(!loading&&!working&&matches.length)setSelected((index+direction+matches.length)%matches.length);},choose:()=>{if(matches[index])void choose(matches[index]);}};
 return <section className="conversation-mentions" aria-label="Mention a saved entity" aria-busy={loading||working}>
  <p className="tiny">Reference a saved bot, enabled routine or skill. This does not run it, change the responding bot or include skill instructions. Use ↑/↓ then Enter, or choose below. Tab keeps moving focus; Escape closes.</p>
  {loading&&<p role="status">Loading saved mention choices…</p>}{error&&<p role="alert">{error}</p>}
  {!loading&&!error&&matches.length===0&&<p role="status">No matching available saved entities.</p>}
  <div role="group" aria-label="Available named references">{matches.map((entry,i)=><button key={conversationMentionToken(entry)} type="button" disabled={loading||working} aria-pressed={i===index} onMouseDown={event=>event.preventDefault()} onClick={()=>void choose(entry)}><span>{entry.name}</span><small>{entry.kind==='routine'?'Scheduled routine':entry.kind==='skill'?'Instruction skill':'Bot'} · saved revision {entry.revision} · {entry.kind==='skill'?`Task ${props.ownerTitles?.[entry.ownerTaskId]??entry.ownerTaskId} · file ${entry.artifactId}`:`ID ${entry.id}`}</small></button>)}</div>
  <button type="button" className="text" disabled={working} onClick={props.onDismiss}>Close mentions</button>
 </section>;
}
