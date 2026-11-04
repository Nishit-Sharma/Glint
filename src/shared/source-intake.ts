import {sourceDependencyRefs} from './source-dependencies';
import {Schema} from 'effect';
import type {Source,SourceRef,Task} from '../core/types';

export const SourceRevocationSchema=Schema.Struct({id:Schema.String,at:Schema.String,previousFreshness:Schema.Literal('fresh','refresh-required'),previousStaleReason:Schema.optional(Schema.String)});
export type SourceRevocation=typeof SourceRevocationSchema.Type;
export const SOURCE_REVOKED_REASON='Removed from requests by you. Results that used it are outdated.';
export const SOURCE_RESTORED_WINDOW_REASON='Restored. Capture this window again before using it.';
export const REDACTION_MARK='[redacted]';
export const MAX_REDACTION_SPANS=200;

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const ref=Schema.Struct({sourceId:id,version:Schema.Int.pipe(Schema.between(1,Number.MAX_SAFE_INTEGER)),digest:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))});
const span=Schema.Struct({start:Schema.Int.pipe(Schema.between(0,12_000_000)),end:Schema.Int.pipe(Schema.between(1,12_000_000))});
const commands=Schema.Union(
 Schema.Struct({type:Schema.Literal('source-intake.revoke'),taskId:id,expected:ref}),
 Schema.Struct({type:Schema.Literal('source-intake.restore'),taskId:id,expected:ref,revokedAt:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(100)),revocationId:id}),
 Schema.Struct({type:Schema.Literal('source-intake.redact'),taskId:id,expected:ref,spans:Schema.Array(span).pipe(Schema.minItems(1),Schema.maxItems(MAX_REDACTION_SPANS))}),
);
export type SourceIntakeCommand=typeof commands.Type;
export type RedactionSpan=typeof span.Type;
export const readSourceIntakeCommand=Schema.decodeUnknownSync(commands,{onExcessProperty:'error'});
export const isSourceIntakeCommand=(command:{type:string}):command is SourceIntakeCommand=>command.type.startsWith('source-intake.');

export const isRevokedSource=(source:Pick<Source,'revoked'>)=>source.revoked!==undefined;

/** Pinned copies retain provenance, so withdrawal at their original owner also fences their use. */
export function requestSourceAvailable(source:Source,owners:readonly Task[],seen=new Set<Source>()):boolean{
 if(source.revoked||source.freshness!=='fresh'||seen.has(source))return false;
 const origin=source.projectOrigin;if(!origin)return true;
 seen.add(source);
 const original=owners.find(task=>task.id===origin.taskId)?.sources.find(item=>item.id===origin.reference.sourceId),version=original?.versions.at(-1);
 return !!original&&!!version&&original.currentVersion===origin.reference.version&&version.digest===origin.reference.digest&&requestSourceAvailable(original,owners,seen);
}
/** Sources a request may send: the explicit scope (or all sources when unset), never removed ones. */
export function requestableSourceIds(task:Pick<Task,'sources'>&{session?:Task['session']},scope?:readonly string[]):string[]{
 scope??=task.session?.sourceSelection?.sourceIds;
 return task.sources.filter(source=>!isRevokedSource(source)&&(scope===undefined||scope.includes(source.id))).map(source=>source.id);
}
export function requestableSourceRefs(task:Pick<Task,'sources'>&{session?:Task['session']},scope?:readonly string[]):SourceRef[]{
 const ids=new Set(requestableSourceIds(task,scope));
 return task.sources.filter(source=>ids.has(source.id)).map(source=>({sourceId:source.id,version:source.currentVersion,digest:source.versions.at(-1)!.digest}));
}
export function changeInclusion(task:Pick<Task,'sources'>&{session?:Task['session']},scope:readonly string[]|undefined,sourceId:string,include:boolean):string[]{
 const current=new Set(requestableSourceIds(task,scope)),source=task.sources.find(item=>item.id===sourceId);
 if(!source||isRevokedSource(source))return [...current];
 if(include)current.add(sourceId);else current.delete(sourceId);
 return task.sources.filter(source=>!isRevokedSource(source)&&current.has(source.id)).map(source=>source.id);
}

