import {Schema,ParseResult} from 'effect';
import type {ArtifactRef,SourceRef} from '../core/types';

export const workflowReviewLimits=Object.freeze({sourceCharacters:20000,passages:80,rules:24,states:8,events:8,steps:12,assumptions:12,quote:500,label:160,reason:500});
export const workflowReviewAssumptions=Object.freeze([
 'This experiment includes only the reviewed quoted rules. Other text and omitted conditions have not been interpreted.',
 'An absent rule blocks the event and preserves the current state in this finite experiment.',
 'Events run one at a time in the chosen order. No real procedure or external action executes.',
]);
export type WorkflowReviewRule={readonly sourceId:string;readonly start:number;readonly end:number;readonly quote:string;readonly from:string;readonly event:string;readonly to:string;readonly interpretation:'source-stated'|'user-interpreted';readonly reason:string};
export type WorkflowReview={readonly rules:readonly WorkflowReviewRule[];readonly initialState:string;readonly eventSequence:readonly string[];readonly assumptions:readonly string[];readonly confirmed:true};
export type WorkflowReviewSource={readonly sourceId:string;readonly text:string};
export type WorkflowReviewPassage={readonly sourceId:string;readonly start:number;readonly end:number;readonly quote:string;readonly candidate:{readonly from:string;readonly event:string;readonly to:string}|null;readonly issues:readonly string[]};
export type WorkflowReviewPreparation={readonly basis:ArtifactRef;readonly sourceRefs:readonly SourceRef[];readonly sources:readonly {readonly ref:SourceRef;readonly label:string;readonly text:string}[];readonly passages:readonly WorkflowReviewPassage[];readonly issues:readonly string[];readonly assumptions:readonly string[]};
export type WorkflowReviewCheck={readonly kind:'valid';readonly value:WorkflowReview}|{readonly kind:'invalid';readonly issues:readonly {readonly path:string;readonly message:string}[]};
function literalRule(quote:string):WorkflowReviewPassage['candidate']{
 const arrows=quote.match(/->|→/g);
 if(quote.split('+').length!==2||arrows?.length!==1||quote.search(/->|→/)<quote.indexOf('+'))return null;
 const [fromPart,rest]=quote.split('+'),[eventPart,toPart]=rest.split(/->|→/);
 const values=[fromPart.trim(),eventPart.trim(),toPart.trim()];
 if(values.some(value=>!value||value.length>workflowReviewLimits.label||/[\u0000-\u001f\u007f]/u.test(value)))return null;
 return {from:values[0],event:values[1],to:values[2]};
}
const pair=(candidate:{from:string;event:string})=>JSON.stringify([candidate.from,candidate.event]);
function conflictingPairs(passages:readonly WorkflowReviewPassage[]){
 const destinations=new Map<string,Set<string>>();
 for(const passage of passages)if(passage.candidate){const key=pair(passage.candidate),values=destinations.get(key)??new Set<string>();values.add(passage.candidate.to);destinations.set(key,values);}
 return new Set([...destinations].filter(([,values])=>values.size>1).map(([key])=>key));
}
export function prepareWorkflowPassages(sources:readonly WorkflowReviewSource[]):{passages:WorkflowReviewPassage[];issues:string[]}{
 if(!sources.length||sources.length>2||new Set(sources.map(source=>source.sourceId)).size!==sources.length)return {passages:[],issues:['Choose one or two different current text sources.']};
 if(sources.some(source=>source.text.length>workflowReviewLimits.sourceCharacters))return {passages:[],issues:[`A linked source exceeds ${workflowReviewLimits.sourceCharacters.toLocaleString('en-US')} characters. Use a smaller source before reviewing workflow rules.`]};
 const passages:WorkflowReviewPassage[]=[];
 for(const source of sources){
  const lines=/([^\r\n]*)(\r\n|\r|\n|$)/g;let match:RegExpExecArray|null;
  while((match=lines.exec(source.text))&&match[0]){
   const quote=match[1].trim();if(!quote)continue;
   if(passages.length===workflowReviewLimits.passages)return {passages:[],issues:[`The linked sources exceed ${workflowReviewLimits.passages} nonempty lines. Use a smaller source; no partial rule set was prepared.`]};
   const start=match.index+match[1].indexOf(quote),candidate=quote.length<=workflowReviewLimits.quote?literalRule(quote):null;
   passages.push({sourceId:source.sourceId,start,end:start+quote.length,quote,candidate,issues:quote.length>workflowReviewLimits.quote?[`This line exceeds the ${workflowReviewLimits.quote}-character quote limit.`]:candidate?[]:['This line is not a literal transition rule. Leave it out or describe your interpretation.']});
  }
 }
 const conflicts=conflictingPairs(passages);
 return {passages:passages.map(passage=>passage.candidate&&conflicts.has(pair(passage.candidate))?{...passage,issues:[...passage.issues,'The sources give different destinations for this state and event. Choosing one requires your interpretation and a reason.']}:passage),issues:passages.length?[]:['The linked sources contain no nonempty text to review.']};
}
const boundedText=(max:number)=>Schema.String.pipe(Schema.minLength(1),Schema.maxLength(max),Schema.filter(value=>value.trim().length>0));
const label=boundedText(workflowReviewLimits.label).pipe(Schema.filter(value=>value.trim()===value&&!/[\u0000-\u001f\u007f]/u.test(value)));
const offset=Schema.Number.pipe(Schema.filter(Number.isSafeInteger),Schema.nonNegative());
const ruleSchema=Schema.Struct({sourceId:boundedText(200),start:offset,end:offset,quote:boundedText(workflowReviewLimits.quote),from:label,event:label,to:label,interpretation:Schema.Literal('source-stated','user-interpreted'),reason:boundedText(workflowReviewLimits.reason)});
const reviewSchema=Schema.Struct({rules:Schema.Array(ruleSchema).pipe(Schema.minItems(1),Schema.maxItems(workflowReviewLimits.rules)),initialState:label,eventSequence:Schema.Array(label).pipe(Schema.minItems(1),Schema.maxItems(workflowReviewLimits.steps)),assumptions:Schema.Array(boundedText(workflowReviewLimits.reason)).pipe(Schema.maxItems(workflowReviewLimits.assumptions)),confirmed:Schema.Literal(true)});
function safeBoundary(text:string,offset:number){return !(offset>0&&offset<text.length&&/[\uD800-\uDBFF]/u.test(text[offset-1])&&/[\uDC00-\uDFFF]/u.test(text[offset]));}
export function checkWorkflowReview(sources:readonly WorkflowReviewSource[],input:unknown):WorkflowReviewCheck{
 let value:WorkflowReview;
 try{value=Schema.decodeUnknownSync(reviewSchema,{onExcessProperty:'error'})(input);}catch(error){
  const fields=new Set(['rules','sourceId','start','end','quote','from','event','to','interpretation','reason','initialState','eventSequence','assumptions','confirmed']);
  const raw=ParseResult.isParseError(error)?ParseResult.ArrayFormatter.formatErrorSync(error):[];
  const issues=raw.slice(0,12).map(issue=>{const path=issue.path.filter(part=>typeof part==='number'||typeof part==='string'&&fields.has(part)).join('.');
   const field=issue.path.at(-1),message=field==='confirmed'?'Confirm that you reviewed the rules and experiment choices.':field==='reason'?'Give a reason for this rule interpretation.':field==='initialState'?'Choose a starting state from the reviewed rules.':field==='eventSequence'?'Choose between one and twelve events from the reviewed rules.':field==='rules'?'Select between one and twenty-four rules to review.':'Complete this review field within the displayed limits; remove unsupported fields.';
   return {path:path||'review',message};});
  return {kind:'invalid',issues:issues.length?issues:[{path:'review',message:'Complete the reviewed rules, experiment choices and local acknowledgement.'}]};
 }
 const prepared=prepareWorkflowPassages(sources),issues:{path:string;message:string}[]=prepared.issues.map(message=>({path:'sources',message})),conflicts=conflictingPairs(prepared.passages),pairs=new Set<string>(),states=new Set<string>(),events=new Set<string>();
 value.rules.forEach((rule,index)=>{
  const path=`rules.${index}`,source=sources.find(source=>source.sourceId===rule.sourceId);
  if(!source||rule.end<=rule.start||rule.end>source.text.length||source.text.slice(rule.start,rule.end)!==rule.quote||!safeBoundary(source.text,rule.start)||!safeBoundary(source.text,rule.end)){issues.push({path:path+'.quote',message:'Select an exact complete-character quote from a linked source.'});return;}
  if(rule.interpretation==='source-stated'){
   const passage=prepared.passages.find(passage=>passage.sourceId===rule.sourceId&&passage.start===rule.start&&passage.end===rule.end&&passage.quote===rule.quote),candidate=passage?.candidate;
   if(!candidate||candidate.from!==rule.from||candidate.event!==rule.event||candidate.to!==rule.to)issues.push({path:path+'.interpretation',message:'A source-stated rule must match a complete literal source line. Mark changed labels or prose as your interpretation and give a reason.'});
   else if(conflicts.has(pair(candidate)))issues.push({path:path+'.interpretation',message:'The linked sources disagree about this rule. Mark your chosen destination as your interpretation and explain it.'});
  }
  const key=pair(rule);if(pairs.has(key))issues.push({path:path+'.event',message:'A state and event can have only one selected rule. Resolve the duplicate before creating the experiment.'});pairs.add(key);states.add(rule.from);states.add(rule.to);events.add(rule.event);
 });
 if(states.size<2||states.size>workflowReviewLimits.states)issues.push({path:'rules',message:'The experiment needs between two and eight states in its reviewed rules.'});
 if(events.size>workflowReviewLimits.events)issues.push({path:'rules',message:'Use no more than eight different events.'});
 if(!states.has(value.initialState))issues.push({path:'initialState',message:'Choose a starting state from the reviewed rules.'});
 if(value.eventSequence.some(event=>!events.has(event)))issues.push({path:'eventSequence',message:'Every chosen event must appear in the reviewed rules.'});
 return issues.length?{kind:'invalid',issues}:{kind:'valid',value};
}
