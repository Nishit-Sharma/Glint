import {useGuardedAction} from './draft-navigation';
import {useState} from 'react';
import type {Task} from '../../core/types';
import type {Bot,ReadyBots} from '../../shared/bot-catalog';
import {DEFAULT_CHARACTER,characterLabel,CHARACTER_SHAPES} from '../../shared/character-catalog';
import {BotImage} from './bot-art';
import {CompanionChoice} from './CompanionChoice';
export function BotIdentityPicker({catalog,active,task,busy,onAssign,onAdd,onDefault,onCreating}:{catalog:ReadyBots;active?:Bot;task?:Task;busy:boolean;onAssign:(botId:string)=>Promise<void>;onAdd:(profile:Bot['profile'])=>Promise<void>;onDefault:(botId:string)=>Promise<void>;onCreating:(creating:boolean)=>void}){
 const guard=useGuardedAction();
 const [adding,setAdding]=useState(false),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 async function change(action:()=>Promise<void>){setSaving(true);setError('');try{await action();}catch(error){setError(error instanceof Error?error.message:'Your companions could not be changed.');}finally{setSaving(false);}}
 if(adding)return <div className="identity-create"><CompanionChoice initial={DEFAULT_CHARACTER} title="Add another companion" action="Add companion" onCancel={()=>{setAdding(false);onCreating(false);}} onContinue={async profile=>{await onAdd(profile);setAdding(false);onCreating(false);}}/></div>;
 return <section className="identity-picker" aria-label="Thread companion">
  {(catalog.bots.length>1||!active)&&<details open={!active||undefined}><summary>Use another companion for this thread</summary>{catalog.bots.map((bot,index)=><div className="identity-row" key={bot.id}><button type="button" aria-pressed={bot.id===active?.id} disabled={saving||busy||!task||bot.id===active?.id} onClick={()=>guard(()=>void change(()=>onAssign(bot.id)))}><BotImage className="bot-thumbnail" profile={bot.profile}/><span>{characterLabel(bot.profile)}<small>{CHARACTER_SHAPES.find(shape=>shape.id===bot.profile.look.shape)?.label} · Companion {index+1}{bot.id===active?.id?' · This thread':''}</small></span></button>{catalog.defaultBotId===bot.id?<small>Default for new threads</small>:<button disabled={saving} onClick={()=>guard(()=>void change(()=>onDefault(bot.id)))}>Use by default for new threads</button>}</div>)}</details>}
  {busy&&<p className="tiny">Change after this response or execution decision finishes.</p>}
  <button type="button" disabled={saving} onClick={()=>guard(()=>{setAdding(true);onCreating(true);})}>Add another bot</button>
  {error&&<p role="alert">{error}</p>}
 </section>;
}
