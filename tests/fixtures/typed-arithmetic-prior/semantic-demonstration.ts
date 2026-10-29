import {Schema} from 'effect';
import {SemanticExpectedSchema,checkSemanticExamples,parseSemanticProcedure,runSemanticProcedure,type SemanticExample,type SemanticExampleCheck,type SemanticProcedure,type SemanticRunResult,type SemanticStep} from './semantic-procedure';

export const semanticDemonstrationLimits=Object.freeze({members:20000,characters:512000,depth:64,recordings:8,rationales:64,corrections:64,examples:20});
const id=Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,80}$/),Schema.filter(value=>!['__proto__','prototype','constructor'].includes(value)));
const revision=Schema.Int.pipe(Schema.between(0,500));
const scalar=Schema.Union(Schema.String.pipe(Schema.maxLength(4000)),Schema.Number.pipe(Schema.between(-1e12,1e12)),Schema.Boolean);
const localRecord=Schema.Record({key:Schema.String,value:scalar});
const contextSchema=Schema.Struct({helperId:id,atRevision:revision});
const requestSchema=Schema.Struct({recordingId:id,procedure:Schema.Unknown,input:localRecord});
export type SemanticRecordingContext=typeof contextSchema.Type;
export type SemanticRecordingRequest=Omit<typeof requestSchema.Type,'procedure'>&{readonly procedure:SemanticProcedure};
const receiptSchema=Schema.Struct({schemaVersion:Schema.Literal(1),kind:Schema.Literal('computed-local-replay'),helperId:id,atRevision:revision,recordingId:id,procedure:Schema.Unknown,input:localRecord,result:Schema.Unknown,externalObservationVerified:Schema.Literal(false),effectAuthority:Schema.Literal('none')});
export type SemanticRecording=Omit<typeof receiptSchema.Type,'procedure'|'result'>&{readonly procedure:SemanticProcedure;readonly result:Exclude<SemanticRunResult,{status:'invalid-input'}>};

function fail(message:string):never {throw Error(message);}
function copyData(value:unknown):unknown {
 const ancestors=new Set<object>();let members=0,characters=0;
 function copy(value:unknown,depth:number):unknown {
  if(++members>semanticDemonstrationLimits.members||depth>semanticDemonstrationLimits.depth)fail('The demonstration exceeds its local structure limit.');
  if(typeof value==='string'){characters+=value.length;if(characters>semanticDemonstrationLimits.characters)fail('The demonstration exceeds its local character limit.');return value;}
  if(typeof value==='number'){if(!Number.isFinite(value))fail('Demonstration numbers must be finite.');return value;}
  if(value===null||typeof value==='boolean')return value;
  if(typeof value!=='object')return fail('A demonstration accepts inert JSON data only.');
  if(ancestors.has(value))fail('Cyclic demonstration data is unsupported.');
  const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
  if(prototype!==null&&prototype!==Object.prototype&&!(array&&prototype===Array.prototype))fail('Demonstration data must use plain records and arrays.');
  const keys=Reflect.ownKeys(value);
  if(keys.length>semanticDemonstrationLimits.members-members)fail('The demonstration exceeds its local structure limit.');
  for(const key of keys){
   if(typeof key!=='string'||key.length>80||!/^[A-Za-z0-9_-]+$/.test(key)||['__proto__','prototype','constructor'].includes(key))fail('Unsupported demonstration member name.');
   characters+=key.length;
  }
  if(characters>semanticDemonstrationLimits.characters)fail('The demonstration exceeds its local character limit.');
  const descriptors=Object.getOwnPropertyDescriptors(value);ancestors.add(value);
  if(array){
   if(value.length>semanticDemonstrationLimits.members||keys.length!==value.length+1)fail('Demonstration arrays must be dense and bounded.');
   const values:unknown[]=[];
   for(let index=0;index<value.length;index++){
    const descriptor=descriptors[String(index)];
    if(!descriptor||!('value' in descriptor)||!descriptor.enumerable)fail('Demonstration accessors and sparse arrays are unsupported.');
    values.push(copy(descriptor.value,depth+1));
   }
   ancestors.delete(value);return values;
  }
  const entries:[string,unknown][]=[];
  for(const key of keys){
   if(typeof key!=='string')return fail('Demonstration symbols are unsupported.');
   const descriptor=descriptors[key];
   if(!('value' in descriptor)||!descriptor.enumerable)fail('Demonstration accessors and hidden members are unsupported.');
   entries.push([key,copy(descriptor.value,depth+1)]);
  }
  ancestors.delete(value);return Object.fromEntries(entries);
 }
 return copy(value,0);
}
function decode<A,I>(schema:Schema.Schema<A,I>,value:unknown):A {
 try{return Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(copyData(value));}
 catch(error){if(error instanceof Error&&error.name==='ParseError')fail('Unsupported or malformed demonstration fields.');throw error;}
}

