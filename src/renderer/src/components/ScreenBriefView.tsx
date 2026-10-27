import {useId,useRef,useState,type ReactNode} from 'react';
import {ArrowUpRight,ChevronDown,Layers,Monitor} from 'lucide-react';
import type {ScreenBrief,ScreenBriefAction} from '../../../core/screen-brief';
import type {SourceRef} from '../../../core/types';
import type {WindowChoice} from '../../../shared/bridge';
import {publicErrorMessage} from '../../../shared/public-messages';
import {ReadableText} from './ReadableText';
import {TaskMenu} from './TaskMenu';
import './context-view.css';

export interface ScreenBriefViewProps {
 brief:ScreenBrief;
 sourceNames:Readonly<Record<string,string>>;
 /** The frozen brief's references, including when there are no suggested actions. */
 sourceRefs?:readonly SourceRef[];
 stale:boolean;
 busy:boolean;
 onAction:(action:ScreenBriefAction)=>void;
 /** The parent resolves this ID against the brief's frozen references, not current source versions. */
 onSource:(sourceId:string)=>void;
 /** Lets the presentation owner wrap only newly arrived non-text actions. */
 renderActions?:(content:ReactNode)=>ReactNode;
 renderAction?:(content:ReactNode,index:number)=>ReactNode;
 renderQuestions?:(content:ReactNode)=>ReactNode;
 onSaveDocument?:()=>Promise<void>;
 compact?:boolean;
 onRefresh?:()=>void;
 refreshWindow?:boolean;
}

export function ScreenBriefView({brief,sourceNames,sourceRefs,stale,busy,onAction,onSource,onRefresh,refreshWindow=false,renderActions,renderAction,renderQuestions,onSaveDocument,compact=false}:ScreenBriefViewProps){
 const id=useId(),[detailOpen,setDetailOpen]=useState(false),saving=useRef(false);
 const references=[...new Map((sourceRefs??[...brief.actions.flatMap(action=>action.sourceRefs),...(brief.questions??[]).flatMap(question=>question.sourceRefs)]).map(ref=>[ref.sourceId,ref])).values()];
 const sourceName=(sourceId:string)=>sourceNames[sourceId]||'Captured source';
 const actions=brief.actions.length>0?<ol className="screen-brief-actions" aria-label="Suggested next steps">{brief.actions.map((action,index)=>{const row=<button type="button" className="screen-brief-action" title={action.outcome} disabled={stale||busy} aria-label={action.label} aria-describedby={`${id}-outcome-${index}`} onClick={()=>{if(!stale&&!busy)onAction(action);}}><span>{action.label}</span><ArrowUpRight size={13} aria-hidden="true"/><span className="sr-only" id={`${id}-outcome-${index}`}>{action.outcome}</span></button>;return <li key={index}>{renderAction?renderAction(row,index):row}</li>;})}</ol>:null;
 const questions=brief.questions?.length?<div className="brief-questions" role="group" aria-label="Questions about this source">{brief.questions.map((question,index)=><details key={index}><summary><span>{question.question}</span><ChevronDown size={14} aria-hidden="true"/></summary><div className="brief-question-answer"><ReadableText text={question.answer}/>{question.sourceRefs.map(ref=><button type="button" className="screen-brief-source-link" key={ref.sourceId} aria-label={`Review ${sourceName(ref.sourceId)}, version ${ref.version}, for ${question.question}`} onClick={()=>onSource(ref.sourceId)}><Layers size={12} aria-hidden="true"/>{sourceName(ref.sourceId)}</button>)}</div></details>)}</div>:null;
 return <section className="context-view screen-brief" data-compact={compact||undefined} aria-label="Screen brief">
  <div className="brief-message"><div className="screen-brief-insight" id={`${id}-insight`}><ReadableText text={brief.insight}/></div>
  <div className="brief-message-meta">{references.map(ref=><button type="button" className="screen-brief-source-link" key={ref.sourceId} aria-label={`Review ${sourceName(ref.sourceId)}, version ${ref.version}`} onClick={()=>onSource(ref.sourceId)}><Layers size={12} aria-hidden="true"/>{sourceName(ref.sourceId)}</button>)}{(brief.detail||onSaveDocument&&questions)&&<TaskMenu label="Message options">{brief.detail&&<button type="button" onClick={()=>setDetailOpen(!detailOpen)}>{detailOpen?'Hide details':'Show details'}</button>}{onSaveDocument&&questions&&<button type="button" disabled={stale||busy} onClick={async()=>{if(saving.current||stale||busy)return;saving.current=true;try{await onSaveDocument();}finally{saving.current=false;}}}>Save answers as document</button>}</TaskMenu>}</div>{stale&&<div className="brief-recovery"><p role="status">{refreshWindow?'Earlier snapshot. Read again for current next steps.':'Earlier context. Review updated sources before continuing.'}</p>{onRefresh&&<button type="button" disabled={busy} onClick={onRefresh}>{refreshWindow?'Refresh this window':'Review sources'}</button>}</div>}{detailOpen&&brief.detail&&<div className="insight-detail"><ReadableText text={brief.detail}/></div>}</div>

  {questions&&(renderQuestions?renderQuestions(questions):questions)}

  {actions&&(stale?<details className="earlier-suggestions"><summary>Earlier suggestions</summary>{renderActions?renderActions(actions):actions}</details>:(renderActions?renderActions(actions):actions))}
 </section>;
}

