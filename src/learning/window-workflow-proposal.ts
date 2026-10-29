import {Schema} from 'effect';
import {windowImageText as text,WindowImageRegionSchema,windowImageRegionIsBounded} from '../shared/window-image-evidence';
import {GroundingArtifactRefSchema,GroundingSourceRefSchema} from './grounded-join';
import {workflowLimits} from './workflow-lab';

export const windowWorkflowProposalLimits=Object.freeze({characters:64000,depth:12,states:workflowLimits.states,events:workflowLimits.events,transitions:workflowLimits.rules,citations:48,issues:12,assumptions:12,quote:500,label:160,reason:500});
const id=Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,80}$/));
const hostId=text(200);
const label=text(windowWorkflowProposalLimits.label).pipe(Schema.filter(value=>value.trim()===value&&!/[\r\n\t]/u.test(value)));
const reason=text(windowWorkflowProposalLimits.reason);
const timestamp=Schema.String.pipe(Schema.maxLength(24),Schema.filter(value=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value));
const contextSchema=Schema.Struct({taskId:hostId,basis:GroundingArtifactRefSchema,source:Schema.Struct({handle:Schema.Literal('S1'),kind:Schema.Literal('window'),role:Schema.Literal('fact'),ref:GroundingSourceRefSchema,capture:Schema.Struct({captureId:hostId,imageSha256:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),capturedAt:timestamp,previewExpiresAt:timestamp})})});
export type WindowWorkflowSourceContext=typeof contextSchema.Type;
const citationIds=Schema.Array(id).pipe(Schema.maxItems(4));
const evidenceIds=citationIds.pipe(Schema.minItems(1));
const unresolved=Schema.Struct({kind:Schema.Literal('unresolved'),citationIds,reason});
const name=Schema.Union(Schema.Struct({kind:Schema.Literal('transcribed'),label,citationId:id}),Schema.Struct({kind:Schema.Literal('inferred'),label,citationIds:evidenceIds,reason}),unresolved);
const named=Schema.Struct({id,name});
const transition=Schema.Struct({id,candidate:Schema.Union(Schema.Struct({kind:Schema.Literal('inferred'),fromStateId:id,eventId:id,toStateId:id,citationIds:evidenceIds,reason}),unresolved)});
const citation=Schema.Struct({id,source:Schema.Literal('S1'),location:WindowImageRegionSchema});
const issue=Schema.Struct({id,kind:Schema.Literal('ambiguity','unreadable','missing-information','unsupported-timing','unsupported-concurrency','insufficient-diagram'),citationIds,reason});
const proposalSchema=Schema.Struct({schemaVersion:Schema.Literal(1),kind:Schema.Literal('finite-state-proposal'),title:label,states:Schema.Array(named).pipe(Schema.maxItems(windowWorkflowProposalLimits.states)),events:Schema.Array(named).pipe(Schema.maxItems(windowWorkflowProposalLimits.events)),transitions:Schema.Array(transition).pipe(Schema.maxItems(windowWorkflowProposalLimits.transitions)),initialState:Schema.Union(Schema.Struct({kind:Schema.Literal('inferred'),stateId:id,citationIds:evidenceIds,reason}),unresolved),assumptions:Schema.Array(reason).pipe(Schema.maxItems(windowWorkflowProposalLimits.assumptions)),issues:Schema.Array(issue).pipe(Schema.maxItems(windowWorkflowProposalLimits.issues)),citations:Schema.Array(citation).pipe(Schema.minItems(1),Schema.maxItems(windowWorkflowProposalLimits.citations))});
const unsupportedSchema=Schema.Struct({schemaVersion:Schema.Literal(1),kind:Schema.Literal('unsupported-source'),code:Schema.Literal('unsupported-timing','unsupported-concurrency','insufficient-diagram','unreadable'),reason});
const outputSchema=Schema.Union(proposalSchema,unsupportedSchema);
export type WindowWorkflowProposal=typeof proposalSchema.Type;
export type WindowWorkflowReviewIssue={readonly code:'initial-state-required'|'unresolved-name'|'unresolved-transition'|'reported-issue'|'unsupported-model-feature'|'insufficient-diagram';readonly path:string};
/** Quoted text is proposed transcription, not verified pixels. Every relationship remains an inference. */
export type WindowWorkflowReviewCandidate={readonly schemaVersion:1;readonly kind:'window-workflow-review-candidate';readonly status:'review-required';readonly provenance:WindowWorkflowSourceContext;readonly proposal:WindowWorkflowProposal;readonly issues:readonly WindowWorkflowReviewIssue[]};
export type WindowWorkflowProposalOutput=WindowWorkflowReviewCandidate|((typeof unsupportedSchema.Type)&{readonly provenance:WindowWorkflowSourceContext});

