import {Schema} from 'effect';
import {AuthoredDocumentOriginSchema,type AuthoredDocumentOrigin} from '../shared/artifact-context-origin';
const FAMILY='authored-document:',PREFIX=FAMILY+'v1:';
const invalid=()=>Error('The original document save record needs review. Saved work is unchanged.');
export function encodeAuthoredDocumentReceipt(value:AuthoredDocumentOrigin):string{
 return PREFIX+JSON.stringify(Schema.decodeUnknownSync(AuthoredDocumentOriginSchema,{onExcessProperty:'error'})(value));
}
export function findAuthoredDocumentReceipt(entries:readonly string[],intentHash:string):AuthoredDocumentOrigin|undefined{
 const claims=new Set(entries),seen=new Set<string>(),targets=new Set<string>();let found:AuthoredDocumentOrigin|undefined;
 for(const entry of entries){
  if(!entry.startsWith(FAMILY))continue;
  try{
   if(entry.length>1600||!entry.startsWith(PREFIX))throw invalid();
   const value=Schema.decodeUnknownSync(AuthoredDocumentOriginSchema,{onExcessProperty:'error'})(JSON.parse(entry.slice(PREFIX.length)));
   if(encodeAuthoredDocumentReceipt(value)!==entry||!claims.has(value.intentHash)||seen.has(value.intentHash)||targets.has(value.artifactId))throw invalid();
   seen.add(value.intentHash);targets.add(value.artifactId);if(value.intentHash===intentHash)found=value;
  }catch{throw invalid();}
 }
 return found;
}
