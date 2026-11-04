import {recognizeRangeSum,rangeSumVariables,RANGE_SUM_FORMULA,RANGE_SUM_ASSUMPTION} from './python-range-sum';
import {Schema} from 'effect';
import {copyTableData} from './semantic-table-procedure';
import {evaluateExperiment} from '../core/experiments';
import {parseModelDraft,type ExperimentDraft} from '../core/model-drafts';
import type {Task,SourceRef,ArtifactRevision,Expression} from '../core/types';
import {pickingCanonical,pickingDigest} from '../shared/picking-digest';

export const SOURCE_FORMULA_MIME='application/vnd.window-companion.source-formula+json';
export const SOURCE_FORMULA_SHARING='Saving creates a regular local experiment with the exact source quotation, correction, inputs and assumptions. This saved content and later saved practice/results can be included in future AI or browser context under the existing request and source-sharing controls. Editing and previewing here stay local; no AI request is made.';
export const sourceFormulaLimits=Object.freeze({sourceCharacters:32000,lines:512,formulaCharacters:2000,tokens:256,nodes:64,depth:12,variables:12,attempts:8,packetCharacters:64000});
const id=Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,80}$/)),digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),positive=Schema.Int.pipe(Schema.positive()),bounded=Schema.Number.pipe(Schema.between(-1e9,1e9),Schema.filter(Number.isFinite));
const sourceRef=Schema.Struct({sourceId:id,version:positive,digest});
const variable=Schema.Struct({name:Schema.String.pipe(Schema.pattern(/^[A-Za-z][A-Za-z0-9_]{0,31}$/),Schema.filter(value=>!['constructor','prototype','__proto__'].includes(value))),unit:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(80)),min:bounded,max:bounded,value:bounded,integer:Schema.optional(Schema.Literal(true))});
export const SourceFormulaInputSchema=Schema.Struct({taskId:id,sourceRef,lineNumber:Schema.Int.pipe(Schema.between(1,512)),start:Schema.Int.pipe(Schema.between(0,32000)),end:Schema.Int.pipe(Schema.between(1,32000)),title:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200)),formula:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(2000)),variables:Schema.Array(variable).pipe(Schema.minItems(1),Schema.maxItems(12)),assumptions:Schema.Array(Schema.String.pipe(Schema.minLength(1),Schema.maxLength(500))).pipe(Schema.minItems(1),Schema.maxItems(12)),correctionReason:Schema.String.pipe(Schema.maxLength(500),Schema.filter(value=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))),confirmed:Schema.Literal('reviewed-source-transcription'),derivation:Schema.optional(Schema.Literal('python-range-sum-v1'))});
const command=Schema.Struct({input:SourceFormulaInputSchema,retryOf:Schema.optional(Schema.String.pipe(Schema.maxLength(100)))});
export type SourceFormulaInput=typeof SourceFormulaInputSchema.Type;
export type SourceFormulaCommand=typeof command.Type;
export type SourceFormulaCitation={sourceRef:SourceRef;lineNumber:number;start:number;end:number;quote:string;lineCount?:3};
export type SourceFormulaPacket={format:'source-formula-v1';input:SourceFormulaInput;citation:SourceFormulaCitation;draft:ExperimentDraft;publication:{binding:string;requestId:string}};
const decode=<A,I>(schema:Schema.Schema<A,I>,value:unknown)=>Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(copyTableData(value,64000,4000));
export const readSourceFormulaInput=(value:unknown)=>decode(SourceFormulaInputSchema,value);
export const readSourceFormulaCommand=(value:unknown)=>decode(command,value);

