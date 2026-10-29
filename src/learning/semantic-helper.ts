import {Schema} from 'effect';
import {checkSemanticDemonstration,createSemanticRecording,parseSemanticRecording,semanticRecordingExpectations,type SemanticRecordingCorrection,type SemanticDemonstrationCandidate,type SemanticRecording} from './semantic-demonstration';
import {SemanticExpectedSchema,parseSemanticProcedure,runSemanticProcedure,type SemanticProcedure,type SemanticRunResult,type SemanticPredicate,type SemanticStep} from './semantic-procedure';

// This branch is deliberately not registered as a second module or store. The
// existing helper owner must supply its identity and perform the atomic commit.
const id=Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,80}$/),Schema.filter(value=>!['__proto__','prototype','constructor'].includes(value)));
const revision=Schema.Int.pipe(Schema.between(0,500));
const version=Schema.Int.pipe(Schema.between(1,20));
const note=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(160),Schema.filter(value=>value.trim().length>0));
const scalar=Schema.Union(Schema.String.pipe(Schema.maxLength(4000)),Schema.Number.pipe(Schema.between(-1e12,1e12),Schema.filter(Number.isFinite)),Schema.Boolean);
const input=Schema.Record({key:Schema.String,value:scalar});
export const semanticBatchLimit=8;
const batchInput=input.pipe(Schema.filter(value=>Object.keys(value).length<=6&&Object.values(value).every(item=>typeof item!=='string'||item.length<=160)));
const batchRows=Schema.Array(Schema.Struct({input:batchInput,result:Schema.Unknown})).pipe(Schema.minItems(1),Schema.maxItems(semanticBatchLimit));
const definitions=Schema.Array(Schema.Struct({procedure:Schema.Unknown})).pipe(Schema.maxItems(20));
const versions=Schema.Array(Schema.Struct({version,procedureVersion:version,savedAtRevision:revision,changeNote:note,candidate:Schema.Unknown})).pipe(Schema.maxItems(20));
export const SemanticHelperStateSchema=Schema.Struct({
 kind:Schema.Literal('helper-studio'),format:Schema.Literal('semantic-record-v1'),helperId:id,revision,
 definitions,draftVersion:Schema.NullOr(version),recordings:Schema.Array(Schema.Unknown).pipe(Schema.maxItems(8)),
 rationales:Schema.Array(Schema.Unknown).pipe(Schema.maxItems(64)),corrections:Schema.Array(Schema.Unknown).pipe(Schema.maxItems(64)),examples:Schema.Array(Schema.Unknown).pipe(Schema.maxItems(20)),recordingCorrections:Schema.optional(Schema.Array(Schema.Unknown).pipe(Schema.maxItems(64))),
 evidenceHistory:Schema.Array(Schema.Struct({atRevision:revision,procedureVersion:version,candidate:Schema.Unknown})).pipe(Schema.maxItems(64)),
 versions,activeVersion:Schema.NullOr(version),lastRun:Schema.NullOr(Schema.Struct({version,input,result:Schema.Unknown})),
 lastBatchRun:Schema.optional(Schema.NullOr(Schema.Struct({version,rows:batchRows}))),
});
export const SemanticHelperActionSchema=Schema.Union(
 Schema.Struct({kind:Schema.Literal('correct-semantic-recording-expectation'),recordingId:id,expected:SemanticExpectedSchema,reason:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(500),Schema.filter(value=>value.trim().length>0)),expectedRevision:revision}),
 Schema.Struct({kind:Schema.Literal('set-semantic-procedure'),procedure:Schema.Unknown,expectedRevision:revision}),
 Schema.Struct({kind:Schema.Literal('replace-semantic-procedure'),procedure:Schema.Unknown,rationales:Schema.Array(Schema.Unknown).pipe(Schema.maxItems(64)),corrections:Schema.Array(Schema.Unknown).pipe(Schema.maxItems(64)),examples:Schema.Array(Schema.Unknown).pipe(Schema.maxItems(20)),expectedRevision:revision}),
 Schema.Struct({kind:Schema.Literal('record-semantic-input'),input,expectedRevision:revision}),
 Schema.Struct({kind:Schema.Literal('set-semantic-evidence'),rationales:Schema.Array(Schema.Unknown).pipe(Schema.maxItems(64)),corrections:Schema.Array(Schema.Unknown).pipe(Schema.maxItems(64)),examples:Schema.Array(Schema.Unknown).pipe(Schema.maxItems(20)),expectedRevision:revision}),
 Schema.Struct({kind:Schema.Literal('save-semantic-version'),changeNote:note,expectedRevision:revision}),
 Schema.Struct({kind:Schema.Literal('activate-semantic-version','restore-semantic-version'),version,expectedRevision:revision}),
 Schema.Struct({kind:Schema.Literal('deactivate-semantic'),expectedRevision:revision}),
 Schema.Struct({kind:Schema.Literal('run-semantic-active'),input,expectedRevision:revision}),
 Schema.Struct({kind:Schema.Literal('run-semantic-batch'),inputs:Schema.Array(batchInput).pipe(Schema.minItems(1),Schema.maxItems(semanticBatchLimit)),expectedVersion:version,expectedRevision:revision}),
);
export type SemanticHelperAction=typeof SemanticHelperActionSchema.Type;
export type SemanticHelperState={kind:'helper-studio';format:'semantic-record-v1';helperId:string;revision:number;
 definitions:{procedure:SemanticProcedure}[];draftVersion:number|null;recordings:SemanticRecording[];
 recordingCorrections?:readonly SemanticRecordingCorrection[];rationales:SemanticDemonstrationCandidate['rationales'];corrections:SemanticDemonstrationCandidate['corrections'];examples:SemanticDemonstrationCandidate['examples'];
 evidenceHistory:{atRevision:number;procedureVersion:number;candidate:SemanticDemonstrationCandidate}[];
 versions:{version:number;procedureVersion:number;savedAtRevision:number;changeNote:string;candidate:SemanticDemonstrationCandidate}[];
 activeVersion:number|null;lastRun:{version:number;input:Record<string,string|number|boolean>;result:SemanticRunResult}|null;
 lastBatchRun?:{version:number;rows:{input:Record<string,string|number|boolean>;result:SemanticRunResult}[]}|null};