/** The host must supply context from owned state. This records a computation, never an external observation. */
export function createSemanticRecording(contextValue:unknown,requestValue:unknown):SemanticRecording {
 const context=decode(contextSchema,contextValue),request=decode(requestSchema,requestValue),procedure=parseSemanticProcedure(request.procedure);
 const result=runSemanticProcedure(procedure,request.input);
 if(result.status==='invalid-input')fail(`Cannot record an invalid ${result.stage}: ${result.reason}`);
 const recording:SemanticRecording={schemaVersion:1,kind:'computed-local-replay',...context,recordingId:request.recordingId,procedure,input:request.input,result,externalObservationVerified:false,effectAuthority:'none'};
 copyData(recording);return recording;
}

function canonical(value:unknown):string {
 if(value===null||typeof value==='string'||typeof value==='number'||typeof value==='boolean')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map((item:unknown)=>canonical(item)).join(',')+']';
 if(typeof value==='object')return '{'+Object.keys(value).sort().map(key=>{
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor||!('value' in descriptor))fail('A replay comparison requires inert data.');
  return JSON.stringify(key)+':'+canonical(descriptor.value);
 }).join(',')+'}';
 return fail('A replay comparison requires inert data.');
}

/** Replay consistency cannot authenticate who originally supplied a stored receipt. Host ownership remains a separate gate. */
export function parseSemanticRecording(contextValue:unknown,receiptValue:unknown):SemanticRecording {
 const context=decode(contextSchema,contextValue),receipt=decode(receiptSchema,receiptValue);
 if(receipt.helperId!==context.helperId)fail('This replay receipt belongs to another helper.');
 if(receipt.atRevision>context.atRevision)fail('This replay receipt refers to a future helper revision.');
 const replay=createSemanticRecording({helperId:receipt.helperId,atRevision:receipt.atRevision},{recordingId:receipt.recordingId,procedure:receipt.procedure,input:receipt.input});
 if(canonical(receipt.result)!==canonical(replay.result))fail('The replay receipt differs from its exact input, definition or trace.');
 return replay;
}

const reason=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(500),Schema.filter(value=>value.trim().length>0));
const basisSchema=Schema.Struct({recordingId:id,traceStepId:id});
const rationaleSchema=Schema.Struct({id,kind:Schema.Literal('inferred-rationale'),stepId:id,basis:Schema.Array(basisSchema).pipe(Schema.minItems(1),Schema.maxItems(8)),reason});
const correctionSchema=Schema.Struct({id,proposalId:id,before:reason,after:reason,reason});
export type SemanticRationaleProposal=typeof rationaleSchema.Type;
export type SemanticRationaleCorrection=typeof correctionSchema.Type;
const recordingCorrectionSchema=Schema.Struct({kind:Schema.Literal('declared-recording-expectation'),id,helperId:id,recordingId:id,atRevision:revision,procedureVersion:Schema.Int.pipe(Schema.between(1,20)),previousCorrectionId:Schema.NullOr(id),before:SemanticExpectedSchema,after:SemanticExpectedSchema,reason});
export type SemanticRecordingCorrection=typeof recordingCorrectionSchema.Type;
export type SemanticRecordingExpectation={readonly recordingId:string;readonly original:SemanticExample;readonly effective:SemanticExample;readonly correctionIds:readonly string[]};
const candidateSchema=Schema.Struct({schemaVersion:Schema.Literal(1),procedure:Schema.Unknown,
 recordings:Schema.Array(Schema.Unknown).pipe(Schema.minItems(1),Schema.maxItems(semanticDemonstrationLimits.recordings)),
 rationales:Schema.Array(rationaleSchema).pipe(Schema.maxItems(semanticDemonstrationLimits.rationales)),
 corrections:Schema.Array(correctionSchema).pipe(Schema.maxItems(semanticDemonstrationLimits.corrections)),
 examples:Schema.Array(Schema.Unknown).pipe(Schema.maxItems(semanticDemonstrationLimits.examples)),recordingCorrections:Schema.optional(Schema.Array(recordingCorrectionSchema).pipe(Schema.maxItems(64))),
});
export type SemanticDemonstrationCandidate=Omit<typeof candidateSchema.Type,'procedure'|'recordings'|'examples'>&{readonly procedure:SemanticProcedure;readonly recordings:readonly SemanticRecording[];readonly examples:readonly SemanticExample[]};
export type SemanticRationale={readonly proposalId:string;readonly stepId:string;readonly basis:ReadonlyArray<typeof basisSchema.Type>;readonly proposedReason:string;readonly currentReason:string;readonly status:'proposed'|'corrected';readonly correctionIds:readonly string[]};
export type SemanticDemonstrationCheck={readonly passed:boolean;readonly issues:readonly string[];readonly recordings:readonly SemanticRecording[];readonly recordingExpectations:readonly SemanticRecordingExpectation[];readonly rationales:readonly SemanticRationale[];readonly checks:SemanticExampleCheck|null;readonly hostOwnershipVerified:false;readonly independentHeldOutVerified:false;readonly activationAuthorized:false;readonly effectAuthority:'none'};

