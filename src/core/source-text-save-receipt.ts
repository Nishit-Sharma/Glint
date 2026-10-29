import {Schema} from 'effect';

const FAMILY='source-text-save:',PREFIX=`${FAMILY}v1:`;
const CLAIM_FAMILY='source-text-save-claim:',CLAIM_PREFIX=`${CLAIM_FAMILY}v1:`;
export const SOURCE_TEXT_SAVE_RECEIPT_LIMIT=4096;
const digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
const identity=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const receiptSchema=Schema.Struct({intentHash:digest,payloadDigest:digest,taskId:identity,sourceId:identity,version:Schema.Int.pipe(Schema.between(1,Number.MAX_SAFE_INTEGER)),digest});
export type SourceTextSaveReceipt=typeof receiptSchema.Type;
const invalid=()=>Error('A source save record is unreadable or conflicting. Your saved sources are unchanged.');
export const sourceTextSaveClaim=(intentHash:string):string=>CLAIM_PREFIX+intentHash;
function canonical(value:SourceTextSaveReceipt):string{
 return PREFIX+JSON.stringify({intentHash:value.intentHash,payloadDigest:value.payloadDigest,taskId:value.taskId,sourceId:value.sourceId,version:value.version,digest:value.digest});
}
export function encodeSourceTextSaveReceipt(value:SourceTextSaveReceipt):string{
 try{const encoded=canonical(Schema.decodeUnknownSync(receiptSchema,{onExcessProperty:'error'})(value));if(encoded.length>SOURCE_TEXT_SAVE_RECEIPT_LIMIT)throw invalid();return encoded;}catch{throw invalid();}
}
/** Opaque records stay outside primary schemas. Every reserved claim and receipt must agree. */
export function findSourceTextSaveReceipt(entries:readonly string[],intentHash:string):SourceTextSaveReceipt|undefined{
 const claims=new Set<string>(),seen=new Set<string>(),versions=new Set<string>();let found:SourceTextSaveReceipt|undefined;
 try{
  for(const entry of entries){
   if(!entry.startsWith(CLAIM_FAMILY))continue;
   if(!entry.startsWith(CLAIM_PREFIX))throw invalid();
   const claim=Schema.decodeUnknownSync(digest)(entry.slice(CLAIM_PREFIX.length));
   if(claims.has(claim))throw invalid();claims.add(claim);
  }
  for(const entry of entries){
   if(!entry.startsWith(FAMILY))continue;
   if(entry.length>SOURCE_TEXT_SAVE_RECEIPT_LIMIT||!entry.startsWith(PREFIX))throw invalid();
   const value=Schema.decodeUnknownSync(receiptSchema,{onExcessProperty:'error'})(JSON.parse(entry.slice(PREFIX.length)));
   const version=JSON.stringify([value.taskId,value.sourceId,value.version]);
   if(canonical(value)!==entry||!claims.has(value.intentHash)||seen.has(value.intentHash)||versions.has(version))throw invalid();
   seen.add(value.intentHash);versions.add(version);if(value.intentHash===intentHash)found=value;
  }
  if(claims.size!==seen.size)throw invalid();
 }catch{throw invalid();}
 return found;
}
