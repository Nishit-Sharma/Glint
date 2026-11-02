import {RefreshCw} from 'lucide-react';

export function ConversationRefresh({pending,error,message,onRefresh}:{pending:boolean;error?:string;message?:string;onRefresh:()=>void}){
 return <div className="conversation-refresh">
  <button type="button" className="conversation-open" disabled={pending} onClick={onRefresh}><RefreshCw size={14} aria-hidden="true"/>{pending?'Refreshing saved messages…':error?'Retry refreshing saved messages':'Refresh saved messages'}</button>
  <p className={error?'warning':'tiny'} role={error?'alert':'status'} aria-live={error?'assertive':'polite'} aria-atomic="true">{pending?'Refreshing saved messages…':error||message||''}</p>
 </div>;
}