function fail(message:string):never{throw Error(message);}
// Detach and reject getters, prototypes, symbols, cycles and bounded-work attacks
// before Effect schemas or JSON comparisons can inspect caller-owned data.
function copy(value:unknown):unknown{
 const ancestors=new Set<object>();let members=0,characters=0;
 function visit(value:unknown,depth:number):unknown{
  if(++members>20000||depth>64)fail('Semantic helper data exceeds its local structure limit.');
  if(typeof value==='string'){characters+=value.length;if(characters>512000)fail('Semantic helper data exceeds its local character limit.');return value;}
  if(typeof value==='number'){if(!Number.isFinite(value))fail('Semantic helper numbers must be finite.');return value;}
  if(value===null||typeof value==='boolean')return value;
  if(typeof value!=='object')return fail('Semantic helper data must be inert JSON.');
  if(ancestors.has(value))fail('Cyclic semantic helper data is unsupported.');
  const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null&&!(array&&prototype===Array.prototype))fail('Semantic helper data must use plain records and arrays.');
  const keys=Reflect.ownKeys(value);if(keys.length>20000-members)fail('Semantic helper data exceeds its local structure limit.');
  for(const key of keys){if(typeof key!=='string'||key.length>80||!/^[A-Za-z0-9_-]+$/.test(key)||['__proto__','prototype','constructor'].includes(key))fail('Unsupported semantic helper member.');characters+=key.length;}
  if(characters>512000)fail('Semantic helper data exceeds its local character limit.');
  const descriptors=Object.getOwnPropertyDescriptors(value);ancestors.add(value);
  if(array){
   if(value.length>20000||keys.length!==value.length+1)fail('Semantic helper arrays must be dense bounded lists.');
   const result:unknown[]=[];for(let i=0;i<value.length;i++){const descriptor=descriptors[String(i)];if(!descriptor||!('value' in descriptor)||!descriptor.enumerable)fail('Semantic helper accessors and sparse arrays are unsupported.');result.push(visit(descriptor.value,depth+1));}
   ancestors.delete(value);return result;
  }
  const result:[string,unknown][]=[];for(const key of keys){if(typeof key!=='string')return fail('Semantic helper symbols are unsupported.');const descriptor=descriptors[key];if(!('value' in descriptor)||!descriptor.enumerable)fail('Semantic helper accessors and hidden members are unsupported.');result.push([key,visit(descriptor.value,depth+1)]);}
  ancestors.delete(value);return Object.fromEntries(result);
 }
 return visit(value,0);
}
function decode<A,I>(schema:Schema.Schema<A,I>,value:unknown):A{return Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(copy(value));}
function canonical(value:unknown):string{
 if(value===null||typeof value==='string'||typeof value==='number'||typeof value==='boolean')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
 return fail('Semantic helper comparison requires inert data.');
}
function candidate(state:SemanticHelperState):SemanticDemonstrationCandidate{
 const procedure=state.definitions.find(item=>item.procedure.version===state.draftVersion)?.procedure;
 if(!procedure)fail('Choose a semantic procedure first.');
 return {schemaVersion:1,procedure,recordings:state.recordings,rationales:state.rationales,corrections:state.corrections,examples:state.examples,...(state.recordingCorrections?{recordingCorrections:state.recordingCorrections}:{})};
}
function check(state:SemanticHelperState){return checkSemanticDemonstration({helperId:state.helperId,atRevision:state.revision},candidate(state));}
function parseState(helperId:string,value:unknown):SemanticHelperState{
 const owner=decode(id,helperId),state=decode(SemanticHelperStateSchema,value) as unknown as SemanticHelperState;
 if(state.helperId!==owner)fail('This semantic helper belongs to another owner.');
 let base:{id:string;target:SemanticProcedure['target']}|undefined;
 state.definitions=state.definitions.map((item,index)=>{
  const procedure=parseSemanticProcedure(item.procedure);
  if(procedure.version!==index+1)fail('Semantic definition revisions must be contiguous.');
  base??={id:procedure.id,target:procedure.target};
  if(procedure.id!==base.id||procedure.target!==base.target)fail('Semantic definition identity cannot change.');
  return {procedure};
 });
 if(state.draftVersion!==null&&!state.definitions[state.draftVersion-1])fail('The semantic draft definition is unavailable.');
 if(state.draftVersion===null&&(state.definitions.length||state.recordings.length||state.rationales.length||state.corrections.length||state.examples.length||state.evidenceHistory.length||(state.recordingCorrections?.length??0)||state.versions.length))fail('Semantic history requires a draft definition.');
 state.recordings=state.recordings.map(recording=>{
  const parsed=parseSemanticRecording({helperId:owner,atRevision:state.revision},recording),definition=state.definitions[parsed.procedure.version-1]?.procedure;
  if(!definition||canonical(definition)!==canonical(parsed.procedure))fail('A recording differs from its immutable semantic definition.');
  return parsed;
 });
 if(new Set(state.recordings.map(item=>item.recordingId)).size!==state.recordings.length||new Set(state.recordings.map(item=>item.atRevision)).size!==state.recordings.length)fail('Semantic recording identities and revisions must be unique.');
 if(state.recordings.some((item,index)=>index>0&&item.atRevision<=state.recordings[index-1].atRevision))fail('Semantic recordings must retain their original order.');
 if(state.recordings.length&&(state.rationales.length||state.corrections.length||state.examples.length||state.recordingCorrections?.length)){const checked=check(state);if(!checked.checks||!state.recordingCorrections?.length&&!state.rationales.length)fail(checked.issues[0]??'Invalid semantic evidence.');}
 else if(state.rationales.length||state.corrections.length||state.examples.length||state.recordingCorrections?.length)fail('Record a local computation before adding semantic evidence.');
 state.evidenceHistory.forEach((saved,index)=>{
  if(saved.atRevision>state.revision||(index>0&&saved.atRevision<=state.evidenceHistory[index-1].atRevision))fail('Semantic evidence history must be ordered.');
  const definition=state.definitions[saved.procedureVersion-1]?.procedure;
  if(!definition||canonical(saved.candidate.procedure)!==canonical(definition))fail('Historical semantic evidence differs from its definition.');
  const checked=checkSemanticDemonstration({helperId:owner,atRevision:saved.atRevision},saved.candidate);
  if(!checked.checks||(saved.candidate.recordingCorrections??[]).some(item=>item.atRevision>=saved.atRevision))fail('Historical semantic evidence is invalid.');
  const original=state.recordings.filter(item=>item.atRevision<saved.atRevision);
  if(canonical(original)!==canonical(checked.recordings))fail('Historical semantic evidence changed its recordings.');
 });
 state.versions.forEach((saved,index)=>{
  if(saved.version!==index+1||saved.savedAtRevision>state.revision||(index>0&&saved.savedAtRevision<=state.versions[index-1].savedAtRevision))fail('Saved helper versions must be ordered.');
  const definition=state.definitions[saved.procedureVersion-1]?.procedure;
  if(!definition||canonical(saved.candidate.procedure)!==canonical(definition))fail('A saved helper version differs from its semantic definition.');
  const checked=checkSemanticDemonstration({helperId:owner,atRevision:saved.savedAtRevision},saved.candidate);
  if(!checked.passed||(saved.candidate.recordingCorrections??[]).some(item=>item.atRevision>=saved.savedAtRevision))fail('Saved semantic helper checks are invalid.');
  const original=state.recordings.filter(item=>item.atRevision<saved.savedAtRevision);
  if(canonical(original)!==canonical(checked.recordings))fail('Saved helper recording history changed.');
 });
 const correctionIds=new Map<string,string>(),correctionRevisions=new Map<number,string>();
 for(const correction of [...(state.recordingCorrections??[]),...state.evidenceHistory.flatMap(item=>item.candidate.recordingCorrections??[]),...state.versions.flatMap(item=>item.candidate.recordingCorrections??[])]){
  const text=canonical(correction),previous=correctionIds.get(correction.id),atRevision=correctionRevisions.get(correction.atRevision);
  if(previous!==undefined&&previous!==text||atRevision!==undefined&&atRevision!==correction.id)fail('A recorded-expectation correction changed its immutable history.');
  if(!state.definitions[correction.procedureVersion-1])fail('A corrected expectation refers to an unavailable definition.');
  correctionIds.set(correction.id,text);correctionRevisions.set(correction.atRevision,correction.id);
 }
 if(state.activeVersion!==null&&!state.versions.some(item=>item.version===state.activeVersion))fail('The active semantic helper version is unavailable.');
 if(state.lastRun){const saved=state.versions.find(item=>item.version===state.lastRun!.version);if(!saved||canonical(runSemanticProcedure(saved.candidate.procedure,state.lastRun.input))!==canonical(state.lastRun.result))fail('The saved semantic result differs from its input and version.');}
 if(state.lastBatchRun){const saved=state.versions.find(item=>item.version===state.lastBatchRun!.version);if(!saved||state.activeVersion!==saved.version||state.lastBatchRun.rows.some(row=>canonical(runSemanticProcedure(saved.candidate.procedure,row.input))!==canonical(row.result)))fail('The saved batch differs from its inputs and active version.');}
 return state;
}
function initial(helperId:string):SemanticHelperState{return {kind:'helper-studio',format:'semantic-record-v1',helperId:decode(id,helperId),revision:0,definitions:[],draftVersion:null,recordings:[],rationales:[],corrections:[],examples:[],evidenceHistory:[],versions:[],activeVersion:null,lastRun:null};}
function update(helperId:string,stateValue:unknown,actionValue:unknown):SemanticHelperState{
 const state=parseState(helperId,stateValue),action=decode(SemanticHelperActionSchema,actionValue);
 if(action.expectedRevision!==state.revision)fail('This semantic helper changed. Reload it before editing.');
 if(state.revision>=500)fail('The helper reached its local revision limit.');
 let next:SemanticHelperState={...state,revision:state.revision+1,lastRun:null,...(state.lastBatchRun!==undefined?{lastBatchRun:null}:{})};
 const archiveEvidence=()=>{
  if(!state.rationales.length&&!state.corrections.length&&!state.examples.length&&!state.recordingCorrections?.length)return state.evidenceHistory;
  if(state.evidenceHistory.length>=64)fail('The semantic evidence history limit was reached.');
  return [...state.evidenceHistory,{atRevision:next.revision,procedureVersion:state.draftVersion!,candidate:candidate(state)}];
 };
 switch(action.kind){
  case 'correct-semantic-recording-expectation':{
   if((state.recordingCorrections?.length??0)>=64)fail('The recorded-expectation correction limit was reached.');
   const current=candidate(state),entry=semanticRecordingExpectations({helperId:state.helperId,atRevision:state.revision},current.procedure,state.recordings,state.recordingCorrections??[]).find(item=>item.recordingId===action.recordingId);
   if(!entry)fail('Choose an original recording from this helper.');
   const receipt:SemanticRecordingCorrection={kind:'declared-recording-expectation',id:`expectation-${next.revision}`,helperId:state.helperId,recordingId:entry.recordingId,atRevision:next.revision,procedureVersion:current.procedure.version,previousCorrectionId:entry.correctionIds.at(-1)??null,before:entry.effective.expected,after:action.expected,reason:action.reason};
   next={...next,evidenceHistory:archiveEvidence(),recordingCorrections:[...(state.recordingCorrections??[]),receipt]};break;
  }
  case 'set-semantic-procedure':case 'replace-semantic-procedure':{
   if(state.definitions.length>=20)fail('The semantic definition revision limit was reached.');
   const parsed=parseSemanticProcedure(action.procedure),procedure=parseSemanticProcedure({...parsed,version:state.definitions.length+1});
   next={...next,definitions:[...state.definitions,{procedure}],draftVersion:procedure.version,evidenceHistory:archiveEvidence(),...(action.kind==='replace-semantic-procedure'?{rationales:action.rationales as SemanticHelperState['rationales'],corrections:action.corrections as SemanticHelperState['corrections'],examples:action.examples as SemanticHelperState['examples']}:{})};break;
  }
  case 'record-semantic-input':{
   const procedure=candidate(state).procedure;
   const recorded=createSemanticRecording({helperId:state.helperId,atRevision:next.revision},{recordingId:`recording-${next.revision}`,procedure,input:action.input});
   next={...next,recordings:[...state.recordings,recorded]};break;
  }
  case 'set-semantic-evidence':next={...next,evidenceHistory:archiveEvidence(),rationales:action.rationales as SemanticHelperState['rationales'],corrections:action.corrections as SemanticHelperState['corrections'],examples:action.examples as SemanticHelperState['examples']};break;
  case 'save-semantic-version':{
   const checked=check(state);if(!checked.passed)fail('Pass the semantic example, negative, exception and declared held-out checks before saving.');
   if(state.versions.length>=20)fail('The saved helper version limit was reached.');
   next={...next,versions:[...state.versions,{version:state.versions.length+1,procedureVersion:state.draftVersion!,savedAtRevision:next.revision,changeNote:action.changeNote,candidate:candidate(state)}]};break;
  }
  case 'activate-semantic-version':if(!state.versions.some(item=>item.version===action.version))fail('The saved semantic helper version is unavailable.');next={...next,activeVersion:action.version};break;
  case 'restore-semantic-version':{
   const saved=state.versions.find(item=>item.version===action.version);if(!saved)fail('The saved semantic helper version is unavailable.');
   if(state.definitions.length>=20)fail('The semantic definition revision limit was reached.');
   const procedure=parseSemanticProcedure({...saved.candidate.procedure,version:state.definitions.length+1});
   next={...next,definitions:[...state.definitions,{procedure}],draftVersion:procedure.version,evidenceHistory:archiveEvidence(),rationales:saved.candidate.rationales,corrections:saved.candidate.corrections,examples:saved.candidate.examples,...(state.recordingCorrections||saved.candidate.recordingCorrections?{recordingCorrections:saved.candidate.recordingCorrections??[]}:{})};break;
  }
  case 'deactivate-semantic':next={...next,activeVersion:null};break;
  case 'run-semantic-batch':{
   const saved=state.versions.find(item=>item.version===state.activeVersion);if(!saved)fail('Activate a saved semantic helper first.');
   if(saved.version!==action.expectedVersion)fail('The active helper version changed. Review the batch before running it.');
   if(saved.candidate.procedure.input.fields.length>6)fail('Batch runs support up to six typed input fields.');
   next={...next,lastBatchRun:{version:saved.version,rows:action.inputs.map(input=>({input,result:runSemanticProcedure(saved.candidate.procedure,input)}))}};break;
  }
  case 'run-semantic-active':{
   const saved=state.versions.find(item=>item.version===state.activeVersion);if(!saved)fail('Activate a saved semantic helper first.');
   next={...next,lastRun:{version:saved.version,input:action.input,result:runSemanticProcedure(saved.candidate.procedure,action.input)}};break;
  }
  default:{const exhaustive:never=action;return exhaustive;}
 }
 return parseState(helperId,next);
}
export const semanticHelper=Object.freeze({initial,parseState,update,check});

