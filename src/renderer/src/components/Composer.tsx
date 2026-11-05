import {EXPLAIN_DEPTHS,explainDepthLabel,type ExplainDepth} from '../../../shared/explanation-modes';
import {useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore,type ReactNode,type KeyboardEvent} from 'react';
import {Plus} from 'lucide-react';
import type {ConnectionStatus} from '../../../shared/bridge';
import type {RequestKind} from '../ui';
import {AiInput} from '../vendor/nexvyn/AiInput';
import {composerDomText,formatComposerSelection,type ComposerFormat} from '../composer-formatting';
import './composer-formatting.css';
import {conversationMentionRange,insertConversationMention,type ConversationMention} from '../../../shared/conversation-mentions';
import {ConversationMentions,type MentionControls} from './ConversationMentions';
import {promptCompletion,type ResponsePromptSuggestions} from '../response-prompt-suggestions';
import {promptSuggestionPreference} from '../prompt-suggestion-preference';
import './prompt-suggestions.css';
export function Composer({explainDepth,onExplainDepth,active,idPrefix,value,placeholder,kind,onChange,disabled,connection,running,onRun,onStop,onConfigure,tools,allowModes=true,frozen=false,stopWhileDisabled=false,queueing=false,mentions,suggestions,suggestionsCurrent,secondaryHidden=false}:{
 explainDepth?:ExplainDepth;onExplainDepth?:(depth:ExplainDepth)=>void;
 active:boolean;idPrefix:string;value:string;placeholder?:string;kind:RequestKind;onChange:(change:{text?:string;kind?:RequestKind})=>void;disabled:boolean;frozen?:boolean;stopWhileDisabled?:boolean;queueing?:boolean;connection?:ConnectionStatus;running:boolean;
 mentions?:{taskId:string;ownerTitles?:Readonly<Record<string,string>>;isCurrent:(text:string)=>boolean};
 suggestions?:ResponsePromptSuggestions;suggestionsCurrent?:(basis:ResponsePromptSuggestions,text:string)=>boolean;
 onRun:(prompt:string,kind:RequestKind)=>void;onStop:()=>void;onConfigure:()=>void;tools?:ReactNode;allowModes?:boolean;
 /** Request details are collapsed: formatting tools and the suggestion preference wait behind them (Cmd/Ctrl+L still quotes). */
 secondaryHidden?:boolean;
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
 const preference=useSyncExternalStore(promptSuggestionPreference.subscribe,promptSuggestionPreference.getSnapshot);
 const [preferenceError,setPreferenceError]=useState(''),[dismissed,setDismissed]=useState(''),[caret,setCaret]=useState<{start:number;end:number;focused:boolean}>({start:0,end:0,focused:false});
 const alive=useRef(true),generation=useRef(0),lastState=useRef<unknown[]>([]),latest=useRef({active,disabled,frozen,running,compositionActive,suggestions,suggestionsCurrent,value});
 latest.current={active,disabled,frozen,running,compositionActive,suggestions,suggestionsCurrent,value};
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
 const state=[active,disabled,frozen,running,compositionActive,kind,value,suggestions?.key,suggestions?.responseText,suggestionsCurrent,preference.version,dismissed,caret.start,caret.end,caret.focused];
 if(state.some((item,index)=>item!==lastState.current[index])){generation.current++;lastState.current=state;}
 const offeredGeneration=generation.current,canSuggest=!!suggestions&&preference.enabled&&!formatDisabled&&dismissed!==suggestions.key;
 const offers=canSuggest?suggestions!.prompts.filter(prompt=>promptCompletion(prompt,value,caret.start,caret.end)!==undefined):[];
 const inline=caret.focused?offers[0]:undefined,suffix=inline?promptCompletion(inline,value,caret.start,caret.end):undefined;
 function selection(){const element=input.current;if(element){generation.current++;setCaret({start:element.selectionStart,end:element.selectionEnd,focused:document.activeElement===element});}}
 function accept(prompt:string,keyboard=false){
  const now=latest.current,element=input.current;
  if(!alive.current||generation.current!==offeredGeneration||!canSuggest||!suggestions||!element||element.disabled||!now.active||now.disabled||now.frozen||now.running||now.compositionActive||composing.current||promptSuggestionPreference.getSnapshot()!==preference||now.suggestions?.key!==suggestions.key||now.value!==value||element.value!==composerDomText(value)||!offers.includes(prompt)||now.suggestionsCurrent!==suggestionsCurrent||!now.suggestionsCurrent?.(suggestions,value)||keyboard&&document.activeElement!==element)return false;
  const addition=promptCompletion(prompt,value,element.selectionStart,element.selectionEnd);if(addition===undefined||element.selectionStart!==caret.start||element.selectionEnd!==caret.end)return false;
  generation.current++;pending.current={element,text:value+addition,start:composerDomText(value+addition).length,end:composerDomText(value+addition).length};onChange({text:value+addition});return true;
 }
 function dismiss(){if(generation.current!==offeredGeneration||!canSuggest||!suggestions)return;generation.current++;setDismissed(suggestions.key);}
 function format(action:ComposerFormat){
  const element=input.current;if(formatDisabled||composing.current||!element||element.disabled||element.value!==composerDomText(value))return;
  if(action==='quote'&&element.selectionStart===element.selectionEnd){setFormatNotice('Select some text in your message to quote.');return;}
  let next;try{next=formatComposerSelection(value,element.selectionStart,element.selectionEnd,action);}catch{setFormatNotice('Select whole characters in your message before formatting.');return;}
  if(next.text===value){element.focus();element.setSelectionRange(next.start,next.end);return;}
  pending.current={element,...next};setFormatNotice('');onChange({text:next.text});
 }
 function keyDown(event:KeyboardEvent<HTMLTextAreaElement>){
  if(mentionOpen&&!event.nativeEvent.isComposing&&!composing.current&&!event.altKey&&!event.shiftKey&&!event.metaKey&&!event.ctrlKey){
   if(event.key==='Escape'){event.preventDefault();dismissMention();return;}
   if(event.key==='Enter'){event.preventDefault();mentionControls.current?.choose();return;}
   if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();mentionControls.current?.move(event.key==='ArrowDown'?1:-1);return;}
  }
  if(!mentionOpen&&!event.nativeEvent.isComposing&&!composing.current&&!event.altKey&&!event.shiftKey&&!event.metaKey&&!event.ctrlKey){
   if(event.key==='Tab'&&inline&&accept(inline,true)){event.preventDefault();return;}
   if(event.key==='Escape'&&offers.length){dismiss();event.preventDefault();return;}
  }
  if(event.nativeEvent.isComposing||composing.current||event.altKey||event.shiftKey||(!event.metaKey&&!event.ctrlKey)||event.key.toLowerCase()!=='l')return;
  event.preventDefault();if(!formatDisabled)format('quote');
 }
 return <section className="composer" data-secondary-hidden={secondaryHidden||undefined} onSelect={()=>{mentionSelection();selection();}} onFocusCapture={()=>{mentionSelection();selection();}} onBlurCapture={event=>{if(event.target===input.current){mentionEpoch.current++;setMentionCaret(previous=>previous?{...previous}:previous);}generation.current++;setCaret(previous=>({...previous,focused:false}));}}>
  <details className="composer-formatting" hidden={secondaryHidden}><summary>Format message</summary><div className="composer-formatting-panel" role="group" aria-label="Composer text formatting">
   <button type="button" disabled={formatDisabled} onMouseDown={event=>event.preventDefault()} onClick={()=>format('bullet')}>Bullets</button>
   <button type="button" disabled={formatDisabled} onMouseDown={event=>event.preventDefault()} onClick={()=>format('numbered')}>Numbered list</button>
   <button type="button" disabled={formatDisabled} onMouseDown={event=>event.preventDefault()} onClick={()=>format('indent')}>Indent</button>
   <button type="button" disabled={formatDisabled} onMouseDown={event=>event.preventDefault()} onClick={()=>format('outdent')}>Outdent</button>
   <button type="button" disabled={formatDisabled} aria-keyshortcuts="Meta+L Control+L" onMouseDown={event=>event.preventDefault()} onClick={()=>format('quote')}>Quote selection</button>
   <label><input type="checkbox" checked={spellCheck} disabled={formatDisabled} onChange={event=>setSpellCheck(event.currentTarget.checked)}/>Native spell-check</label>
  </div><p className="tiny">Lists and nesting apply to selected lines. Quote selected text with Cmd/Ctrl+L. Spell-check uses available system dictionaries; this switch turns back on when you reopen the window.</p>{formatNotice&&<p className="tiny" role="status">{formatNotice}</p>}</details>
  <div className="prompt-suggestion-input"><AiInput ref={input} spellCheck={spellCheck} onKeyDown={keyDown}
   onCompositionStart={()=>{mentionEpoch.current++;generation.current++;composing.current=true;setCompositionActive(true);pending.current=undefined;}}
   onCompositionEnd={()=>{composing.current=false;setCompositionActive(false);}}
   className={'nexvyn-composer single-line-composer'+(!allowModes&&!tools?' no-leading-tools':'')} active={active} clearOnSubmit={false} id={idPrefix+'-prompt'} ariaLabel={idPrefix==='revision'?'Ask for a change':idPrefix==='compact'?'Ask companion':'Ask about this task'} value={value} onValueChange={text=>{mentionEpoch.current++;generation.current++;pending.current=undefined;onChange({text});mentionSelection(text);selection();}} onSubmit={text=>{if(!disabled&&!frozen&&connection?.configured)onRun(text,kind);}} streaming={running&&!queueing} onStop={onStop} stopWhileDisabled={stopWhileDisabled&&running} disabled={frozen||disabled&&!running} submitDisabled={disabled||frozen||!connection?.configured} submitLabel={queueing?'Queue follow-up':connection?.configured?'Ask':'Connect to ask'} placeholder={suffix?'':placeholder??(idPrefix==='compact'?'Ask about this window…':'Ask or create something…')} maxRows={idPrefix==='compact'?3:5} startSlot={(allowModes||tools)?<details className="composer-options" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))event.currentTarget.open=false;}}><summary role="button" aria-label="Request options"><Plus size={16}/></summary><div className="composer-context">{tools}<label className="mode"><span className="sr-only">{idPrefix==='compact'?'Window request type':'Request type'}</span><select disabled={disabled||running} aria-label={idPrefix==='compact'?'Window request type':'Request type'} value={kind} onChange={event=>onChange({kind:event.target.value as RequestKind})}><option value="explain">Explain</option><option value="create">Create a draft</option><option value="experiment">Create experiment</option><option value="procedure">Learn procedure</option></select></label>{kind==='explain'&&onExplainDepth&&<label className="explanation-depth">Explanation depth<select aria-label="Explanation depth" value={explainDepth??'quick'} disabled={disabled||running||frozen} onChange={event=>onExplainDepth(event.target.value as ExplainDepth)}>{EXPLAIN_DEPTHS.map(depth=><option key={depth} value={depth}>{explainDepthLabel[depth]}</option>)}</select></label>}{connection?.configured&&<button type="button" className="provider-link" onClick={onConfigure} title={connection.provider==='Meta'?'AI connection: Meta':'AI connection: Codex · Luna'}>{connection.provider==='Meta'?'Meta':'Luna'}</button>}</div></details>:undefined}/>
  </div>
  {mentionOpen&&mentions&&mentionRange&&<ConversationMentions key={mentionKey} taskId={mentions.taskId} ownerTitles={mentions.ownerTitles} value={value} range={mentionRange} isCurrent={text=>mentionAlive.current&&mentionEpoch.current===mentionGeneration&&!formatDisabled&&mentions.isCurrent(text)} onInsert={insertMention} onDismiss={dismissMention} controls={mentionControls}/>}
  {suffix&&<p className="composer-completion" role="status"><kbd>Tab</kbd> adds: <span>{suffix}</span></p>}{suggestions&&<div className={'prompt-suggestions'+(inline?' has-inline':'')}>
   <label hidden={secondaryHidden}><input type="checkbox" checked={preference.enabled} disabled={!active||disabled||frozen||running} onChange={event=>{try{promptSuggestionPreference.set(event.currentTarget.checked);setPreferenceError('');}catch{setPreferenceError('Could not save the follow-up suggestion setting. Try again.');}}}/>Local follow-up suggestions</label>
   {(!preference.available||preferenceError)&&<p role="status" className="tiny">{preferenceError||'The follow-up suggestion setting could not be read. Suggestions are off.'}</p>}
   {offers.length>0&&<><p className="tiny">From your latest saved response. Click to complete your draft{inline?' or press Tab':''}. Nothing is sent.</p><div className="prompt-suggestion-actions">{offers.map(prompt=><button type="button" key={prompt} onMouseDown={event=>event.preventDefault()} onClick={()=>accept(prompt)}>{prompt}</button>)}<button type="button" onMouseDown={event=>event.preventDefault()} onClick={dismiss}>Dismiss suggestions</button></div></>}
  </div>}
  {!connection?.configured&&<p className="connection-hint">{idPrefix==='compact'?<span className="sr-only">Connect an AI service to ask questions. </span>:'Connect an AI service to ask questions. '}<button onClick={onConfigure}>{connection?.provider==='Codex (temporary)'?'Check Codex connection':'Set up Meta'}</button></p>}{queueing&&<button type="button" className="text queue-stop" onClick={onStop}>Stop response</button>}
 </section>;
}
