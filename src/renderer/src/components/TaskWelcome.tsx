import {useId,type ReactNode} from 'react';
import {Layers} from 'lucide-react';
import type {SourceRef,Task} from '../../../core/types';
import {savedSourceSummary} from './task-preview';
import './task-welcome.css';

type WelcomeTask=Pick<Task,'sources'|'requests'|'artifacts'|'procedures'>;

/** The welcome is only for a task with no conversation yet: any request or saved output hides it. */
export function taskHasAnswers(task:Pick<Task,'requests'|'artifacts'|'procedures'>){return task.requests.length>0||task.artifacts.length>0||task.procedures.length>0;}

/** Starter questions built from the saved source names only, never from source contents. */
export function welcomeStarters(task:Pick<Task,'sources'>):string[]{
 const summary=savedSourceSummary(task);
 if(!summary)return [];
 if(!summary.label)return ['Summarize what I’ve added in three short points.','How do these compare?','What should I do next?'];
 const name='“'+summary.label+'”';
 return [`Summarize ${name} in three short points.`,`What are the key facts or numbers in ${name}?`,`What should I do next, based on ${name}?`];
}

/** A starter fills the composer. Existing text is kept: the starter goes on a new line after it. */
export function withStarter(draft:string,starter:string){return draft.trim()?draft.replace(/\s+$/,'')+'\n'+starter:starter;}

export function TaskWelcome({task,name,portrait,draft,disabled=false,composerId,onDraft,onReview}:{
 task:WelcomeTask;name:string;portrait:ReactNode;draft:string;disabled?:boolean;composerId?:string;
 onDraft:(text:string)=>void;onReview:(reference?:SourceRef)=>void;
}){
 const headingId=useId();
 const summary=savedSourceSummary(task);
 if(!summary||taskHasAnswers(task))return null;
 const starters=welcomeStarters(task),prefix=summary.label?(summary.stale?'Earlier copy:':'Using:'):'';
 const fill=(starter:string)=>{
  if(disabled)return;
  onDraft(withStarter(draft,starter));
  if(composerId&&typeof document!=='undefined')requestAnimationFrame(()=>document.getElementById(composerId)?.focus());
 };
 return <section className="new-conversation task-welcome" aria-labelledby={headingId}>
  <h2 id={headingId} className="sr-only">{summary.heading}</h2>
  <div className="task-welcome-hello">
   <span className="task-welcome-portrait" aria-hidden="true">{portrait}</span>
   <div className="task-welcome-copy">
    <p className="task-welcome-greeting">Hi, I’m {name}.</p>
    <p className="task-welcome-lede">{summary.label?<>What would you like to know about “{summary.label}”? Ask below, or try one of these.</>:'What would you like to know about what you’ve added? Ask below, or try one of these.'}</p>
   </div>
  </div>
  <div className="task-welcome-source">
   <Layers size={14} aria-hidden="true"/>
   <span className="task-welcome-source-text">{prefix&&<span className="task-welcome-source-prefix">{prefix} </span>}{summary.description}</span>
   <button type="button" className="task-welcome-review" aria-label={summary.action} onClick={()=>onReview(summary.reference)}>Review</button>
  </div>
  {starters.length>0&&<div className="task-welcome-starters" role="group" aria-label="Suggested questions">
   {starters.map(starter=><button type="button" key={starter} className="task-welcome-starter" disabled={disabled} onClick={()=>fill(starter)}>{starter}</button>)}
  </div>}
 </section>;
}

/** Compact companion: a small character and one short line, no starter list. */
export function CompactGreeting({name,portrait,source}:{name:string;portrait:ReactNode;source?:string}){
 return <div className="compact-welcome">
  <span className="compact-welcome-portrait" aria-hidden="true">{portrait}</span>
  <p>Hi, I’m {name}. {source?<>What would you like to know about “{source}”?</>:'What can I help with?'}</p>
 </div>;
}
