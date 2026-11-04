import {Either,Schema} from 'effect';
import type {SourceRef,SourceVersion,Task} from '../core/types';
import {DiagramSpecSchema,diagramText,validateDiagram} from './explanation-diagram';

export const EXPLANATION_MIME='application/vnd.glint.explanation+json';
export const EXPLAIN_DEPTHS=['quick','deep','visual'] as const;
export type ExplainDepth=typeof EXPLAIN_DEPTHS[number];
export const ExplainDepthSchema=Schema.Literal(...EXPLAIN_DEPTHS);
export const explainDepthLabel:Record<ExplainDepth,string>={quick:'Quick',deep:'Deep',visual:'Visual'};
export function readExplainDepth(value:unknown):ExplainDepth{
 if(typeof value!=='string'||!(EXPLAIN_DEPTHS as readonly string[]).includes(value))throw Error('Choose a quick, deep or visual explanation.');
 return value as ExplainDepth;
}

export const CITATION_STATUSES=['verified','quote-not-found','unknown-source','version-mismatch','image-unverified'] as const;
export type CitationStatus=typeof CITATION_STATUSES[number];
export const EXPLANATION_ERROR='The explanation response could not be validated. Review the selected sources and try again.';
const fail=():never=>{throw Error(EXPLANATION_ERROR);};
const text=(max:number)=>Schema.String.pipe(Schema.maxLength(max),Schema.filter(value=>value.trim().length>0));
const SourceAnchorSchema=Schema.Struct({sourceId:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200)),version:Schema.Int.pipe(Schema.positive()),quote:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(600),Schema.filter(value=>value.trim().length>0||'Quotes must be nonblank.'))});
export type SourceAnchor=typeof SourceAnchorSchema.Type;
const CitationSchema=Schema.Struct({...SourceAnchorSchema.fields,status:Schema.Literal(...CITATION_STATUSES),label:Schema.optional(text(400)),digest:Schema.optional(text(200)),start:Schema.optional(Schema.Int.pipe(Schema.nonNegative())),end:Schema.optional(Schema.Int.pipe(Schema.nonNegative()))});
export type ExplanationCitation=typeof CitationSchema.Type;
const DeepSchema=Schema.Struct({
 coreIdea:text(1500).pipe(Schema.minLength(1)),
 parts:Schema.Array(Schema.Struct({title:text(120).pipe(Schema.minLength(1)),detail:text(1500).pipe(Schema.minLength(1))})).pipe(Schema.minItems(1),Schema.maxItems(8)),
 workedExample:text(3000).pipe(Schema.minLength(1)),
 misconceptions:Schema.Array(Schema.Struct({misconception:text(400).pipe(Schema.minLength(1)),correction:text(800).pipe(Schema.minLength(1))})).pipe(Schema.minItems(1),Schema.maxItems(5)),
 check:Schema.Struct({question:text(600).pipe(Schema.minLength(1)),answer:text(1500).pipe(Schema.minLength(1))}),
});
export type DeepBreakdown=typeof DeepSchema.Type;
const ExplanationSchema=Schema.Struct({
 schemaVersion:Schema.Literal(1),kind:Schema.Literal('explanation'),depth:ExplainDepthSchema,structure:Schema.Literal('parsed','text-fallback'),
 title:text(160).pipe(Schema.minLength(1)),answer:text(20_000),
 deep:Schema.optional(DeepSchema),
 diagram:Schema.optional(Schema.Union(Schema.Struct({status:Schema.Literal('valid'),spec:DiagramSpecSchema}),Schema.Struct({status:Schema.Literal('invalid'),reason:text(600)}))),
 citations:Schema.Array(CitationSchema).pipe(Schema.maxItems(40)),
 notices:Schema.Array(text(400)).pipe(Schema.maxItems(8)),
 revision:Schema.optional(Schema.Struct({instruction:text(16_000),basisRevision:Schema.Int.pipe(Schema.positive()),previousDepth:ExplainDepthSchema})),
});
export type Explanation=typeof ExplanationSchema.Type;
export function readExplanation(content:string):Explanation|undefined{
 if(content.length>400_000)return;
 let raw:unknown;try{raw=JSON.parse(content);}catch{return;}
 const decoded=Schema.decodeUnknownEither(ExplanationSchema,{onExcessProperty:'error'})(raw);
 if(Either.isLeft(decoded))return;
 const value=decoded.right;
 if(value.structure!=='parsed'||(value.depth==='deep')!==!!value.deep||(value.depth==='visual')!==!!value.diagram||value.diagram?.status==='invalid')return;
 if(value.diagram?.status==='valid'&&!validateDiagram(value.diagram.spec,value.citations.length).ok)return;
 return value;
}

