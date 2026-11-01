import {Schema} from 'effect';

// usedRequestIds is an opaque, heterogeneous ledger. Ordinary claims stay exact
// SHA-256 strings. Old readers preserve these additional strings unchanged.
// Never filter, compact, normalize or expose ledger entries as task/model data.
const FAMILY='local-start:',PREFIX=`${FAMILY}v1:`;
export const LOCAL_START_RECEIPT_LIMIT=1024;
const digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
const uuid=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/));
const receiptSchema=Schema.Struct({intentHash:digest,payloadDigest:digest,taskId:uuid,kind:Schema.Literal('text','draft','suggested'),targetId:uuid});
export type LocalStartReceipt=typeof receiptSchema.Type;
const invalid=()=>Error('A local save record is unreadable or conflicting. Your saved tasks are unchanged.');
function canonical(value:LocalStartReceipt):string{
 return PREFIX+JSON.stringify({intentHash:value.intentHash,payloadDigest:value.payloadDigest,taskId:value.taskId,kind:value.kind,targetId:value.targetId});
}
export function encodeLocalStartReceipt(value:LocalStartReceipt):string{
 try{return canonical(Schema.decodeUnknownSync(receiptSchema,{onExcessProperty:'error'})(value));}catch{throw invalid();}
}
/** Reserved records fail closed; other opaque entries are preserved and ignored.
 * A receipt is not authority: it only resolves an already-claimed live target.
 * Deleted targets leave tombstones; absence can never create a replacement. */
export function findLocalStartReceipt(entries:readonly string[],intentHash:string):LocalStartReceipt|undefined{
 const claims=new Set(entries),seen=new Set<string>(),tasks=new Set<string>();let found:LocalStartReceipt|undefined;
 for(const entry of entries){
  if(!entry.startsWith(FAMILY))continue;
  let value:LocalStartReceipt;
  try{
   if(entry.length>LOCAL_START_RECEIPT_LIMIT||!entry.startsWith(PREFIX))throw invalid();
   value=Schema.decodeUnknownSync(receiptSchema,{onExcessProperty:'error'})(JSON.parse(entry.slice(PREFIX.length)));
   if(canonical(value)!==entry||!claims.has(value.intentHash)||seen.has(value.intentHash)||tasks.has(value.taskId))throw invalid();
  }catch{throw invalid();}
  seen.add(value.intentHash);tasks.add(value.taskId);
  if(value.intentHash===intentHash)found=value;
 }
 return found;
}
