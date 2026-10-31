import type {Task} from '../../../core/types';
import type {ConnectionStatus} from '../../../shared/bridge';

export function RequestContext({task,selectedSourceIds,connection,onReview,kind='explain'}:{task?:Task;selectedSourceIds?:string[];connection?:ConnectionStatus;onReview?:()=>void;kind?:'explain'|'create'|'experiment'|'procedure'}){
 if(task?.session?.browserContext)return null;
 const sources=task?.sources.filter(source=>selectedSourceIds===undefined||selectedSourceIds.includes(source.id))??[];
 const labels=sources.map(source=>source.versions.at(-1)!.label),summary=labels.slice(0,2).join(', ')+(labels.length>2?` +${labels.length-2} more`:'');
 const history=kind==='explain'||kind==='create';
 const destination=connection?.configured?(connection.provider==='Meta'?'Meta':'OpenAI'):undefined;
 return <div className="request-context" aria-label="Context for next question">
  {task?<details><summary>Context · {summary||'No sources selected'}{history?' · task history':''}</summary>
   {onReview&&<button type="button" className="text" onClick={onReview}>Review or change context</button>}
   <p>{history?'Your message, task title, goal, saved conversation and choices are included. History can contain copied or derived content from earlier sources even when they are now deselected.':'Your message and the selected source content are included.'}</p>
   {sources.length>0&&<ul>{sources.map(source=>{const version=source.versions.at(-1)!;return <li key={source.id}>{version.label} · {version.kind==='window'?'frozen snapshot':version.kind} · {source.freshness==='fresh'?`version ${version.version}`:'refresh required'}</li>;})}</ul>}
  </details>:<span>Context · Your message</span>}
  {destination&&<span className="request-destination">To {destination}</span>}
 </div>;
}
