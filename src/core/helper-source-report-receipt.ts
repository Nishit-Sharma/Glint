import {Schema} from 'effect';
const FAMILY='helper-source-report:',PREFIX=FAMILY+'v1:';
const digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),id=Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,80}$/));
const schema=Schema.Struct({claimHash:digest,binding:digest,requestDigest:digest,payloadDigest:digest,taskId:id,artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest});
type Receipt=typeof schema.Type;
const invalid=()=>Error('The original table-report save receipt needs review. Existing documents were kept.');
const canonical=(value:Receipt)=>PREFIX+JSON.stringify({claimHash:value.claimHash,binding:value.binding,requestDigest:value.requestDigest,payloadDigest:value.payloadDigest,taskId:value.taskId,artifactId:value.artifactId,revision:value.revision,digest:value.digest});
export const encodeHelperSourceReportReceipt=(value:Receipt)=>canonical(Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(value));
/** Opaque strings remain in the existing atomic ledger; they are not task/model content. */
export function findHelperSourceReportReceipt(entries:readonly string[],claimHash:string):Receipt|undefined{
 const claims=new Set(entries),seen=new Set<string>(),targets=new Set<string>();let found:Receipt|undefined;
 for(const entry of entries){if(!entry.startsWith(FAMILY))continue;try{
  if(entry.length>2048||!entry.startsWith(PREFIX))throw invalid();
  const value=Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(JSON.parse(entry.slice(PREFIX.length))),target=JSON.stringify([value.taskId,value.artifactId,value.revision]);
  if(canonical(value)!==entry||!claims.has(value.claimHash)||seen.has(value.claimHash)||targets.has(target))throw invalid();seen.add(value.claimHash);targets.add(target);if(value.claimHash===claimHash)found=value;
 }catch{throw invalid();}}
 return found;
}
