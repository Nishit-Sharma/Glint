import {requestableSourceIds} from '../../../shared/source-intake';
import {TaskHistoryInspector} from './TaskHistoryInspector';
import {TaskMemorySettings} from './TaskMemorySettings';
import {RequestInferenceSettings} from './RequestInferenceSettings';
import {InstructionSkills} from './InstructionSkills';
import {PdfRequestInspector} from './PdfRequestInspector';
import type {Task} from '../../../core/types';
import type {ConnectionStatus} from '../../../shared/bridge';
import {sourceRoleLabel} from '../../../shared/public-messages';
import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {instructionSkillSelection} from '../../../shared/instruction-skill';
import './composer-details.css';

// One quiet context line stays visible. Model, task memory, skill, PDF inspection and any
// caller-supplied request settings (account memory, response mode) sit behind one details
// control so the composer does not crowd the answer. Everything stays mounted and disclosed.
export function RequestContext({task,selectedSourceIds,connection,onReview,kind='explain',prompt,details,flag,chips=[],detailsOpen,onDetailsOpen}:{task?:Task;selectedSourceIds?:string[];connection?:ConnectionStatus;onReview?:()=>void;kind?:'explain'|'create'|'experiment'|'procedure';prompt?:string;details?:ReactNode;flag?:string;
 /** Active request context that is sent with the next message (memory, project instructions); always shown. */
 chips?:string[];detailsOpen?:boolean;onDetailsOpen?:(open:boolean)=>void}){
 const panelId=useId(),[ownOpen,setOwnOpen]=useState(false),open=detailsOpen??ownOpen,revealOnOpen=useRef(false);
 // When the user opens Details inside the compact composer's scroll box, bring its first row into view above
 // the pinned input (scroll-margin in composer-details.css). Reduced motion jumps instead of scrolling smoothly.
 useEffect(()=>{
  if(!open||!revealOnOpen.current)return;revealOnOpen.current=false;
  const row=document.getElementById(panelId)?.firstElementChild;if(!row||!row.closest('.compact-compose'))return;
  row.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
 },[open,panelId]);
 const toggle=()=>{revealOnOpen.current=!open;setOwnOpen(!open);onDetailsOpen?.(!open);};
 if(task?.session?.browserContext)return null;
 const selected=task?new Set(requestableSourceIds(task,selectedSourceIds)):new Set<string>(),sources=task?.sources.filter(source=>selected.has(source.id))??[];
 const projectCopies=task?.sources.filter(source=>source.projectOrigin)??[],selectedCopies=projectCopies.filter(source=>sources.some(selected=>selected.id===source.id));
 const labels=sources.map(source=>source.versions.at(-1)!.label),summary=labels.slice(0,2).join(', ')+(labels.length>2?` +${labels.length-2} more`:'');
 const history=kind==='explain'||kind==='create';
 // Name the actual route: the Baseten Muse profile reaches Meta's model through inference.baseten.co.
 const viaBaseten=connection?.metaProfile==='baseten-hackathon'||/(^|\.)baseten\.co$/.test((()=>{try{return new URL(connection?.endpoint??'').hostname;}catch{return '';}})());
 const destination=connection?.configured?(connection.provider==='Meta'?(viaBaseten?'Meta · Baseten':'Meta'):'OpenAI'):undefined;
 // A task-pinned skill is included with every ordinary Ask, so it stays visible beside the message.
 const skill=task&&history?instructionSkillSelection(task.session).selection:null,skillTitle=skill&&(skill.ownerTaskId===task?.id?task?.artifacts.find(item=>item.id===skill.artifactId)?.revisions.at(-1)?.title:undefined);
 const visible:{text:string;prefix?:string;name?:string}[]=[...(flag?[{text:flag}]:[]),...(skill?[{text:'Skill · '+(skillTitle??'saved skill'),prefix:'Skill ·',name:skillTitle??'saved skill'}]:[]),...chips.map(text=>({text}))];
 const pdf=!!task&&history&&sources.some(source=>source.versions.at(-1)?.pdfPage),hasPanel=(!!task&&history)||!!details;
 return <div className="request-context" aria-label="Context for next question">
  {task?<details><summary>Context · {summary||'No sources selected'}{history?' + task history':''}</summary>
   {onReview&&<button type="button" className="text" onClick={onReview}>Review or change context</button>}
   <p>{history?'Your message, task title, goal, saved conversation and choices are included. Source-derived history is included only for selected current sources. Removed, excluded and superseded source versions and their linked results are excluded. Older unredacted versions stay in local history. Independently saved guidance may contain copied text; inspect or edit that guidance separately.':'Your message and the selected source content are included.'}</p>
   {history&&<TaskHistoryInspector key={task.id} task={task} sourceIds={sources.map(source=>source.id)} prompt={prompt??''}/>}
   {projectCopies.length>0&&<p>{projectCopies.length} saved project {projectCopies.length===1?'snapshot':'snapshots'} · {selectedCopies.length} selected for this question. Copies stay pinned; existing explicit source selections stay unchanged.</p>}
   {sources.length>0&&<ul>{sources.map(source=>{const version=source.versions.at(-1)!;return <li key={source.id}>{version.label} · {version.kind==='window'?'frozen snapshot':version.kind} · {source.freshness==='fresh'?`version ${version.version}`:'refresh required'}{source.projectOrigin&&<> · project snapshot of shared saved version {source.projectOrigin.reference.version} · {sourceRoleLabel(version.role)}{source.currentVersion!==source.projectOrigin.copiedVersion||version.digest!==source.projectOrigin.copiedDigest?' · locally changed copy':' · pinned copy'}</>}</li>;})}</ul>}
  </details>:<span>Context · Your message</span>}
  {(hasPanel||destination)&&<div className="request-context-end">{destination&&<span className="request-destination">To {destination}</span>}{hasPanel&&<button type="button" className="request-details-toggle" aria-expanded={open} aria-controls={panelId} onClick={toggle}><span className="request-details-marker" aria-hidden="true"/>Details</button>}{hasPanel&&visible.length>0&&<button type="button" className="request-details-toggle request-included-toggle" aria-label={"Included with your next message: "+visible.map(chip=>chip.text).join(", ")+". Request details"} aria-expanded={open} aria-controls={panelId} onClick={toggle}><span className="request-details-marker" aria-hidden="true"/>+{visible.length} included</button>}</div>}
  {visible.length>0&&<div className="request-chips" role="group" aria-label="Included with your next message">{visible.map(chip=><button type="button" key={chip.text} className="request-chip" aria-label={chip.name?chip.text:undefined} aria-expanded={hasPanel?open:undefined} aria-controls={hasPanel?panelId:undefined} disabled={!hasPanel} onClick={toggle}>{chip.name?<><span aria-hidden="true">{chip.prefix}</span><span className="request-chip-name" aria-hidden="true">{chip.name}</span></>:chip.text}</button>)}</div>}
  {hasPanel&&<div id={panelId} className="request-details" role="group" aria-label="Request details" hidden={!open}>
   {task&&history&&<RequestInferenceSettings key={task.id} task={task} prompt={prompt} kind={kind==='create'?'create':'explain'} connectionKey={JSON.stringify([connection?.provider,connection?.endpoint,connection?.configured])}/>}
   {task&&history&&<TaskMemorySettings key={'memory:'+task.id} task={task} prompt={prompt??''}/>}
   {task&&history&&<InstructionSkills key={'skills:'+task.id} task={task} prompt={prompt} sourceIds={sources.map(source=>source.id)} onManageSources={onReview}/>}
   {pdf&&task&&<PdfRequestInspector key={'visual:'+task.id} task={task} prompt={prompt??''} kind={kind==='create'?'create':'explain'} sourceIds={sources.map(source=>source.id)} connectionKey={JSON.stringify([connection?.provider,connection?.endpoint,connection?.configured])}/>}
   {details}
  </div>}
 </div>;
}