export type InclusionRow={sourceId:string;label:string;kind:'text'|'image'|'window';title?:string;version:number;capturedAt:string;state:'included'|'excluded'|'needs-refresh'|'removed';reason?:string};
/** Exactly what the next request will carry, in task order; removed sources are listed but never sendable. */
export function inclusionRows(task:Pick<Task,'sources'>&{session?:Task['session']},scope?:readonly string[]):InclusionRow[]{
 const included=new Set(requestableSourceIds(task,scope));
 return task.sources.map(source=>{
  const version=source.versions.at(-1)!;
  const state=isRevokedSource(source)?'removed':!included.has(source.id)?'excluded':source.freshness!=='fresh'?'needs-refresh':'included';
  return {sourceId:source.id,label:version.label,kind:version.kind,...(version.title&&version.title!==version.label?{title:version.title}:{}),version:version.version,capturedAt:version.capturedAt,state,...(source.staleReason&&state!=='included'&&state!=='excluded'?{reason:source.staleReason}:{})};
 });
}
export function inclusionSummary(rows:readonly InclusionRow[]){
 const count=(state:InclusionRow['state'])=>rows.filter(row=>row.state===state).length;
 const included=count('included'),stale=count('needs-refresh'),excluded=count('excluded'),removed=count('removed');
 return [`${included} of ${rows.length-removed} sources included`,stale?`${stale} need refresh`:'',excluded?`${excluded} excluded`:'',removed?`${removed} removed`:''].filter(Boolean).join(' · ');
}

/** Saved work whose latest revision cites the source; revocation marks each one outdated. */
export function revocationEffects(task:Pick<Task,'artifacts'|'procedures'|'requests'|'actions'>,sourceId:string){
 const cites=(refs:readonly SourceRef[]|undefined)=>!!refs?.some(ref=>ref.sourceId===sourceId);
 return {
  artifactIds:task.artifacts.filter(item=>cites(item.revisions.at(-1)&&sourceDependencyRefs(item.revisions.at(-1)!))).map(item=>item.id),
  procedureIds:task.procedures.filter(item=>cites(item.revisions.at(-1)?.sourceRefs)).map(item=>item.id),
  runningRequestIds:task.requests.filter(item=>item.status==='running'&&cites(sourceDependencyRefs(item))).map(item=>item.id),
  pendingActionIds:task.actions.filter(item=>(item.status==='proposed'||item.status==='approved')&&cites(item.proposal.sourceRefs)).map(item=>item.proposal.id),
 };
}

/** Replaces UTF-16 spans of the exact reviewed content. Overlapping or touching spans are merged. */
export function redactSpans(content:string,spans:readonly RedactionSpan[]):string{
 if(!spans.length||spans.length>MAX_REDACTION_SPANS)throw Error('Choose between 1 and 200 text spans to redact.');
 for(const item of spans)if(!Number.isSafeInteger(item.start)||!Number.isSafeInteger(item.end)||item.start<0||item.end<=item.start||item.end>content.length)throw Error('A redaction span is outside the reviewed source text.');
 const splitsPair=(offset:number)=>offset>0&&offset<content.length&&/[\uD800-\uDBFF]/.test(content[offset-1])&&/[\uDC00-\uDFFF]/.test(content[offset]);
 if(spans.some(item=>splitsPair(item.start)||splitsPair(item.end)))throw Error('Select whole characters to redact.');
 const merged:RedactionSpan[]=[];
 for(const item of [...spans].sort((a,b)=>a.start-b.start||a.end-b.end)){
  const last=merged.at(-1);
  if(last&&item.start<=last.end)merged[merged.length-1]={start:last.start,end:Math.max(last.end,item.end)};else merged.push({...item});
 }
 let result='',cursor=0;
 for(const item of merged){result+=content.slice(cursor,item.start)+REDACTION_MARK;cursor=item.end;}
 return result+content.slice(cursor);
}
