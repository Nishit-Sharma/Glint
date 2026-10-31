import {Schema} from 'effect';

const FAMILY='project-create:',PREFIX=FAMILY+'v1:';
const Digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
const ProjectId=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/));
const Receipt=Schema.Struct({intentHash:Digest,payloadDigest:Digest,projectId:ProjectId});
type Receipt=typeof Receipt.Type;
const invalid=()=>Error('A project creation record is unreadable or conflicting. Saved work is unchanged.');
const encode=(value:Receipt)=>PREFIX+JSON.stringify({intentHash:value.intentHash,payloadDigest:value.payloadDigest,projectId:value.projectId});
export const encodeProjectCreation=(value:Receipt)=>encode(Schema.decodeUnknownSync(Receipt,{onExcessProperty:'error'})(value));
export function findProjectCreation(entries:readonly string[],intentHash:string):Receipt|undefined{
 const claims=new Set(entries),seen=new Set<string>(),projects=new Set<string>();let found:Receipt|undefined;
 for(const entry of entries){
  if(!entry.startsWith(FAMILY))continue;
  try{
   if(!entry.startsWith(PREFIX)||entry.length>512)throw invalid();
   const value=Schema.decodeUnknownSync(Receipt,{onExcessProperty:'error'})(JSON.parse(entry.slice(PREFIX.length)));
   if(encode(value)!==entry||!claims.has(value.intentHash)||seen.has(value.intentHash)||projects.has(value.projectId))throw invalid();
   seen.add(value.intentHash);projects.add(value.projectId);if(value.intentHash===intentHash)found=value;
  }catch{throw invalid();}
 }
 return found;
}
