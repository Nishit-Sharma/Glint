import {randomUUID} from 'node:crypto';
import type {Source,Task} from './types';
import {SOURCE_RESTORED_WINDOW_REASON,SOURCE_REVOKED_REASON} from '../shared/source-intake';

/** Revocation keeps history but makes the source unsendable and every result citing it outdated. */
export function applySourceRevocation(source:Source,at:string):boolean{
 if(source.revoked)return false;
 source.revoked={id:randomUUID(),at,previousFreshness:source.freshness,...(source.staleReason!==undefined?{previousStaleReason:source.staleReason}:{})};
 source.freshness='refresh-required';source.staleReason=SOURCE_REVOKED_REASON;
 return true;
}
/** Window pixels are never retained across revocation, so a restored window must be captured again. */
export function applySourceRestore(source:Source):boolean{
 const revoked=source.revoked;if(!revoked)return false;
 delete source.revoked;
 if(source.versions.at(-1)?.kind==='window'){source.freshness='refresh-required';source.staleReason=SOURCE_RESTORED_WINDOW_REASON;return true;}
 source.freshness=revoked.previousFreshness;
 if(revoked.previousStaleReason!==undefined)source.staleReason=revoked.previousStaleReason;else delete source.staleReason;
 return true;
}

/** Pinned copies retain provenance, so withdrawal at their original owner also fences their use. */
export function requestSourceAvailable(source:Source,owners:readonly Task[],seen=new Set<Source>()):boolean{
 if(source.revoked||source.freshness!=='fresh'||seen.has(source))return false;
 const origin=source.projectOrigin;if(!origin)return true;
 seen.add(source);
 const original=owners.find(task=>task.id===origin.taskId)?.sources.find(item=>item.id===origin.reference.sourceId),version=original?.versions.at(-1);
 return !!original&&!!version&&original.currentVersion===origin.reference.version&&version.digest===origin.reference.digest&&requestSourceAvailable(original,owners,seen);
}
