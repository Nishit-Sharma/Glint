import {useEffect,useLayoutEffect,useRef,useState,type ReactNode,type KeyboardEvent} from 'react';
import {Plus} from 'lucide-react';
import type {ConnectionStatus} from '../../../shared/bridge';
import type {RequestKind} from '../ui';
import {AiInput} from '../vendor/nexvyn/AiInput';
import {composerDomText,formatComposerSelection,type ComposerFormat} from '../composer-formatting';
import './composer-formatting.css';
import {conversationMentionRange,insertConversationMention,type ConversationMention} from '../../../shared/conversation-mentions';
import {ConversationMentions,type MentionControls} from './ConversationMentions';
export function Composer({active,idPrefix,value,placeholder,kind,onChange,disabled,connection,running,onRun,onStop,onConfigure,tools,allowModes=true,frozen=false,stopWhileDisabled=false,queueing=false,mentions}:{
 active:boolean;idPrefix:string;value:string;placeholder?:string;kind:RequestKind;onChange:(change:{text?:string;kind?:RequestKind})=>void;disabled:boolean;frozen?:boolean;stopWhileDisabled?:boolean;queueing?:boolean;connection?:ConnectionStatus;running:boolean;
 mentions?:{taskId:string;ownerTitles?:Readonly<Record<string,string>>;isCurrent:(text:string)=>boolean};
 onRun:(prompt:string,kind:RequestKind)=>void;onStop:()=>void;onConfigure:()=>void;tools?:ReactNode;allowModes?:boolean;
}){
 const input=useRef<HTMLTextAreaElement>(null),pending=useRef<{element:HTMLTextAreaElement;text:string;start:number;end:number}|undefined>(undefined),composing=useRef(false),[compositionActive,setCompositionActive]=useState(false),[spellCheck,setSpellCheck]=useState(true),[formatNotice,setFormatNotice]=useState(''),formatDisabled=!active||disabled||frozen||running||compositionActive;
 useLayoutEffect(()=>{
  const restore=pending.current;pending.current=undefined;
  if(!restore||formatDisabled||input.current!==restore.element||value!==restore.text||restore.element.value!==composerDomText(value))return;
  restore.element.focus();restore.element.setSelectionRange(restore.start,restore.end);
 },[value,formatDisabled]);
 const [mentionCaret,setMentionCaret]=useState<{text:string;start:number;end:number}>(),[mentionDismissed,setMentionDismissed]=useState('');
 const mentionControls=useRef<MentionControls|undefined>(undefined),mentionEpoch=useRef(0),mentionAlive=useRef(true),mentionPrevious=useRef<unknown[]>([]);
 const mentionState=[mentions?.taskId,mentions?.isCurrent,value,kind,active,disabled,frozen,running,compositionActive,mentionCaret,mentionDismissed];
 if(mentionState.some((item,index)=>item!==mentionPrevious.current[index])){mentionEpoch.current++;mentionPrevious.current=mentionState;}
 useEffect(()=>{mentionAlive.current=true;return()=>{mentionAlive.current=false;mentionEpoch.current++;};},[]);
 const mentionGeneration=mentionEpoch.current,mentionRange=mentions&&!formatDisabled&&mentionCaret?.text===value?conversationMentionRange(value,mentionCaret.start,mentionCaret.end):undefined;
 const mentionKey=JSON.stringify([mentions?.taskId,value,mentionRange]),mentionOpen=!!mentionRange&&mentionKey!==mentionDismissed;
 function mentionSelection(text=value){const element=input.current;if(!element||document.activeElement!==element)return;mentionEpoch.current++;setMentionCaret({text,start:element.selectionStart,end:element.selectionEnd});}
 function insertMention(reference:ConversationMention){
  const element=input.current;if(!mentionAlive.current||mentionEpoch.current!==mentionGeneration||!mentionOpen||!mentions||!mentionRange||formatDisabled||composing.current||!element||element.disabled||element.value!==composerDomText(value)||element.selectionStart!==mentionRange.caret||element.selectionEnd!==mentionRange.caret||!mentions.isCurrent(value))return false;
  const next=insertConversationMention(value,mentionRange,reference);mentionEpoch.current++;pending.current={element,...next};setMentionDismissed(mentionKey);onChange({text:next.text});return true;
 }
 function dismissMention(){mentionEpoch.current++;setMentionDismissed(mentionKey);}
 function format(action:ComposerFormat){
  const element=input.current;if(formatDisabled||composing.current||!element||element.disabled||element.value!==composerDomText(value))return;
  if(action==='quote'&&element.selectionStart===element.selectionEnd){setFormatNotice('Select composer text to quote.');return;}
  let next;try{next=formatComposerSelection(value,element.selectionStart,element.selectionEnd,action);}catch{setFormatNotice('Select complete characters in the current composer before formatting.');return;}
  if(next.text===value){element.focus();element.setSelectionRange(next.start,next.end);return;}
  pending.current={element,...next};setFormatNotice('');onChange({text:next.text});
 }
 function keyDown(event:KeyboardEvent<HTMLTextAreaElement>){
  if(mentionOpen&&!event.nativeEvent.isComposing&&!composing.current&&!event.altKey&&!event.shiftKey&&!event.metaKey&&!event.ctrlKey){
   if(event.key==='Escape'){event.preventDefault();dismissMention();return;}
   if(event.key==='Enter'){event.preventDefault();mentionControls.current?.choose();return;}
   if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();mentionControls.current?.move(event.key==='ArrowDown'?1:-1);return;}
  }
  if(event.nativeEvent.isComposing||composing.current||event.altKey||event.shiftKey||(!event.metaKey&&!event.ctrlKey)||event.key.toLowerCase()!=='l')return;
  event.preventDefault();if(!formatDisabled)format('quote');
 }
 return <section className="composer" onSelect={()=>mentionSelection()} onFocusCapture={()=>mentionSelection()} onBlurCapture={event=>{if(event.target===input.current){mentionEpoch.current++;setMentionCaret(previous=>previous?{...previous}:previous);}}}>
  <details className="composer-formatting"><summary>Format message</summary><div className="composer-formatting-panel" role="group" aria-label="Composer text formatting">
   <button type="button" disabled={formatDisabled} onMouseDown={event=>event.preventDefault()} onClick={()=>format('bullet')}>Bullets</button>
   <button type="button" disabled={formatDisabled} onMouseDown={event=>event.preventDefault()} onClick={()=>format('numbered')}>Numbered list</button>
   <button type="button" disabled={formatDisabled} onMouseDown={event=>event.preventDefault()} onClick={()=>format('indent')}>Indent</button>
   <button type="button" disabled={formatDisabled} onMouseDown={event=>event.preventDefault()} onClick={()=>format('outdent')}>Outdent</button>
   <button type="button" disabled={formatDisabled} aria-keyshortcuts="Meta+L Control+L" onMouseDown={event=>event.preventDefault()} onClick={()=>format('quote')}>Quote selection</button>
   <label><input type="checkbox" checked={spellCheck} disabled={formatDisabled} onChange={event=>setSpellCheck(event.currentTarget.checked)}/>Native spell-check</label>
  </div><p className="tiny">Lists and nesting apply to selected lines. Quote selected text with Cmd/Ctrl+L. Spell-check uses available system dictionaries; this composer’s switch resets to on when reopened.</p>{formatNotice&&<p className="tiny" role="status">{formatNotice}</p>}</details>
  <AiInput ref={input} spellCheck={spellCheck} onKeyDown={keyDown}
   onCompositionStart={()=>{mentionEpoch.current++;composing.current=true;setCompositionActive(true);pending.current=undefined;}}
   onCompositionEnd={()=>{composing.current=false;setCompositionActive(false);}}
   className={'nexvyn-composer single-line-composer'+(!allowModes&&!tools?' no-leading-tools':'')} active={active} clearOnSubmit={false} id={idPrefix+'-prompt'} ariaLabel={idPrefix==='revision'?'Ask for a change':idPrefix==='compact'?'Ask companion':'Ask about this task'} value={value} onValueChange={text=>{mentionEpoch.current++;pending.current=undefined;onChange({text});mentionSelection(text);}} onSubmit={text=>{if(!disabled&&!frozen&&connection?.configured)onRun(text,kind);}} streaming={running&&!queueing} onStop={onStop} stopWhileDisabled={stopWhileDisabled&&running} disabled={frozen||disabled&&!running} submitDisabled={disabled||frozen||!connection?.configured} submitLabel={queueing?'Queue follow-up':connection?.configured?'Ask':'Connect to ask'} placeholder={placeholder??(idPrefix==='compact'?'Ask about this window…':'Ask or create something…')} maxRows={idPrefix==='compact'?3:5} startSlot={(allowModes||tools)?<details className="composer-options" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))event.currentTarget.open=false;}}><summary role="button" aria-label="Request options"><Plus size={16}/></summary><div className="composer-context">{tools}<label className="mode"><span className="sr-only">{idPrefix==='compact'?'Companion request type':'Request type'}</span><select disabled={disabled||running} aria-label={idPrefix==='compact'?'Companion request type':'Request type'} value={kind} onChange={event=>onChange({kind:event.target.value as RequestKind})}><option value="explain">Explain</option><option value="create">Create a draft</option><option value="experiment">Create experiment</option><option value="procedure">Learn procedure</option></select></label>{connection?.configured&&<button type="button" className="provider-link" onClick={onConfigure} title={connection.provider==='Meta'?'AI connection: Meta':'AI connection: Codex · Luna'}>{connection.provider==='Meta'?'Meta':'Luna'}</button>}</div></details>:undefined}/>
  {mentionOpen&&mentions&&mentionRange&&<ConversationMentions key={mentionKey} taskId={mentions.taskId} ownerTitles={mentions.ownerTitles} value={value} range={mentionRange} isCurrent={text=>mentionAlive.current&&mentionEpoch.current===mentionGeneration&&!formatDisabled&&mentions.isCurrent(text)} onInsert={insertMention} onDismiss={dismissMention} controls={mentionControls}/>}
  {!connection?.configured&&<p className="connection-hint">Connect an AI service to ask questions. <button onClick={onConfigure}>{connection?.provider==='Codex (temporary)'?'Check Codex connection':'Set up Meta'}</button></p>}{queueing&&<button type="button" className="text queue-stop" onClick={onStop}>Stop response</button>}
 </section>;
}
