import {Either,ParseResult,Schema} from 'effect';
import {JoinExtractionProposalSchema,type JoinExtractionProposal} from '../learning/grounded-join';

type JoinExtractionOutput = {kind:'proposal';proposal:JoinExtractionProposal}|{schemaVersion:1;kind:'unsupported-source';reason:string};
type Failure='size'|'depth'|'duplicate-key'|'json'|'unsupported-shape'|'schema'|'empty-table';
const fields=new Set(['schemaVersion','extraction','citations','id','title','left','right','join','assumptions','citationId','columns','rows','label','sourceLabel','type','typeCitationId','cells','kind','value','reason','keys','mode','leftColumnId','rightColumnId','source','location','start','end','quote','x','y','width','height']);
/** Only schema vocabulary and bounded indices survive; values and unknown key names never do. */
function diagnosticPath(path:ReadonlyArray<PropertyKey>){return path.slice(0,16).map(key=>typeof key==='number'&&Number.isSafeInteger(key)&&key>=0&&key<=128?`[${key}]`:typeof key==='string'&&fields.has(key)?`.${key}`:'.[unknown-field]').join('')||'$';}
const fail=(code:Failure,path:ReadonlyArray<PropertyKey>=[]):never=>{throw Error(`Invalid join extraction output. Diagnostic: ${code} at ${diagnosticPath(path)}. Return a bounded transcription or an explicit unsupported-source result.`);};

/** The provider boundary accepts one complete JSON value, never Markdown or partial JSON. */
export function parseJoinExtractionOutput(source:string):JoinExtractionOutput {
 if(typeof source!=='string'||source.length<1||source.length>128_000)return fail('size');
 const objects:(Set<string>|null)[]=[];
 let index=0;
 while(index<source.length){
  const char=source[index];
  if(char==='{'||char==='['){if(objects.length>=12)return fail('depth');objects.push(char==='{'?new Set():null);index++;continue;}
  if(char==='}'||char===']'){objects.pop();index++;continue;}
  if(char!=='"'){index++;continue;}
  const start=index++;
  while(index<source.length){if(source[index]==='\\'){index+=2;continue;}if(source[index++]==='"')break;}
  let next=index;while(next<source.length&&/\s/u.test(source[next]))next++;
  const object=objects.at(-1);
  if(source[next]===':'&&object){
   let key:unknown;try{key=JSON.parse(source.slice(start,index));}catch{return fail('json');}
   if(typeof key!=='string'||object.has(key))return fail('duplicate-key');object.add(key);
  }
 }
 let value:unknown;try{value=JSON.parse(source);}catch{return fail('json');}
 if(value!==null&&typeof value==='object'&&!Array.isArray(value)&&'kind' in value&&value.kind==='unsupported-source'){
  const object=value as Record<string,unknown>,reason=object.reason;
  if(Object.keys(object).length!==3||object.schemaVersion!==1||typeof reason!=='string'||!reason.trim()||reason.length>500||/[\u0000-\u001f\u007f<>\[\]{}\x60~*_#|]|(?:\b[a-z][a-z0-9+.-]*:\/\/|\b(?:javascript|vbscript|data|mailto|tel|sms|intent|blob|file|vscode|codex):|\bwww\.)/iu.test(reason))return fail('unsupported-shape');
  return {schemaVersion:1,kind:'unsupported-source',reason};
 }
 const decoded=Schema.decodeUnknownEither(JoinExtractionProposalSchema,{onExcessProperty:'error'})(value);
 if(Either.isLeft(decoded))return fail('schema',ParseResult.ArrayFormatter.formatErrorSync(decoded.left)[0]?.path??[]);
 const proposal=decoded.right;
 if(!proposal.extraction.left.rows.length)return fail('empty-table',['extraction','left','rows']);
 if(!proposal.extraction.right.rows.length)return fail('empty-table',['extraction','right','rows']);
 return {kind:'proposal',proposal};
}
