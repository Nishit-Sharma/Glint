import {Schema} from 'effect';
import {parseSemanticProcedure,runSemanticProcedure,type SemanticProcedure,type SemanticRecord,type SemanticScalar,type SemanticRunResult,type SemanticPredicate,type SemanticTrace} from './semantic-procedure';

export const tableLimits=Object.freeze({rows:12,columns:4,cellCharacters:160,characters:64000,members:4096,depth:48});
const reserved=new Set(['__proto__','prototype','constructor']);
/** Inert bounded copying is shared by this V2 contract only; V1 stays unchanged. */
export function copyTableData(value:unknown,characters:number=tableLimits.characters,members:number=tableLimits.members):unknown{
 const ancestors=new Set<object>();let count=0,size=0;
 const visit=(v:unknown,depth:number):unknown=>{
  if(depth>tableLimits.depth||++count>members)throw Error('The table data exceeds its structural limit.');
  if(typeof v==='string'){size+=v.length;if(v.length>4000||size>characters)throw Error('The table data exceeds its character limit.');return v;}
  if(typeof v==='number'){if(!Number.isFinite(v)||Math.abs(v)>1e12)throw Error('Only bounded finite numbers are supported.');return v;}
  if(v===null||typeof v==='boolean')return v;
  if(typeof v!=='object'||ancestors.has(v))throw Error('Only acyclic inert data is supported.');
  const array=Array.isArray(v),prototype=Object.getPrototypeOf(v);
  if(prototype!==Object.prototype&&prototype!==null&&!(array&&prototype===Array.prototype))throw Error('Only plain data is supported.');
  const keys=Reflect.ownKeys(v);if(keys.length>members-count)throw Error('The table member limit was exceeded.');
  for(const key of keys){if(typeof key!=='string'||key.length>80||!/^[A-Za-z0-9_-]+$/.test(key)||reserved.has(key))throw Error('Unsupported data member.');size+=key.length;}
  if(size>characters)throw Error('The table character limit was exceeded.');
  ancestors.add(v);const descriptors=Object.getOwnPropertyDescriptors(v);
  if(array){if(v.length>members||keys.length!==v.length+1)throw Error('Dense bounded arrays are required.');const result=[];for(let i=0;i<v.length;i++){const d=descriptors[String(i)];if(!d||!('value' in d)||!d.enumerable)throw Error('Accessors and sparse data are unsupported.');result.push(visit(d.value,depth+1));}ancestors.delete(v);return result;}
  const result:Record<string,unknown>={};for(const key of keys){const d=descriptors[key as string];if(!('value' in d)||!d.enumerable)throw Error('Accessors and hidden data are unsupported.');result[key as string]=visit(d.value,depth+1);}ancestors.delete(v);return result;
 };return visit(value,0);
}
export const TableIdSchema=Schema.String.pipe(Schema.pattern(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/),Schema.filter(v=>!reserved.has(v)));
const note=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(500));
const column=Schema.Struct({id:TableIdSchema,kind:Schema.Literal('string','integer','boolean')});
const definition=Schema.Struct({schemaVersion:Schema.Literal(2),id:TableIdSchema,version:Schema.Int.pipe(Schema.between(1,20)),intent:note,
 requestFields:Schema.Array(TableIdSchema).pipe(Schema.minItems(1),Schema.maxItems(16)),integerRequestFields:Schema.Array(TableIdSchema).pipe(Schema.maxItems(16)),
 table:Schema.Struct({binding:TableIdSchema,columns:Schema.Array(column).pipe(Schema.minItems(1),Schema.maxItems(4))}),
 lookup:Schema.Struct({id:TableIdSchema,column:TableIdSchema,keyInput:TableIdSchema,bindings:Schema.Array(Schema.Struct({column:TableIdSchema,input:TableIdSchema})).pipe(Schema.minItems(1),Schema.maxItems(4))}),body:Schema.Unknown});
