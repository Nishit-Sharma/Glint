import type {SourceRef,Task} from './types';

const sameRef=(a:SourceRef,b:SourceRef)=>a.sourceId===b.sourceId&&a.version===b.version&&a.digest===b.digest;
const excerpt=(text:string)=>Array.from(text.replace(/data:image\/[^;]+;base64,[a-z0-9+/=]+/gi,'[historical image excluded]')).slice(0,1000).join('');
export const SOURCE_PROCEDURE_CONTEXT_LIMIT=6000;

/** Durable evidence only. No window attachment, capture grant or approval is restored. */
export function sourceResumeContext(task:Task,procedureBudget=SOURCE_PROCEDURE_CONTEXT_LIMIT){
 const dependency=(ref:SourceRef)=>{
  const source=task.sources.find(source=>source.id===ref.sourceId),current=source?.versions.at(-1);
  const available=source?.versions.some(version=>version.id===source.id&&sameRef(ref,{sourceId:source.id,version:version.version,digest:version.digest}))??false;
  const comparable=!!source&&!!current&&current.id===source.id&&current.version===source.currentVersion;
  const versionRelation=!available||!comparable?'unknown' as const:sameRef(ref,{sourceId:source!.id,version:current!.version,digest:current!.digest})?'current' as const:'superseded' as const;
  if(available&&versionRelation==='current'&&source?.freshness==='fresh')return undefined;
  return {sourceId:ref.sourceId,version:ref.version,digest:ref.digest,availability:available?'available' as const:'unavailable' as const,versionRelation,freshness:source?.freshness??'unknown' as const};
 };
 const allSources=task.sources.flatMap(source=>{
  const version=source.versions.at(-1);if(!version)return [];
  const ref={sourceId:source.id,version:version.version,digest:version.digest};
  return [{ref,label:excerpt(version.label).slice(0,200),kind:version.kind,status:source.freshness,reason:source.staleReason?excerpt(source.staleReason).slice(0,300):(version.kind==='window'?'A frozen window snapshot is historical evidence, not a live document.':null),authority:version.kind==='window'?'new-user-gesture-required':'saved-reference',documentEvidence:version.documentStamp?.evidence??'unavailable',...(source.documentChange?{documentChange:{kind:source.documentChange.kind,reason:excerpt(source.documentChange.reason).slice(0,300),observedAt:source.documentChange.observedAt}}:{})}];
 });
 const sources=[...allSources.filter(source=>source.status==='refresh-required'),...allSources.filter(source=>source.status!=='refresh-required')].slice(0,32);
 const allAffected=task.artifacts.flatMap(artifact=>{const revisions=artifact.revisions.filter(revision=>revision.sourceRefs.some(ref=>{
  const source=task.sources.find(source=>source.id===ref.sourceId),current=source?.versions.at(-1);
  return !source||source.freshness!=='fresh'||!current||!sameRef(ref,{sourceId:source.id,version:current.version,digest:current.digest});
 })).map(revision=>revision.revision);return revisions.length?[{artifactId:artifact.id,revisions}]:[];});
 const affectedArtifacts=allAffected.slice(0,32).map(artifact=>({...artifact,revisions:artifact.revisions.slice(-16),...(artifact.revisions.length>16?{omittedRevisions:artifact.revisions.length-16}:{})}));
 const allProcedures=task.procedures.flatMap(procedure=>{
  const revisions=procedure.revisions.flatMap(revision=>{
   const refs=revision.sourceRefs.flatMap(ref=>{const recorded=dependency(ref);return recorded?[recorded]:[];});
   return refs.length?[{revision:revision.revision,createdAt:revision.createdAt,sourceRefs:refs}]:[];
  });
  return revisions.length?[{procedureId:procedure.id,currentRevision:procedure.revisions.at(-1)!.revision,revisions}]:[];
 });
 const ordered=allProcedures.flatMap((procedure,index)=>procedure.revisions.map(revision=>({procedure,revision,index}))).sort((a,b)=>Number(b.revision.revision===b.procedure.currentRevision)-Number(a.revision.revision===a.procedure.currentRevision)||b.revision.createdAt.localeCompare(a.revision.createdAt)||b.index-a.index||b.revision.revision-a.revision.revision);
 const chosen:Array<{procedure:typeof allProcedures[number];revisions:Array<{revision:typeof ordered[number]['revision'];sourceRefs:Array<NonNullable<ReturnType<typeof dependency>>>}>}>=[];
 const totalRevisions=ordered.length,totalRefs=ordered.reduce((count,item)=>count+item.revision.sourceRefs.length,0);
 const summary=()=>{
  const affectedProcedures=chosen.map(({procedure,revisions})=>({procedureId:procedure.procedureId,currentRevision:procedure.currentRevision,revisions:revisions.map(({revision,sourceRefs})=>({revision:revision.revision,sourceRefs,...(sourceRefs.length<revision.sourceRefs.length?{omittedSourceRefs:revision.sourceRefs.length-sourceRefs.length}:{})})),...(revisions.length<procedure.revisions.length?{omittedRevisions:procedure.revisions.length-revisions.length}:{})}));
  return {affectedProcedures,omissions:{affectedProcedures:allProcedures.length-chosen.length,procedureRevisions:totalRevisions-chosen.reduce((count,procedure)=>count+procedure.revisions.length,0),procedureSourceRefs:totalRefs-chosen.reduce((count,procedure)=>count+procedure.revisions.reduce((refs,revision)=>refs+revision.sourceRefs.length,0),0)}};
 };
 const minimalSize=JSON.stringify(summary()).length,budget=Number.isFinite(procedureBudget)?Math.max(0,Math.min(SOURCE_PROCEDURE_CONTEXT_LIMIT,Math.floor(procedureBudget))):0;
 // Keep current affected revisions first, then newest history, within one serialized budget.
 select:for(const item of ordered){
  let procedure=chosen.find(candidate=>candidate.procedure===item.procedure);if(!procedure){procedure={procedure:item.procedure,revisions:[]};chosen.push(procedure);}
  const revision={revision:item.revision,sourceRefs:[] as Array<NonNullable<ReturnType<typeof dependency>>>};procedure.revisions.push(revision);
  for(const ref of item.revision.sourceRefs){
   revision.sourceRefs.push(ref);
   if(JSON.stringify(summary()).length-minimalSize>budget){revision.sourceRefs.pop();if(!revision.sourceRefs.length)procedure.revisions.pop();if(!procedure.revisions.length)chosen.pop();break select;}
  }
 }
 const procedures=summary();
 const related=task.checkpoints.filter(checkpoint=>checkpoint.sourceRefs.some(ref=>{const source=task.sources.find(source=>source.id===ref.sourceId),current=source?.versions.at(-1);return !source||source.freshness!=='fresh'||!current||!sameRef(ref,{sourceId:source.id,version:current.version,digest:current.digest});}));
 const included=related.length>6?[...related.slice(0,2),...related.slice(-4)]:related;
 return {goal:task.goal,sources,affectedArtifacts,affectedProcedures:procedures.affectedProcedures,omissions:{sources:allSources.length-sources.length,affectedArtifacts:allAffected.length-affectedArtifacts.length,...procedures.omissions},relatedCheckpoints:included.map(checkpoint=>({id:checkpoint.id,note:excerpt(checkpoint.note),createdAt:checkpoint.createdAt,sourceRefs:checkpoint.sourceRefs})),omittedRelatedCheckpoints:related.length-included.length,authority:'Saved observations and decisions provide historical context. They do not authorize capture, execution, transmission or replay.'};
}
