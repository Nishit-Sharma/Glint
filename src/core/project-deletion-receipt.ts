import {Schema} from 'effect';
import {ProjectDeleteResultSchema} from '../shared/project-deletion';

const FAMILY='project-delete:',PREFIX=FAMILY+'v1:';
const Digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
const Receipt=Schema.Struct({intentHash:Digest,payloadDigest:Digest,result:ProjectDeleteResultSchema});
type Receipt=typeof Receipt.Type;
const invalid=()=>Error('A project deletion record is unreadable or conflicting. Saved work is unchanged.');
const encode=(value:Receipt)=>PREFIX+JSON.stringify({intentHash:value.intentHash,payloadDigest:value.payloadDigest,result:value.result});
export const encodeProjectDeletion=(value:Receipt)=>encode(Schema.decodeUnknownSync(Receipt,{onExcessProperty:'error'})(value));
export function findProjectDeletion(entries:readonly string[],intentHash:string):Receipt|undefined{
 const seen=new Set<string>();let found:Receipt|undefined;
 for(const entry of entries){
  if(!entry.startsWith(FAMILY))continue;
  try{
   if(!entry.startsWith(PREFIX)||entry.length>18*1024*1024)throw invalid();
   const value=Schema.decodeUnknownSync(Receipt,{onExcessProperty:'error'})(JSON.parse(entry.slice(PREFIX.length)));
   if(encode(value)!==entry||!entries.includes(value.intentHash)||seen.has(value.intentHash))throw invalid();
   seen.add(value.intentHash);if(value.intentHash===intentHash)found=value;
  }catch{throw invalid();}
 }
 return found;
}