function unique(values:readonly (string|number)[],message:string):void {if(new Set(values).size!==values.length)fail(message);}
function stepIds(procedure:SemanticProcedure):Set<string> {
 const ids=new Set([...procedure.preconditions,...procedure.postconditions].map(condition=>condition.id));
 function visit(step:SemanticStep):void {
  ids.add(step.id);
  switch(step.kind){
   case 'assign':visit(step.next);return;
   case 'branch':visit(step.then);visit(step.else);return;
   case 'return':case 'abstain':return;
   default:{const exhaustive:never=step;return exhaustive;}
  }
 }
 visit(procedure.root);return ids;
}
function recordingExample(recording:SemanticRecording,index:number):SemanticExample {
 const result=recording.result,id=`recorded-${index+1}`;
 if(result.status==='completed')return {id,role:'example',input:recording.input,expected:{status:'completed',output:result.output}};
 return {id,role:result.code==='explicit-stop'?'exception':'counterexample',input:recording.input,expected:{status:'abstained',haltedStepId:result.haltedStepId,code:result.code}};
}

/** Receipts change declared checks only; the original replay is never rewritten. */
export function semanticRecordingExpectations(context:SemanticRecordingContext,procedure:SemanticProcedure,recordings:readonly SemanticRecording[],correctionsValue:unknown):readonly SemanticRecordingExpectation[]{
 const corrections=decode(Schema.Array(recordingCorrectionSchema).pipe(Schema.maxItems(64)),correctionsValue);
 unique(corrections.map(item=>item.id),'Recorded-expectation correction identities must be unique.');
 const expectations=recordings.map((recording,index)=>{const original=recordingExample(recording,index);return {recordingId:recording.recordingId,original,effective:original,correctionIds:[] as string[]};});
 let previousRevision=-1;
 for(const correction of corrections){
  const recording=recordings.find(item=>item.recordingId===correction.recordingId),entry=expectations.find(item=>item.recordingId===correction.recordingId);
  if(!recording||!entry)fail('A corrected expectation refers to an unavailable original recording.');
  if(correction.helperId!==context.helperId)fail('A corrected expectation belongs to another helper.');
  if(correction.atRevision<=recording.atRevision||correction.atRevision>context.atRevision||correction.atRevision<=previousRevision)fail('Recorded-expectation corrections must retain their original revision order.');
  if(correction.procedureVersion<=recording.procedure.version||correction.procedureVersion>procedure.version)fail('Correct an original recording only in a later draft definition.');
  if(correction.previousCorrectionId!==(entry.correctionIds.at(-1)??null)||canonical(correction.before)!==canonical(entry.effective.expected))fail('A corrected expectation does not match its previous declared expectation.');
  if(canonical(correction.before)===canonical(correction.after))fail('A correction must change the expected outcome.');
  const expected=correction.after,role=expected.status==='completed'?'example':expected.status==='abstained'&&expected.code==='explicit-stop'?'exception':'counterexample';
  entry.effective={...entry.original,role,expected};entry.correctionIds.push(correction.id);previousRevision=correction.atRevision;
 }
 return expectations;
}