/** Readable value-only projection for the existing guarded module document. */
export function semanticHelperText(helperId:string,stateValue:unknown):string{
 const state=parseState(helperId,stateValue),active=state.versions.find(item=>item.version===state.activeVersion);
 const quote=(label:string,value:unknown)=>{const text=typeof value==='string'?value:JSON.stringify(value,null,2),longest=Math.max(0,...(text.match(/`+/g)??[]).map(run=>run.length)),fence='`'.repeat(Math.max(3,longest+1));return `${label}\n\n${fence}text\n${text}\n${fence}`;};
 const operand=(value:Extract<SemanticPredicate,{kind:'compare'}>['left'])=>value.kind==='literal'?JSON.stringify(value.value):`${value.kind} ${value.field}`;
 const predicate=(value:SemanticPredicate):string=>value.kind==='compare'?`${operand(value.left)} ${value.operator} ${operand(value.right)}`:value.kind==='not'?`not (${predicate(value.predicate)})`:`${value.kind} (${value.terms.map(predicate).join('; ')})`;
 const assignment=(value:Extract<SemanticStep,{kind:'assign'}>['value']):string=>value.kind==='arithmetic'?`${operand(value.left)} ${{add:'plus',subtract:'minus',multiply:'times',divide:'divided by'}[value.operator]} ${operand(value.right)}`:operand(value);
 const steps=(value:SemanticStep):string[]=>{switch(value.kind){case 'assign':return [quote('Set output field',`${value.field} from ${assignment(value.value)}`),...steps(value.next)];case 'branch':return [quote('Branch when',predicate(value.predicate)),'When true:',...steps(value.then),'Otherwise:',...steps(value.else)];case 'abstain':return [quote('Stop for review',value.reason)];case 'return':return ['Return the checked local result.'];}};
 const resultText=(result:SemanticRunResult):string[]=>result.status==='invalid-input'?[quote('Input needs review',result.reason)]:[result.status==='completed'?'Computed local result.':quote('Stopped for review',result.reason),quote('Output fields',result.output),'Inspected steps:',...result.trace.map(item=>quote(item.kind,item.inspected.map(read=>`${read.field??'value'}: ${String(read.value)}`).join('; ')||item.reason||'Completed.'))];
 const parts=['# Local record helper','This helper computes local record values. It does not perform external actions.',`Active version: ${state.activeVersion??'none'}.`,'## Saved versions',...state.versions.map(item=>`Version ${item.version}: ${item.changeNote}`),...(!state.versions.length?['No saved versions.']:[]),'## Current definition'];
 for(const saved of state.versions)if(saved.candidate.recordingCorrections?.length){parts.push(`## Saved version ${saved.version} expectation corrections`);for(const item of saved.candidate.recordingCorrections)parts.push(quote('Saved declared correction',{input:saved.candidate.recordings.find(recording=>recording.recordingId===item.recordingId)?.input,before:item.before,after:item.after,reason:item.reason}));}
 if(state.draftVersion!==null){const current=candidate(state);parts.push(quote('Purpose',current.procedure.intent),...current.procedure.input.fields.map(field=>quote('Input field',`${field.name} (${field.kind})`)),...current.procedure.output.fields.map(field=>quote('Output field',`${field.name} (${field.kind})`)),...current.procedure.preconditions.map(condition=>quote('Required condition',`${predicate(condition.predicate)} — ${condition.reason}`)),...steps(current.procedure.root),...current.procedure.postconditions.map(condition=>quote('Result condition',`${predicate(condition.predicate)} — ${condition.reason}`)));}
 if(state.recordings.length){parts.push('## Computed local replay','These values are computed from the supplied record; they are not an external observation.');for(const item of state.recordings)parts.push(quote('Input fields',item.input),...resultText(item.result));}
 if(state.recordingCorrections?.length){parts.push('## Corrected recorded expectations','Original recordings remain unchanged; these are declared checks for later drafts.');for(const item of state.recordingCorrections)parts.push(quote('Original recorded expectation',state.recordings.find(recording=>recording.recordingId===item.recordingId)?.result),quote(`Corrected expectation for draft ${item.procedureVersion}`,{before:item.before,after:item.after,reason:item.reason}));}
 if(state.rationales.length)parts.push('## Proposed and corrected reasons',...state.rationales.map(item=>quote('Proposed reason',item.reason)),...state.corrections.map(item=>quote('Correction',{before:item.before,after:item.after,reason:item.reason})));
 if(state.evidenceHistory.length){parts.push('## Earlier proposed and corrected reasons','These are retained from earlier draft revisions.');for(const entry of state.evidenceHistory){for(const item of entry.candidate.rationales)parts.push(quote('Earlier proposed reason',item.reason));for(const item of entry.candidate.corrections)parts.push(quote('Earlier correction',{before:item.before,after:item.after,reason:item.reason}));for(const item of entry.candidate.recordingCorrections??[])parts.push(quote('Earlier declared expectation',{before:item.before,after:item.after,reason:item.reason}));}}
 if(state.draftVersion!==null){const checked=check(state);parts.push('## Current checks',checked.passed?'The local checks pass.':'The local checks need review.','The other input is declared by the user; independence and mastery are not established.',...checked.issues.map(issue=>quote('Check to review',issue)));}
 if(active)parts.push(`## Active definition`,quote('Purpose',active.candidate.procedure.intent));
 if(state.lastRun)parts.push(`## Latest run — version ${state.lastRun.version}`,quote('Input fields',state.lastRun.input),...resultText(state.lastRun.result));
 if(state.lastBatchRun){parts.push(`## Latest batch — version ${state.lastBatchRun.version}`,'Each record was evaluated independently; stopped and invalid records are not completed outputs.');for(const [index,row] of state.lastBatchRun.rows.entries())parts.push(`### Record ${index+1}`,quote('Exact input fields',row.input),...resultText(row.result));}
 return parts.join('\n\n');
}
