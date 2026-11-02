import {Schema} from 'effect';
const family='ai-attribution:',prefix=family+'v1:';
const digest=Schema.String.pipe(Schema.length(64),Schema.pattern(/^[a-f0-9]{64}$/)),id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const schema=Schema.Struct({claimHash:digest,requestDigest:digest,taskId:id,artifactId:id,revision:Schema.Int.pipe(Schema.positive()),digest});
type Receipt=typeof schema.Type;
const encode=(value:Receipt)=>prefix+JSON.stringify({claimHash:value.claimHash,requestDigest:value.requestDigest,taskId:value.taskId,artifactId:value.artifactId,revision:value.revision,digest:value.digest});
export const encodeAiAttributionReceipt=(value:Receipt)=>encode(Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(value));
export function findAiAttributionReceipt(entries:readonly string[],claimHash:string):Receipt|undefined{
 const claims=new Set(entries),seen=new Set<string>(),targets=new Set<string>();let found:Receipt|undefined;
 for(const entry of entries){if(!entry.startsWith(family))continue;try{
  if(entry.length>2048||!entry.startsWith(prefix))throw Error();
  const value=Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(JSON.parse(entry.slice(prefix.length))),target=JSON.stringify([value.taskId,value.artifactId,value.revision]);
  if(encode(value)!==entry||!claims.has(value.claimHash)||seen.has(value.claimHash)||targets.has(target))throw Error();seen.add(value.claimHash);targets.add(target);if(value.claimHash===claimHash)found=value;
 }catch{throw Error('The original attribution receipt is unavailable or unfamiliar. No replacement was created.');}}
 return found;
}
