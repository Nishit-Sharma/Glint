import type {SourceRef,Task} from '../../../core/types';
import {buildHistoryEvents} from './history-events';
import {savedExperimentRunActivity} from '../../../learning/experiment-runs';
import {localActivityLabel} from '../local-activity';

/** Presentation only: exact saved revisions, never source contents or inferred answers. */
export function savedSourceSummary(task:Pick<Task,'sources'>):{heading:string;description:string;action:string;preview:string;reference?:SourceRef}|undefined{
 const sources=task.sources.flatMap(source=>{
  const version=source.versions.find(version=>version.version===source.currentVersion);
  if(!version)return [];
  const label=version.label.trim()||(version.kind==='window'?'Window snapshot':version.kind==='image'?'Image source':'Text source');
  return [{label,stale:source.freshness!=='fresh',reference:{sourceId:source.id,version:version.version,digest:version.digest}}];
 });
 if(!sources.length)return;
 if(sources.length===1){const source=sources[0];return {
  heading:source.stale?'Saved source snapshot':'Source saved',
  description:source.label+(source.stale?' · Review before using it again.':''),
  action:source.stale?'Review saved snapshot':'Review source',
  preview:(source.stale?'Saved snapshot: ':'Saved source: ')+source.label,
  reference:source.reference,
 };}
 const stale=sources.filter(source=>source.stale).length;
 return {heading:'Saved sources',description:`${sources.length} sources saved.`+(stale?` ${stale} ${stale===1?'snapshot needs':'snapshots need'} review.`:''),action:'Review sources',preview:`${sources.length} saved sources`+(stale?' · Review needed':'')};
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
