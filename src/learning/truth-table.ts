import {Schema} from 'effect';
import type {ArtifactRef,SourceRef,Task} from '../core/types';

export const TRUTH_MODULE_PREFIX='truth-table-v1-';
export const TRUTH_PREDICTION_PREFIX='truth-pred-v1-';
export const isTruthPredictionId=(id:string)=>/^truth-pred-v1-[a-f0-9]{64}$/.test(id);
export const isTruthModuleId=(id:string)=>id.startsWith(TRUTH_MODULE_PREFIX)||isTruthPredictionId(id);
export const TRUTH_INTRO='A reviewed single assignment is explored as binary Boolean values. Other source lines are not interpreted; this is not VHDL simulation and does not model timing or unknown values.';
const marker='\n<!--companion-truth-v1:';
const text=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(500));
const ref=Schema.Struct({sourceId:text,version:Schema.Int.pipe(Schema.positive()),digest:text});
const artifact=Schema.Struct({artifactId:text,revision:Schema.Int.pipe(Schema.positive()),digest:text});
const bindingSchema=Schema.Struct({taskId:text,basis:artifact,sourceRefs:Schema.Array(ref).pipe(Schema.minItems(1),Schema.maxItems(2)),sourceId:text,start:Schema.Int.pipe(Schema.nonNegative()),end:Schema.Int.pipe(Schema.positive()),quote:text});
export type TruthBinding=typeof bindingSchema.Type;
export type BinaryAssignment={output:string;left:string;right:string;operator:'and'|'or'|'xor'|'nand'|'nor'|'xnor';quote:string};
const reserved=new Set('abs access after alias all and architecture array assert attribute begin block body buffer bus case component configuration constant disconnect downto else elsif end entity exit file for function generate generic group guarded if impure in inertial inout is label library linkage literal loop map mod nand new next nor not null of on open or others out package port postponed procedure process pure range record register reject rem report return rol ror select severity shared signal sla sll sra srl subtype then to transport type unaffected units until use variable wait when while with xnor xor'.split(' '));
/** One complete restricted assignment; no expression tree, HDL type, or execution inference. */
export function parseBinaryAssignment(quote:string):BinaryAssignment|null{
 if(typeof quote!=='string'||quote.length>500)return null;
 const match=/^([a-z][a-z0-9]*(?:_[a-z0-9]+)*)\s*<=\s*([a-z][a-z0-9]*(?:_[a-z0-9]+)*)\s+(and|or|xor|nand|nor|xnor)\s+([a-z][a-z0-9]*(?:_[a-z0-9]+)*)\s*;$/i.exec(quote);if(!match)return null;
 const [,output,left,op,right]=match,names=[output,left,right].map(name=>name.toLowerCase());if(new Set(names).size!==3||names.some(name=>name.length>80||reserved.has(name)))return null;
 return {output,left,right,operator:op.toLowerCase() as BinaryAssignment['operator'],quote};
}
export function binaryOutput(operator:BinaryAssignment['operator'],left:0|1,right:0|1):0|1{
 const both=left===1&&right===1,either=left===1||right===1,different=left!==right;
 switch(operator){case 'and':return both?1:0;case 'or':return either?1:0;case 'xor':return different?1:0;case 'nand':return both?0:1;case 'nor':return either?0:1;case 'xnor':return different?0:1;default:throw Error('This binary operator is not supported.');}
}
export function makeTruthComparison(rule:BinaryAssignment){
 const baseline=binaryOutput(rule.operator,0,0);
 const rows=([['0','0'],['0','1'],['1','0'],['1','1']] as const).map(([a,b])=>{const result=binaryOutput(rule.operator,Number(a) as 0|1,Number(b) as 0|1);const why=rule.operator==='and'?'AND is 1 only when both inputs are 1':rule.operator==='or'?'OR is 1 when either input is 1':rule.operator==='xor'?'XOR is 1 when the inputs differ':rule.operator==='nand'?'NAND is 0 only when both inputs are 1':rule.operator==='nor'?'NOR is 1 only when both inputs are 0':'XNOR is 1 when the inputs are the same';return {id:`pair-${a}${b}`,label:`${rule.left} = ${a}; ${rule.right} = ${b}`,values:[String(result),`${why}. Compared with 00, the output ${result!==baseline?`changes from ${baseline} to ${result}`:`stays ${baseline}`}.`,a==='0'&&b==='0'?rule.quote:'Same reviewed assignment.']};});
 return {kind:'comparison' as const,schemaVersion:1 as const,title:`Binary truth table: ${rule.output}`,question:'Choose an input pair and compare with 00. This is a binary Boolean model, not VHDL simulation.',columns:[rule.output,'Explanation','Reviewed source'],rows};
}
/** The stored choices contain only the exact reviewed quote, never computed feedback. */
export function makeTruthPrediction(rule:BinaryAssignment){
 return {kind:'comparison' as const,schemaVersion:1 as const,title:`Predict output: ${rule.output}`,question:`For ${rule.left} = 1 and ${rule.right} = 0, predict ${rule.output}.`,columns:['Reviewed source'],rows:[{id:'predict-0',label:'0',values:[rule.quote]},{id:'predict-1',label:'1',values:[rule.quote]}]};
}
export function observeTruthPrediction(rule:BinaryAssignment,selected:string|undefined){
 if(selected===undefined)return null;if(selected!=='predict-0'&&selected!=='predict-1')throw Error('This saved prediction needs review.');
 const output=String(binaryOutput(rule.operator,1,0)),prediction=selected==='predict-0'?'0':'1';
 const explanation=rule.operator==='and'?`For ${rule.left} = 1 and ${rule.right} = 0, AND returns 0 because at least one input is 0.`:rule.operator==='or'?`For ${rule.left} = 1 and ${rule.right} = 0, OR returns 1 because one input is 1.`:rule.operator==='xor'?`For ${rule.left} = 1 and ${rule.right} = 0, XOR returns 1 because the inputs differ.`:rule.operator==='nand'?`For ${rule.left} = 1 and ${rule.right} = 0, NAND returns 1 because at least one input is 0.`:rule.operator==='nor'?`For ${rule.left} = 1 and ${rule.right} = 0, NOR returns 0 because at least one input is 1.`:`For ${rule.left} = 1 and ${rule.right} = 0, XNOR returns 0 because the inputs differ.`;
 return {prediction,output,correct:prediction===output,explanation};
}
export function truthPredictionText(rule:BinaryAssignment,selected:string|undefined){
 const result=observeTruthPrediction(rule,selected);return `Reviewed assignment: ${rule.quote}\nInputs: ${rule.left} = 1; ${rule.right} = 0.\nEarlier exposure is not tracked. This binary model is not VHDL simulation.\n${result?`Your saved prediction: ${result.prediction}.\nComputed output: ${result.output}. ${result.correct?'Matches':'Does not match'} your prediction.\n${result.explanation}`:'No prediction has been saved.'}`;
}
export function truthMarkdown(binding:TruthBinding){return TRUTH_INTRO+marker+btoa(encodeURIComponent(JSON.stringify(binding)))+'-->';}
export function readTruthBinding(markdown:string,moduleId:string):TruthBinding|null{
 if(!isTruthModuleId(moduleId))return null;
 try{if(!markdown.startsWith(TRUTH_INTRO+marker)||!markdown.endsWith('-->'))throw Error('Bad binding');const encoded=markdown.slice((TRUTH_INTRO+marker).length,-3),value=JSON.parse(decodeURIComponent(atob(encoded)));return Schema.decodeUnknownSync(bindingSchema,{onExcessProperty:'error'})(value);}catch{throw Error('This saved truth table needs review. Its source binding is unavailable.');}
}
const same=(a:SourceRef,b:SourceRef)=>a.sourceId===b.sourceId&&a.version===b.version&&a.digest===b.digest;
const sameSet=(left:readonly SourceRef[],right:readonly SourceRef[])=>left.length===right.length&&new Set(left.map(ref=>ref.sourceId)).size===left.length&&new Set(right.map(ref=>ref.sourceId)).size===right.length&&left.every(ref=>right.some(other=>same(ref,other)));
export function truthStatus(binding:TruthBinding|undefined,task:Task|undefined):{kind:'current'|'stale'|'unverified'}{
 if(!binding||!task)return {kind:'unverified'};if(task.id!==binding.taskId)return {kind:'stale'};
 const basis=task.artifacts.find(a=>a.id===binding.basis.artifactId)?.revisions.at(-1);if(!basis||basis.revision!==binding.basis.revision||basis.digest!==binding.basis.digest||!sameSet(basis.sourceRefs,binding.sourceRefs))return {kind:'stale'};
 for(const ref of binding.sourceRefs){const s=task.sources.find(item=>item.id===ref.sourceId),v=s?.versions.at(-1);if(!s||!v||s.freshness!=='fresh'||s.currentVersion!==ref.version||v.version!==ref.version||v.id!==ref.sourceId||v.digest!==ref.digest||v.kind!=='text'||v.role!=='fact')return {kind:'stale'};if(ref.sourceId===binding.sourceId){if(binding.end<=binding.start||v.content.slice(binding.start,binding.end)!==binding.quote)return {kind:'stale'};const before=v.content.slice(0,binding.start),lineStart=Math.max(before.lastIndexOf('\n'),before.lastIndexOf('\r'))+1,tail=v.content.slice(binding.end),lineEndOffset=tail.search(/[\r\n]/),lineEnd=lineEndOffset<0?v.content.length:binding.end+lineEndOffset,line=v.content.slice(lineStart,lineEnd);if(line.trim()!==binding.quote||lineStart+line.indexOf(binding.quote)!==binding.start)return {kind:'stale'};}}
 if(!binding.sourceRefs.some(ref=>ref.sourceId===binding.sourceId)||!parseBinaryAssignment(binding.quote))return {kind:'stale'};return {kind:'current'};
}