const fail=(code:string):never=>{throw Error(`Invalid window workflow proposal. Diagnostic: ${code}. No workflow was admitted.`);};
function decode<A,I>(schema:Schema.Schema<A,I>,input:unknown,code:string):A {try{return Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(input);}catch{return fail(code);}}
function unique(values:readonly string[]){if(new Set(values).size!==values.length)fail('duplicate-identity');}
function parseJson(source:string):unknown {
 if(typeof source!=='string'||!source.length||source.length>windowWorkflowProposalLimits.characters)fail('size');
 const objects:(Set<string>|null)[]=[];
 let index=0;
 while(index<source.length){
  const char=source[index];
  if(char==='{'||char==='['){if(objects.length>=windowWorkflowProposalLimits.depth)fail('depth');objects.push(char==='{'?new Set():null);index++;continue;}
  if(char==='}'||char===']'){objects.pop();index++;continue;}
  if(char!=='"'){index++;continue;}
  const start=index++;
  while(index<source.length){if(source[index]==='\\'){index+=2;continue;}if(source[index++]==='"')break;}
  let next=index;while(next<source.length&&/\s/u.test(source[next]))next++;
  const object=objects.at(-1);
  if(source[next]===':'&&object){
   let key:unknown;try{key=JSON.parse(source.slice(start,index));}catch{return fail('json');}
   if(typeof key!=='string')return fail('json');
   if(object.has(key))return fail('duplicate-key');
   object.add(key);
  }
 }
 try{return JSON.parse(source);}catch{return fail('json');}
}
function validateProposal(proposal:WindowWorkflowProposal){
 unique([...proposal.states,...proposal.events,...proposal.transitions,...proposal.citations,...proposal.issues].map(value=>value.id));
 const citations=new Map(proposal.citations.map(value=>[value.id,value]));
 for(const {location} of proposal.citations)if(!windowImageRegionIsBounded(location))fail('region');
 const checkCitations=(ids:readonly string[])=>{unique(ids);if(ids.some(value=>!citations.has(value)))fail('citation-reference');};
 for(const values of [proposal.states,proposal.events]){
  unique(values.flatMap(value=>value.name.kind==='unresolved'?[]:[value.name.label]));
  for(const {name} of values){
   if(name.kind==='transcribed'){
    if(citations.get(name.citationId)?.location.quote!==name.label)fail('transcription');
   }else checkCitations(name.citationIds);
  }
 }
 const states=new Set(proposal.states.map(value=>value.id)),events=new Set(proposal.events.map(value=>value.id)),pairs:string[]=[];
 for(const {candidate} of proposal.transitions){
  checkCitations(candidate.citationIds);
  if(candidate.kind==='unresolved')continue;
  if(!states.has(candidate.fromStateId)||!states.has(candidate.toStateId)||!events.has(candidate.eventId))fail('transition-reference');
  pairs.push(JSON.stringify([candidate.fromStateId,candidate.eventId]));
 }
 unique(pairs);
 checkCitations(proposal.initialState.citationIds);
 if(proposal.initialState.kind==='inferred'&&!states.has(proposal.initialState.stateId))fail('initial-state-reference');
 for(const issue of proposal.issues)checkCitations(issue.citationIds);
}
function reviewIssues(proposal:WindowWorkflowProposal):WindowWorkflowReviewIssue[]{
 const issues:WindowWorkflowReviewIssue[]=[];
 if(proposal.states.length<2||!proposal.events.length||!proposal.transitions.length)issues.push({code:'insufficient-diagram',path:'proposal'});
 for(const key of ['states','events'] satisfies readonly ('states'|'events')[])proposal[key].forEach(({name},index)=>{if(name.kind==='unresolved')issues.push({code:'unresolved-name',path:`${key}.${index}.name`});});
 proposal.transitions.forEach(({candidate},index)=>{if(candidate.kind==='unresolved')issues.push({code:'unresolved-transition',path:`transitions.${index}`});});
 if(proposal.initialState.kind==='unresolved')issues.push({code:'initial-state-required',path:'initialState'});
 proposal.issues.forEach((issue,index)=>issues.push({code:issue.kind==='unsupported-timing'||issue.kind==='unsupported-concurrency'?'unsupported-model-feature':'reported-issue',path:`issues.${index}`}));
 return issues;
}

/** This copies provenance only. The host must check current capture, privacy and TTL again before publication. */
export function parseWindowWorkflowProposal(providerText:string,trustedContext:unknown):WindowWorkflowProposalOutput {
 const provenance=decode(contextSchema,trustedContext,'context');
 const capture=provenance.source.capture,retention=Date.parse(capture.previewExpiresAt)-Date.parse(capture.capturedAt);
 if(retention<=0||retention>300000)fail('context');
 const input=parseJson(providerText);
 const proposal=decode(outputSchema,input,'schema');
 if(proposal.kind==='unsupported-source')return {...proposal,provenance:structuredClone(provenance)};
 validateProposal(proposal);
 return {schemaVersion:1,kind:'window-workflow-review-candidate',status:'review-required',provenance:structuredClone(provenance),proposal:structuredClone(proposal),issues:reviewIssues(proposal)};
}