const DEPTH_GUIDANCE:Record<ExplainDepth,string>={
 quick:'Depth: QUICK. "answer" is a short plain-language explanation of at most 5 sentences. No headings, no lists. Omit "deep" and "diagram".',
 deep:'Depth: DEEP. "answer" is a 1–3 sentence overview. Also return "deep": {"coreIdea":"the one central idea","parts":[{"title":"part or step","detail":"what it is and why it matters"}],"workedExample":"a concrete example worked step by step","misconceptions":[{"misconception":"a common wrong belief","correction":"why it is wrong and what is true"}],"check":{"question":"one check-your-understanding question","answer":"its answer with a short reason"}}. Use 1–8 parts and 1–5 misconceptions. Omit "diagram".',
 visual:'Depth: VISUAL. "answer" is a readable text explanation (at most 8 sentences) that still makes sense without the picture. Also return "diagram": {"title":"optional","direction":"down|right","nodes":[{"id":"a","label":"short label","kind":"concept|process|input|output|example|question|note","group":"optional group id","citation":1}],"edges":[{"from":"a","to":"b","label":"optional short label"}],"groups":[{"id":"g1","label":"group label"}]}. Limits: 1–24 nodes, at most 40 edges, at most 6 groups; ids are 1–32 ASCII letters, digits, underscore or hyphen; node labels ≤60 characters, edge and group labels ≤40, title ≤120; no self-edges; at most one edge per ordered node pair. "citation" is optional and is the 1-based index of an entry in "citations". Omit "deep".',
};
export type ExplanationSourceDescriptor={sourceId:string;version:number;label:string;kind:SourceVersion['kind']};
export const explanationSourceDescriptors=(sources:readonly SourceVersion[]):ExplanationSourceDescriptor[]=>sources.filter(source=>!source.id.startsWith('artifact:')).map(source=>({sourceId:source.id,version:source.version,label:source.label,kind:source.kind}));
export function explanationPrompt(input:{depth:ExplainDepth;request:string;sources:readonly ExplanationSourceDescriptor[];revision?:{instruction:string;previousDepth:ExplainDepth;basisRevision:number}}):string{
 const citing=input.sources.length?`Citable sources (cite only these exact sourceId and version values): ${JSON.stringify(input.sources)}. For each claim that relies on a source, add a citation {"sourceId","version","quote"} where "quote" is copied exactly from that source's text (1–600 characters, no paraphrase, no ellipsis). Mark claims in "answer" with [n], the 1-based index of the citation. For an image or window source, cite it with a short "quote" describing the region you rely on; it will be shown as a cited image, not as verified text. If no source supports a claim, do not cite it.`:'No sources are attached. Return "citations": [] and do not invent sources.';
 const task=input.revision?`Revise the saved explanation provided as the "Revision target" reference (revision ${input.revision.basisRevision}, previously ${explainDepthLabel[input.revision.previousDepth]} depth). Follow this instruction: ${input.revision.instruction}\nThe original question was: ${input.request}`:`Explain: ${input.request}`;
 return `${task}\n\nReturn exactly one raw JSON object without Markdown fences: {"title":"short title","answer":"Markdown text","citations":[{"sourceId":"…","version":1,"quote":"exact source text"}]} plus the depth-specific fields below.\n${DEPTH_GUIDANCE[input.depth]}\n${citing}`;
}

export function verifyAnchor(anchor:SourceAnchor,sources:readonly SourceVersion[]):ExplanationCitation{
 const base={...anchor},source=sources.find(item=>item.id===anchor.sourceId&&!item.id.startsWith('artifact:'));
 if(!source)return {...base,status:'unknown-source'};
 const known={...base,label:source.label,digest:source.digest};
 if(source.version!==anchor.version)return {...known,status:'version-mismatch'};
 if(source.kind!=='text')return {...known,status:'image-unverified'};
 const start=source.content.indexOf(anchor.quote);
 return start<0?{...known,status:'quote-not-found'}:{...known,status:'verified',start,end:start+anchor.quote.length};
}

function modelJson(content:string):unknown{
 if(content.length>200_000)return fail();
 const stack:(Set<string>|null)[]=[];
 for(let index=0;index<content.length;){
  const char=content[index];if(char==='{'||char==='['){if(stack.length>=12)return fail();stack.push(char==='{'?new Set():null);index++;continue;}
  if(char==='}'||char===']'){stack.pop();index++;continue;}if(char!=='"'){index++;continue;}
  const start=index++;while(index<content.length){if(content[index]==='\\'){index+=2;continue;}if(content[index++]==='"')break;}
  let next=index;while(next<content.length&&/\s/u.test(content[next]))next++;
  const keys=stack.at(-1);if(content[next]===':'&&keys){let key:string;try{key=JSON.parse(content.slice(start,index));}catch{return fail();}if(keys.has(key))return fail();keys.add(key);}
 }
 try{return JSON.parse(content);}catch{return fail();}
}
const Envelope=Schema.Struct({title:text(160),answer:text(20_000),citations:Schema.Array(SourceAnchorSchema).pipe(Schema.maxItems(40)),deep:Schema.optional(DeepSchema),diagram:Schema.optional(DiagramSpecSchema)});

