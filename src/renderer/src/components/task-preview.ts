import type {SourceRef,Task} from '../../../core/types';
import {buildHistoryEvents} from './history-events';
import {savedExperimentRunActivity} from '../../../learning/experiment-runs';
import {localActivityLabel} from '../local-activity';

/** Presentation only: exact saved revisions, never source contents or inferred answers. */
export function savedSourceSummary(task:Pick<Task,'sources'>):{heading:string;description:string;action:string;preview:string;reference?:SourceRef;label?:string;stale?:boolean}|undefined{
 const sources=task.sources.flatMap(source=>{
  const version=source.versions.find(version=>version.version===source.currentVersion);
  if(!version)return [];
  const label=version.label.trim()||(version.kind==='window'?'Captured window':version.kind==='image'?'Added image':'Added text');
  return [{label,stale:source.freshness!=='fresh',reference:{sourceId:source.id,version:version.version,digest:version.digest}}];
 });
 if(!sources.length)return;
 if(sources.length===1){const source=sources[0];return {
  heading:source.stale?'Earlier copy saved':'Added to this task',
  description:source.label+(source.stale?' · It may have changed. Check it before using it again.':''),
  action:source.stale?'Review earlier copy':'Review what you added',
  preview:(source.stale?'Earlier copy: ':'Added: ')+source.label,
  reference:source.reference,
  label:source.label,stale:source.stale,
 };}
 const stale=sources.filter(source=>source.stale).length;
 return {heading:'What you added',description:`${sources.length} items added.`+(stale?` ${stale} may have changed.`:''),action:'Review what you added',preview:`${sources.length} items added`+(stale?' · Review needed':'')};
}

/** Preserve existing history/document/goal precedence; sources fill only the empty fallback. */
export function taskSidebarPreview(task:Task):string{
 const event=buildHistoryEvents(task)[0];
 if(!event)return task.artifacts.at(-1)?.revisions.at(-1)?.title||task.goal||savedSourceSummary(task)?.preview||'New task';
 if(event.kind==='checkpoint')return event.checkpoint.note;
 if(event.kind==='export')return event.action.status==='verified'?'Export saved':'Export needs review';
 if(event.request.kind==='brief'){const item=task.artifacts.find(a=>a.id===event.request.artifactId);return item?.revisions.at(-1)?.title||'Screen insight';}
 const activity=event.request.status==='completed'?savedExperimentRunActivity(task,event.request):undefined;
 return activity?activity.label:localActivityLabel(task,event.request,true)??event.request.prompt;
}
