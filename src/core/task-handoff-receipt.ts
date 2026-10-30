import {Schema} from 'effect';
const FAMILY='task-handoff:',PREFIX=FAMILY+'v2:';
const digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const schema=Schema.Struct({claimHash:digest,requestDigest:digest,payloadDigest:digest,taskId:id,artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest});
type Receipt=typeof schema.Type;
const invalid=()=>Error('The original handoff receipt is unavailable or unfamiliar. Existing saved work is kept.');
const canonical=(value:Receipt)=>PREFIX+JSON.stringify({claimHash:value.claimHash,requestDigest:value.requestDigest,payloadDigest:value.payloadDigest,taskId:value.taskId,artifactId:value.artifactId,revision:value.revision,digest:value.digest});
export const encodeTaskHandoffReceipt=(value:Receipt)=>canonical(Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(value));
/** Opaque ledger strings identify the original document; they grant no authority. */
export function findTaskHandoffReceipt(entries:readonly string[],claimHash:string):Receipt|undefined{
 const claims=new Set(entries),seen=new Set<string>(),targets=new Set<string>();let found:Receipt|undefined;
 for(const entry of entries){if(!entry.startsWith(FAMILY))continue;try{if(entry.length>2048||!entry.startsWith(PREFIX))throw invalid();const value=Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(JSON.parse(entry.slice(PREFIX.length))),target=JSON.stringify([value.taskId,value.artifactId,value.revision]);if(canonical(value)!==entry||!claims.has(value.claimHash)||seen.has(value.claimHash)||targets.has(target))throw invalid();seen.add(value.claimHash);targets.add(target);if(value.claimHash===claimHash)found=value;}catch{throw invalid();}}
 return found;
}
