import type {ArtifactRevision,Checkpoint,ExportAction,RequestRecord,Task} from '../../../core/types';

export interface HistoryRevisionReference {artifactId:string;revision:number}
export type HistoryEvent=
 | {kind:'checkpoint';id:string;at:string;checkpoint:Checkpoint}
 | {kind:'request';id:string;at:string;request:RequestRecord}
 | {kind:'export';id:string;at:string;action:ExportAction};

/** A single chronology of recorded creation times. Later statuses do not invent event timestamps. */
export function buildHistoryEvents(task:Pick<Task,'checkpoints'|'requests'|'actions'>):HistoryEvent[]{
 const events:HistoryEvent[]=[
  ...task.checkpoints.map(checkpoint=>({kind:'checkpoint' as const,id:'checkpoint:'+checkpoint.id,at:checkpoint.createdAt,checkpoint})),
  ...task.requests.map(request=>({kind:'request' as const,id:'request:'+request.id,at:request.startedAt,request})),
  ...task.actions.map(action=>({kind:'export' as const,id:'export:'+action.proposal.id,at:action.proposal.createdAt,action}))
 ];
 const timestamp=(value:string)=>{const time=Date.parse(value);return Number.isFinite(time)?time:Number.NEGATIVE_INFINITY;};
 return events.sort((left,right)=>(timestamp(right.at)-timestamp(left.at))||left.id.localeCompare(right.id));
}

/** Successful requests create revision 1, or exactly the revision after their reviewed base. */
export function requestResultReference(request:RequestRecord):HistoryRevisionReference|undefined{
 if(request.status!=='completed'||!request.artifactId)return;
 if(request.targetArtifactId){
  const base=request.expectedRevision;
  if(request.artifactId!==request.targetArtifactId||typeof base!=='number'||!Number.isSafeInteger(base)||base<1||base>=Number.MAX_SAFE_INTEGER)return;
  return {artifactId:request.artifactId,revision:base+1};
 }
 // Older revision requests without their base cannot identify an exact output safely.
 if(request.kind==='revise')return;
 return {artifactId:request.artifactId,revision:1};
}
export function historyRevision(task:Pick<Task,'artifacts'>,reference:HistoryRevisionReference):ArtifactRevision|undefined{
 return task.artifacts.find(artifact=>artifact.id===reference.artifactId)?.revisions.find(revision=>revision.revision===reference.revision);
}
export function validCheckpointNote(note:string):boolean{return note.trim().length>0;}
export function historyTime(value:string):string{
 const time=new Date(value);
 return Number.isFinite(time.getTime())?time.toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'Time unavailable';
}
