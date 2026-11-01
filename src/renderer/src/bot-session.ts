import {useCallback,useEffect,useRef,useState} from 'react';
import {readBotState,readBotCommit,type BotSnapshot,type BotState,type BotCommand} from '../../shared/bot-catalog';
type State=BotState|{kind:'loading'}|{kind:'legacy'};
type Action=BotCommand extends infer C?C extends BotCommand?Omit<C,'expectedRevision'>:never:never;
export function useBotSession(){
 const [state,setState]=useState<State>({kind:'loading'}),current=useRef<BotSnapshot|undefined>(undefined);
 const reload=useCallback(async()=>{const response=await window.companion.invoke({type:'bots.get'});if(response===undefined){setState({kind:'legacy'});return;}const value=readBotState(response);if(value.kind==='available')current.current=value.current;setState(value);return value;},[]);
 useEffect(()=>{void reload().catch(()=>setState({kind:'unavailable',message:'Your companions could not be opened. Saved work has not been replaced.'}));},[reload]);
 useEffect(()=>window.companion.subscribe(event=>{if(event.type==='surface')void reload().catch(()=>{});}),[reload]);
 const command=useCallback(async(action:Action)=>{const base=current.current;if(!base)throw Error('Open your saved companion before changing it.');const result=readBotCommit(await window.companion.invoke({type:'bots.change',change:{...action,expectedRevision:base.revision}}));if(result.kind==='unavailable'){setState(result);throw Error(result.message);}current.current=result.current;setState({kind:'available',current:result.current});if(result.kind==='conflict')throw Error('Your companion changed elsewhere. The saved choice is shown. Try again.');return result.current;},[]);
 return {state,reload,command};
}
