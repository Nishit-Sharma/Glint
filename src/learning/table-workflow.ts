import {Schema} from 'effect';
import {TableColumnRolesSchema,TableColumnMappingsSchema,TableColumnRoleSchema,tableColumnTargets,tableColumnContract,bindTableColumns,tableColumnIdentity,type TableColumnMappings} from './table-workflow-columns';
import {TableInputBindingsSchema,TableInputValuesSchema,TableInputNameSchema,TableInputSlotSchema,tableInputTargets,tableInputContract,tableInputIdentity,resolvedTableInputIdentity,bindTableInputs,type TableInputValues} from './table-workflow-inputs';
import {parseSourceTable,sourceTableLimits} from './source-table-helper';
import {LocalDemonstrationOwnerSchema,type LocalDemonstrationOwner} from './local-demonstration';
import {pickingCanonical,pickingDigest} from '../shared/picking-digest';

export const TABLE_WORKFLOW_LIMITS=Object.freeze({steps:8,versions:10,checks:6,demonstrations:4,stateCharacters:4*1024*1024,numericMagnitude:1e12,...sourceTableLimits});
const text=(n:number)=>Schema.String.pipe(Schema.maxLength(n));
const note=text(500).pipe(Schema.minLength(1),Schema.filter(s=>!!s.trim()));
const header=text(80).pipe(Schema.minLength(1),Schema.filter(s=>s===s.trim()&&!s.includes('\0')));
const revision=Schema.Int.pipe(Schema.between(0,500)),version=Schema.Int.pipe(Schema.between(1,10));
const number=Schema.Number.pipe(Schema.finite(),Schema.between(-1e12,1e12));
const ref=Schema.Struct({sourceId:text(80).pipe(Schema.minLength(1)),version:Schema.Int.pipe(Schema.positive()),digest:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))});
export const TableWorkflowSourceSchema=Schema.Struct({ref,label:text(500),content:text(32000)});
export type TableWorkflowSource=typeof TableWorkflowSourceSchema.Type;
const operand=Schema.Union(Schema.Struct({kind:Schema.Literal('column'),column:header}),Schema.Struct({kind:Schema.Literal('number'),value:number}));
export const TableWorkflowStepSchema=Schema.Union(
 Schema.Struct({kind:Schema.Literal('filter'),column:header,operator:Schema.Literal('eq','ne','gt','gte','lt','lte'),value:text(160)}),
 Schema.Struct({kind:Schema.Literal('calculate'),output:header,left:operand,operator:Schema.Literal('add','subtract','multiply','divide'),right:operand}),
 Schema.Struct({kind:Schema.Literal('summarize'),groupBy:Schema.NullOr(header),column:header,output:header}),
);
export type TableWorkflowStep=typeof TableWorkflowStepSchema.Type;
const table=Schema.Struct({headers:Schema.Array(header).pipe(Schema.minItems(1),Schema.maxItems(12)),rows:Schema.Array(Schema.Struct({cells:Schema.Array(text(160)).pipe(Schema.minItems(1),Schema.maxItems(12)),records:Schema.Array(Schema.Int.pipe(Schema.between(2,33))).pipe(Schema.minItems(1),Schema.maxItems(32))})).pipe(Schema.minItems(1),Schema.maxItems(32))});
export type WorkflowTable=typeof table.Type;
const receipt=Schema.Struct({atRevision:revision,authority:Schema.Struct({kind:Schema.Literal('explicit-local-table-action'),expectedRevision:revision}),step:TableWorkflowStepSchema,before:table,after:table});
const failed=Schema.Struct({atRevision:revision,step:TableWorkflowStepSchema,reason:note,before:table});
const workspace=Schema.Struct({owner:LocalDemonstrationOwnerSchema,source:TableWorkflowSourceSchema,name:note,intent:note,startedAtRevision:revision,actions:Schema.Array(receipt).pipe(Schema.maxItems(8)),failure:Schema.NullOr(failed)});
export type TableWorkflowWorkspace=typeof workspace.Type;
const exception=Schema.Struct({contains:text(160).pipe(Schema.minLength(1)),reason:note});
const expected=Schema.Union(Schema.Struct({kind:Schema.Literal('output'),csv:text(32000)}),Schema.Struct({kind:Schema.Literal('stopped')}),Schema.Struct({kind:Schema.Literal('invalid-input')}));
const check=Schema.Struct({input:text(32000),expected,inputs:Schema.optional(TableInputValuesSchema),columns:Schema.optional(TableColumnMappingsSchema)});
const definition=Schema.Struct({name:note,intent:note,steps:Schema.Array(TableWorkflowStepSchema).pipe(Schema.maxItems(8)),exceptions:Schema.Array(exception).pipe(Schema.maxItems(6)),checks:Schema.Array(check).pipe(Schema.maxItems(6)),bindings:Schema.optional(TableInputBindingsSchema),columnRoles:Schema.optional(TableColumnRolesSchema),observation:Schema.NullOr(workspace)});
export type TableWorkflowDefinition=typeof definition.Type;
const result=Schema.Union(
 Schema.Struct({status:Schema.Literal('invalid-input'),reason:note,trace:Schema.Tuple()}),
 Schema.Struct({status:Schema.Literal('completed'),table,trace:Schema.Array(Schema.Struct({step:TableWorkflowStepSchema,before:table,after:table})).pipe(Schema.maxItems(8))}),
 Schema.Struct({status:Schema.Literal('stopped'),reason:note,exception:Schema.Int.pipe(Schema.between(0,5)),trace:Schema.Tuple()}),
 Schema.Struct({status:Schema.Literal('invalid'),reason:note,trace:Schema.Array(Schema.Struct({step:TableWorkflowStepSchema,before:table,after:table})).pipe(Schema.maxItems(8))}),
);
export type TableWorkflowResult=typeof result.Type;
const Shape=Schema.Struct({kind:Schema.Literal('helper-studio'),format:Schema.Literal('table-workflow-v1'),helperId:text(80),owner:Schema.NullOr(LocalDemonstrationOwnerSchema),revision,draft:definition,workspace:Schema.NullOr(workspace),demonstrations:Schema.Array(Schema.Struct({outcome:Schema.Literal('cancelled','inactive-proposal'),workspace})).pipe(Schema.maxItems(4)),versions:Schema.Array(Schema.Struct({version,definition})).pipe(Schema.maxItems(10)),activeVersion:Schema.NullOr(version),activationHistory:Schema.Array(version).pipe(Schema.maxItems(40)),lastRun:Schema.NullOr(Schema.Struct({atRevision:revision,owner:LocalDemonstrationOwnerSchema,version,definitionDigest:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),source:TableWorkflowSourceSchema,inputs:Schema.optional(TableInputValuesSchema),columns:Schema.optional(TableColumnMappingsSchema),result}))});
export type TableWorkflowState=typeof Shape.Type;
const common={expectedRevision:revision};
export const TableWorkflowActionSchema=Schema.Union(
 Schema.Struct({kind:Schema.Literal('begin-table-workflow'),...common}),
 Schema.Struct({kind:Schema.Literal('table-workflow-start'),name:note,intent:note,sourceRef:ref,...common}),
 Schema.Struct({kind:Schema.Literal('table-workflow-step'),step:TableWorkflowStepSchema,...common}),
 Schema.Struct({kind:Schema.Literal('table-workflow-finish'),confirmed:Schema.Literal('reviewed-inactive-table-workflow'),...common}),
 Schema.Struct({kind:Schema.Literal('table-workflow-cancel','table-workflow-save-version','table-workflow-rollback'),...common}),
 Schema.Struct({kind:Schema.Literal('table-workflow-edit'),name:note,intent:note,steps:Schema.Array(TableWorkflowStepSchema).pipe(Schema.maxItems(8)),...common}),
 Schema.Struct({kind:Schema.Literal('table-workflow-exception'),...exception.fields,...common}),
 Schema.Struct({kind:Schema.Literal('table-workflow-remove-exception','table-workflow-remove-check'),index:Schema.Int.pipe(Schema.between(0,5)),...common}),
 Schema.Struct({kind:Schema.Literal('table-workflow-check'),...check.fields,replaces:Schema.optional(Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))),...common}),
 Schema.Struct({kind:Schema.Literal('table-workflow-bind-input'),name:TableInputNameSchema,stepIndex:Schema.Int.pipe(Schema.between(0,7)),slot:TableInputSlotSchema,expectedStepDigest:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),...common}),
 Schema.Struct({kind:Schema.Literal('table-workflow-bind-column'),name:TableInputNameSchema,column:TableColumnRoleSchema.fields.column,expectedTargetsDigest:TableColumnRoleSchema.fields.targetsDigest,...common}),
 Schema.Struct({kind:Schema.Literal('table-workflow-remove-column'),index:Schema.Int.pipe(Schema.between(0,5)),...common}),
 Schema.Struct({kind:Schema.Literal('table-workflow-remove-input'),index:Schema.Int.pipe(Schema.between(0,5)),...common}),
 Schema.Struct({kind:Schema.Literal('table-workflow-activate','table-workflow-restore'),version,...common}),
 Schema.Struct({kind:Schema.Literal('table-workflow-run'),activeVersion:version,sourceRef:ref,inputs:Schema.optional(TableInputValuesSchema),columns:Schema.optional(TableColumnMappingsSchema),...common}),
);
export type TableWorkflowAction=typeof TableWorkflowActionSchema.Type;
/** Bound inert copying before schema traversal; no getters, prototypes or executable values. */
function copy(value:unknown):unknown{
 const ancestors=new Set<object>();let nodes=0,characters=0;
 function visit(v:unknown,depth:number):unknown{
  if(++nodes>200000||depth>32)throw Error('This workflow exceeds the local structural limit.');
  if(typeof v==='string'){characters+=v.length;if(v.length>32000||characters>TABLE_WORKFLOW_LIMITS.stateCharacters)throw Error('This workflow reached its local data limit. Create a separate helper.');return v;}
  if(v===null||typeof v==='boolean')return v;if(typeof v==='number'){if(!Number.isFinite(v)||Math.abs(v)>1e12)throw Error('Use bounded finite values.');return v;}
  if(typeof v!=='object'||ancestors.has(v))throw Error('Use inert acyclic local data.');
  const array=Array.isArray(v),prototype=Object.getPrototypeOf(v);if(prototype!==Object.prototype&&prototype!==null&&!(array&&prototype===Array.prototype))throw Error('Use plain local records.');
  const keys=Reflect.ownKeys(v);if(keys.length>200000-nodes)throw Error('This workflow exceeds its local member limit.');const descriptors=Object.getOwnPropertyDescriptors(v);ancestors.add(v);
  if(array){if(keys.length!==v.length+1)throw Error('Sparse workflow data is unsupported.');const a=[];for(let i=0;i<v.length;i++){const d=descriptors[String(i)];if(!d||!d.enumerable||!('value'in d))throw Error('Workflow accessors are unsupported.');a.push(visit(d.value,depth+1));}ancestors.delete(v);return a;}
  const entries=[];for(const k of keys){if(typeof k!=='string'||k.length>80||! /^[A-Za-z0-9_-]+$/.test(k)||['__proto__','prototype','constructor'].includes(k))throw Error('Unsupported workflow member.');const d=descriptors[k];if(!d.enumerable||!('value'in d))throw Error('Workflow accessors are unsupported.');entries.push([k,visit(d.value,depth+1)]);}ancestors.delete(v);return Object.fromEntries(entries);
 }return visit(value,0);
}
const decode=<A,I>(schema:Schema.Schema<A,I>,v:unknown):A=>Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(copy(v));
const same=(a:unknown,b:unknown)=>pickingCanonical(a)===pickingCanonical(b);
const problem=(cause:unknown)=>cause instanceof Error?cause.message.slice(0,500):'Review the local table workflow.';
export function tableWorkflowInput(csv:string):WorkflowTable{const parsed=parseSourceTable(csv);return {headers:parsed.headers,rows:parsed.records.map((cells,index)=>({cells,records:[index+2]}))};}
function numeric(text:string):number{const clean=text.trim();if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(clean)||!Number.isFinite(Number(clean))||Math.abs(Number(clean))>1e12)throw Error('A selected numeric cell is not a finite decimal within ±1,000,000,000,000. No final table was produced.');return Number(clean);}
function bounded(value:number){if(!Number.isFinite(value)||Math.abs(value)>1e12)throw Error('A calculation exceeded the finite numeric limit. No final table was produced.');return Object.is(value,-0)?0:value;}
export function applyTableWorkflowStep(input:WorkflowTable,value:unknown):WorkflowTable{
 const step=decode(TableWorkflowStepSchema,value),before=decode(table,input),index=(name:string)=>{const i=before.headers.indexOf(name);if(i<0)throw Error(`Column “${name}” is unavailable at this step.`);return i;};
 if(new Set(before.headers).size!==before.headers.length||before.rows.some(row=>row.cells.length!==before.headers.length))throw Error('Every table row must match unique column headers.');
 let output:WorkflowTable;
 if(step.kind==='filter'){
  const i=index(step.column),rows=before.rows.filter(row=>{const a=row.cells[i],b=step.value;if(step.operator==='eq')return a===b;if(step.operator==='ne')return a!==b;const x=numeric(a),y=numeric(b);return step.operator==='gt'?x>y:step.operator==='gte'?x>=y:step.operator==='lt'?x<y:x<=y;});
  if(!rows.length)throw Error('No records match this selection. No final table was produced.');output={...before,rows};
 }else if(step.kind==='calculate'){
  if(before.headers.includes(step.output)||before.headers.length>=12)throw Error('Choose a new result column and keep at most twelve columns.');
  const read=(o:typeof step.left,cells:readonly string[])=>o.kind==='number'?o.value:numeric(cells[index(o.column)]);
  output={headers:[...before.headers,step.output],rows:before.rows.map(row=>{try{const a=read(step.left,row.cells),b=read(step.right,row.cells);if(step.operator==='divide'&&b===0)throw Error('Division by zero is unsupported.');const n=bounded(step.operator==='add'?a+b:step.operator==='subtract'?a-b:step.operator==='multiply'?a*b:a/b);return {...row,cells:[...row.cells,String(n)]};}catch(cause){throw Error(`Record ${row.records.join(', ')}: ${problem(cause)}`);}})};
 }else{
  const valueIndex=index(step.column),groupIndex=step.groupBy===null?null:index(step.groupBy);if(step.groupBy===step.output)throw Error('The total column needs a different name from its group.');
  const groups=new Map<string,{sum:number;records:number[]}>();for(const row of before.rows){try{const key=groupIndex===null?'':row.cells[groupIndex],group=groups.get(key)??{sum:0,records:[]};group.sum=bounded(group.sum+numeric(row.cells[valueIndex]));group.records.push(...row.records);groups.set(key,group);}catch(cause){throw Error(`Record ${row.records.join(', ')}: ${problem(cause)}`);}}
  output={headers:[...(step.groupBy===null?[]:[step.groupBy]),step.output],rows:[...groups].map(([key,group])=>({cells:[...(step.groupBy===null?[]:[key]),String(group.sum)],records:[...new Set(group.records)]}))};
 }
 return decode(table,output);
}
export function runTableWorkflow(program:{steps:readonly TableWorkflowStep[];exceptions:TableWorkflowDefinition['exceptions'];bindings?:TableWorkflowDefinition['bindings'];columnRoles?:TableWorkflowDefinition['columnRoles'];observation?:TableWorkflowDefinition['observation']},csv:string,values:TableInputValues=[],columns:TableColumnMappings=[]):TableWorkflowResult{
 const trace:Array<{step:TableWorkflowStep;before:WorkflowTable;after:WorkflowTable}>=[];
 try{
  const originalSteps=decode(Schema.Array(TableWorkflowStepSchema).pipe(Schema.minItems(1),Schema.maxItems(8)),program.steps),exceptions=decode(Schema.Array(exception).pipe(Schema.maxItems(6)),program.exceptions);let current=tableWorkflowInput(csv),steps:TableWorkflowStep[];
  try{const valueSteps=bindTableInputs(originalSteps,decode(TableInputBindingsSchema,program.bindings??[]),decode(TableInputValuesSchema,values));steps=bindTableColumns(originalSteps,valueSteps,decode(TableColumnRolesSchema,program.columnRoles??[]),decode(TableColumnMappingsSchema,columns),program.observation?tableWorkflowInput(program.observation.source.content).headers:[],current.headers);}catch(cause){return {status:'invalid-input',reason:problem(cause),trace:[]};}
  const exceptionIndex=exceptions.findIndex(item=>csv.includes(item.contains));if(exceptionIndex>=0)return {status:'stopped',exception:exceptionIndex,reason:exceptions[exceptionIndex].reason,trace:[]};
  for(const step of steps){const before=current;current=applyTableWorkflowStep(before,step);trace.push({step,before,after:current});}return {status:'completed',table:current,trace};
 }catch(cause){return {status:'invalid',reason:problem(cause),trace};}
}
export function workflowTableCsv(value:WorkflowTable):string{const quote=(s:string)=>/[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;return [value.headers,...value.rows.map(row=>row.cells)].map(row=>row.map(quote).join(',')).join('\n')+'\n';}
const cells=(value:WorkflowTable)=>({headers:value.headers,rows:value.rows.map(row=>row.cells)});
export function tableWorkflowStepText(step:TableWorkflowStep){
 if(step.kind==='filter')return `Keep records where “${step.column}” ${({eq:'equals',ne:'does not equal',gt:'is greater than',gte:'is at least',lt:'is less than',lte:'is at most'} as const)[step.operator]} “${step.value}”.`;
 if(step.kind==='summarize')return `Sum “${step.column}” into “${step.output}”${step.groupBy===null?' across all remaining records':` for each exact “${step.groupBy}”`}.`;
 const label=(o:typeof step.left)=>o.kind==='number'?String(o.value):`“${o.column}”`;return `Calculate “${step.output}”: ${label(step.left)} ${({add:'+',subtract:'−',multiply:'×',divide:'÷'}as const)[step.operator]} ${label(step.right)}.`;
}
function replayWorkspace(value:TableWorkflowWorkspace){
 let current=tableWorkflowInput(value.source.content),previous=value.startedAtRevision;
 for(const action of value.actions){if(action.atRevision!==previous+1||action.authority.expectedRevision!==previous)throw Error('Keep the exact performed action order and revision authority.');const next=applyTableWorkflowStep(current,action.step);if(!same(action.before,current)||!same(action.after,next))throw Error('A demonstrated action or its before/after table changed.');current=next;previous=action.atRevision;}
 if(value.failure){if(value.failure.atRevision!==previous+1||!same(value.failure.before,current))throw Error('The failed action receipt changed.');let reason='';try{applyTableWorkflowStep(current,value.failure.step);}catch(cause){reason=problem(cause);}if(!reason||reason!==value.failure.reason)throw Error('The failed action cannot be verified.');}
 return current;
}
export function tableWorkflowSuite(draft:TableWorkflowDefinition){
 const cases=draft.checks.map(item=>{const result=runTableWorkflow(draft,item.input,item.inputs??[],item.columns??[]);let passed=false;try{passed=item.expected.kind==='invalid-input'?result.status==='invalid-input':item.expected.kind==='stopped'?result.status==='stopped':result.status==='completed'&&same(cells(result.table),cells(tableWorkflowInput(item.expected.csv)));}catch{}return {...item,result,passed};});let issue='';
 try{
  if(!draft.observation||draft.observation.failure||draft.observation.actions.length<2)throw Error('Finish a successful multi-step local table demonstration first.');replayWorkspace(draft.observation);
  if(draft.steps.length<2||new Set(draft.steps.map(step=>step.kind)).size<2)throw Error('Use at least two different supported table step kinds.');
  if(!draft.exceptions.length)throw Error('Declare an explicit stop exception and check it separately.');
  const inputs=tableInputContract(draft.steps,draft.bindings??[]);
  if(inputs.length){
   const successful=cases.filter(item=>item.expected.kind==='output'&&item.passed);
   if(new Set(successful.map(item=>resolvedTableInputIdentity(item.inputs??[],inputs))).size<2)throw Error('Check at least two different complete named-input sets with exact successful output tables.');
   if(!cases.some(item=>{if(item.expected.kind!=='invalid-input'||!item.passed)return false;try{bindTableInputs(draft.steps,draft.bindings??[],item.inputs??[]);return false;}catch{return true;}}))throw Error('Declare a missing or invalid named-input check; no table may be produced.');
  }
  const roles=tableColumnContract(draft.steps,draft.columnRoles??[],tableWorkflowInput(draft.observation.source.content).headers);
  if(roles.length){
   const successful=cases.filter(item=>item.expected.kind==='output'&&item.passed),headers=(item:typeof cases[number])=>pickingCanonical([...tableWorkflowInput(item.input).headers].sort()),mapping=(item:typeof cases[number])=>tableColumnIdentity(item.columns??[]);
   if(!successful.some(a=>successful.some(b=>headers(a)!==headers(b)&&mapping(a)!==mapping(b))))throw Error('Check successful exact tables on at least two genuinely different header sets and explicit mappings.');
   if(!cases.some(item=>{if(item.expected.kind!=='invalid-input'||!item.passed)return false;let bound:TableWorkflowStep[];try{bound=bindTableInputs(draft.steps,draft.bindings??[],item.inputs??[]);}catch{return false;}try{bindTableColumns(draft.steps,bound,draft.columnRoles??[],item.columns??[],tableWorkflowInput(draft.observation!.source.content).headers,tableWorkflowInput(item.input).headers);return false;}catch{return true;}}))throw Error('Declare a missing or invalid column-mapping check; no table may be processed.');
  }
  const original=cells(tableWorkflowInput(draft.observation.source.content));if(!cases.some(item=>item.expected.kind==='output'&&!same(cells(tableWorkflowInput(item.input)),original)))throw Error('Declare a distinct-input success check with its exact expected table.');
  for(let i=0;i<draft.exceptions.length;i++)if(!cases.some(item=>item.expected.kind==='stopped'&&item.result.status==='stopped'&&item.result.exception===i))throw Error('Each exception needs its own passing stopped-input check.');
  if(cases.some(item=>!item.passed))throw Error('Every declared check must pass before saving or activation.');
 }catch(cause){issue=problem(cause);}return {ready:!issue,issue,cases,independentGeneralizationVerified:false,effectAuthority:'none' as const};
}
function validate(state:TableWorkflowState){
 if(state.owner&&state.owner.helperId!==state.helperId)throw Error('This workflow belongs to another helper.');
 for(const w of [state.workspace,state.draft.observation,...state.demonstrations.map(item=>item.workspace),...state.versions.map(item=>item.definition.observation)].filter((x):x is TableWorkflowWorkspace=>!!x)){if(!state.owner||!same(w.owner,state.owner)||w.startedAtRevision>state.revision||w.actions.some(item=>item.atRevision>state.revision)||w.failure&&w.failure.atRevision>state.revision)throw Error('The demonstrated source owner or revision changed.');replayWorkspace(w);}
 if(new Set(state.draft.checks.map(item=>pickingCanonical({input:item.input,inputs:tableInputIdentity(item.inputs??[]),columns:tableColumnIdentity(item.columns??[])}))).size!==state.draft.checks.length)throw Error('Use distinct exact check inputs.');
 state.versions.forEach((v,i)=>{if(v.version!==i+1||!tableWorkflowSuite(v.definition).ready)throw Error('Saved workflow versions must retain their original passing checks.');});
 for(const v of [state.activeVersion,...state.activationHistory])if(v!==null&&!state.versions.some(item=>item.version===v))throw Error('The checked workflow version is unavailable.');
 if(state.lastRun){const saved=state.versions.find(item=>item.version===state.lastRun!.version);if(!saved||!same(state.lastRun.owner,state.owner)||state.lastRun.atRevision>state.revision||state.lastRun.definitionDigest!==pickingDigest(saved.definition)||!same(state.lastRun.result,runTableWorkflow(saved.definition,state.lastRun.source.content,state.lastRun.inputs??[],state.lastRun.columns??[])))throw Error('The saved local run or exact checked version changed.');}
 return state;
}
export const TableWorkflowStateSchema=Shape.pipe(Schema.filter(s=>{try{validate(s);return true;}catch{return false;}}));
function parseState(helperId:string,value:unknown){const state=decode(TableWorkflowStateSchema,value);if(state.helperId!==helperId)throw Error('Open the original table workflow helper.');return state;}
function initial(helperId:string,owner:LocalDemonstrationOwner|null=null):TableWorkflowState{return {kind:'helper-studio',format:'table-workflow-v1',helperId,owner,revision:0,draft:{name:'Table workflow',intent:'Summarize deliberately selected local table data.',steps:[],exceptions:[],checks:[],observation:null},workspace:null,demonstrations:[],versions:[],activeVersion:null,activationHistory:[],lastRun:null};}
export type TableWorkflowAdmission={owner:LocalDemonstrationOwner;source?:TableWorkflowSource};
function update(helperId:string,value:unknown,actionValue:unknown,admission?:TableWorkflowAdmission):TableWorkflowState{
 const state=parseState(helperId,value),action=decode(TableWorkflowActionSchema,actionValue);if(state.revision!==action.expectedRevision)throw Error('This table workflow changed. Reload before applying another action.');if(state.revision>=500)throw Error('This helper reached its edit limit. Create a separate helper.');
 if(admission&&(!state.owner||!same(admission.owner,state.owner)))throw Error('The exact table workflow owner changed.');
 if(state.workspace&&!['table-workflow-step','table-workflow-finish','table-workflow-cancel'].includes(action.kind))throw Error('Finish or cancel this demonstration first. Existing recipe drafts are kept.');
 let next:TableWorkflowState={...state,revision:state.revision+1};
 switch(action.kind){
  case 'begin-table-workflow':throw Error('Choose table-workflow mode only from a new unchanged helper.');
  case 'table-workflow-start':{
   if(!admission?.source||!same(admission.source.ref,action.sourceRef))throw Error('The owning core must supply the exact selected source.');if(state.demonstrations.length>=4)throw Error('This helper retains four demonstrations. Create a separate helper.');tableWorkflowInput(admission.source.content);
   next={...next,workspace:{owner:admission.owner,source:admission.source,name:action.name,intent:action.intent,startedAtRevision:next.revision,actions:[],failure:null}};break;
  }
  case 'table-workflow-step':{
   if(!admission||!state.workspace||state.workspace.failure||state.workspace.actions.length>=8)throw Error('Start a supported demonstration or cancel its failed action before continuing.');const before=replayWorkspace(state.workspace);
   try{const after=applyTableWorkflowStep(before,action.step);next={...next,workspace:{...state.workspace,actions:[...state.workspace.actions,{atRevision:next.revision,authority:{kind:'explicit-local-table-action',expectedRevision:state.revision},step:action.step,before,after}]}};}catch(cause){next={...next,workspace:{...state.workspace,failure:{atRevision:next.revision,step:action.step,reason:problem(cause),before}}};}break;
  }
  case 'table-workflow-finish':{
   const w=state.workspace;if(!admission||!w||w.failure||w.actions.length<2)throw Error('Review a successful multi-step demonstration first.');const output=replayWorkspace(w);next={...next,workspace:null,demonstrations:[...state.demonstrations,{outcome:'inactive-proposal',workspace:w}],draft:{name:w.name,intent:w.intent,steps:w.actions.map(item=>item.step),exceptions:[],checks:[{input:w.source.content,expected:{kind:'output',csv:workflowTableCsv(output)}}],observation:w}};break;
  }
  case 'table-workflow-cancel':{if(!state.workspace)throw Error('No local demonstration is open.');next={...next,workspace:null,demonstrations:[...state.demonstrations,{outcome:'cancelled',workspace:state.workspace}]};break;}
  case 'table-workflow-edit':next={...next,draft:{...state.draft,name:action.name,intent:action.intent,steps:action.steps}};break;
  case 'table-workflow-exception':if(state.draft.exceptions.length>=6)throw Error('Keep at most six exceptions.');next={...next,draft:{...state.draft,exceptions:[...state.draft.exceptions,{contains:action.contains,reason:action.reason}]}};break;
  case 'table-workflow-remove-exception':next={...next,draft:{...state.draft,exceptions:state.draft.exceptions.filter((_,i)=>i!==action.index)}};break;
  case 'table-workflow-check':{const identity=(item:{input:string;inputs?:TableInputValues;columns?:TableColumnMappings})=>pickingCanonical({input:item.input,inputs:tableInputIdentity(item.inputs??[]),columns:tableColumnIdentity(item.columns??[])}),replace=action.replaces&&state.draft.checks.find(item=>pickingDigest(item)===action.replaces);if(action.replaces&&!replace)throw Error('The original declared check changed. Review it again.');if(replace&&state.draft.checks.some(item=>item!==replace&&identity(item)===identity(action)))throw Error('A different declared check already uses these inputs. Keep distinct inputs or edit that check instead.');const checks=state.draft.checks.filter(item=>item!==replace&&identity(item)!==identity(action));if(checks.length>=6)throw Error('Keep at most six declared checks.');next={...next,draft:{...state.draft,checks:[...checks,{input:action.input,expected:action.expected,...(action.inputs?{inputs:action.inputs}:{}),...(action.columns?{columns:action.columns}:{})}]}};break;}
  case 'table-workflow-bind-input':{if(!state.draft.observation)throw Error('Review a successful demonstration before declaring run inputs.');const target=tableInputTargets(state.draft.steps).find(item=>item.stepIndex===action.stepIndex&&item.slot===action.slot);if(!target||target.stepDigest!==action.expectedStepDigest)throw Error('This literal target changed or is unsupported. Review the applied step.');const bindings=[...(state.draft.bindings??[])];if(bindings.length>=6)throw Error('Keep at most six explicit literal bindings.');bindings.push({name:action.name,kind:target.kind,stepIndex:target.stepIndex,slot:target.slot,stepDigest:target.stepDigest});tableInputContract(state.draft.steps,bindings);next={...next,draft:{...state.draft,bindings}};break;}
  case 'table-workflow-bind-column':{if(!state.draft.observation)throw Error('Review a successful demonstration before declaring column roles.');const headers=tableWorkflowInput(state.draft.observation.source.content).headers,target=tableColumnTargets(state.draft.steps,headers).find(item=>item.column===action.column);if(!target||target.targetsDigest!==action.expectedTargetsDigest)throw Error('The original input-column references changed or are unsupported. Review the applied steps.');const columnRoles=[...(state.draft.columnRoles??[])];if(columnRoles.length>=6)throw Error('Keep at most six explicit column roles.');columnRoles.push({name:action.name,column:target.column,targetsDigest:target.targetsDigest});tableColumnContract(state.draft.steps,columnRoles,headers);next={...next,draft:{...state.draft,columnRoles}};break;}
  case 'table-workflow-remove-column':{if(!state.draft.columnRoles?.[action.index])throw Error('This column role changed.');next={...next,draft:{...state.draft,columnRoles:state.draft.columnRoles.filter((_,i)=>i!==action.index)}};break;}
  case 'table-workflow-remove-input':{if(!state.draft.bindings?.[action.index])throw Error('This input binding changed.');next={...next,draft:{...state.draft,bindings:state.draft.bindings.filter((_,i)=>i!==action.index)}};break;}
  case 'table-workflow-remove-check':next={...next,draft:{...state.draft,checks:state.draft.checks.filter((_,i)=>i!==action.index)}};break;
  case 'table-workflow-save-version':{const suite=tableWorkflowSuite(state.draft);if(!suite.ready)throw Error(suite.issue);if(state.versions.length>=10)throw Error('Keep at most ten checked versions.');if(state.versions.some(item=>same(item.definition,state.draft)))throw Error('This exact checked workflow is already saved.');next={...next,versions:[...state.versions,{version:state.versions.length+1,definition:structuredClone(state.draft)}]};break;}
  case 'table-workflow-activate':{const saved=state.versions.find(item=>item.version===action.version);if(!saved||!tableWorkflowSuite(saved.definition).ready)throw Error('Activate a checked immutable version first.');if(state.activeVersion===action.version)throw Error('This version is already active.');if(state.activationHistory.length>=40)throw Error('This helper reached its activation limit.');next={...next,activeVersion:action.version,activationHistory:[...state.activationHistory,...(state.activeVersion===null?[]:[state.activeVersion])]};break;}
  case 'table-workflow-rollback':{const prior=state.activationHistory.at(-1);if(prior===undefined)throw Error('No previous active version is available.');next={...next,activeVersion:prior,activationHistory:state.activationHistory.slice(0,-1)};break;}
  case 'table-workflow-restore':{const saved=state.versions.find(item=>item.version===action.version);if(!saved)throw Error('Choose a checked saved version.');next={...next,draft:structuredClone(saved.definition)};break;}
  case 'table-workflow-run':{
   if(!admission?.source||!same(admission.source.ref,action.sourceRef)||state.activeVersion!==action.activeVersion)throw Error('The selected source or active workflow changed. Review the current version.');const saved=state.versions.find(item=>item.version===state.activeVersion);if(!saved)throw Error('Activate a checked version first.');next={...next,lastRun:{atRevision:next.revision,owner:admission.owner,version:saved.version,definitionDigest:pickingDigest(saved.definition),source:admission.source,...(action.inputs?{inputs:action.inputs}:{}),...(action.columns?{columns:action.columns}:{}),result:runTableWorkflow(saved.definition,admission.source.content,action.inputs??[],action.columns??[])}};break;
  }
 }
 return parseState(helperId,next);
}
export function tableWorkflowReport(state:TableWorkflowState):string{
 const run=state.lastRun;if(!run||run.result.status!=='completed')throw Error('Only a complete local table run can be saved as a document. Stopped or invalid runs have no final table.');
 const fence=(s:string)=>{const f='`'.repeat(Math.max(3,...(s.match(/`+/g)??[]).map(x=>x.length+1)));return `${f}text\n${s}\n${f}`;};const saved=state.versions.find(item=>item.version===run.version)!;
 return [`# ${saved.definition.name}`,saved.definition.intent,`Local table workflow version ${run.version}. Explicit local computation only; no browser or OS action. Decimal arithmetic uses bounded JavaScript numbers, not financial precision.`,`## Exact selected source`,fence(run.source.label),`Source ${run.source.ref.sourceId}, version ${run.source.ref.version}, digest ${run.source.ref.digest}.`,...(run.inputs?[`## Explicit named inputs`,...run.inputs.map(input=>fence(`${input.name}: ${input.value}`))]:[]),...(run.columns?[`## Explicit column mappings`,...run.columns.map(mapping=>fence(`${mapping.name}: ${mapping.column}`))]:[]),`## Performed workflow`,fence(run.result.trace.map(({step},i)=>`${i+1}. ${tableWorkflowStepText(step)}`).join('\n')),...(saved.definition.bindings?.length?[`## Checked input bindings`,...saved.definition.bindings.map(binding=>`${binding.name} (${binding.kind}) replaces step ${binding.stepIndex+1} ${binding.slot}; exact step ${binding.stepDigest}.`)]:[]),...(saved.definition.columnRoles?.length?[`## Checked column roles`,...saved.definition.columnRoles.map(role=>fence(`${role.name}: original input ${role.column}; exact references ${role.targetsDigest}`))]:[]),`## Complete output table`,fence(workflowTableCsv(run.result.table)),`## Source-record provenance`,...run.result.table.rows.map((row,i)=>`Output row ${i+1}: source CSV records ${row.records.join(', ')}.`)].join('\n\n');
}
export const tableWorkflow={initial,parseState,update,text:(_data:unknown,value:unknown)=>tableWorkflowReport(parseState((value as TableWorkflowState).helperId,value))};
