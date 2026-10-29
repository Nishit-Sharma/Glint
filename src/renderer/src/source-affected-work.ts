import type {Artifact,Procedure,SourceRef,Task} from '../../core/types';

export type AffectedSourceWork =
 | {kind:'artifact';item:Artifact;refs:SourceRef[]}
 | {kind:'procedure';item:Procedure;refs:SourceRef[]};

/** Only the latest saved output revisions and the selected source's exact
 * recorded references are considered. This performs no live source check. */
export function sourceAffectedWork(task:Task,sourceId:string):AffectedSourceWork[]{
 const source=task.sources.find(item=>item.id===sourceId),current=source?.versions.at(-1);
 if(!source||!current)return [];
 const affected=(refs:SourceRef[])=>refs.filter(ref=>ref.sourceId===source.id&&(source.freshness!=='fresh'||ref.version!==source.currentVersion||ref.digest!==current.digest));
 const artifacts:AffectedSourceWork[]=task.artifacts.flatMap(item=>{const refs=affected(item.revisions.at(-1)?.sourceRefs??[]);return refs.length?[{kind:'artifact',item,refs}]:[];});
 const procedures:AffectedSourceWork[]=task.procedures.flatMap(item=>{const refs=affected(item.revisions.at(-1)?.sourceRefs??[]);return refs.length?[{kind:'procedure',item,refs}]:[];});
 return [...artifacts,...procedures];
}