/**
 * Checks local replay and provenance consistency, not host authenticity or user review.
 * The host must reject renderer-supplied receipts and derive these from its owned module state.
 * Declared transfer examples cannot establish independent withholding, mastery or activation.
 * A higher candidate version still requires the host's immutable history binding, which this seam cannot verify.
 */
export function checkSemanticDemonstration(contextValue:unknown,candidateValue:unknown):SemanticDemonstrationCheck {
 try{
  const context=decode(contextSchema,contextValue),candidate=decode(candidateSchema,candidateValue),procedure=parseSemanticProcedure(candidate.procedure);
  const recordings=candidate.recordings.map(recording=>parseSemanticRecording(context,recording));
  unique(recordings.map(recording=>recording.recordingId),'Recording identities must be unique.');
  unique(recordings.map(recording=>recording.atRevision),'Recording revisions must be unique.');
  const definitionsByVersion=new Map([[procedure.version,canonical(procedure)]]);
  for(const recording of recordings){
   if(recording.procedure.id!==procedure.id||recording.procedure.target!==procedure.target)fail('A recording belongs to another procedure or target.');
   if(recording.procedure.version>procedure.version)fail('A recording refers to a later procedure version.');
   const definition=canonical(recording.procedure),previous=definitionsByVersion.get(recording.procedure.version);
   if(previous!==undefined&&previous!==definition)fail('The same procedure version must retain the exact recorded definition.');
   definitionsByVersion.set(recording.procedure.version,definition);
  }
  const ids=stepIds(procedure),recordingById=new Map(recordings.map(recording=>[recording.recordingId,recording]));
  unique(candidate.rationales.map(proposal=>proposal.id),'Rationale identities must be unique.');
  unique(candidate.rationales.map(proposal=>proposal.stepId),'Use one proposed rationale per semantic step.');
  unique(candidate.corrections.map(correction=>correction.id),'Correction identities must be unique.');
  const rationales=new Map<string,SemanticRationale>();
  for(const proposal of candidate.rationales){
   if(!ids.has(proposal.stepId))fail('A proposed rationale refers to an unknown semantic step.');
   unique(proposal.basis.map(basis=>canonical(basis)),'A rationale repeats the same recording basis.');
   for(const basis of proposal.basis){
    const recording=recordingById.get(basis.recordingId);
    if(!recording||!recording.result.trace.some(step=>step.stepId===basis.traceStepId))fail('A proposed rationale must cite an actual step in a supplied local replay.');
   }
   rationales.set(proposal.id,{proposalId:proposal.id,stepId:proposal.stepId,basis:proposal.basis,proposedReason:proposal.reason,currentReason:proposal.reason,status:'proposed',correctionIds:[]});
  }
  for(const correction of candidate.corrections){
   const previous=rationales.get(correction.proposalId);
   if(!previous)fail('A correction refers to an unknown rationale.');
   if(correction.before!==previous.currentReason)fail('A correction does not match the previous rationale text.');
   if(correction.before===correction.after)fail('A correction must change the rationale text.');
   rationales.set(correction.proposalId,{...previous,currentReason:correction.after,status:'corrected',correctionIds:[...previous.correctionIds,correction.id]});
  }
  const recordingExpectations=semanticRecordingExpectations(context,procedure,recordings,candidate.recordingCorrections??[]);
  const checks=checkSemanticExamples(procedure,[...recordingExpectations.map(item=>item.effective),...candidate.examples]);
  const issues=[...checks.coverageIssues,...checks.cases.filter(check=>!check.passed).map(check=>`Example ${check.id} does not match its expected outcome.`)];
  if(!candidate.rationales.length)issues.unshift('Add a reason grounded in a recorded computation.');
  if(!recordings.some(recording=>recording.result.status==='completed'))issues.unshift('Record at least one completed local computation.');
  return {passed:issues.length===0&&checks.passed,issues,recordings,recordingExpectations,rationales:[...rationales.values()],checks,hostOwnershipVerified:false,independentHeldOutVerified:false,activationAuthorized:false,effectAuthority:'none'};
 }catch(error){return {passed:false,issues:[error instanceof Error?error.message:'Invalid demonstration.'],recordings:[],recordingExpectations:[],rationales:[],checks:null,hostOwnershipVerified:false,independentHeldOutVerified:false,activationAuthorized:false,effectAuthority:'none'};}
}