/** A finite arithmetic parser, never eval/JavaScript/HDL. Powers bind before unary minus. */
export function parseSourceFormula(text:string,allowConstant=false):{expression:Expression;variables:string[];resultName:string|null}{
 if(typeof text!=='string'||!text.trim()||text.length>sourceFormulaLimits.formulaCharacters)throw Error('Enter a formula of 1–2,000 characters.');
 const tokens:string[]=[];let position=0;
 while(position<text.length){
  const rest=text.slice(position),space=/^\s+/u.exec(rest);if(space){position+=space[0].length;continue;}
  const token=/^(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z][A-Za-z0-9_]*|[+\-−*×/÷^()=])/u.exec(rest);
  if(!token)throw Error('Use numbers, named variables, + − × ÷, parentheses and integer powers. Functions, units in the formula and implicit multiplication are unsupported.');
  tokens.push(token[0]);position+=token[0].length;if(tokens.length>256)throw Error('This formula exceeds the 256-token limit.');
 }
 let at=0,depth=0;const names:string[]=[];let resultName:string|null=null;
 const isName=(value:string|undefined)=>!!value&&/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(value)&&!['constructor','prototype','__proto__'].includes(value);
 if(tokens.includes('=')){if(!isName(tokens[0])||tokens[1]!=='='||tokens.filter(token=>token==='=').length!==1)throw Error('Use at most one result name followed by = and an arithmetic expression.');resultName=tokens[0];at=2;}
 const guard=<T,>(fn:()=>T):T=>{if(++depth>32)throw Error('This formula exceeds the supported nesting depth.');try{return fn();}finally{depth--;}};
 const atom=():Expression=>guard(()=>{const token=tokens[at++];if(token==='('){const value=sum();if(tokens[at++]!==')')throw Error('Close each formula parenthesis.');return value;}if(isName(token)){if(!names.includes(token))names.push(token);return {op:'variable',name:token};}if(token&&/^(?:\d|\.)/.test(token)){const value=Number(token);if(!Number.isFinite(value)||Math.abs(value)>1e9)throw Error('Constants must be finite and at most 1,000,000,000 in magnitude.');return {op:'constant',value};}throw Error('Enter a supported number, variable or parenthesized expression.');});
 const power=():Expression=>{let value=atom();if(tokens[at]==='^'){at++;let sign=1;if(tokens[at]==='-'||tokens[at]==='−'){sign=-1;at++;}else if(tokens[at]==='+')at++;const token=tokens[at++];if(!token||!/^\d+$/.test(token)||Number(token)>8)throw Error('Powers must be literal integers from -8 to 8.');value={op:'power',base:value,exponent:sign*Number(token)};}return value;};
 const unary=():Expression=>guard(()=>{if(tokens[at]==='+'){at++;return unary();}if(tokens[at]==='-'||tokens[at]==='−'){at++;return {op:'multiply',left:{op:'constant',value:-1},right:unary()};}return power();});
 const product=():Expression=>{let left=unary();while(['*','×','/','÷'].includes(tokens[at])){const operator=tokens[at++],right=unary();left={op:operator==='*'||operator==='×'?'multiply':'divide',left,right};}return left;};
 const sum=():Expression=>{let left=product();while(['+','-','−'].includes(tokens[at])){const operator=tokens[at++],right=product();left={op:operator==='+'?'add':'subtract',left,right};}return left;};
 const expression=sum();if(at!==tokens.length)throw Error('Unexpected formula text. Write multiplication explicitly and parenthesize chained powers.');
 let nodes=0;const inspect=(value:Expression,depth:number):void=>{if(++nodes>64||depth>12)throw Error('Use at most 64 expression nodes and depth 12.');if(value.op==='power')inspect(value.base,depth+1);else if(value.op!=='constant'&&value.op!=='variable'){inspect(value.left,depth+1);inspect(value.right,depth+1);}};inspect(expression,1);
 if((!names.length&&!allowConstant)||names.length>12)throw Error('Use 1–12 named input variables.');if(resultName&&names.includes(resultName))throw Error('The result name cannot also be an input.');
 return {expression,variables:names,resultName};
}
export function sourceFormulaLines(text:string){
 if(typeof text!=='string'||!text.length||text.length>32000||text.includes('\0'))throw Error('Choose a nonempty saved text source of at most 32,000 characters without NUL characters.');
 const parts=text.split(/(\r\n|\r|\n)/),lines:{lineNumber:number;start:number;end:number;quote:string}[]=[];let start=0;
 for(let index=0;index<parts.length;index+=2){const quote=parts[index];lines.push({lineNumber:lines.length+1,start,end:start+quote.length,quote});start+=quote.length+(parts[index+1]?.length??0);if(lines.length>512)throw Error('Choose a source with at most 512 lines. No partial source was read.');}
 return lines;
}
export function sourceFormulaBinding(input:SourceFormulaInput){return pickingDigest(input);}
export function sourceFormulaRequestId(input:SourceFormulaInput,index=0){if(!Number.isInteger(index)||index<0||index>=8)throw Error('The formula save retry limit was reached.');return 'source-formula-v1-'+sourceFormulaBinding(input)+(index?'_'+index:'');}
export function sourceFormulaAttempt(input:SourceFormulaInput,id:string){for(let index=0;index<8;index++)if(sourceFormulaRequestId(input,index)===id)return index;return -1;}
function exactFormulaCitation(input:SourceFormulaInput,text:string):SourceFormulaCitation{
 if(input.derivation){const loop=recognizeRangeSum(text);if(!loop||input.lineNumber!==1||input.start!==0||input.end!==loop.end)throw Error('Choose the exact complete supported three-line range accumulation source.');return {sourceRef:{...input.sourceRef},lineNumber:1,start:0,end:loop.end,quote:loop.quote,lineCount:3};}
 const line=sourceFormulaLines(text).find(line=>line.lineNumber===input.lineNumber);if(!line||line.start!==input.start||line.end!==input.end||!line.quote.trim()||line.quote.length>2000)throw Error('Choose one exact nonempty source line of at most 2,000 characters.');return {...line,sourceRef:{...input.sourceRef}};
}
export function buildSourceFormulaDraft(input:SourceFormulaInput,citation:SourceFormulaCitation):ExperimentDraft{
 if(input.derivation){const loop=recognizeRangeSum(citation.quote);if(!loop||citation.lineCount!==3||input.formula!==RANGE_SUM_FORMULA||pickingCanonical(input.variables)!==pickingCanonical(rangeSumVariables(loop))||!input.assumptions.includes(RANGE_SUM_ASSUMPTION))throw Error('The derived range-sum model must preserve the exact source mapping, integer defaults, bounds, formula and required assumption. Review another source explicitly to correct it.');}
 else if(citation.lineCount!==undefined)throw Error('A multiline citation requires the supported derived source model.');
 const parsed=parseSourceFormula(input.formula);if(input.variables.length!==parsed.variables.length||new Set(input.variables.map(item=>item.name)).size!==parsed.variables.length||parsed.variables.some(name=>!input.variables.some(item=>item.name===name)))throw Error('Define each formula input exactly once, without extra variables.');
 if(input.formula!==citation.quote&&!input.correctionReason.trim())throw Error('Explain the change from the exact source quotation before saving this corrected transcription.');
 if(input.formula===citation.quote&&input.correctionReason!=='')throw Error('The formula matches the source exactly. Clear the correction reason or edit the formula explicitly.');
 return parseModelDraft(JSON.stringify({schemaVersion:1,kind:'experiment',title:input.title,explanation:input.derivation?'An explicitly reviewed, bounded arithmetic derivation of a three-line Python range accumulation idiom. No Python is executed.':'A locally reviewed transcription of a cited source formula. The quotation records provenance; it does not verify the model or its assumptions.',spec:{title:input.title,expression:parsed.expression,variables:input.variables.map(({name,unit,min,max,integer})=>({name,unit,min,max,...(integer?{integer}:{})})),assumptions:input.assumptions},inputs:Object.fromEntries(input.variables.map(item=>[item.name,item.value]))}),'experiment') as ExperimentDraft;
}
export function sourceFormulaPreview(task:Task,raw:unknown){
 const input=readSourceFormulaInput(raw);if(task.id!==input.taskId||task.status!=='active')throw Error('Open and resume the exact owning task before saving a formula.');
 const source=task.sources.find(item=>item.id===input.sourceRef.sourceId),version=source?.versions.at(-1);if(source?.freshness!=='fresh'||source.currentVersion!==input.sourceRef.version||version?.version!==input.sourceRef.version||version.digest!==input.sourceRef.digest||version.kind!=='text')throw Error('The selected source version changed or needs refresh. Review its current version explicitly.');
 const citation=exactFormulaCitation(input,version.content),draft=buildSourceFormulaDraft(input,citation);return {input,citation,draft,binding:sourceFormulaBinding(input),sourceLabel:version.label,result:evaluateExperiment(draft.spec,draft.inputs)};
}
const packetSchema=Schema.Struct({format:Schema.Literal('source-formula-v1'),input:SourceFormulaInputSchema,citation:Schema.Struct({sourceRef,lineNumber:positive,start:Schema.Int.pipe(Schema.nonNegative()),end:positive,quote:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(2000)),lineCount:Schema.optional(Schema.Literal(3))}),draft:Schema.Unknown,publication:Schema.Struct({binding:digest,requestId:Schema.String.pipe(Schema.maxLength(100))})});
export function readSourceFormulaPacket(content:string):SourceFormulaPacket{
 if(typeof content!=='string'||content.length>64000)throw Error('The saved source formula exceeds its supported size.');const parsed=decode(packetSchema,JSON.parse(content)),input=readSourceFormulaInput(parsed.input),draft=buildSourceFormulaDraft(input,parsed.citation);
 if(pickingCanonical(parsed.draft)!==pickingCanonical(draft)||parsed.publication.binding!==sourceFormulaBinding(input)||sourceFormulaAttempt(input,parsed.publication.requestId)<0||pickingCanonical(parsed.citation.sourceRef)!==pickingCanonical(input.sourceRef)||parsed.citation.lineNumber!==input.lineNumber||parsed.citation.start!==input.start||parsed.citation.end!==input.end||input.end-input.start!==parsed.citation.quote.length)throw Error('The saved formula transcription or its provenance changed.');
 return {...parsed,input,draft};
}
/** A custom MIME cannot be created/revised by the generic artifact command.
 * Interactive publication additionally needs the actual completed local request. */
