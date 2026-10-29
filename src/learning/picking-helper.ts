import {Schema} from 'effect';
import {parseTableProcedure,parseTableSnapshot,parseTableRequest,runTableProcedure,copyTableData,TableIdSchema,type TableProcedureV2,type TableSnapshot,type TableRunResult} from './semantic-table-procedure';
import type {SemanticRecord,SemanticScalar,SemanticStep} from './semantic-procedure';
import {pickingCanonical,pickingDigest} from '../shared/picking-digest';

const id=Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,80}$/),Schema.filter(v=>!['__proto__','prototype','constructor'].includes(v)));
const digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
const revision=Schema.Int.pipe(Schema.between(0,500));
const version=Schema.Int.pipe(Schema.between(1,20));
const reason=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(500),Schema.filter(v=>v.trim().length>0));
const scalar=Schema.Union(Schema.String.pipe(Schema.maxLength(4000)),Schema.Number.pipe(Schema.finite(),Schema.between(-1e12,1e12)),Schema.Boolean);
const record=Schema.Record({key:TableIdSchema,value:scalar});
const ownerText=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(v=>!v.includes('\0')));
export const PickingOwnerSchema=Schema.Struct({taskId:ownerText,artifactId:ownerText,artifactRevision:Schema.Int.pipe(Schema.positive()),artifactDigest:ownerText,moduleId:id,moduleVersion:Schema.Int.pipe(Schema.positive()),helperId:id});
export type PickingOwner=typeof PickingOwnerSchema.Type;
const targetSchema=Schema.Struct({id:TableIdSchema,revision,value:Schema.NullOr(record)});
const contextSchema=Schema.Struct({id:TableIdSchema,definition:Schema.Unknown,table:Schema.Unknown,request:record,target:targetSchema});
const stepSchema=Schema.Union(Schema.Struct({kind:Schema.Literal('select-row'),rowId:TableIdSchema}),Schema.Struct({kind:Schema.Literal('copy'),source:Schema.Literal('row','request'),field:TableIdSchema,output:TableIdSchema}),Schema.Struct({kind:Schema.Literal('literal'),output:TableIdSchema,value:scalar}));
const eventSchema=Schema.Struct({step:stepSchema,before:record,after:record});
const recordingSchema=Schema.Struct({id:TableIdSchema,contextId:TableIdSchema,selectedRow:Schema.NullOr(TableIdSchema),output:record,events:Schema.Array(eventSchema).pipe(Schema.maxItems(16))});
const observationSchema=Schema.Struct({id:TableIdSchema,kind:Schema.Literal('observed-app-actions'),admission:Schema.Literal('owned-module-host'),physicalGestureVerified:Schema.Literal(false),recordingId:TableIdSchema,owner:PickingOwnerSchema,contextId:TableIdSchema,events:Schema.Array(eventSchema).pipe(Schema.minItems(1),Schema.maxItems(16)),output:record,targetRevision:revision,digest});
const caseScalar=Schema.Union(Schema.Null,Schema.String.pipe(Schema.maxLength(160)),Schema.Number.pipe(Schema.finite(),Schema.between(-1e12,1e12)),Schema.Boolean);
const caseRequest=Schema.Struct({key:Schema.optional(caseScalar),quantity:Schema.optional(caseScalar),reviewed:Schema.optional(caseScalar),delivery:Schema.optional(caseScalar)});
const caseOutput=Schema.Struct({itemKey:Schema.optional(caseScalar),label:Schema.optional(caseScalar),quantity:Schema.optional(caseScalar),handling:Schema.optional(caseScalar)});
const caseTable=Schema.Struct({id:TableIdSchema,rows:Schema.Array(Schema.Struct({id:TableIdSchema,values:Schema.Array(caseScalar).pipe(Schema.minItems(1),Schema.maxItems(4))})).pipe(Schema.maxItems(12))});
const expectedSchema=Schema.Union(Schema.Struct({status:Schema.Literal('completed'),output:caseOutput}),Schema.Struct({status:Schema.Literal('abstained'),code:Schema.String.pipe(Schema.maxLength(80)),haltedStepId:Schema.optional(TableIdSchema)}),Schema.Struct({status:Schema.Literal('invalid-input'),stage:Schema.Literal('definition','input')}));
const caseSchema=Schema.Struct({id:TableIdSchema,role:Schema.Literal('held-out','counterexample','exception'),table:caseTable,request:caseRequest,expected:expectedSchema});
const correctionSchema=Schema.Struct({atRevision:revision,before:digest,after:digest,beforeReason:reason,afterReason:reason,reason});
const candidateSchema=Schema.Struct({definition:Schema.Unknown,observationId:Schema.NullOr(TableIdSchema),proposedReason:reason,currentReason:reason});
const attemptSchema=Schema.Struct({id:id,payloadDigest:digest,releaseDigest:digest,generation:revision,contextId:TableIdSchema,targetRevision:revision,note:Schema.String.pipe(Schema.maxLength(500)),result:Schema.Unknown,status:Schema.Literal('prepared','failed','cancelled','retired','completed'),preparedAtRevision:revision,settledAtRevision:Schema.NullOr(revision),targetRevisionAfter:Schema.NullOr(revision),targetDigest:Schema.NullOr(digest)});
export const PickingStateSchema=Schema.Struct({kind:Schema.Literal('helper-studio'),format:Schema.Literal('semantic-table-v2'),helperId:id,revision,owner:Schema.NullOr(PickingOwnerSchema),contexts:Schema.Array(contextSchema).pipe(Schema.maxItems(8)),currentContextId:Schema.NullOr(TableIdSchema),recording:Schema.NullOr(recordingSchema),observations:Schema.Array(observationSchema).pipe(Schema.maxItems(8)),candidate:Schema.NullOr(candidateSchema),candidateHistory:Schema.Array(Schema.Struct({atRevision:revision,candidate:candidateSchema})).pipe(Schema.maxItems(64)),cases:Schema.Array(caseSchema).pipe(Schema.maxItems(20)),corrections:Schema.Array(correctionSchema).pipe(Schema.maxItems(64)),releases:Schema.Array(Schema.Unknown).pipe(Schema.maxItems(20)),activation:Schema.Struct({generation:revision,version:Schema.NullOr(version),digest:Schema.NullOr(digest)}),attempts:Schema.Array(attemptSchema).pipe(Schema.maxItems(20))});
const common={expectedRevision:revision};
export const PickingActionSchema=Schema.Union(
 Schema.Struct({kind:Schema.Literal('picking-candidate'),definition:Schema.Unknown,reason,...common}),
 Schema.Struct({kind:Schema.Literal('picking-reason'),reason,...common}),
 Schema.Struct({kind:Schema.Literal('picking-cases'),cases:Schema.Array(caseSchema).pipe(Schema.maxItems(20)),...common}),
 Schema.Struct({kind:Schema.Literal('picking-save'),note:reason,...common}),
 Schema.Struct({kind:Schema.Literal('picking-activate'),version,digest,generation:revision,...common}),
 Schema.Struct({kind:Schema.Literal('picking-restore'),version,...common}),
 Schema.Struct({kind:Schema.Literal('picking-deactivate','picking-propose','picking-record-stop','picking-record-cancel'),...common}),
 Schema.Struct({kind:Schema.Literal('picking-context'),table:Schema.Unknown,request:record,...common}),
 Schema.Struct({kind:Schema.Literal('picking-record-start'),contextId:TableIdSchema,...common}),
 Schema.Struct({kind:Schema.Literal('picking-select-row'),rowId:TableIdSchema,...common}),
 Schema.Struct({kind:Schema.Literal('picking-copy'),source:Schema.Literal('row','request'),field:TableIdSchema,output:TableIdSchema,...common}),
 Schema.Struct({kind:Schema.Literal('picking-literal'),output:TableIdSchema,value:scalar,...common}),
 Schema.Struct({kind:Schema.Literal('picking-prepare'),runId:id,releaseDigest:digest,generation:revision,contextId:TableIdSchema,targetRevision:revision,note:Schema.optional(Schema.String.pipe(Schema.maxLength(500))),...common}),
 Schema.Struct({kind:Schema.Literal('picking-apply','picking-cancel','picking-inspect'),runId:id,...common}),
);
export type PickingAction=typeof PickingActionSchema.Type;
export type PickingContext=Omit<typeof contextSchema.Type,'definition'|'table'>&{definition:TableProcedureV2;table:TableSnapshot};
export type PickingRecording=typeof recordingSchema.Type;
export type PickingObservation=typeof observationSchema.Type;
export type PickingCase=typeof caseSchema.Type;
export type PickingAttempt=Omit<typeof attemptSchema.Type,'result'>&{result:TableRunResult};
export const PICKING_CAPABILITY='owned-local-manifest:v2' as const;
export const PICKING_EVALUATOR=Object.freeze({id:'table-procedure',version:2,algorithm:'unique-typed-table-to-v1-scalar-body',authority:'none',bounds:{rows:12,columns:4,steps:64,observations:8,cases:20}});
export const PICKING_EVALUATOR_DIGEST=pickingDigest(PICKING_EVALUATOR);
export type PickingRelease={candidate:typeof candidateSchema.Type;corrections:readonly (typeof correctionSchema.Type)[];version:number;definition:TableProcedureV2;definitionDigest:string;schemaIdentity:string;capability:typeof PICKING_CAPABILITY;observations:{id:string;digest:string}[];cases:readonly PickingCase[];caseSetDigest:string;evaluator:typeof PICKING_EVALUATOR;evaluatorDigest:string;checks:PickingChecks;note:string;savedAtRevision:number;previousDigest:string|null;digest:string};
export type PickingState=Omit<typeof PickingStateSchema.Type,'contexts'|'candidate'|'candidateHistory'|'releases'|'attempts'>&{contexts:readonly PickingContext[];candidate:(Omit<typeof candidateSchema.Type,'definition'>&{definition:TableProcedureV2})|null;candidateHistory:readonly {atRevision:number;candidate:Omit<typeof candidateSchema.Type,'definition'>&{definition:TableProcedureV2}}[];releases:readonly PickingRelease[];attempts:readonly PickingAttempt[]};
export type PickingChecks={passed:boolean;independentHeldOutVerified:false;effectAuthority:'none';issues:string[];cases:{id:string;passed:boolean;actual:TableRunResult}[]};
const decode=<A,I>(schema:Schema.Schema<A,I>,value:unknown)=>Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(copyTableData(value,2*1024*1024,80000));
const same=(a:unknown,b:unknown)=>pickingCanonical(a)===pickingCanonical(b);
const unique=(values:readonly string[])=>{if(new Set(values).size!==values.length)throw Error('Duplicate picking identity.');};
export function pickingDefinition(value:unknown):TableProcedureV2{
 const p=parseTableProcedure(value),outputs=p.body.output.fields;
 if(p.table.columns.length!==4||p.table.columns.filter(c=>c.kind==='string').length!==2||p.table.columns.filter(c=>c.kind==='integer').length!==1||p.table.columns.filter(c=>c.kind==='boolean').length!==1||p.body.version!==p.version||p.lookup.keyInput!=='key'||!p.integerRequestFields.includes('quantity'))throw Error('The installed four-column picking schema and paired definition version are required.');
 if(p.requestFields.length!==4||['key','quantity','reviewed','delivery'].some(f=>!p.requestFields.includes(f))||p.body.input.fields.some(f=>f.kind==='string'&&f.maxLength>160)||outputs.some(f=>f.kind==='string'&&f.maxLength>160))throw Error('The installed picking field roles and 160-character range are required.');
 for(const [field,kind] of [['itemKey','string'],['label','string'],['quantity','number'],['handling','string']])if(!outputs.some(f=>f.name===field&&f.kind===kind))throw Error('This installed manifest capability requires its four typed output roles.');
 if(outputs.length!==4||!p.lookup.bindings.some(b=>b.input==='protected'&&p.table.columns.find(c=>c.id===b.column)?.kind==='boolean')||!p.lookup.bindings.some(b=>b.input==='available'&&p.table.columns.find(c=>c.id===b.column)?.kind==='integer'))throw Error('The picking protection and availability bindings are required.');
 return p;
}
export function pickingContext(state:PickingState,id:string):PickingContext{const context=state.contexts.find(c=>c.id===id);if(!context)throw Error('The owned context is unavailable.');return context;}
export function contextTable(context:PickingContext,definition:TableProcedureV2):TableSnapshot{
 const old=context.definition.table.columns;if(definition.table.columns.length!==old.length||definition.table.columns.some(c=>!old.some(o=>o.id===c.id&&o.kind===c.kind)))throw Error('Review a fresh context for the changed table schema.');
 return {...context.table,rows:context.table.rows.map(r=>({...r,values:definition.table.columns.map(c=>r.values[old.findIndex(o=>o.id===c.id)])}))};
}
export function recordingStep(context:PickingContext,recording:PickingRecording,step:typeof stepSchema.Type):PickingRecording{
 if(recording.events.length>=16)throw Error('The recording action limit was reached.');let selectedRow=recording.selectedRow,output={...recording.output};
 if(step.kind==='select-row'){
  const row=context.table.rows.find(r=>r.id===step.rowId);if(!row)throw Error('The selected row is unavailable.');
  const protectedBinding=context.definition.lookup.bindings.find(b=>b.input==='protected')!,column=context.definition.table.columns.findIndex(c=>c.id===protectedBinding.column);
  if(row.values[column]===true)throw Error('Protected items cannot be copied into a manifest.');selectedRow=row.id;
 }else{
  const field=context.definition.body.output.fields.find(f=>f.name===step.output);if(!field)throw Error('The output field is unavailable.');
  let value:SemanticScalar;
  if(step.kind==='literal')value=step.value;
  else if(step.source==='request'){if(!context.definition.requestFields.includes(step.field))throw Error('The request field is unavailable.');value=context.request[step.field];}
  else{const row=context.table.rows.find(r=>r.id===selectedRow),index=context.definition.table.columns.findIndex(c=>c.id===step.field);if(!row||index<0)throw Error('Select the row and a declared column first.');value=row.values[index];}
  if(field.kind==='string'?typeof value!=='string'||value.length<field.minLength||value.length>field.maxLength:field.kind==='number'?typeof value!=='number'||value<field.minimum||value>field.maximum:typeof value!=='boolean')throw Error('The copied value does not match its output field.');output[step.output]=value;
 }
 return {...recording,selectedRow,output,events:[...recording.events,{step,before:recording.output,after:output}]};
}
export function replayRecording(context:PickingContext,events:PickingRecording['events'],id='recording'):PickingRecording{
 let result:PickingRecording={id,contextId:context.id,selectedRow:null,output:{},events:[]};
 for(const event of events){const next=recordingStep(context,result,event.step);if(!same(next.events.at(-1),event))throw Error('The observed action does not match its actual source and prior output.');result=next;}return result;
}
const expectedMatches=(expected:PickingCase['expected'],actual:TableRunResult)=>expected.status===actual.status&&(expected.status==='completed'?actual.status==='completed'&&same(expected.output,actual.output):expected.status==='invalid-input'?actual.status==='invalid-input'&&expected.stage===actual.stage:actual.status==='abstained'&&expected.code===actual.code&&(!expected.haltedStepId||expected.haltedStepId===actual.haltedStepId));
function stops(step:SemanticStep):string[]{return step.kind==='abstain'?[step.id]:step.kind==='assign'?stops(step.next):step.kind==='branch'?[...stops(step.then),...stops(step.else)]:[];}
export function checkPicking(definition:TableProcedureV2,observations:readonly PickingObservation[],contexts:readonly PickingContext[],cases:readonly PickingCase[]):PickingChecks{
 const issues:string[]=[],results:PickingChecks['cases']=[];
 for(const observation of observations){const context=contexts.find(c=>c.id===observation.contextId);if(!context){issues.push('An original observed context is unavailable.');continue;}let actual:TableRunResult;try{actual=runTableProcedure(definition,contextTable(context,definition),context.request);}catch{actual=runTableProcedure({},null,null);}results.push({id:observation.id,passed:actual.status==='completed'&&same(actual.output,observation.output),actual});}
 for(const test of cases){const actual=runTableProcedure(definition,test.table,test.request);results.push({id:test.id,passed:expectedMatches(test.expected,actual),actual});}
 if(!observations.length)issues.push('Record and review an actual completed local action sequence.');
 const passing=(test:PickingCase)=>results.find(r=>r.id===test.id)?.passed===true;
 const originals=observations.flatMap(o=>contexts.filter(c=>c.id===o.contextId));
 if(!cases.some(c=>c.role==='held-out'&&passing(c)&&c.expected.status==='completed'&&originals.every(o=>(c.request as Record<string,unknown>)[definition.lookup.keyInput]!==o.request[definition.lookup.keyInput]&&!same((c.table as TableSnapshot).rows,o.table.rows))))issues.push('Add a passing declared held-out case with a different key and table data.');
 if(!cases.some(c=>c.role==='counterexample'&&passing(c)&&c.expected.status!=='completed'))issues.push('Add a passing negative counterexample.');
 for(const precondition of definition.body.preconditions)if(!cases.some(c=>c.role!=='held-out'&&passing(c)&&c.expected.status==='abstained'&&c.expected.code==='precondition'&&c.expected.haltedStepId===precondition.id))issues.push('Exercise precondition '+precondition.id+'.');
 for(const stop of stops(definition.body.root))if(!cases.some(c=>c.role!=='held-out'&&passing(c)&&c.expected.status==='abstained'&&c.expected.code==='explicit-stop'&&c.expected.haltedStepId===stop))issues.push('Exercise exception '+stop+'.');
 for(const code of ['lookup-missing','lookup-ambiguous'])if(!cases.some(c=>c.role!=='held-out'&&passing(c)&&c.expected.status==='abstained'&&c.expected.code===code))issues.push('Exercise '+code+'.');
 return {passed:issues.length===0&&results.every(r=>r.passed),independentHeldOutVerified:false,effectAuthority:'none',issues,cases:results};
}
export function releasePayload(release:PickingRelease){const {digest:_,...payload}=release;return payload;}
export function observationPayload(observation:PickingObservation){const {digest:_,...payload}=observation;return payload;}
export function attemptPayload(state:PickingState,context:PickingContext,release:PickingRelease,generation:number,targetRevision:number,note=''){return {note,owner:state.owner,releaseDigest:release.digest,evaluatorDigest:release.evaluatorDigest,caseSetDigest:release.caseSetDigest,generation,contextId:context.id,tableDigest:pickingDigest(context.table),requestDigest:pickingDigest(context.request),targetId:context.target.id,targetRevision,capability:PICKING_CAPABILITY};}
function parseState(helperId:string,value:unknown):PickingState{
 const raw=decode(PickingStateSchema,value);if(raw.helperId!==helperId||raw.owner&&raw.owner.helperId!==helperId)throw Error('This picking helper belongs to another owner.');
 const contexts=raw.contexts.map(c=>{const definition=pickingDefinition(c.definition);return {...c,definition,table:parseTableSnapshot(definition,c.table),request:parseTableRequest(definition,c.request)};});
 unique(contexts.map(c=>c.id));unique(contexts.map(c=>c.table.id));unique(contexts.map(c=>c.target.id));unique(raw.observations.map(o=>o.id));unique(raw.observations.map(o=>o.recordingId));unique(raw.cases.map(c=>c.id));unique(raw.attempts.map(a=>a.id));
 if(raw.currentContextId&&!contexts.some(c=>c.id===raw.currentContextId))throw Error('The selected context is unavailable.');
 for(const o of raw.observations){const c=contexts.find(c=>c.id===o.contextId);if(!c||!raw.owner||!same(o.owner,raw.owner)||pickingDigest(observationPayload(o))!==o.digest||!same(replayRecording(c,o.events,o.recordingId).output,o.output)||o.targetRevision<1)throw Error('The stored observed action sequence is invalid.');}
 if(raw.recording){const c=contexts.find(c=>c.id===raw.recording!.contextId);if(!c||!same(replayRecording(c,raw.recording.events,raw.recording.id),raw.recording))throw Error('The open recording is invalid.');}
 const candidate=raw.candidate?{...raw.candidate,definition:pickingDefinition(raw.candidate.definition)}:null;
 if(candidate?.observationId&&!raw.observations.some(o=>o.id===candidate.observationId))throw Error('The candidate observation is unavailable.');
 const candidateHistory=raw.candidateHistory.map(h=>{const candidate={...h.candidate,definition:pickingDefinition(h.candidate.definition)};if(h.atRevision>raw.revision||candidate.observationId&&!raw.observations.some(o=>o.id===candidate.observationId))throw Error('The prior candidate history is invalid.');return {...h,candidate};});
 const releases=raw.releases.map((value,index)=>{
  const release=copyTableData(value,2*1024*1024,80000) as PickingRelease;
  const allowed=['candidate','corrections','version','definition','definitionDigest','schemaIdentity','capability','observations','cases','caseSetDigest','evaluator','evaluatorDigest','checks','note','savedAtRevision','previousDigest','digest'];
  if(!release||typeof release!=='object'||Object.keys(release).length!==allowed.length||Object.keys(release).some(k=>!allowed.includes(k)))throw Error('Unfamiliar release fields.');
  const definition=pickingDefinition(release.definition),cases=release.cases.map(c=>decode(caseSchema,c));
  const refs=release.observations.map(ref=>{const o=raw.observations.find(o=>o.id===ref.id&&o.digest===ref.digest);if(!o||Object.keys(ref).sort().join(',')!=='digest,id')throw Error('An original release observation is unavailable.');return o;});
  unique(cases.map(c=>c.id));unique(refs.map(o=>o.id));const checkedCandidate=decode(candidateSchema,release.candidate);const checkedCorrections=release.corrections.map(c=>decode(correctionSchema,c));if(!same(checkedCandidate.definition,definition)||!refs.some(o=>o.id===checkedCandidate.observationId)||!same(checkedCorrections,raw.corrections.filter(c=>c.atRevision<=release.savedAtRevision)))throw Error('The saved rationale or correction prefix changed.');const checks=checkPicking(definition,refs,contexts,cases);
  if(release.version!==index+1||release.savedAtRevision>raw.revision||release.savedAtRevision<1||release.previousDigest!==(index?(raw.releases[index-1] as PickingRelease).digest:null)||release.capability!==PICKING_CAPABILITY||!same(release.evaluator,PICKING_EVALUATOR)||release.evaluatorDigest!==PICKING_EVALUATOR_DIGEST||release.definitionDigest!==pickingDigest(definition)||release.caseSetDigest!==pickingDigest(cases)||release.schemaIdentity!==pickingDigest({request:definition.requestFields,table:definition.table,input:definition.body.input,output:definition.body.output})||!checks.passed||!same(release.checks,checks)||pickingDigest(releasePayload(release))!==release.digest||typeof release.note!=='string'||!release.note.trim()||release.note.length>500)throw Error('The immutable release, evaluator or checked case set changed.');
  return {...release,definition,cases};
 });
 const activation=raw.activation,active=releases.find(r=>r.version===activation.version);if(activation.generation>raw.revision||(activation.version===null?activation.digest!==null:!active||active.digest!==activation.digest||activation.generation===0))throw Error('The active release identity is invalid.');
 const definitions=[...contexts.map(c=>c.definition),...candidateHistory.map(h=>h.candidate.definition),...releases.map(r=>r.definition),...(candidate?[candidate.definition]:[])],identities=new Map<string,string>();
 for(const definition of definitions){const key=definition.id+':'+definition.version,body=pickingCanonical(definition);if(identities.has(key)&&identities.get(key)!==body)throw Error('The same definition version cannot change its bytes.');if(definitions[0]&&(definition.id!==definitions[0].id||definition.body.id!==definitions[0].body.id))throw Error('Definitions belong to one owned procedure identity.');identities.set(key,body);}
 const partial={...raw,contexts,candidate,candidateHistory,releases} as PickingState;
 const attempts=raw.attempts.map(a=>{
  const c=contexts.find(c=>c.id===a.contextId),release=releases.find(r=>r.digest===a.releaseDigest);if(!c||!release||a.generation<1||a.generation>activation.generation||a.preparedAtRevision>raw.revision||a.targetRevision>c.target.revision||a.payloadDigest!==pickingDigest(attemptPayload(partial,c,release,a.generation,a.targetRevision,a.note)))throw Error('The run identity changed.');
  const result=runTableProcedure(release.definition,contextTable(c,release.definition),c.request);if(a.status==='prepared'?a.settledAtRevision!==null:a.settledAtRevision===null||a.settledAtRevision<a.preparedAtRevision||a.settledAtRevision>raw.revision)throw Error('The run settlement revision is invalid.');
  if(!same(a.result,result)||a.status==='prepared'&&(result.status!=='completed'||a.settledAtRevision!==null)||a.status==='failed'&&result.status==='completed'||a.status==='completed'&&(result.status!=='completed'||a.targetRevisionAfter!==a.targetRevision+1||a.targetDigest!==pickingDigest(result.output))||a.status!=='completed'&&(a.targetRevisionAfter!==null||a.targetDigest!==null))throw Error('The run result or receipt is invalid.');return {...a,result};
 });
 for(const c of contexts){const history=[...raw.observations.filter(o=>o.contextId===c.id).map(o=>({revision:o.targetRevision,value:o.output})),...attempts.filter(a=>a.contextId===c.id&&a.status==='completed').map(a=>({revision:a.targetRevisionAfter!,value:a.result.status==='completed'?a.result.output:{}}))].sort((a,b)=>a.revision-b.revision);if(history.some((h,i)=>h.revision!==i+1)||c.target.revision!==history.length||!same(c.target.value,history.at(-1)?.value??null))throw Error('The owned target does not match its atomic receipt history.');}
 return {...partial,attempts};
}
export function nextPickingDefinition(state:PickingState,value:unknown,forceNew=false):TableProcedureV2{
 const parsed=pickingDefinition(value),previous=state.candidate?.definition;
 if(previous&&(parsed.id!==previous.id||parsed.body.id!==previous.body.id))throw Error('Keep the original owned procedure identity.');
 const content=(p:TableProcedureV2)=>({...p,version:0,body:{...p.body,version:0}});
 if(!forceNew&&previous&&same(content(parsed),content(previous)))return previous;
 const definitions=[...state.contexts.map(c=>c.definition),...state.candidateHistory.map(h=>h.candidate.definition),...state.releases.map(r=>r.definition),...(previous?[previous]:[])];
 const version=Math.max(0,...definitions.map(p=>p.version))+1;if(version>20)throw Error('The immutable definition revision limit was reached. Keep this helper for review.');
 return pickingDefinition({...parsed,version,body:{...parsed.body,version}});
}
const initial=(helperId:string):PickingState=>({kind:'helper-studio',format:'semantic-table-v2',helperId,revision:0,owner:null,contexts:[],currentContextId:null,recording:null,observations:[],candidate:null,candidateHistory:[],cases:[],corrections:[],releases:[],activation:{generation:0,version:null,digest:null},attempts:[]});
export const parsePickingCase=(value:unknown)=>decode(caseSchema,value);
/** A saved recipe outcome is evidence; only the chosen option supplies the new expectation. */
export function pickingRunCaseReview(state:PickingState,runId:string){
 const attempt=state.attempts.find(value=>value.id===runId),context=attempt&&state.contexts.find(value=>value.id===attempt.contextId),release=attempt&&state.releases.find(value=>value.digest===attempt.releaseDigest),definition=state.candidate?.definition;
 if(!state.owner||!attempt||!context||!release||!definition)throw Error('The saved run, original context or checked version is unavailable. Inspect the saved receipt first.');
 if(!(attempt.status==='completed'&&attempt.result.status==='completed'||attempt.status==='failed'&&attempt.result.status!=='completed')||attempt.result.status==='invalid-input'&&attempt.result.stage==='definition')throw Error('Inspect or settle this receipt first. Cancellation, changed targets and unconfirmed replies are not recipe counterexamples.');
 if(!same(context.definition.table.columns,definition.table.columns))throw Error('The table columns changed. Review the original saved input before creating a case.');
 const saved=attempt.result.status==='completed'?{status:'completed' as const,output:attempt.result.output}:attempt.result.status==='abstained'?{status:'abstained' as const,code:attempt.result.code,...(attempt.result.haltedStepId?{haltedStepId:attempt.result.haltedStepId}:{})}:{status:'invalid-input' as const,stage:attempt.result.stage};
 const caseId='runCase'+pickingDigest({owner:state.owner,runId});
 const make=(expected:PickingCase['expected'])=>parsePickingCase({id:caseId,role:'counterexample',table:context.table,request:context.request,expected});
 const choices:{id:string;label:string;expected:PickingCase['expected']}[]=[{id:'saved',label:attempt.result.status==='completed'?'I expect the saved output':'I expect the saved recipe refusal',expected:make(saved).expected}];
 for(const condition of definition.body.preconditions)choices.push({id:'precondition:'+condition.id,label:'Expect request refusal: '+condition.reason,expected:{status:'abstained',code:'precondition',haltedStepId:condition.id}});
 const visit=(step:SemanticStep):void=>{if(step.kind==='abstain')choices.push({id:'stop:'+step.id,label:'Expect stop: '+step.reason,expected:{status:'abstained',code:'explicit-stop',haltedStepId:step.id}});else if(step.kind==='assign')visit(step.next);else if(step.kind==='branch'){visit(step.then);visit(step.else);}};visit(definition.body.root);
 return {caseId,context,release,attempt,choices,make};
}
export function pickingCaseFromRun(state:PickingState,runId:string,choiceId:string):PickingCase{
 const review=pickingRunCaseReview(state,runId),choice=review.choices.find(value=>value.id===choiceId);
 if(!choice)throw Error('Choose the expected outcome explicitly before adding this declared case.');return review.make(choice.expected);
}
const parseAction=(value:unknown)=>decode(PickingActionSchema,value);
function update(helperId:string,value:unknown,actionValue:unknown):PickingState{
 const state=parseState(helperId,value),action=parseAction(actionValue);if(action.expectedRevision!==state.revision||state.revision>=500)throw Error('This picking helper changed or reached its revision limit.');
 if(state.revision+1+state.attempts.filter(a=>a.status==='prepared').length>500)throw Error('Keep the remaining revision capacity for settling prepared runs.');
 let next:PickingState={...state,revision:state.revision+1};
 if(action.kind==='picking-candidate'){
  const definition=nextPickingDefinition(state,action.definition),previous=state.candidate;next={...next,candidate:{definition,observationId:previous?.observationId??null,proposedReason:previous?.proposedReason??action.reason,currentReason:previous?.currentReason??action.reason},corrections:previous?[...state.corrections,{atRevision:next.revision,before:pickingDigest(previous.definition),after:pickingDigest(definition),beforeReason:previous.currentReason,afterReason:previous.currentReason,reason:action.reason}]:state.corrections};
 }else if(action.kind==='picking-reason'){
  if(!state.candidate)throw Error('Propose a candidate first.');next={...next,candidate:{...state.candidate,currentReason:action.reason},corrections:[...state.corrections,{atRevision:next.revision,before:pickingDigest(state.candidate.definition),after:pickingDigest(state.candidate.definition),beforeReason:state.candidate.currentReason,afterReason:action.reason,reason:'User corrected the proposed reason.'}]};
 }else if(action.kind==='picking-cases'){unique(action.cases.map(c=>c.id));next={...next,cases:action.cases};}
 else if(action.kind==='picking-save'){
  if(state.recording||!state.candidate?.observationId||state.releases.length>=20)throw Error('Finish and review an observed candidate before saving.');
  const checks=checkPicking(state.candidate.definition,state.observations,state.contexts,state.cases);if(!checks.passed)throw Error('The required original, held-out and negative checks must pass.');
  const definition=state.candidate.definition,payload={candidate:state.candidate,corrections:state.corrections,version:state.releases.length+1,definition,definitionDigest:pickingDigest(definition),schemaIdentity:pickingDigest({request:definition.requestFields,table:definition.table,input:definition.body.input,output:definition.body.output}),capability:PICKING_CAPABILITY,observations:state.observations.map(o=>({id:o.id,digest:o.digest})),cases:state.cases,caseSetDigest:pickingDigest(state.cases),evaluator:PICKING_EVALUATOR,evaluatorDigest:PICKING_EVALUATOR_DIGEST,checks,note:action.note,savedAtRevision:next.revision,previousDigest:state.releases.at(-1)?.digest??null};next={...next,releases:[...state.releases,{...payload,digest:pickingDigest(payload)}]};
 }else if(action.kind==='picking-activate'){
  const release=state.releases.find(r=>r.version===action.version&&r.digest===action.digest);if(!release||state.activation.generation!==action.generation)throw Error('The exact release or activation generation changed.');next={...next,activation:{version:release.version,digest:release.digest,generation:state.activation.generation+1}};
 }else if(action.kind==='picking-deactivate'){next={...next,activation:{version:null,digest:null,generation:state.activation.generation+1}};}
 else if(action.kind==='picking-restore'){const release=state.releases.find(r=>r.version===action.version);if(!release)throw Error('The saved release is unavailable.');next={...next,candidate:{definition:nextPickingDefinition(state,release.definition,true),observationId:release.observations[0]?.id??null,proposedReason:'Restored checked definition as a new draft.',currentReason:'Restored checked definition as a new draft.'},cases:release.cases};}
 else throw Error('This action requires current host admission.');
 if(state.candidate&&['picking-candidate','picking-reason','picking-restore'].includes(action.kind))next={...next,candidateHistory:[...state.candidateHistory,{atRevision:next.revision,candidate:state.candidate}]};
 return parseState(helperId,next);
}
export function pickingHelperText(helperId:string,value:unknown):string{
 const s=parseState(helperId,value);return ['# Local picking manifest','Typed local table → unique match → reviewed projection. This does not capture a screen, send, export, reserve or change stock.',`Observed app-action sequences: ${s.observations.length}. App commands do not verify a physical human gesture.`,s.candidate?`Proposed reason: ${s.candidate.proposedReason}\nCurrent reason: ${s.candidate.currentReason}`:'No reviewed candidate yet.',...s.releases.map(r=>`Saved version ${r.version}: ${r.candidate.currentReason}`),`Saved releases: ${s.releases.length}. Active version: ${s.activation.version??'none'}; activation generation ${s.activation.generation}.`,...s.attempts.map(a=>`Run ${a.id}: ${a.status}. Release ${s.releases.find(r=>r.digest===a.releaseDigest)?.version??'unavailable'}; local target ${a.contextId} revision ${a.targetRevisionAfter??a.targetRevision}. ${a.result.status==='completed'?JSON.stringify(a.result.output):a.result.reason}`),'Declared held-out cases do not verify independence or human mastery.'].join('\n\n');
}
export const pickingHelper={initial,parseState,parseAction,update,text:pickingHelperText};