export function parseExplanationModel(content:string,input:{depth:ExplainDepth;sources:readonly SourceVersion[];fallbackTitle:string;revision?:Explanation['revision']}):Explanation{
 const decoded=Schema.decodeUnknownEither(Envelope,{onExcessProperty:'error'})(modelJson(content));
 if(Either.isLeft(decoded))return fail();
 const envelope=decoded.right,{depth}=input;
 if((depth==='deep')!==!!envelope.deep||(depth==='visual')!==!!envelope.diagram)return fail();
 const citations=envelope.citations.map(anchor=>verifyAnchor(anchor,input.sources));
 if(citations.some(citation=>citation.status!=='verified'&&citation.status!=='image-unverified'))return fail();
 const spec=envelope.diagram?validateDiagram(envelope.diagram,citations.length):undefined;
 if(spec&&!spec.ok)return fail();
 const prose=[envelope.title,envelope.answer,...(envelope.deep?[envelope.deep.coreIdea,...envelope.deep.parts.flatMap(part=>[part.title,part.detail]),envelope.deep.workedExample,...envelope.deep.misconceptions.flatMap(item=>[item.misconception,item.correction]),envelope.deep.check.question,envelope.deep.check.answer]:[])].join('\n');
 for(const match of prose.matchAll(/\[(\d+)\]/gu))if(Number(match[1])<1||Number(match[1])>citations.length)return fail();
 return {schemaVersion:1,kind:'explanation',depth,structure:'parsed',title:envelope.title,answer:envelope.answer,...(envelope.deep?{deep:envelope.deep}:{}),...(spec?.ok?{diagram:{status:'valid',spec:spec.spec}}:{}),citations,notices:[],...(input.revision?{revision:input.revision}:{})};
}

/** Binds persisted citations to the artifact's exact immutable source references. */
export function explanationSourcesValid(explanation:Explanation,refs:readonly SourceRef[],sources:readonly SourceVersion[]):boolean{
 return explanation.citations.every(citation=>{
  if(!refs.some(ref=>ref.sourceId===citation.sourceId&&ref.version===citation.version&&ref.digest===citation.digest))return false;
  const verified=verifyAnchor(citation,sources);
  return (verified.status==='verified'||verified.status==='image-unverified')&&verified.status===citation.status&&verified.digest===citation.digest&&verified.label===citation.label&&verified.start===citation.start&&verified.end===citation.end;
 });
}

export type CitationDisplay={state:'verified'|'stale'|'not-found'|'unknown-source'|'version-mismatch'|'image'|'image-stale';label:string;start?:number;end?:number};
/** Recomputed from saved task sources each time; saved "verified" status alone is never trusted. */
export function citationDisplay(task:Pick<Task,'sources'>,citation:ExplanationCitation):CitationDisplay{
 const source=task.sources.find(item=>item.id===citation.sourceId),label=citation.label??'Unknown source';
 if(citation.status==='unknown-source')return {state:'unknown-source',label};
 if(citation.status==='version-mismatch')return {state:'version-mismatch',label};
 if(citation.status==='quote-not-found')return {state:'not-found',label};
 const cited=source?.versions.find(version=>version.version===citation.version&&version.digest===citation.digest),current=source?.versions.at(-1);
 const changed=!source||!current||source.freshness!=='fresh'||current.version!==citation.version||current.digest!==citation.digest;
 if(citation.status==='image-unverified')return {state:changed?'image-stale':'image',label};
 if(!cited||cited.kind!=='text'||citation.start===undefined||citation.end===undefined||citation.end!==citation.start+citation.quote.length||cited.content.slice(citation.start,citation.end)!==citation.quote)return {state:'not-found',label};
 return {state:changed?'stale':'verified',label,start:citation.start,end:citation.end};
}
export const citationStateText:Record<CitationDisplay['state'],string>={verified:'Quote matches saved version','stale':'Source changed since this revision','not-found':'Quote not found in source','unknown-source':'Not one of the supplied sources','version-mismatch':'Cites a version that was not supplied',image:'Cited image · not text-verified','image-stale':'Cited image · source changed · not text-verified'};

export function explanationText(explanation:Explanation):string{
 const parts=[`# ${explanation.title}`,`${explainDepthLabel[explanation.depth]} explanation`,explanation.answer];
 if(explanation.deep){const d=explanation.deep;parts.push(`## Core idea\n\n${d.coreIdea}`,`## Parts\n\n${d.parts.map((part,i)=>`${i+1}. **${part.title}** — ${part.detail}`).join('\n')}`,`## Worked example\n\n${d.workedExample}`,`## Common misconceptions\n\n${d.misconceptions.map(m=>`- ${m.misconception} — ${m.correction}`).join('\n')}`,`## Check your understanding\n\n${d.check.question}\n\nAnswer: ${d.check.answer}`);}
 if(explanation.diagram)parts.push(explanation.diagram.status==='valid'?diagramText(explanation.diagram.spec):`Diagram could not be validated: ${explanation.diagram.reason}`);
 if(explanation.citations.length)parts.push(`## Citations\n\n${explanation.citations.map((c,i)=>`[${i+1}] ${c.label??c.sourceId} · version ${c.version} · ${c.status}: “${c.quote}”`).join('\n')}`);
 return parts.join('\n\n');
}
