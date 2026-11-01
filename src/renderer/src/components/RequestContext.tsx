import {TaskMemorySettings} from './TaskMemorySettings';
import {RequestInferenceSettings} from './RequestInferenceSettings';
import {InstructionSkills} from './InstructionSkills';
import {PdfRequestInspector} from './PdfRequestInspector';
import type {Task} from '../../../core/types';
import type {ConnectionStatus} from '../../../shared/bridge';
import {sourceRoleLabel} from '../../../shared/public-messages';

export function RequestContext({task,selectedSourceIds,connection,onReview,kind='explain',prompt}:{task?:Task;selectedSourceIds?:string[];connection?:ConnectionStatus;onReview?:()=>void;kind?:'explain'|'create'|'experiment'|'procedure';prompt?:string}){
 if(task?.session?.browserContext)return null;
 const sources=task?.sources.filter(source=>selectedSourceIds===undefined||selectedSourceIds.includes(source.id))??[];
 const projectCopies=task?.sources.filter(source=>source.projectOrigin)??[],selectedCopies=projectCopies.filter(source=>sources.some(selected=>selected.id===source.id));
 const labels=sources.map(source=>source.versions.at(-1)!.label),summary=labels.slice(0,2).join(', ')+(labels.length>2?` +${labels.length-2} more`:'');
 const history=kind==='explain'||kind==='create';
 const destination=connection?.configured?(connection.provider==='Meta'?'Meta':'OpenAI'):undefined;
 return <div className="request-context" aria-label="Context for next question">
  {task?<details><summary>Context · {summary||'No sources selected'}{history?' · task history':''}</summary>
   {onReview&&<button type="button" className="text" onClick={onReview}>Review or change context</button>}
   <p>{history?'Your message, task title, goal, saved conversation and choices are included. History can contain copied or derived content from earlier sources even when they are now deselected.':'Your message and the selected source content are included.'}</p>
   {projectCopies.length>0&&<p>{projectCopies.length} saved project {projectCopies.length===1?'snapshot':'snapshots'} · {selectedCopies.length} selected for this question. Copies stay pinned; existing explicit source selections stay unchanged.</p>}
   {sources.length>0&&<ul>{sources.map(source=>{const version=source.versions.at(-1)!;return <li key={source.id}>{version.label} · {version.kind==='window'?'frozen snapshot':version.kind} · {source.freshness==='fresh'?`version ${version.version}`:'refresh required'}{source.projectOrigin&&<> · project snapshot of shared saved version {source.projectOrigin.reference.version} · {sourceRoleLabel(version.role)}{source.currentVersion!==source.projectOrigin.copiedVersion||version.digest!==source.projectOrigin.copiedDigest?' · locally changed copy':' · pinned copy'}</>}</li>;})}</ul>}
  </details>:<span>Context · Your message</span>}
  {task&&history&&<RequestInferenceSettings key={task.id} task={task} prompt={prompt} kind={kind==='create'?'create':'explain'} connectionKey={JSON.stringify([connection?.provider,connection?.endpoint,connection?.configured])}/>}
  {task&&history&&<TaskMemorySettings key={'memory:'+task.id} task={task} prompt={prompt??''}/>}
  {task&&history&&<InstructionSkills key={'skills:'+task.id} task={task} prompt={prompt} sourceIds={sources.map(source=>source.id)} onManageSources={onReview}/>}
  {task&&history&&sources.some(source=>source.versions.at(-1)?.pdfPage)&&<PdfRequestInspector key={'visual:'+task.id} task={task} prompt={prompt??''} kind={kind==='create'?'create':'explain'} sourceIds={sources.map(source=>source.id)} connectionKey={JSON.stringify([connection?.provider,connection?.endpoint,connection?.configured])}/>}
  {destination&&<span className="request-destination">To {destination}</span>}
 </div>;
}