export function reviewedSourceFormula(task:Task,artifactId:string,revision:ArtifactRevision):SourceFormulaPacket{
 if(revision.mimeType!==SOURCE_FORMULA_MIME||revision.encoding==='base64')throw Error('This is not a supported cited formula.');const packet=readSourceFormulaPacket(revision.content),request=task.requests.find(item=>item.id===packet.publication.requestId),ref=packet.input.sourceRef;
 if(packet.input.taskId!==task.id||request?.status!=='completed'||request.kind!=='experiment'||request.artifactId!==artifactId||request.answer?.artifactId!==artifactId||request.answer.revision!==revision.revision||request.answer.digest!==revision.digest||pickingCanonical(request.sourceRefs)!==pickingCanonical([ref])||pickingCanonical(revision.sourceRefs)!==pickingCanonical([ref]))throw Error('The original reviewed formula publication needs inspection.');
 const source=task.sources.find(item=>item.id===ref.sourceId),version=source?.versions.find(item=>item.version===ref.version&&item.digest===ref.digest);if(version?.kind!=='text')throw Error('The exact quoted source snapshot is unavailable.');const citation=exactFormulaCitation(packet.input,version.content);if(pickingCanonical(citation)!==pickingCanonical(packet.citation))throw Error('The exact source quotation no longer matches its recorded snapshot.');return packet;
}
export function sourceFormulaCitationText(packet:SourceFormulaPacket){
 const quote=(value:string)=>{const fence='`'.repeat(Math.max(3,...(value.match(/`+/g)??[]).map(run=>run.length+1)));return `${fence}text\n${value}\n${fence}`;},c=packet.citation;
 return `Cited local formula transcription\nSource: ${c.sourceRef.sourceId}; version ${c.sourceRef.version}; digest ${c.sourceRef.digest}.\n${c.lineCount?'Lines '+c.lineNumber+'–'+(c.lineNumber+c.lineCount-1):'Line '+c.lineNumber}; UTF-16 character offsets [${c.start}, ${c.end}).\n\nExact source quotation:\n${quote(c.quote)}\n\nReviewed formula:\n${quote(packet.input.formula)}${packet.input.correctionReason?'\n\n'+(packet.input.derivation?'Derivation rationale':'User correction reason')+':\n'+quote(packet.input.correctionReason):'\n\nThe reviewed formula matches the exact source line.'}${inputDerivationText(packet)}\n\n${packet.input.derivation?'Defaults map to the reviewed source literals; whole-number bounds and dimensionless units belong to this limited model.':'Variable values, units, bounds and assumptions were supplied by the user.'} This citation does not verify the model or establish real-world causation.`;
}

function inputDerivationText(packet:SourceFormulaPacket){return packet.input.derivation?'\n\nBounded derived model: initial maps to the reviewed accumulator literal; count maps to the reviewed range stop. The arithmetic identity sums integers 0 through count - 1. This is an illustrative calculation, not executed Python.':'';}
