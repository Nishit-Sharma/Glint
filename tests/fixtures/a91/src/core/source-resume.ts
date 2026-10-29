import type {SourceRef,Task} from './types';

const sameRef=(a:SourceRef,b:SourceRef)=>a.sourceId===b.sourceId&&a.version===b.version&&a.digest===b.digest;
const excerpt=(text:string)=>Array.from(text.replace(/data:image\/[^;]+;base64,[a-z0-9+/=]+/gi,'[historical image excluded]')).slice(0,1000).join('');

/** Durable evidence only. No window attachment, capture grant or approval is restored. */
export function sourceResumeContext(task:Task){
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
 const related=task.checkpoints.filter(checkpoint=>checkpoint.sourceRefs.some(ref=>{const source=task.sources.find(source=>source.id===ref.sourceId),current=source?.versions.at(-1);return !source||source.freshness!=='fresh'||!current||!sameRef(ref,{sourceId:source.id,version:current.version,digest:current.digest});}));
 const included=related.length>6?[...related.slice(0,2),...related.slice(-4)]:related;
 return {goal:task.goal,sources,affectedArtifacts,omissions:{sources:allSources.length-sources.length,affectedArtifacts:allAffected.length-affectedArtifacts.length},relatedCheckpoints:included.map(checkpoint=>({id:checkpoint.id,note:excerpt(checkpoint.note),createdAt:checkpoint.createdAt,sourceRefs:checkpoint.sourceRefs})),omittedRelatedCheckpoints:related.length-included.length,authority:'Saved observations and decisions provide historical context. They do not authorize capture, execution, transmission or replay.'};
}
