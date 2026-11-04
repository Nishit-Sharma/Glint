import {Schema} from 'effect';
const FAMILY='source-comparison:',PREFIX=FAMILY+'v1:';
const digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const schema=Schema.Struct({claimHash:digest,binding:digest,taskId:id,artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest});
export type SourceComparisonReceipt=typeof schema.Type;
const invalid=()=>Error('The original comparison receipt is unavailable or conflicting. Your notes are kept. Inspect Files before another save.');
const canonical=(value:SourceComparisonReceipt)=>PREFIX+JSON.stringify({claimHash:value.claimHash,binding:value.binding,taskId:value.taskId,artifactId:value.artifactId,revision:value.revision,digest:value.digest});
export const encodeSourceComparisonReceipt=(value:SourceComparisonReceipt)=>canonical(Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(value));
/** Existing atomic ledger claims identify an immutable publication, never a content guess. */
export function findSourceComparisonReceipt(entries:readonly string[],claimHash:string):SourceComparisonReceipt|undefined{
 const claims=new Set(entries),seen=new Set<string>(),targets=new Set<string>();let found:SourceComparisonReceipt|undefined;
 for(const entry of entries){if(!entry.startsWith(FAMILY))continue;try{
  if(entry.length>2048||!entry.startsWith(PREFIX))throw invalid();
  const value=Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(JSON.parse(entry.slice(PREFIX.length))),target=JSON.stringify([value.taskId,value.artifactId,value.revision]);
  if(canonical(value)!==entry||!claims.has(value.claimHash)||seen.has(value.claimHash)||targets.has(target))throw invalid();seen.add(value.claimHash);targets.add(target);if(value.claimHash===claimHash)found=value;
 }catch{throw invalid();}}
 if(!found&&claims.has(claimHash))throw invalid();
 return found;
}
