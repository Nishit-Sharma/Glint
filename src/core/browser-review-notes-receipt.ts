import {Schema} from 'effect';
const FAMILY='browser-review-notes:',PREFIX=FAMILY+'v1:';
const digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const schema=Schema.Struct({claimHash:digest,payloadDigest:digest,taskId:id,artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest});
type Receipt=typeof schema.Type;
const invalid=()=>Error('The saved browser-notes receipt needs review. Existing notes were kept.');
const canonical=(value:Receipt)=>PREFIX+JSON.stringify({claimHash:value.claimHash,payloadDigest:value.payloadDigest,taskId:value.taskId,artifactId:value.artifactId,revision:value.revision,digest:value.digest});
export const encodeBrowserReviewNotesReceipt=(value:Receipt)=>canonical(Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(value));
/** Opaque ledger strings survive old readers; a receipt only identifies an existing original revision. */
export function findBrowserReviewNotesReceipt(entries:readonly string[],claimHash:string):Receipt|undefined{
 const claims=new Set(entries),seen=new Set<string>(),targets=new Set<string>();let found:Receipt|undefined;
 for(const entry of entries){if(!entry.startsWith(FAMILY))continue;try{if(entry.length>2048||!entry.startsWith(PREFIX))throw invalid();const value=Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(JSON.parse(entry.slice(PREFIX.length))),target=JSON.stringify([value.taskId,value.artifactId,value.revision]);if(canonical(value)!==entry||!claims.has(value.claimHash)||seen.has(value.claimHash)||targets.has(target))throw invalid();seen.add(value.claimHash);targets.add(target);if(value.claimHash===claimHash)found=value;}catch{throw invalid();}}
 return found;
}
