import {windowReviewRowsMatch} from '../shared/learning-draft-form-policy';
import {Schema} from 'effect';
import {serializeLearningDraftJson} from '../shared/learning-drafts';
import {WorkflowCaseSchema,validateWorkflowCase,type WorkflowCase} from './workflow-lab';
import {parseWindowWorkflowProposal,windowWorkflowProposalLimits,type WindowWorkflowProposal,type WindowWorkflowReviewCandidate} from './window-workflow-proposal';

const id=Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,80}$/));
const text=(max:number)=>Schema.String.pipe(Schema.minLength(1),Schema.maxLength(max),Schema.filter(value=>value.trim().length>0&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069\uD800-\uDFFF]/u.test(value)&&!/(?:\b[a-z][a-z0-9+.-]*:\/\/|\b(?:javascript|vbscript|data|mailto|tel|sms|intent|blob|file|vscode|codex):|\bwww\.)/iu.test(value)&&!/```|~~~|<\/?[a-z][^>]*>|<!--|\]\s*(?:\(|\[)|^\s*\[[^\]]+\]:/imu.test(value)));
const label=text(windowWorkflowProposalLimits.label).pipe(Schema.filter(value=>value.trim()===value&&!/[\r\n\t]/u.test(value)));
const reason=text(windowWorkflowProposalLimits.reason);
const citationIds=Schema.Array(id).pipe(Schema.minItems(1),Schema.maxItems(4));
const unresolved=Schema.Struct({kind:Schema.Literal('unresolved'),reason});
const reviewedName=Schema.Struct({kind:Schema.Literal('reviewed-name'),label,citationId:id,interpretation:Schema.Literal('reviewed-transcription','user-interpreted'),reason});
const named=Schema.Struct({id,selected:Schema.Boolean,value:Schema.Union(reviewedName,unresolved)});
const interpreted=Schema.Struct({kind:Schema.Literal('reviewed-image-interpretation'),fromStateId:id,eventId:id,toStateId:id,citationIds,reason});
const transition=Schema.Struct({id,selected:Schema.Boolean,value:Schema.Union(interpreted,unresolved)});
const evidence=Schema.Union(Schema.Struct({citationId:id,kind:Schema.Literal('confirmed-transcription'),reason}),Schema.Struct({citationId:id,kind:Schema.Literal('corrected-transcription'),location:Schema.Unknown,reason}));
const draftSchema=Schema.Struct({title:label,states:Schema.Array(named).pipe(Schema.maxItems(8)),events:Schema.Array(named).pipe(Schema.maxItems(8)),transitions:Schema.Array(transition).pipe(Schema.maxItems(24)),evidence:Schema.Array(evidence).pipe(Schema.maxItems(48)),initialStateId:Schema.NullOr(id),eventIds:Schema.Array(id).pipe(Schema.maxItems(12)),assumptions:Schema.Array(reason).pipe(Schema.maxItems(12)),issueResolutions:Schema.Array(Schema.Struct({issueId:id,kind:Schema.Literal('resolved','excluded'),reason})).pipe(Schema.maxItems(12))});
const inputSchema=Schema.Struct({draft:draftSchema,confirmation:Schema.NullOr(Schema.Struct({kind:Schema.Literal('reviewed-window-transcription'),snapshot:Schema.String.pipe(Schema.maxLength(128*1024))}))});
const candidateHeader=Schema.Struct({schemaVersion:Schema.Literal(1),kind:Schema.Literal('window-workflow-review-candidate'),status:Schema.Literal('review-required'),provenance:Schema.Unknown,proposal:Schema.Unknown,issues:Schema.Unknown});
export type WindowWorkflowReviewDraft=typeof draftSchema.Type;
type Location=WindowWorkflowProposal['citations'][number]['location'];
export type WindowWorkflowReviewedEvidence={readonly citationId:string;readonly sourceRef:WindowWorkflowReviewCandidate['provenance']['source']['ref'];readonly original:Location;readonly reviewed:Location;readonly classification:'confirmed-transcription'|'corrected-transcription';readonly reason:string};
export type WindowWorkflowReviewedInput={readonly schemaVersion:1;readonly kind:'reviewed-window-workflow-input';readonly scope:'reviewed-frozen-transcription';readonly provenance:WindowWorkflowReviewCandidate['provenance'];readonly practice:WorkflowCase;readonly evidence:readonly WindowWorkflowReviewedEvidence[];readonly nameInterpretations:readonly {readonly category:'states'|'events';readonly id:string;readonly classification:'reviewed-transcription'|'user-interpreted';readonly citationId:string;readonly reason:string;readonly reviewerAdded?:true}[];readonly ruleInterpretations:readonly {readonly ruleId:string;readonly classification:'reviewed-image-interpretation';readonly citationIds:readonly string[];readonly reason:string;readonly reviewerAdded?:true}[];readonly assumptions:readonly string[];readonly reviewSnapshot:string};
export type WindowWorkflowReviewCheck={readonly kind:'valid';readonly value:WindowWorkflowReviewedInput}|{readonly kind:'invalid';readonly issues:readonly {readonly code:string;readonly path:string}[]};

class ReviewError extends Error {constructor(readonly code:string,readonly path='review'){super('Invalid finite window workflow review.');}}
function decode<A,I>(schema:Schema.Schema<A,I>,value:unknown):A {try{return Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(value);}catch{throw new ReviewError('schema');}}
function checkedCandidate(candidate:WindowWorkflowReviewCandidate):WindowWorkflowReviewCandidate{
 try{
  serializeLearningDraftJson(candidate);decode(candidateHeader,candidate);
  const parsed=parseWindowWorkflowProposal(JSON.stringify(candidate.proposal),candidate.provenance);
  if(parsed.kind!=='window-workflow-review-candidate'||serializeLearningDraftJson(parsed.issues)!==serializeLearningDraftJson(candidate.issues))throw new ReviewError('candidate');
  return parsed;
 }catch{throw new ReviewError('candidate','candidate');}
}
function checkedDraft(input:unknown){serializeLearningDraftJson(input);return decode(draftSchema,input);}
function snapshot(candidate:WindowWorkflowReviewCandidate,draft:WindowWorkflowReviewDraft){return serializeLearningDraftJson({candidate:{provenance:candidate.provenance,proposal:candidate.proposal},draft});}

/** A content binding for an explicit review gesture, never proof that a human reviewed pixels. */
export function windowWorkflowReviewSnapshot(candidate:WindowWorkflowReviewCandidate,input:unknown):string{
 try{return snapshot(checkedCandidate(candidate),checkedDraft(input));}catch{throw Error('The finite window workflow review snapshot is invalid.');}
}
function reviewedEvidence(candidate:WindowWorkflowReviewCandidate,draft:WindowWorkflowReviewDraft):WindowWorkflowReviewedEvidence[]{
 const proposed=draft.evidence.map(entry=>{
  const original=candidate.proposal.citations.find(citation=>citation.id===entry.citationId);
  if(!original)throw new ReviewError('evidence-reference','evidence');
  return {id:entry.citationId,source:'S1',location:entry.kind==='confirmed-transcription'?original.location:entry.location};
 });
 let parsed:ReturnType<typeof parseWindowWorkflowProposal>;
 try{parsed=parseWindowWorkflowProposal(JSON.stringify({schemaVersion:1,kind:'finite-state-proposal',title:'Review evidence validation',states:[],events:[],transitions:[],initialState:{kind:'unresolved',citationIds:[],reason:'Evidence validation does not choose a model.'},assumptions:[],issues:[],citations:proposed}),candidate.provenance);}catch{throw new ReviewError('evidence','evidence');}
 if(parsed.kind!=='window-workflow-review-candidate')throw new ReviewError('evidence','evidence');
 return draft.evidence.map(entry=>{
  const original=candidate.proposal.citations.find(citation=>citation.id===entry.citationId),reviewed=parsed.proposal.citations.find(citation=>citation.id===entry.citationId);
  if(!original||!reviewed)throw new ReviewError('evidence-reference','evidence');
  if(entry.kind==='corrected-transcription'&&serializeLearningDraftJson(original.location)===serializeLearningDraftJson(reviewed.location))throw new ReviewError('unchanged-correction','evidence');
  return {citationId:entry.citationId,sourceRef:candidate.provenance.source.ref,original:original.location,reviewed:reviewed.location,classification:entry.kind,reason:entry.reason};
 });
}
function unique(values:readonly string[],path:string){if(new Set(values).size!==values.length)throw new ReviewError('duplicate',path);}
function validateDraft(candidate:WindowWorkflowReviewCandidate,draft:WindowWorkflowReviewDraft,evidence:readonly WindowWorkflowReviewedEvidence[]){
 if(candidate.proposal.issues.some(issue=>issue.kind==='unsupported-timing'||issue.kind==='unsupported-concurrency'||issue.kind==='insufficient-diagram'))throw new ReviewError('unsupported-source','issues');
 const reviewed=new Map(evidence.map(entry=>[entry.citationId,entry])),supplied=new Set(candidate.proposal.citations.map(entry=>entry.id));
 const used=new Set<string>();
 unique([...draft.states,...draft.events,...draft.transitions,...candidate.proposal.citations,...candidate.proposal.issues].map(entry=>entry.id),'identities');
 for(const category of ['states','events','transitions'] satisfies readonly ('states'|'events'|'transitions')[]){
  const entries=draft[category];
  unique(entries.map(entry=>entry.id),category);
  if(!windowReviewRowsMatch(entries,candidate.proposal[category],category))throw new ReviewError('candidate-reference',category);
  if(entries.some(entry=>entry.selected&&entry.value.kind==='unresolved'))throw new ReviewError('unresolved-selection',category);
 }
 for(const category of ['states','events'] satisfies readonly ('states'|'events')[]){
  unique(draft[category].flatMap(entry=>entry.selected&&entry.value.kind==='reviewed-name'?[entry.value.label]:[]),category);
  for(const entry of draft[category])if(entry.value.kind==='reviewed-name'){
   const value=entry.value,citation=reviewed.get(value.citationId);
   if(!candidate.proposal[category].some(original=>original.id===entry.id)&&value.interpretation!=='user-interpreted')throw new ReviewError('added-name-interpretation',category);
   if(!supplied.has(value.citationId)||entry.selected&&!citation)throw new ReviewError('evidence-reference',category);
   if(entry.selected&&value.interpretation==='reviewed-transcription'&&citation?.reviewed.quote!==value.label)throw new ReviewError('transcription',category);
   if(entry.selected)used.add(value.citationId);
  }
 }
 const stateIds=new Set(draft.states.map(entry=>entry.id)),eventIds=new Set(draft.events.map(entry=>entry.id));
 for(const entry of draft.transitions)if(entry.value.kind==='reviewed-image-interpretation'){
  if(!stateIds.has(entry.value.fromStateId)||!stateIds.has(entry.value.toStateId)||!eventIds.has(entry.value.eventId))throw new ReviewError('transition-reference','transitions');
  unique(entry.value.citationIds,'transitions');
  if(entry.value.citationIds.some(citationId=>!supplied.has(citationId)||entry.selected&&!reviewed.has(citationId)))throw new ReviewError('evidence-reference','transitions');
  if(entry.selected)for(const citationId of entry.value.citationIds)used.add(citationId);
 }
 unique(draft.issueResolutions.map(entry=>entry.issueId),'issueResolutions');
 if(draft.issueResolutions.length!==candidate.proposal.issues.length||draft.issueResolutions.some(entry=>!candidate.proposal.issues.some(issue=>issue.id===entry.issueId)))throw new ReviewError('issue-resolution','issueResolutions');
 for(const resolution of draft.issueResolutions){
  const issue=candidate.proposal.issues.find(entry=>entry.id===resolution.issueId);
  if(!issue||resolution.kind==='excluded'&&(!issue.citationIds.length||issue.citationIds.some(citationId=>used.has(citationId))))throw new ReviewError('issue-exclusion','issueResolutions');
 }
}

/** This checks declared review input only. Host capture, privacy, TTL, publication and transfer checks remain separate. */
export function checkWindowWorkflowReview(candidateInput:WindowWorkflowReviewCandidate,input:unknown):WindowWorkflowReviewCheck{
 try{
  const candidate=checkedCandidate(candidateInput),parsed=decode(inputSchema,input);
  const draft=checkedDraft(parsed.draft),confirmation=parsed.confirmation,reviewSnapshot=snapshot(candidate,draft);
  if(!confirmation)throw new ReviewError('confirmation-required','confirmation');
  if(confirmation.snapshot!==reviewSnapshot)throw new ReviewError('confirmation-stale','confirmation');
  const evidence=reviewedEvidence(candidate,draft);
  validateDraft(candidate,draft,evidence);
  const states=draft.states.flatMap(entry=>entry.selected&&entry.value.kind==='reviewed-name'?[{id:entry.id,label:entry.value.label}]:[]),events=draft.events.flatMap(entry=>entry.selected&&entry.value.kind==='reviewed-name'?[{id:entry.id,label:entry.value.label}]:[]);
  const rules=draft.transitions.flatMap(entry=>entry.selected&&entry.value.kind==='reviewed-image-interpretation'?[{id:entry.id,fromStateId:entry.value.fromStateId,eventId:entry.value.eventId,toStateId:entry.value.toStateId,enabled:true}]:[]);
  const practice=decode(WorkflowCaseSchema,{id:'reviewed-window-practice',title:draft.title,states,events,rules,initialStateId:draft.initialStateId,eventIds:draft.eventIds});validateWorkflowCase(practice);
  const nameInterpretations:WindowWorkflowReviewedInput['nameInterpretations'][number][]=[];
  for(const category of ['states','events'] satisfies readonly ('states'|'events')[])for(const entry of draft[category])if(entry.selected&&entry.value.kind==='reviewed-name')nameInterpretations.push({category,id:entry.id,classification:entry.value.interpretation,citationId:entry.value.citationId,reason:entry.value.reason,...(!candidate.proposal[category].some(original=>original.id===entry.id)?{reviewerAdded:true as const}:{})});
  const ruleInterpretations=draft.transitions.flatMap(entry=>entry.selected&&entry.value.kind==='reviewed-image-interpretation'?[{ruleId:entry.id,classification:entry.value.kind,citationIds:entry.value.citationIds,reason:entry.value.reason,...(!candidate.proposal.transitions.some(original=>original.id===entry.id)?{reviewerAdded:true as const}:{})}]:[]);
  return {kind:'valid',value:structuredClone({schemaVersion:1,kind:'reviewed-window-workflow-input',scope:'reviewed-frozen-transcription',provenance:candidate.provenance,practice,evidence,nameInterpretations,ruleInterpretations,assumptions:draft.assumptions,reviewSnapshot})};
 }catch(error){return {kind:'invalid',issues:[{code:error instanceof ReviewError?error.code:'invalid-input',path:error instanceof ReviewError?error.path:'review'}]};}
}