export type ContextIntakeStatus='selecting'|'choose'|'capturing'|'captured'|'reading'|'unavailable'|'cancelled'|'error'|'no-room';
export type ContextIntakeTarget=Pick<WindowChoice,'id'|'title'|'owner'>;
export interface ContextIntakeProps {
 status:ContextIntakeStatus;
 target?:ContextIntakeTarget;
 choices:readonly WindowChoice[];
 /** Raw failures are converted by the existing public-message formatter. */
 error?:string;
 busy?:boolean;
 onChoose:(choice:WindowChoice)=>void;
 onRetry:()=>void;
 onCancel:()=>void;
 onSettings:()=>void;
 onOpenApp?:()=>void;
}

export function ContextIntake({status,target,choices,error,busy=false,onChoose,onRetry,onCancel,onSettings,onOpenApp}:ContextIntakeProps){
 const id=useId();
 const messages:Record<Exclude<ContextIntakeStatus,'choose'>,{title:string;description:string}>={
  selecting:{title:'Selecting this window…',description:'Choose the context before continuing.'},
  capturing:{title:'Waiting for capture…',description:'The selected window has not been analyzed yet.'},
  captured:{title:'Snapshot captured',description:'Review the analysis request before this snapshot is sent.'},
  reading:{title:'Reading this snapshot…',description:'Useful text will appear as it arrives.'},
  unavailable:{title:'Not analyzed yet',description:'The AI connection is unavailable. Connect a service, then try again.'},
  cancelled:{title:'Context review cancelled',description:'Try again when you’re ready to continue.'},
  error:{title:target?'Couldn’t read this window':'Couldn’t open screen context',description:'Try again to choose a window and continue.'},
  'no-room':{title:'No space beside this window',description:'Keep the small anchor, or open a separate app window. The app window may cover part of your source. Nothing has been captured or analyzed.'}
 };
 const message=status==='choose'?undefined:messages[status];
 const canRetry=status==='unavailable'||status==='cancelled'||status==='error'||(status==='choose'&&choices.length===0);
 return <section className="context-view context-intake" aria-label="Screen context">
  {target&&status!=='choose'&&<div className="context-intake-target"><Monitor size={15} aria-hidden="true"/><span><strong>{target.title||target.owner.name}</strong><span>{target.owner.name}</span></span></div>}
  {status==='choose'?<>
   <div className="context-intake-message"><h2 id={`${id}-heading`}>Which window?</h2>{!choices.length&&<p>Open the window you want to inspect, then try again.</p>}</div>
   {choices.length>0&&<div className="context-window-choices" role="group" aria-label="Window to inspect">{choices.map(choice=><button type="button" className="context-window-choice" key={choice.id} disabled={busy} onClick={()=>onChoose(choice)}><span><strong>{choice.title||choice.owner.name}</strong><span>{choice.owner.name}</span></span><ArrowUpRight size={14} aria-hidden="true"/></button>)}</div>}

  </>:<div className="context-intake-message" role={status==='error'?'alert':'status'}><h2>{message!.title}</h2>{(error||['unavailable','cancelled','error','no-room'].includes(status))&&<p>{error?publicErrorMessage(error):message!.description}</p>}</div>}
  <div className="context-intake-actions">
   <button type="button" className="context-intake-cancel" onClick={onCancel}>{status==='reading'?'Stop':'Cancel'}</button>
   {status==='unavailable'&&<button type="button" className="primary" disabled={busy} onClick={onSettings}>Connections</button>}
   {status==='no-room'&&onOpenApp&&<button type="button" className="primary" disabled={busy} onClick={onOpenApp}>Open app instead</button>}
   {canRetry&&<button type="button" className="context-intake-retry" disabled={busy} onClick={onRetry}>Try again<ArrowUpRight size={14} aria-hidden="true"/></button>}
  </div>
 </section>;
}