export type TableProcedureV2=Omit<typeof definition.Type,'body'>&{readonly body:SemanticProcedure};
const scalar=Schema.Union(Schema.String.pipe(Schema.maxLength(160)),Schema.Number.pipe(Schema.finite()),Schema.Boolean);
export const TableSnapshotSchema=Schema.Struct({id:TableIdSchema,rows:Schema.Array(Schema.Struct({id:TableIdSchema,values:Schema.Array(scalar).pipe(Schema.minItems(1),Schema.maxItems(4))})).pipe(Schema.maxItems(12))});
export type TableSnapshot=typeof TableSnapshotSchema.Type;
const decode=<A,I>(schema:Schema.Schema<A,I>,value:unknown):A=>Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(copyTableData(value));
const unique=(values:readonly string[])=>{if(new Set(values).size!==values.length)throw Error('Duplicate table or binding identity.');};
const fieldKind=(field:SemanticProcedure['input']['fields'][number])=>field.kind==='number'?'integer':field.kind;
export function parseTableProcedure(value:unknown):TableProcedureV2{
 const raw=decode(definition,value),body=parseSemanticProcedure(raw.body),plan={...raw,body};
 unique(raw.requestFields);unique(raw.integerRequestFields);unique(raw.table.columns.map(c=>c.id));unique(raw.lookup.bindings.map(b=>b.input));
 const fields=new Map(body.input.fields.map(f=>[f.name,f])),columns=new Map(raw.table.columns.map(c=>[c.id,c]));
 if(raw.requestFields.some(f=>!fields.has(f))||!raw.requestFields.includes(raw.lookup.keyInput))throw Error('The request binding is unavailable.');
 if(raw.integerRequestFields.some(f=>!raw.requestFields.includes(f)||fields.get(f)?.kind!=='number'))throw Error('Integer request fields must be numeric request fields.');
 if(!columns.has(raw.lookup.column)||columns.get(raw.lookup.column)!.kind!==fieldKind(fields.get(raw.lookup.keyInput)!))throw Error('The lookup key types must agree.');
 for(const binding of raw.lookup.bindings){if(raw.requestFields.includes(binding.input)||!fields.has(binding.input)||!columns.has(binding.column)||columns.get(binding.column)!.kind!==fieldKind(fields.get(binding.input)!))throw Error('The projected column and input types must agree.');}
 const bound=[...raw.requestFields,...raw.lookup.bindings.map(b=>b.input)];unique(bound);
 if(bound.length!==fields.size||bound.some(f=>!fields.has(f)))throw Error('Every body input needs exactly one explicit binding.');
 return plan;
}
export function parseTableSnapshot(plan:TableProcedureV2,value:unknown):TableSnapshot{
 const table=decode(TableSnapshotSchema,value);unique(table.rows.map(r=>r.id));
 for(const row of table.rows){if(row.values.length!==plan.table.columns.length)throw Error('Every row must exactly match the declared columns.');row.values.forEach((cell,i)=>{const kind=plan.table.columns[i].kind;if(kind==='integer'?!Number.isSafeInteger(cell)||typeof cell!=='number'||Math.abs(cell)>1e12:typeof cell!==kind)throw Error('A table cell does not match its declared type.');});}
 return table;
}
export function parseTableRequest(plan:TableProcedureV2,value:unknown):SemanticRecord{
 const raw=copyTableData(value);if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('A request record is required.');
 const request=raw as Record<string,SemanticScalar>;
 if(Object.keys(request).length!==plan.requestFields.length||Object.keys(request).some(k=>!plan.requestFields.includes(k)))throw Error('Supply exactly the declared request fields.');
 for(const key of plan.requestFields){const f=plan.body.input.fields.find(f=>f.name===key)!,v=request[key];if(f.kind==='string'?typeof v!=='string'||v.length<f.minLength||v.length>f.maxLength:f.kind==='number'?typeof v!=='number'||!Number.isFinite(v)||v<f.minimum||v>f.maximum:typeof v!=='boolean')throw Error('A request value does not match its field contract.');if(plan.integerRequestFields.includes(key)&&!Number.isSafeInteger(v))throw Error('An integer request value is required.');}
 return request;
}
export type TableRunResult=(SemanticRunResult&{readonly lookup?:{tableId:string;rowId:string;bindings:readonly {column:string;input:string;value:SemanticScalar}[]}})|{readonly status:'abstained';readonly code:'lookup-missing'|'lookup-ambiguous';readonly haltedStepId:string;readonly reason:string;readonly output:SemanticRecord;readonly trace:readonly [];readonly effectAuthority:'none'};
function requestPreconditionFailure(plan:TableProcedureV2,request:SemanticRecord):TableRunResult|undefined{
 const available=(p:SemanticPredicate):boolean=>p.kind==='compare'?[p.left,p.right].every(o=>o.kind==='literal'||o.kind==='input'&&plan.requestFields.includes(o.field)):p.kind==='not'?available(p.predicate):p.terms.every(available);
 const trace:SemanticTrace[]=[];
 for(const condition of plan.body.preconditions){
  // Preserve condition order: a row-dependent condition waits for the lookup.
  if(!available(condition.predicate))break;
  const inspected:Array<SemanticTrace['inspected'][number]>=[];
  const operand=(o:Extract<SemanticPredicate,{kind:'compare'}>['left']):SemanticScalar=>{const value=o.kind==='literal'?o.value:request[o.field];inspected.push({source:o.kind,field:o.kind==='literal'?null:o.field,value});return value;};
  const evaluate=(p:SemanticPredicate):boolean=>{
   if(p.kind==='not')return !evaluate(p.predicate);if(p.kind==='all')return p.terms.every(evaluate);if(p.kind==='any')return p.terms.some(evaluate);
   if(p.kind!=='compare')return false;const left=operand(p.left),right=operand(p.right);
   switch(p.operator){case 'eq':return left===right;case 'ne':return left!==right;case 'gt':return (left as number)>(right as number);case 'gte':return (left as number)>=(right as number);case 'lt':return (left as number)<(right as number);case 'lte':return (left as number)<=(right as number);}
  };
  const decision=evaluate(condition.predicate);trace.push({stepId:condition.id,kind:'precondition',inspected,output:{},decision,reason:condition.reason});
  if(!decision)return {status:'abstained',procedureId:plan.body.id,version:plan.body.version,target:plan.body.target,code:'precondition',haltedStepId:condition.id,reason:condition.reason,output:{},trace,effectAuthority:'none'};
 }
}
export function runTableProcedure(definition:unknown,tableValue:unknown,requestValue:unknown):TableRunResult{
 let plan:TableProcedureV2;try{plan=parseTableProcedure(definition);}catch{return {status:'invalid-input',stage:'definition',reason:'The typed table procedure is unavailable or invalid.',trace:[],effectAuthority:'none'};}
 try{
  const request=parseTableRequest(plan,requestValue),early=requestPreconditionFailure(plan,request);if(early)return early;
  const table=parseTableSnapshot(plan,tableValue),keyIndex=plan.table.columns.findIndex(c=>c.id===plan.lookup.column),matches=table.rows.filter(r=>r.values[keyIndex]===request[plan.lookup.keyInput]);
  if(matches.length!==1)return {status:'abstained',code:matches.length?'lookup-ambiguous':'lookup-missing',haltedStepId:plan.lookup.id,reason:matches.length?'More than one row matches the requested key.':'No row matches the requested key.',output:{},trace:[],effectAuthority:'none'};
  const row=matches[0],bindings=plan.lookup.bindings.map(b=>({...b,value:row.values[plan.table.columns.findIndex(c=>c.id===b.column)]}));
  const bound={...request,...Object.fromEntries(bindings.map(b=>[b.input,b.value]))};
  return {...runSemanticProcedure(plan.body,bound),lookup:{tableId:table.id,rowId:row.id,bindings}};
 }catch{return {status:'invalid-input',stage:'input',reason:'The typed table or request does not match its declared contract.',trace:[],effectAuthority:'none'};}
}
