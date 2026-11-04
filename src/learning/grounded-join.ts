import {Schema} from 'effect';
import type {ArtifactRef,SourceRef,Task} from '../core/types';
import {joinLab,describeLastJoinChange,JoinLessonSchema,JoinStateSchema,JoinActionSchema,validateJoinCase,type Cell,type JoinCase,type JoinLesson} from './join-lab';

const id=Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,80}$/));
const text=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(500));
const title=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(160));
const hostText=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const digest=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(128));
const positive=Schema.Number.pipe(Schema.filter(Number.isSafeInteger),Schema.positive());
const revision=Schema.Int.pipe(Schema.between(0,500));
const cell=Schema.Union(Schema.Null,Schema.String.pipe(Schema.maxLength(160)),Schema.Number.pipe(Schema.filter(Number.isSafeInteger)),Schema.Boolean);
export const GroundingSourceRefSchema=Schema.Struct({sourceId:hostText,version:positive,digest});
export const GroundingArtifactRefSchema=Schema.Struct({artifactId:hostText,revision:positive,digest});
const location=Schema.Union(
 Schema.Struct({kind:Schema.Literal('text-range'),start:Schema.Int.pipe(Schema.nonNegative()),end:Schema.Int.pipe(Schema.positive()),quote:Schema.String.pipe(Schema.maxLength(500))}),
 Schema.Struct({kind:Schema.Literal('image-region'),x:Schema.Number.pipe(Schema.between(0,1)),y:Schema.Number.pipe(Schema.between(0,1)),width:Schema.Number.pipe(Schema.greaterThan(0),Schema.lessThanOrEqualTo(1)),height:Schema.Number.pipe(Schema.greaterThan(0),Schema.lessThanOrEqualTo(1)),quote:Schema.String.pipe(Schema.maxLength(500))}),
);
const citation=Schema.Struct({id,sourceRef:GroundingSourceRefSchema,location});
const proposedCitation=Schema.Struct({id,source:Schema.String.pipe(Schema.pattern(/^S[12]$/)),location});
const extractedCell=Schema.Union(
 Schema.Struct({kind:Schema.Literal('observed'),value:cell,citationId:id}),
 Schema.Struct({kind:Schema.Literal('needs-correction'),reason:text,citationId:id}),
 Schema.Struct({kind:Schema.Literal('provided'),value:cell}),
);
const extractedColumn=Schema.Struct({id,label:title,sourceLabel:title,type:Schema.Literal('string','integer','boolean','unknown'),citationId:Schema.NullOr(id),typeCitationId:Schema.NullOr(id)});
const extractedTable=Schema.Struct({id,title:title,citationId:Schema.NullOr(id),columns:Schema.Array(extractedColumn).pipe(Schema.minItems(1),Schema.maxItems(4)),rows:Schema.Array(Schema.Struct({id,cells:Schema.Array(extractedCell).pipe(Schema.minItems(1),Schema.maxItems(4))})).pipe(Schema.maxItems(12))});
const keys=Schema.Struct({mode:Schema.Literal('INNER','LEFT'),leftColumnId:id,rightColumnId:id});
const keyProposal=Schema.Union(Schema.Struct({kind:Schema.Literal('mapped'),keys,reason:text,citationId:Schema.NullOr(id)}),Schema.Struct({kind:Schema.Literal('ambiguous'),reason:text}));
const extraction=Schema.Struct({id,title:title,left:extractedTable,right:extractedTable,join:keyProposal,assumptions:Schema.Array(text).pipe(Schema.maxItems(8))});
export const JoinExtractionProposalSchema=Schema.Struct({schemaVersion:Schema.Literal(1),extraction,citations:Schema.Array(proposedCitation).pipe(Schema.minItems(1),Schema.maxItems(128))});
export type JoinExtractionProposal=typeof JoinExtractionProposalSchema.Type;
const basis=Schema.Union(
 Schema.Struct({kind:Schema.Literal('local-demo'),contextDigest:digest}),
 Schema.Struct({kind:Schema.Literal('observed-source'),contextDigest:digest,taskId:hostText,artifact:GroundingArtifactRefSchema,sourceRefs:Schema.Array(GroundingSourceRefSchema).pipe(Schema.minItems(1),Schema.maxItems(2))}),
);
export const GroundedJoinDataSchema=Schema.Struct({kind:Schema.Literal('grounded-join'),schemaVersion:Schema.Literal(1),id,title:title,version:positive,basis,extraction,citations:Schema.Array(citation).pipe(Schema.maxItems(128)),transfer:JoinLessonSchema.fields.transfer});
export type GroundedJoinData=typeof GroundedJoinDataSchema.Type;
const cellCorrection=Schema.Struct({side:Schema.Literal('left','right'),rowId:id,columnId:id,value:cell,reason:text});
const typeCorrection=Schema.Struct({side:Schema.Literal('left','right'),columnId:id,type:Schema.Literal('string','integer','boolean'),reason:text});
export const GroundedJoinStateSchema=Schema.Struct({kind:Schema.Literal('grounded-join'),revision,contextDigest:digest,mode:Schema.Literal('quick','deep','visual'),cellCorrections:Schema.Array(cellCorrection).pipe(Schema.maxItems(96)),typeCorrections:Schema.Array(typeCorrection).pipe(Schema.maxItems(8)),keyCorrection:Schema.NullOr(Schema.Struct({keys,reason:text})),lab:Schema.NullOr(JoinStateSchema)});
export type GroundedJoinState=typeof GroundedJoinStateSchema.Type;
export const GroundedJoinActionSchema=Schema.Union(
 Schema.Struct({kind:Schema.Literal('correct-cell'),...cellCorrection.fields,expectedRevision:revision}),
 Schema.Struct({kind:Schema.Literal('correct-type'),...typeCorrection.fields,expectedRevision:revision}),
 Schema.Struct({kind:Schema.Literal('correct-keys'),keys,reason:text,expectedRevision:revision}),
 Schema.Struct({kind:Schema.Literal('remove-cell-correction'),side:Schema.Literal('left','right'),rowId:id,columnId:id,expectedRevision:revision}),
 Schema.Struct({kind:Schema.Literal('remove-type-correction'),side:Schema.Literal('left','right'),columnId:id,expectedRevision:revision}),
 Schema.Struct({kind:Schema.Literal('remove-key-correction'),expectedRevision:revision}),
 Schema.Struct({kind:Schema.Literal('accept-extraction'),expectedRevision:revision}),
 Schema.Struct({kind:Schema.Literal('explanation-mode'),mode:Schema.Literal('quick','deep','visual'),expectedRevision:revision}),
 Schema.Struct({kind:Schema.Literal('lab'),action:JoinActionSchema,expectedRevision:revision}),
);
export type GroundedJoinAction=typeof GroundedJoinActionSchema.Type;
function decode<A,I>(schema:Schema.Schema<A,I>,value:unknown):A{return Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(value);}
function sameRef(a:SourceRef,b:SourceRef){return a.sourceId===b.sourceId&&a.version===b.version&&a.digest===b.digest;}
function sameArtifact(a:ArtifactRef,b:ArtifactRef){return a.artifactId===b.artifactId&&a.revision===b.revision&&a.digest===b.digest;}
function unique(values:readonly string[]){if(new Set(values).size!==values.length)throw Error('Extraction identities must be unique.');}
function validateData(data:GroundedJoinData){
 unique([data.id,data.extraction.id,data.transfer.id,...[data.extraction.left,data.extraction.right,data.transfer.left,data.transfer.right].flatMap(t=>[t.id,...t.columns.map(c=>c.id),...t.rows.map(r=>r.id)])]);
 validateJoinCase(data.transfer);
 unique(data.citations.map(c=>c.id));
 if(data.basis.kind==='observed-source')unique(data.basis.sourceRefs.map(r=>r.sourceId));
 const getCitation=(citationId:string|null)=>{const c=data.citations.find(c=>c.id===citationId);if(!c)throw Error('Every observed table, column and cell needs a supplied citation.');return c;};
 for(const c of data.citations){
  if(data.basis.kind!=='observed-source'||!data.basis.sourceRefs.some(r=>sameRef(r,c.sourceRef)))throw Error('Citation is outside the host-bound source set.');
  if(c.location.kind==='text-range'&&c.location.end<c.location.start)throw Error('Invalid citation range.');
  if(c.location.kind==='image-region'&&(c.location.x+c.location.width>1||c.location.y+c.location.height>1))throw Error('Citation region exceeds its source.');
 }
 for(const t of [data.extraction.left,data.extraction.right]){
  if(data.basis.kind==='observed-source'&&getCitation(t.citationId).location.quote!==t.title)throw Error('Observed table title must match its citation.');
  for(const column of t.columns)if(data.basis.kind==='observed-source'){
   if(getCitation(column.citationId).location.quote!==column.sourceLabel)throw Error('Column mapping must retain its cited source label.');
   if(column.type!=='unknown'&&getCitation(column.typeCitationId).location.quote!==column.type)throw Error('A declared observed type needs its exact source citation; otherwise leave the type unknown.');
  }
  for(const row of t.rows){
   if(row.cells.length!==t.columns.length)throw Error('Each extracted row must map every declared column.');
   for(const value of row.cells){
    if(data.basis.kind==='observed-source'&&value.kind==='provided')throw Error('Source extraction cannot include uncited invented values.');
    if(value.kind==='provided')continue;
    const c=getCitation(value.citationId);
    if(value.kind==='observed'&&c.location.quote!==(value.value===null?'NULL':String(value.value)))throw Error('An observed cell must retain its exact cited transcription. Use a user correction for another value.');
   }
  }
 }
 if(data.extraction.join.kind==='mapped'&&data.extraction.join.citationId!==null)getCitation(data.extraction.join.citationId);
}
function parse(value:unknown){const data=decode(GroundedJoinDataSchema,value);validateData(data);return data;}
function draftProblem(data:GroundedJoinData,state:GroundedJoinState){
 const missing:string[]=[];
 const table=(side:'left'|'right')=>{
  const t=data.extraction[side];
  const columns=t.columns.map(column=>{
   const correction=state.typeCorrections.find(c=>c.side===side&&c.columnId===column.id);
   const type=correction?.type??column.type;
   if(type==='unknown')missing.push(`${side}/${column.id}: choose the column type`);
   return {...column,type};
  });
  const rows=t.rows.map(row=>({id:row.id,values:row.cells.map((value,index)=>{
   const c=state.cellCorrections.find(c=>c.side===side&&c.rowId===row.id&&c.columnId===t.columns[index].id);
   if(c)return c.value;
   if(value.kind==='needs-correction'){missing.push(`${side}/${row.id}/${t.columns[index].id}: ${value.reason}`);return undefined;}
   return value.value;
  })}));
  return {id:t.id,title:t.title,columns:columns.map(({id,label,type})=>({id,label,type})),rows};
 };
 const left=table('left'),right=table('right');
 const join=state.keyCorrection?.keys??(data.extraction.join.kind==='mapped'?data.extraction.join.keys:null);
 if(!join)missing.push('Choose the join type and both keys explicitly.');
 return {left,right,join,missing};
}
function lesson(data:GroundedJoinData,state:GroundedJoinState):JoinLesson{
 const problem=draftProblem(data,state);
 if(problem.missing.length||!problem.join)throw Error(`Resolve the extraction first: ${problem.missing.join('; ')}`);
 return joinLab.parse({kind:'join-lab',schemaVersion:1,id:data.id,version:data.version,title:data.title,source:{sourceId:data.id,version:data.version,digest:data.basis.contextDigest},practice:{id:data.extraction.id,title:data.extraction.title,left:problem.left,right:problem.right,join:problem.join},transfer:data.transfer});
}
function parseState(dataValue:unknown,value:unknown){
 const data=parse(dataValue),state=decode(GroundedJoinStateSchema,value);
 if(state.contextDigest!==data.basis.contextDigest)throw Error('Saved review belongs to another source/extraction version.');
 unique(state.cellCorrections.map(c=>`${c.side}/${c.rowId}/${c.columnId}`));unique(state.typeCorrections.map(c=>`${c.side}/${c.columnId}`));
 for(const c of state.cellCorrections)if(!data.extraction[c.side].rows.some(r=>r.id===c.rowId)||!data.extraction[c.side].columns.some(column=>column.id===c.columnId))throw Error('Correction must identify an extracted row and column.');
 for(const c of state.typeCorrections)if(!data.extraction[c.side].columns.some(column=>column.id===c.columnId))throw Error('Type correction must identify an extracted column.');
 if(state.lab)joinLab.parseState(lesson(data,state),state.lab);
 return state;
}
function initial(dataValue:unknown):GroundedJoinState{
 const data=parse(dataValue);
 return {kind:'grounded-join',revision:0,contextDigest:data.basis.contextDigest,mode:'quick',cellCorrections:[],typeCorrections:[],keyCorrection:null,lab:null};
}
function update(dataValue:unknown,stateValue:unknown,actionValue:unknown):GroundedJoinState{
 const data=parse(dataValue),state=parseState(data,stateValue),action=decode(GroundedJoinActionSchema,actionValue);
 if(action.expectedRevision!==state.revision)throw Error('The source review changed. Reload its current state.');
 if(state.revision>=500)throw Error('Create a new lesson version to continue.');
 let next:GroundedJoinState={...state,revision:state.revision+1};
 if(action.kind==='explanation-mode')next={...next,mode:action.mode};
 else if(action.kind==='lab'){
  if(!state.lab)throw Error('Review and accept extracted values before experimenting.');
  next={...next,lab:joinLab.update(lesson(data,state),state.lab,action.action)};
 } else {
  if(state.lab)throw Error('The reviewed extraction is fixed. Create a new lesson version to correct it; prior practice and transfer are kept.');
  switch(action.kind){
   case 'correct-cell':{const {expectedRevision:_,kind:__,...c}=action;next={...next,cellCorrections:[...state.cellCorrections.filter(v=>v.side!==c.side||v.rowId!==c.rowId||v.columnId!==c.columnId),c]};break;}
   case 'correct-type':{const {expectedRevision:_,kind:__,...c}=action;next={...next,typeCorrections:[...state.typeCorrections.filter(v=>v.side!==c.side||v.columnId!==c.columnId),c]};break;}
   case 'correct-keys':next={...next,keyCorrection:{keys:action.keys,reason:action.reason}};break;
   case 'remove-cell-correction':{
    const corrections=state.cellCorrections.filter(c=>c.side!==action.side||c.rowId!==action.rowId||c.columnId!==action.columnId);
    if(corrections.length===state.cellCorrections.length)throw Error('This cell has no saved correction to remove.');
    next={...next,cellCorrections:corrections};break;
   }
   case 'remove-type-correction':{
    const corrections=state.typeCorrections.filter(c=>c.side!==action.side||c.columnId!==action.columnId);
    if(corrections.length===state.typeCorrections.length)throw Error('This column has no saved type correction to remove.');
    next={...next,typeCorrections:corrections};break;
   }
   case 'remove-key-correction':
    if(!state.keyCorrection)throw Error('There is no saved join correction to remove.');
    next={...next,keyCorrection:null};break;
   case 'accept-extraction':next={...next,lab:joinLab.initial(lesson(data,state))};break;
  }
 }
 return parseState(data,next);
}
export type GroundingStatus={kind:'current'}|{kind:'historical';reason:string}|{kind:'unverified';reason:string};
export function groundedJoinStatus(dataValue:unknown,task:Task):GroundingStatus{
 const data=parse(dataValue),basis=data.basis;
 if(basis.kind==='local-demo')return {kind:'current'};
 if(task.id!==basis.taskId)return {kind:'historical',reason:'This extraction belongs to another task.'};
 for(const ref of basis.sourceRefs){const source=task.sources.find(s=>s.id===ref.sourceId),v=source?.versions.at(-1);if(!source||source.freshness!=='fresh'||source.currentVersion!==ref.version||!v||v.id!==ref.sourceId||v.version!==ref.version||v.digest!==ref.digest)return {kind:'historical',reason:'The cited source changed or needs a fresh capture. The saved extraction is historical.'};}
 const a=task.artifacts.find(a=>a.id===basis.artifact.artifactId),v=a?.revisions.at(-1);
 if(!a||!v||!sameArtifact(basis.artifact,{artifactId:a.id,revision:v.revision,digest:v.digest}))return {kind:'historical',reason:'The cited artifact changed. Review a new extraction version.'};
 return {kind:'current'};
}
function observe(dataValue:unknown,stateValue:unknown){
 const data=parse(dataValue),state=parseState(data,stateValue),draft=draftProblem(data,state);
 let problemError:string|null=null;
 if(!draft.missing.length)try{lesson(data,state);}catch(cause){problemError=cause instanceof Error?cause.message:'Review table types and keys.';}
 const lab=state.lab?joinLab.observe(lesson(data,state),state.lab):null;
 const origin=data.basis.kind==='local-demo'?'local-demo':state.cellCorrections.length||state.typeCorrections.length||state.keyCorrection?'user-corrected':'observed-source';
 const count=lab?.observation?.rowCount;
 const change=lab?.change??lab?.practiceReview?.change??null;
 const stage=lab?.phase.startsWith('transfer')?'Separate synthetic challenge':'Reviewed practice';
 const currentProblemOrigin=stage==='Separate synthetic challenge'?'synthetic-transfer':state.lab&&state.lab.practiceEdits>0?'local-experiment':origin;
 const original=data.extraction.join;
 const joinMapping=original.kind==='mapped'?{kind:'mapped' as const,origin:data.basis.kind==='local-demo'?'local-demo':original.citationId===null?'proposed-assumption':'source-cited',keys:original.keys,reason:original.reason,citationId:original.citationId,citation:data.citations.find(c=>c.id===original.citationId)??null}:{kind:'ambiguous' as const,origin:'unresolved',reason:original.reason};
 const assumptions=[...data.extraction.assumptions,...(joinMapping.origin==='proposed-assumption'?[`Proposed join condition (not source-cited): ${joinMapping.reason}`]:[])];
 const quick=state.lab?(count===undefined?`Predict the result of the ${stage.toLowerCase()}.`:`${count} output rows, computed from the ${lab?.problem.join.mode} join at local revision ${state.lab.revision} (${stage.toLowerCase()}).`):data.basis.kind==='local-demo'?'Review the supplied practice tables before running the experiment.':'Review the cited transcription and resolve missing values before running the experiment.';
 const deep=lab?.assessment?.correction??'Every equal non-NULL pair produces one row; LEFT also retains unmatched left rows. Exact strings, safe integers and booleans only. No coercion, filters or database collation are modelled.';
 const changeSummary=change?`${stage==='Separate synthetic challenge'?'Practice review before transfer: ':''}${change.originalCount} → ${change.currentCount} rows; added: ${change.addedPairIds.join(', ')||'none'}; removed: ${change.removedPairIds.join(', ')||'none'}; changed values: ${change.changedPairIds.join(', ')||'none'}.`:null;
 return {origin,currentProblemOrigin,stage,mode:state.mode,revision:state.revision,sourceRefs:data.basis.kind==='observed-source'?data.basis.sourceRefs:[],citations:data.citations,assumptions,joinMapping,userJoinCorrection:state.keyCorrection,missing:draft.missing,problemError,ready:!draft.missing.length&&!problemError,quick,deep,changeSummary,visual:lab?.observation?.rows??[],lab,lesson:state.lab?lesson(data,state):null};
}
/** One public projection for notes and history. Exact refs stay in the typed envelope. */
function readable(dataValue:unknown,stateValue?:unknown):string{
 const data=parse(dataValue),state=stateValue===undefined?initial(data):parseState(data,stateValue),view=observe(data,state),draft=draftProblem(data,state);
 const column=(side:'left'|'right',columnId:string)=>`${data.extraction[side].title}.${data.extraction[side].columns.find(c=>c.id===columnId)?.label??'Unknown column'}`;
 const row=(side:'left'|'right',rowId:string)=>`${data.extraction[side].title} row ${data.extraction[side].rows.findIndex(r=>r.id===rowId)+1}`;
 const keys=(value:NonNullable<GroundedJoinState['keyCorrection']>['keys'])=>`${value.mode} equality on ${column('left',value.leftColumnId)} = ${column('right',value.rightColumnId)}`;
 const value=(cell:Cell|undefined)=>cell===undefined?'Needs your correction':cell===null?'NULL':typeof cell==='string'?`“${cell}”`:String(cell);
 const type=(name:string)=>name==='string'?'text':name==='integer'?'whole number':name==='boolean'?'true or false':'needs your confirmation';
 const source=(ref:SourceRef)=>{
  const index=view.sourceRefs.findIndex(item=>sameRef(item,ref));
  const locations=data.citations.filter(c=>sameRef(c.sourceRef,ref)).map(c=>c.location.kind);
  const kind=locations.length===0?'bound source':locations.every(kind=>kind==='text-range')?'cited text':locations.every(kind=>kind==='image-region')?'cited image':'cited source';
  return `Source ${index+1} (${kind}), version ${ref.version}`;
 };
 const citationLabel=(citationId:string|null)=>citationId===null?'':`Citation ${data.citations.findIndex(c=>c.id===citationId)+1}`;
 const mapping=view.joinMapping.kind==='mapped'
  ? `${view.joinMapping.origin==='source-cited'?'Source-cited mapping':view.joinMapping.origin==='local-demo'?'Local worked example':'Proposed assumption (no source citation)'}. ${keys(view.joinMapping.keys)}. Reason: ${view.joinMapping.reason}${view.joinMapping.citationId?` (${citationLabel(view.joinMapping.citationId)})`:''}`
  : `Unresolved. ${view.joinMapping.reason}`;
 const corrections=[
  ...state.cellCorrections.map(c=>`${row(c.side,c.rowId)}, ${data.extraction[c.side].columns.find(column=>column.id===c.columnId)!.label}: ${value(c.value)}. Reason: ${c.reason}`),
  ...state.typeCorrections.map(c=>`${column(c.side,c.columnId)} type: ${type(c.type)}. Reason: ${c.reason}`),
 ];
 const unresolved=[...(['left','right'] as const).flatMap(side=>[
  ...draft[side].columns.filter(c=>c.type==='unknown').map(c=>`${column(side,c.id)}: choose the column type.`),
  ...data.extraction[side].rows.flatMap(r=>r.cells.flatMap((cell,index)=>cell.kind==='needs-correction'&&!state.cellCorrections.some(c=>c.side===side&&c.rowId===r.id&&c.columnId===data.extraction[side].columns[index].id)?[`${row(side,r.id)}, ${data.extraction[side].columns[index].label}: ${cell.reason}`]:[])),
 ]),...(!draft.join?['Choose the join type and both keys explicitly.']:[])];
 // Validation can identify a particular cell; format that known address, never strip user text.
 let problemError=view.problemError;
 if(problemError)for(const side of ['left','right'] as const)for(const r of data.extraction[side].rows)for(const c of data.extraction[side].columns){
  const prefix=`Cell ${r.id}/${c.id} must be `;
  if(problemError.startsWith(prefix))problemError=`${row(side,r.id)}, ${c.label} must be ${problemError.slice(prefix.length)}`;
 }
 const tables=view.lab?(['left','right'] as const).map(side=>{
  const t=view.lab!.problem[side];return `${t.title}\nColumns: ${t.columns.map(c=>`${c.label} (${type(c.type)})`).join(', ')}\n${t.rows.map((r,index)=>`Row ${index+1}: ${r.values.map(value).join(' | ')}`).join('\n')||'(empty)'}`;
 }):(['left','right'] as const).map(side=>{
  const t=draft[side];return `${t.title}\nColumns: ${t.columns.map(c=>`${c.label} (${type(c.type)})`).join(', ')}\n${t.rows.map((r,index)=>`Row ${index+1}: ${r.values.map(value).join(' | ')}`).join('\n')||'(empty)'}`;
 });
 const lab=view.lab,observation=lab?.observation,assessment=lab?.assessment;
 const currentJoin=lab?`${lab.problem.join.mode} equality on ${lab.problem.left.title}.${lab.problem.left.columns.find(c=>c.id===lab.problem.join.leftColumnId)!.label} = ${lab.problem.right.title}.${lab.problem.right.columns.find(c=>c.id===lab.problem.join.rightColumnId)!.label}`:null;
 const labRow=(side:'left'|'right',rowId:string)=>{const t=lab!.problem[side];return `${t.title} row ${t.rows.findIndex(r=>r.id===rowId)+1}`;};
 const result=observation&&assessment?[
  `${observation.rowCount} output rows. ${assessment.correct?'Correct prediction.':`You predicted ${assessment.predictedCount}; the actual count is ${assessment.actualCount}.`}`,
  ...observation.contributions.map(c=>`${labRow('left',c.leftRowId)}: ${c.matchingRightRowIds.length?`matches ${c.matchingRightRowIds.map(id=>labRow('right',id)).join(', ')}`:c.reason==='null-key'?'NULL key does not satisfy equality':'no matching right row'}; contributes ${c.outputCount} row(s).`),
  'Computed pairs:',...observation.rows.map(r=>`${labRow('left',r.provenance.leftRowId)} → ${r.provenance.rightRowId?labRow('right',r.provenance.rightRowId):'Unmatched'}: ${r.leftValues.map(value).join(' | ')} / ${r.rightValues.map(value).join(' | ')}`),
  `Recorded reasoning (ungraded): ${assessment.reasoning||'(none)'}`,
  ...(lab.phase==='transfer-reviewed'?[`Transfer score: ${assessment.correct?'1 / 1':'0 / 1'} for the first row-count prediction. This records one attempt, not lasting learning.`]:[]),
 ]:['Predict the output row count to reveal computed pairs.'];
 const change=lab?.change??lab?.practiceReview?.change;
 const priorPractice=lab?.practiceReview?[
  `Prior practice prediction: ${lab.practiceReview.assessment.predictedCount}; computed result: ${lab.practiceReview.assessment.actualCount} rows. ${lab.practiceReview.assessment.correct?'Correct.':'Incorrect.'}`,
  `Recorded practice reasoning (ungraded): ${lab.practiceReview.assessment.reasoning||'(none)'}`,
 ]:[];
 const changeText=change?`${lab?.practiceReview?'Practice review before transfer: ':''}Compared with reviewed practice: ${change.originalCount} → ${change.currentCount} rows; added ${change.addedPairIds.length}, removed ${change.removedPairIds.length}, changed values in ${change.changedPairIds.length} pairs.`:'';
 const lastChange=lab?.lastChange??lab?.practiceReview?.lastChange;
 const last=lastChange&&state.lab?describeLastJoinChange(state.lab.practice,lastChange):null;
 const lastText=last?[last.summary,data.basis.kind==='local-demo'?'Hypothetical local practice edits; the original supplied practice data is unchanged.':'Hypothetical local practice edits; the reviewed transcription and its citations are unchanged.',...last.edits,last.effects,...last.rows.map(row=>`${row.label}: before ${row.before}; after ${row.after}.`),...(last.unchanged.length?[`Unchanged output contributions: ${last.unchanged.join(', ')}.`]:[]),...last.added.map(pair=>`Added: ${pair}.`),...last.removed.map(pair=>`Removed: ${pair}.`),...last.changed.map(pair=>`Displayed values changed: ${pair}.`)].join('\n\n'):'';
 const origin=view.origin==='local-demo'?'Local worked example':view.origin==='user-corrected'?'User-corrected source transcription':'Source transcription for review';
 const local=data.basis.kind==='local-demo';
 const current=view.currentProblemOrigin==='synthetic-transfer'?'Separate synthetic challenge. Earlier exposure is not tracked. This is a separate synthetic problem, not observed source data.':view.currentProblemOrigin==='local-experiment'?(local?'Hypothetical local experiment. These edits do not change the original supplied practice data.':'Hypothetical local experiment. These edits do not change the source transcription.'):state.lab?(local?'Reviewed supplied practice':'Reviewed source practice'):(local?'Review the supplied practice tables before running the experiment.':'Review the cited transcription before running the experiment.');
 return [data.title,`Data: ${origin}. Lesson version ${data.version}; review revision ${state.revision}.`,current,
  ...view.sourceRefs.map(source),`Original join mapping: ${mapping}`,
  `Your join correction: ${state.keyCorrection?`${keys(state.keyCorrection.keys)}. Reason: ${state.keyCorrection.reason}`:'none.'}`,
  `Your corrections:\n${corrections.join('\n')||'None.'}`,
  `Assumptions:\n${view.assumptions.map(a=>`- ${a}`).join('\n')||'None supplied.'}`,
  `Needs review:\n${unresolved.join('\n')||problemError||'None.'}`,
  `${local?'Practice provenance':'Cited excerpts'}:\n${data.citations.map((c,index)=>`Citation ${index+1} — ${source(c.sourceRef)}; ${c.location.kind==='text-range'?'text excerpt':'image region'}: “${c.location.quote}”`).join('\n')||'Local example; no source citations.'}`,
  ...(currentJoin?[`Current join: ${currentJoin}.`]:[]),...tables,...(state.lab?result:['No experiment has been run. Unreadable cells have no invented value.']),...priorPractice,changeText,lastText,
  'Every equal non-NULL pair produces one row; duplicate matches each produce a row. LEFT also retains unmatched left rows. Exact typed equality only; no coercion, filters or database collation. Count correctness is checked; reasoning and human learning are not evaluated.',
 ].filter(Boolean).join('\n\n');
}
export const groundedJoin=Object.freeze({kind:'grounded-join',schemaVersion:1,parse,parseState,initial,update,observe,parseProposal:(value:unknown)=>decode(JoinExtractionProposalSchema,value),parseAction:(value:unknown)=>decode(GroundedJoinActionSchema,value),text:readable});
