import {useGuardedAction,useNavigationDraft} from './draft-navigation';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {Task} from '../../core/types';
import {assignedBot,visibleBots,type Bot,type ReadyBots,type BotCommand} from '../../shared/bot-catalog';
import {DEFAULT_CHARACTER,characterLabel} from '../../shared/character-catalog';
import {BotImage} from './bot-art';
import {CompanionChoice} from './CompanionChoice';
import {TaskMenu} from './components/TaskMenu';
type Action=BotCommand extends infer C?C extends BotCommand?Omit<C,'expectedRevision'>:never:never;
/** Bring a just-revealed form into view and focus its first field. Respects reduced motion. */
function reveal(target:HTMLElement|null|undefined,field:HTMLElement|null|undefined){
 if(!target)return;const reduce=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
 target.scrollIntoView({block:'start',behavior:reduce?'auto':'smooth'});field?.focus({preventScroll:true});
}
export function BotIdentityPicker({catalog,active,task,tasks,busy,onAssign,onAdd,onDefault,onCreating,onEdit,onChange}:{catalog:ReadyBots;active?:Bot;task?:Task;tasks:Task[];busy:boolean;onAssign:(botId:string)=>Promise<void>;onAdd:(profile:Bot['profile'])=>Promise<void>;onDefault:(botId:string)=>Promise<void>;onCreating:(creating:boolean)=>void;onEdit:(botId:string)=>void;onChange:(action:Action)=>Promise<unknown>}){
 const guard=useGuardedAction(),section=useRef<HTMLElement>(null);
 const [adding,setAdding]=useState(false),[details,setDetails]=useState<Bot>(),[feedback,setFeedback]=useState<{botId?:string;message?:string;error?:string}>({}),[saving,setSaving]=useState(false);
 useEffect(()=>{if(!feedback.message&&!feedback.error)return;section.current?.querySelector<HTMLElement>('[data-identity-feedback]:not(:empty)')?.scrollIntoView({block:'nearest'});},[feedback]);
 async function change(botId:string|undefined,action:()=>Promise<unknown>,success='Companion saved.'){setSaving(true);setFeedback({botId});try{await action();setFeedback({botId,message:success});}catch(error){setFeedback({botId,error:error instanceof Error?error.message:'Your companions could not be changed.'});}finally{setSaving(false);}}
 // The editor is rendered after this roster; wait for the chosen companion's form, then bring it into view.
 function editAppearance(bot:Bot){
  const root=section.current?.closest('.inspector-content'),previous=bot.id===active?.id?undefined:root?.querySelector('.appearance-editor');
  onEdit(bot.id);let frames=0;
  const step=()=>{const form=root?.querySelector<HTMLElement>('.appearance-editor'),field=form?.querySelector<HTMLElement>('[aria-label="Character name"]:not(:disabled)');if(form&&field&&form!==previous){reveal(root?.querySelector<HTMLElement>('.appearance-heading')??form,field);return;}if(++frames<90)requestAnimationFrame(step);};
  requestAnimationFrame(step);
 }
 if(adding)return <div className="identity-create"><CompanionChoice initial={DEFAULT_CHARACTER} title="Add another companion" action="Add companion" onCancel={()=>{setAdding(false);onCreating(false);}} onContinue={async profile=>{await onAdd(profile);setAdding(false);onCreating(false);}}/></div>;
 const assigned=task?assignedBot(catalog,task.assignedBotId):undefined,repair=!!task&&!assigned,inUse=task?assigned?.id:catalog.defaultBotId;
 const status=(botId:string|undefined)=><>{feedback.botId===botId&&feedback.error?<p className="identity-feedback" data-identity-feedback role="alert">{feedback.error}</p>:null}<p className="identity-feedback" data-identity-feedback role="status">{feedback.botId===botId&&feedback.message?feedback.message:''}</p></>;
 const row=(bot:Bot,hidden=false)=>{const label=characterLabel(bot.profile),assign=!!task&&task.assignedBotId!==bot.id;
  const badges=[bot.id===inUse?(task?'With you on this task':'Starts new tasks'):'',task&&bot.id===catalog.defaultBotId?'Default for new tasks':'',bot.pinned?'Pinned':'',bot.id===active?.id&&!hidden?'Editing':''].filter(Boolean);
  return <div className="identity-row" key={bot.id} data-in-use={bot.id===inUse||undefined}><div className="identity-summary"><BotImage className="bot-thumbnail" profile={bot.profile}/><div><strong>{label}</strong>{bot.title&&<small>{bot.title}</small>}{bot.tagline&&<p>{bot.tagline}</p>}{badges.length>0&&<ul className="identity-badges" aria-label={'About '+label}>{badges.map(badge=><li key={badge}>{badge}</li>)}</ul>}</div></div><div className="identity-actions">
  {hidden?<button disabled={saving} onClick={()=>void change(undefined,()=>onChange({type:'visibility',botId:bot.id,hidden:false}),'Companion restored.')}>Restore {label}</button>:<>
  {repair&&<button className="identity-primary" disabled={saving||busy} onClick={()=>guard(()=>void change(bot.id,()=>onAssign(bot.id),'Companion switched for this task.'))}>Use for this task</button>}
  <button className={repair?undefined:'identity-primary'} disabled={saving} onClick={()=>guard(()=>editAppearance(bot))}>Edit appearance</button>
  <TaskMenu label={'More for '+label}>
   <button type="button" disabled={saving} onClick={()=>guard(()=>setDetails(bot))}>Edit details</button>
   {!repair&&assign&&<button type="button" disabled={saving||busy} onClick={()=>guard(()=>void change(bot.id,()=>onAssign(bot.id),'Companion switched for this task.'))}>Use for this task</button>}
   {catalog.defaultBotId!==bot.id&&<button type="button" disabled={saving} onClick={()=>guard(()=>void change(bot.id,()=>onDefault(bot.id),'Default companion saved.'))}>Use by default for new tasks</button>}
   <button type="button" disabled={saving||catalog.bots.length>=40} onClick={()=>void change(bot.id,()=>onChange({type:'duplicate',botId:bot.id}),'Companion duplicated. The copy looks the same and starts with no conversations.')}>Duplicate</button>
   <button type="button" disabled={saving} onClick={()=>void change(bot.id,()=>onChange({type:'pin',botId:bot.id,pinned:!bot.pinned}),bot.pinned?'Companion unpinned.':'Pinned to the sidebar.')}>{bot.pinned?'Unpin companion':'Pin companion'}</button>
   <button type="button" disabled={saving} onClick={()=>guard(()=>{if(details?.id===bot.id)setDetails(undefined);void change(undefined,()=>onChange({type:'visibility',botId:bot.id,hidden:true}),'Hidden from the sidebar. Its conversations are kept.');})}>Hide from sidebar</button>
  </TaskMenu></>}
 </div>{!hidden&&details?.id===bot.id&&<BotDetails key={details.id+':'+details.revision} bot={details} onCancel={()=>setDetails(undefined)} onSave={async(title,tagline)=>{await onChange({type:'details',botId:details.id,title,tagline});setDetails(undefined);setFeedback({botId:details.id,message:'Details saved.'});}}/>}{!hidden&&status(bot.id)}</div>;};
 const visible=visibleBots(catalog),ordered=[...visible.filter(bot=>bot.id===inUse),...visible.filter(bot=>bot.id!==inUse)];
 return <section ref={section} className="identity-picker" aria-label="Manage companions"><header className="identity-intro"><h3>Your companions</h3><p className="tiny">Pick who keeps you company. Names and looks stay on this Mac.</p></header>
  {ordered.map(bot=>row(bot))}
  {status(undefined)}
  {catalog.bots.some(bot=>bot.hidden)&&<details className="identity-hidden"><summary>Hidden companions</summary>{catalog.bots.filter(bot=>bot.hidden).map(bot=>row(bot,true))}</details>}
  <button type="button" className="identity-add" disabled={saving||catalog.bots.length>=40} onClick={()=>guard(()=>{setAdding(true);onCreating(true);})}>Add another companion</button>
  {busy&&<p className="tiny">You can switch companions once the current answer finishes.</p>}
 </section>;
}
/** Startup and floating choices sit after the appearance editor so the roster leads straight into editing. */
export function CompanionPreferences({catalog,tasks,onChange,onFloat}:{catalog:ReadyBots;tasks:Task[];onChange:(action:Action)=>Promise<unknown>;onFloat:()=>void}){
 const guard=useGuardedAction();
 const [error,setError]=useState(''),[message,setMessage]=useState(''),[saving,setSaving]=useState(false);
 async function change(action:()=>Promise<unknown>,success:string){setSaving(true);setError('');setMessage('');try{await action();setMessage(success);}catch(error){setError(error instanceof Error?error.message:'Your companions could not be changed.');}finally{setSaving(false);}}
 return <section className="identity-preferences" aria-label="Companion preferences">
  <section className="identity-startup"><h3>When Glint opens</h3><label>Conversation at startup<select aria-label="Conversation at startup" disabled={saving} value={catalog.startup?.taskId??''} onChange={event=>{const task=tasks.find(task=>task.id===event.target.value);void change(()=>onChange({type:'startup',selection:task?{botId:task.assignedBotId!,taskId:task.id}:null}),'Startup choice saved.');}}><option value="">Restore the last open task</option>{tasks.filter(task=>!task.archive&&visibleBots(catalog).some(bot=>bot.id===task.assignedBotId)).map(task=><option key={task.id} value={task.id}>{characterLabel(catalog.bots.find(bot=>bot.id===task.assignedBotId)!.profile)} · {task.title}</option>)}</select></label><p className="tiny">Opens that companion’s existing task without sending a request. If it is unavailable, Glint shows the task list.</p></section>
  <section className="identity-floating"><h3>Floating companion</h3><p className="tiny">Open a compact window. Drag its header to move it, resize its edges, and hide it from the compact toolbar. Restore it from Glint’s menu bar icon.</p><button disabled={saving} onClick={()=>guard(onFloat)}>Show floating companion</button></section>
  {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
function BotDetails({bot,onSave,onCancel}:{bot:Bot;onSave:(title:string,tagline:string)=>Promise<void>;onCancel:()=>void}){
 const [title,setTitle]=useState(bot.title??''),[tagline,setTagline]=useState(bot.tagline??''),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const dirty=title!==(bot.title??'')||tagline!==(bot.tagline??''),clear=useNavigationDraft(dirty||saving),invalid=/[\p{Cc}\p{Cf}]/u.test(title+tagline),form=useRef<HTMLFormElement>(null);
 useLayoutEffect(()=>{const element=form.current;if(element)reveal(element,element.querySelector<HTMLElement>('input'));},[]);
 return <form ref={form} className="identity-details" aria-label="Companion display details" onSubmit={event=>{event.preventDefault();if(saving||invalid)return;setSaving(true);setError('');void onSave(title,tagline).then(clear).catch(error=>setError(error instanceof Error?error.message:'Details could not be saved.')).finally(()=>setSaving(false));}}><h4>Display details · {characterLabel(bot.profile)}</h4><label>Title<input value={title} maxLength={80} disabled={saving} onChange={event=>setTitle(event.target.value)}/></label><label>Tagline<input value={tagline} maxLength={160} disabled={saving} onChange={event=>setTagline(event.target.value)}/></label><p className="tiny">These labels appear in your companion list. They do not change response instructions.</p>{error&&<p role="alert">{error}</p>}<button type="submit" disabled={saving||!dirty||invalid}>{saving?'Saving…':'Save details'}</button><button type="button" disabled={saving} onClick={()=>{clear();onCancel();}}>Cancel</button></form>;
}
export function CompanionNavigation({catalog,onOpen,onManage}:{catalog:ReadyBots;onOpen:(bot:Bot)=>void;onManage:()=>void}){return <section className="companion-navigation" aria-label="Companions"><div><strong>Companions</strong><button onClick={onManage}>Manage</button></div>{visibleBots(catalog).map(bot=><button key={bot.id} onClick={()=>onOpen(bot)}><BotImage profile={bot.profile} className="bot-thumbnail"/><span>{characterLabel(bot.profile)}{bot.title&&<small>{bot.title}</small>}</span>{bot.pinned&&<small>Pinned</small>}</button>)}{!visibleBots(catalog).length&&<p className="tiny">All companions are hidden. Restore one in Manage.</p>}</section>;}
