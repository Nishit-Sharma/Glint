import {Schema} from 'effect';

/** A value-only interpreter. Host ownership, activation and effects remain outside this module. */
export const semanticProcedureLimits=Object.freeze({fields:16,steps:64,stepDepth:16,predicates:128,predicateDepth:8,conditions:8,examples:20,characters:4000,totalCharacters:64000,members:4096,dataDepth:48});
const scalarSchema=Schema.Union(Schema.String.pipe(Schema.maxLength(semanticProcedureLimits.characters)),Schema.Number.pipe(Schema.between(-1e12,1e12),Schema.filter(Number.isFinite)),Schema.Boolean);
export type SemanticScalar=typeof scalarSchema.Type;
export type SemanticRecord=Readonly<Record<string,SemanticScalar>>;
const reserved=new Set(['__proto__','prototype','constructor']);
const identifier=Schema.String.pipe(Schema.pattern(/^[A-Za-z][A-Za-z0-9_-]{0,79}$/),Schema.filter(value=>!reserved.has(value)));
const text=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(500),Schema.filter(value=>value.trim().length>0));
const length=Schema.Int.pipe(Schema.between(0,semanticProcedureLimits.characters));
const fieldSchema=Schema.Union(
 Schema.Struct({name:identifier,kind:Schema.Literal('string'),minLength:length,maxLength:length}),
 Schema.Struct({name:identifier,kind:Schema.Literal('number'),minimum:Schema.Number.pipe(Schema.between(-1e12,1e12)),maximum:Schema.Number.pipe(Schema.between(-1e12,1e12))}),
 Schema.Struct({name:identifier,kind:Schema.Literal('boolean')}),
);
type Field=typeof fieldSchema.Type;
const recordSchema=Schema.Struct({name:identifier,fields:Schema.Array(fieldSchema).pipe(Schema.minItems(1),Schema.maxItems(semanticProcedureLimits.fields))});
const atomicValueSchema=Schema.Union(Schema.Struct({kind:Schema.Literal('literal'),value:scalarSchema}),Schema.Struct({kind:Schema.Literal('input'),field:identifier}));
const arithmeticSchema=Schema.Struct({kind:Schema.Literal('arithmetic'),operator:Schema.Literal('add','subtract','multiply','divide'),left:atomicValueSchema,right:atomicValueSchema});
const valueSchema=Schema.Union(atomicValueSchema,arithmeticSchema);
type Value=typeof valueSchema.Type;
const operandSchema=Schema.Union(atomicValueSchema,Schema.Struct({kind:Schema.Literal('output'),field:identifier}));
type Operand=typeof operandSchema.Type;
const operatorSchema=Schema.Literal('eq','ne','gt','gte','lt','lte');
export type SemanticPredicate=
 | {readonly kind:'compare';readonly operator:typeof operatorSchema.Type;readonly left:Operand;readonly right:Operand}
 | {readonly kind:'all'|'any';readonly terms:readonly SemanticPredicate[]}
 | {readonly kind:'not';readonly predicate:SemanticPredicate};
const predicateSchema:Schema.Schema<SemanticPredicate>=Schema.suspend(()=>Schema.Union(
 Schema.Struct({kind:Schema.Literal('compare'),operator:operatorSchema,left:operandSchema,right:operandSchema}),
 Schema.Struct({kind:Schema.Literal('all','any'),terms:Schema.Array(predicateSchema).pipe(Schema.minItems(1),Schema.maxItems(8))}),
 Schema.Struct({kind:Schema.Literal('not'),predicate:predicateSchema}),
));
export type SemanticStep=
 | {readonly kind:'assign';readonly id:string;readonly intent:string;readonly field:string;readonly value:Value;readonly next:SemanticStep}
 | {readonly kind:'branch';readonly id:string;readonly intent:string;readonly predicate:SemanticPredicate;readonly then:SemanticStep;readonly else:SemanticStep}
 | {readonly kind:'return';readonly id:string;readonly intent:string}
 | {readonly kind:'abstain';readonly id:string;readonly intent:string;readonly reason:string};
const stepSchema:Schema.Schema<SemanticStep>=Schema.suspend(()=>Schema.Union(
 Schema.Struct({kind:Schema.Literal('assign'),id:identifier,intent:text,field:identifier,value:valueSchema,next:stepSchema}),
 Schema.Struct({kind:Schema.Literal('branch'),id:identifier,intent:text,predicate:predicateSchema,then:stepSchema,else:stepSchema}),
 Schema.Struct({kind:Schema.Literal('return'),id:identifier,intent:text}),
 Schema.Struct({kind:Schema.Literal('abstain'),id:identifier,intent:text,reason:text}),
));
const conditionSchema=Schema.Struct({id:identifier,reason:text,predicate:predicateSchema});
const definitionSchema=Schema.Struct({
 schemaVersion:Schema.Literal(1),id:identifier,version:Schema.Int.pipe(Schema.between(1,20)),intent:text,
 target:Schema.Literal('local-record','local-export-manifest'),input:recordSchema,output:recordSchema,
 preconditions:Schema.Array(conditionSchema).pipe(Schema.maxItems(semanticProcedureLimits.conditions)),
 postconditions:Schema.Array(conditionSchema).pipe(Schema.minItems(1),Schema.maxItems(semanticProcedureLimits.conditions)),root:stepSchema,
});
export type SemanticProcedure=typeof definitionSchema.Type;
type Inspection={readonly source:'input'|'output'|'literal';readonly field:string|null;readonly value:SemanticScalar};
export type SemanticTrace={readonly stepId:string;readonly kind:SemanticStep['kind']|'precondition'|'postcondition';readonly inspected:readonly Inspection[];readonly output:SemanticRecord;readonly decision:boolean|null;readonly reason:string|null};
type RunBase={readonly effectAuthority:'none';readonly trace:readonly SemanticTrace[]};
type Identity={readonly procedureId:string;readonly version:number;readonly target:SemanticProcedure['target']};
export type SemanticRunResult=
 | (RunBase&Identity&{readonly status:'completed';readonly output:SemanticRecord})
 | (RunBase&Identity&{readonly status:'abstained';readonly code:'precondition'|'explicit-stop'|'output-contract'|'postcondition';readonly haltedStepId:string;readonly reason:string;readonly output:SemanticRecord})
 | (RunBase&{readonly status:'invalid-input';readonly stage:'definition'|'input';readonly reason:string});

function fail(message:string):never {throw Error(message);}

// Copy inert data before schema decoding, without reading accessors or inherited members.
function inertCopy(value:unknown):unknown {
 const ancestors=new Set<object>();let members=0,characters=0;
 function visit(current:unknown,depth:number):unknown {
  if(depth>semanticProcedureLimits.dataDepth||++members>semanticProcedureLimits.members)fail('The local data structure exceeds its depth or member limit.');
  if(typeof current==='string'){
   characters+=current.length;
   if(current.length>semanticProcedureLimits.characters||characters>semanticProcedureLimits.totalCharacters)fail('The local data exceeds its character limit.');
   return current;
  }
  if(typeof current==='number'){if(!Number.isFinite(current)||Math.abs(current)>1e12)fail('Numbers must be finite and within the local range.');return current;}
  if(typeof current==='boolean'||current===null)return current;
  if(typeof current!=='object')return fail('Only inert JSON data is supported.');
  if(ancestors.has(current))fail('Cyclic data is unsupported.');
  const prototype=Object.getPrototypeOf(current);
  if(prototype!==Object.prototype&&prototype!==null&&!(Array.isArray(current)&&prototype===Array.prototype))fail('Only plain records and arrays are supported.');
  ancestors.add(current);
  const keys=Reflect.ownKeys(current);
  if(keys.length>semanticProcedureLimits.members-members)fail('The local data structure exceeds its depth or member limit.');
  if(keys.some(key=>typeof key!=='string'||reserved.has(key)))fail('Unsupported prototype or symbol member.');
  for(const key of keys){
   if(typeof key!=='string'||key.length>80||!/^[A-Za-z0-9_-]+$/.test(key))fail('Member names must be bounded identifiers.');
   characters+=key.length;
  }
  if(characters>semanticProcedureLimits.totalCharacters)fail('The local data exceeds its character limit.');
  const descriptors=Object.getOwnPropertyDescriptors(current);
  if(Array.isArray(current)){
   if(current.length>semanticProcedureLimits.members||keys.length!==current.length+1)fail('Arrays must be dense bounded lists without extra members.');
   const result:unknown[]=[];
   for(let index=0;index<current.length;index++){
    const descriptor=descriptors[String(index)];
    if(!descriptor||!('value' in descriptor)||!descriptor.enumerable)fail('Accessors and sparse arrays are unsupported.');
    result.push(visit(descriptor.value,depth+1));
   }
   ancestors.delete(current);return result;
  }
  const entries:[string,unknown][]=[];
  for(const key of keys){
   if(typeof key!=='string')return fail('Symbol members are unsupported.');
   const descriptor=descriptors[key];
   if(!('value' in descriptor)||!descriptor.enumerable)fail('Accessors and hidden members are unsupported.');
   entries.push([key,visit(descriptor.value,depth+1)]);
  }
  ancestors.delete(current);return Object.fromEntries(entries);
 }
 return visit(value,0);
}
function decode<A,I>(schema:Schema.Schema<A,I>,value:unknown):A {
 try{return Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(inertCopy(value));}
 catch(error){if(error instanceof Error&&error.name==='ParseError')fail('Unsupported or malformed definition fields or values.');throw error;}
}
function fieldMap(spec:typeof recordSchema.Type):Map<string,Field> {
 const fields=new Map<string,Field>();
 for(const field of spec.fields){
  if(fields.has(field.name))fail(`Duplicate field ${field.name}.`);
  if(field.kind==='string'&&field.minLength>field.maxLength||field.kind==='number'&&field.minimum>field.maximum)fail(`Invalid bounds for ${field.name}.`);
  fields.set(field.name,field);
 }
 return fields;
}
function accepts(field:Field,value:SemanticScalar):boolean {
 switch(field.kind){
  case 'boolean':return typeof value==='boolean';
  case 'string':return typeof value==='string'&&value.length>=field.minLength&&value.length<=field.maxLength;
  case 'number':return typeof value==='number'&&Number.isFinite(value)&&value>=field.minimum&&value<=field.maximum;
  default:{const exhaustive:never=field;return exhaustive;}
 }
}
export function parseSemanticProcedure(value:unknown):SemanticProcedure {
 const plan=decode(definitionSchema,value),inputs=fieldMap(plan.input),outputs=fieldMap(plan.output),identities=new Set<string>();
 let steps=0,predicates=0;
 const unique=(id:string)=>{if(identities.has(id))fail(`Duplicate step or condition identity ${id}.`);identities.add(id);};
 function operandType(operand:Operand,assigned:ReadonlySet<string>,allowOutput:boolean):string {
  if(operand.kind==='literal')return typeof operand.value;
  const field=(operand.kind==='input'?inputs:outputs).get(operand.field);
  if(!field)fail(`Unknown ${operand.kind} field ${operand.field}.`);
  if(operand.kind==='output'&&(!allowOutput||!assigned.has(operand.field)))fail(`Output field ${operand.field} is not available here.`);
  return field.kind;
 }
 function predicate(value:SemanticPredicate,assigned:ReadonlySet<string>,allowOutput:boolean,depth=1):void {
  if(++predicates>semanticProcedureLimits.predicates||depth>semanticProcedureLimits.predicateDepth)fail('The predicate limit was exceeded.');
  switch(value.kind){
   case 'compare':{
    const left=operandType(value.left,assigned,allowOutput),right=operandType(value.right,assigned,allowOutput);
    if(left!==right)fail('Comparison operands must have the same scalar type.');
    if(value.operator!=='eq'&&value.operator!=='ne'&&left!=='number')fail('Ordered comparisons require numbers.');
    return;
   }
   case 'all':case 'any':for(const term of value.terms)predicate(term,assigned,allowOutput,depth+1);return;
   case 'not':predicate(value.predicate,assigned,allowOutput,depth+1);return;
   default:{const exhaustive:never=value;return exhaustive;}
  }
 }
 for(const condition of plan.preconditions){unique(condition.id);predicate(condition.predicate,new Set(),false);}
 for(const condition of plan.postconditions){unique(condition.id);predicate(condition.predicate,new Set(outputs.keys()),true);}
 function step(value:SemanticStep,assigned:ReadonlySet<string>,depth:number):void {
  if(++steps>semanticProcedureLimits.steps||depth>semanticProcedureLimits.stepDepth)fail('The semantic step limit was exceeded.');
  unique(value.id);
  switch(value.kind){
   case 'assign':{
    const field=outputs.get(value.field);if(!field)fail(`Unknown output field ${value.field}.`);
    if(value.value.kind==='arithmetic'){
     if(plan.target!=='local-record')fail('Arithmetic assignments are available only to local record helpers.');
     if(field.kind!=='number'||operandType(value.value.left,assigned,false)!=='number'||operandType(value.value.right,assigned,false)!=='number')fail('Arithmetic assignments require a numeric result and two numeric inputs or constants.');
     if(value.value.operator==='divide'&&value.value.right.kind==='literal'&&value.value.right.value===0)fail('A constant divisor must not be zero.');
    }else{
     if(operandType(value.value,assigned,false)!==field.kind)fail(`Assignment type differs for ${value.field}.`);
     if(value.value.kind==='literal'&&!accepts(field,value.value.value))fail(`Assignment exceeds the output contract for ${value.field}.`);
    }
    step(value.next,new Set([...assigned,value.field]),depth+1);return;
   }
   case 'branch':predicate(value.predicate,assigned,true);step(value.then,assigned,depth+1);step(value.else,assigned,depth+1);return;
   case 'return':for(const field of outputs.keys())if(!assigned.has(field))fail(`Return is missing output field ${field}.`);return;
   case 'abstain':return;
   default:{const exhaustive:never=value;return exhaustive;}
  }
 }
 step(plan.root,new Set(),1);return plan;
}
function parseRecord(spec:typeof recordSchema.Type,value:unknown):SemanticRecord {
 const parsed=decode(Schema.Record({key:Schema.String,value:scalarSchema}),value);
 const fields=fieldMap(spec);
 for(const key of Object.keys(parsed))if(!fields.has(key))fail(`Unknown input field ${key}.`);
 for(const field of fields.values())if(!Object.hasOwn(parsed,field.name)||!accepts(field,parsed[field.name]))fail(`Missing, invalid or out-of-range input field ${field.name}.`);
 return parsed;
}
function execute(plan:SemanticProcedure,input:SemanticRecord):SemanticRunResult {
 const output:Record<string,SemanticScalar>={},trace:SemanticTrace[]=[],outputs=fieldMap(plan.output);
 const identity={procedureId:plan.id,version:plan.version,target:plan.target};
 const snapshot=()=>({...output});
 function read(operand:Operand,inspected:Inspection[]):SemanticScalar {
  const value=operand.kind==='literal'?operand.value:(operand.kind==='input'?input:output)[operand.field];
  inspected.push({source:operand.kind,field:operand.kind==='literal'?null:operand.field,value});return value;
 }
 function evaluate(predicate:SemanticPredicate,inspected:Inspection[]):boolean {
  switch(predicate.kind){
   case 'compare':{
    const left=read(predicate.left,inspected),right=read(predicate.right,inspected);
    switch(predicate.operator){
     case 'eq':return left===right;
     case 'ne':return left!==right;
     case 'gt':return typeof left==='number'&&typeof right==='number'&&left>right;
     case 'gte':return typeof left==='number'&&typeof right==='number'&&left>=right;
     case 'lt':return typeof left==='number'&&typeof right==='number'&&left<right;
     case 'lte':return typeof left==='number'&&typeof right==='number'&&left<=right;
     default:{const exhaustive:never=predicate.operator;return exhaustive;}
    }
   }
   case 'all':return predicate.terms.every(term=>evaluate(term,inspected));
   case 'any':return predicate.terms.some(term=>evaluate(term,inspected));
   case 'not':return !evaluate(predicate.predicate,inspected);
   default:{const exhaustive:never=predicate;return exhaustive;}
  }
 }
 function stopped(code:'precondition'|'explicit-stop'|'output-contract'|'postcondition',haltedStepId:string,reason:string):SemanticRunResult {
  return {...identity,status:'abstained',code,haltedStepId,reason,output:snapshot(),trace,effectAuthority:'none'};
 }
 for(const condition of plan.preconditions){
  const inspected:Inspection[]=[],decision=evaluate(condition.predicate,inspected);
  trace.push({stepId:condition.id,kind:'precondition',inspected,decision,reason:decision?null:condition.reason,output:snapshot()});
  if(!decision)return stopped('precondition',condition.id,condition.reason);
 }
 let step=plan.root;
 for(;;){
  const inspected:Inspection[]=[];
  switch(step.kind){
   case 'assign':{
    let value:SemanticScalar;
    if(step.value.kind==='arithmetic'){
     const left=read(step.value.left,inspected),right=read(step.value.right,inspected);
     const number=typeof left==='number'&&typeof right==='number'?(step.value.operator==='add'?left+right:step.value.operator==='subtract'?left-right:step.value.operator==='multiply'?left*right:left/right):NaN;
     const reason=step.value.operator==='divide'&&right===0?'Cannot divide by zero.':!Number.isFinite(number)?'The calculation did not produce a finite number.':null;
     if(reason){trace.push({stepId:step.id,kind:step.kind,inspected,decision:false,reason,output:snapshot()});return stopped('output-contract',step.id,reason);}
     value=number;
    }else value=read(step.value,inspected);
    const field=outputs.get(step.field);
    if(!field||!accepts(field,value)){
     const reason=`Derived value exceeds the output contract for ${step.field}.`;
     trace.push({stepId:step.id,kind:step.kind,inspected,decision:false,reason,output:snapshot()});
     return stopped('output-contract',step.id,reason);
    }
    output[step.field]=value;
    trace.push({stepId:step.id,kind:step.kind,inspected,decision:null,reason:null,output:snapshot()});step=step.next;break;
   }
   case 'branch':{
    const decision=evaluate(step.predicate,inspected);
    trace.push({stepId:step.id,kind:step.kind,inspected,decision,reason:null,output:snapshot()});step=decision?step.then:step.else;break;
   }
   case 'abstain':
    trace.push({stepId:step.id,kind:step.kind,inspected,decision:null,reason:step.reason,output:snapshot()});
    return stopped('explicit-stop',step.id,step.reason);
   case 'return':
    trace.push({stepId:step.id,kind:step.kind,inspected,decision:null,reason:null,output:snapshot()});
    for(const condition of plan.postconditions){
     const inspected:Inspection[]=[],decision=evaluate(condition.predicate,inspected);
     trace.push({stepId:condition.id,kind:'postcondition',inspected,decision,reason:decision?null:condition.reason,output:snapshot()});
     if(!decision)return stopped('postcondition',condition.id,condition.reason);
    }
    return {...identity,status:'completed',output:snapshot(),trace,effectAuthority:'none'};
   default:{const exhaustive:never=step;return exhaustive;}
  }
 }
}
/** Revalidates the exact supplied definition and input on every run. No host capability is accepted. */
export function runSemanticProcedure(definition:unknown,input:unknown):SemanticRunResult {
 let plan:SemanticProcedure;
 try{plan=parseSemanticProcedure(definition);}catch(error){return {status:'invalid-input',stage:'definition',reason:error instanceof Error?error.message:'Invalid definition.',trace:[],effectAuthority:'none'};}
 let values:SemanticRecord;
 try{values=parseRecord(plan.input,input);}catch(error){return {status:'invalid-input',stage:'input',reason:error instanceof Error?error.message:'Invalid input.',trace:[],effectAuthority:'none'};}
 return execute(plan,values);
}

export const SemanticExpectedSchema=Schema.Union(
 Schema.Struct({status:Schema.Literal('completed'),output:Schema.Record({key:Schema.String,value:scalarSchema})}),
 Schema.Struct({status:Schema.Literal('abstained'),haltedStepId:identifier,code:Schema.Literal('precondition','explicit-stop','output-contract','postcondition')}),
 Schema.Struct({status:Schema.Literal('invalid-input'),stage:Schema.Literal('input')}),
);
const exampleSchema=Schema.Struct({
 id:identifier,role:Schema.Literal('example','held-out','counterexample','exception'),
 input:Schema.Record({key:Schema.String,value:scalarSchema}),expected:SemanticExpectedSchema,
});
export type SemanticExample=typeof exampleSchema.Type;
type ExampleCase={readonly id:string;readonly role:SemanticExample['role'];readonly passed:boolean;readonly actual:SemanticRunResult};
export type SemanticExampleCheck={readonly passed:boolean;readonly activationAuthorized:false;readonly independentHeldOutVerified:false;readonly effectAuthority:'none';readonly coverageIssues:readonly string[];readonly cases:readonly ExampleCase[]};
function recordIdentity(value:SemanticRecord):string {return JSON.stringify(Object.keys(value).sort().map(key=>[key,value[key]]));}

/**
 * Local evidence only. The held-out role is a caller declaration; different input
 * does not establish independent withholding, mastery or observed provenance.
 * Passing checks cannot save, activate or grant effects to a host-owned helper.
 */
export function checkSemanticExamples(definition:unknown,examples:unknown):SemanticExampleCheck {
 let plan:SemanticProcedure,values:readonly SemanticExample[];
 try{
  plan=parseSemanticProcedure(definition);
  values=decode(Schema.Array(exampleSchema).pipe(Schema.maxItems(semanticProcedureLimits.examples)),examples);
  if(new Set(values.map(example=>example.id)).size!==values.length)fail('Example identities must be unique.');
 }catch(error){return {passed:false,activationAuthorized:false,independentHeldOutVerified:false,effectAuthority:'none',coverageIssues:[error instanceof Error?error.message:'Invalid examples or definition.'],cases:[]};}
 const cases=values.map(example=>{
  const actual=runSemanticProcedure(plan,example.input),expected=example.expected;
  const passed=actual.status==='completed'&&expected.status==='completed'?recordIdentity(actual.output)===recordIdentity(expected.output)
   :actual.status==='abstained'&&expected.status==='abstained'?actual.haltedStepId===expected.haltedStepId&&actual.code===expected.code
   :actual.status==='invalid-input'&&expected.status==='invalid-input'&&actual.stage==='input';
  return {id:example.id,role:example.role,passed,actual};
 });
 const coverageIssues:string[]=[],positiveInputs=new Set(values.filter(example=>example.role==='example').map(example=>recordIdentity(example.input)));
 const passedRole=(role:SemanticExample['role'])=>cases.some((check,index)=>check.role===role&&check.passed&&check.actual.status==='completed'&&(role==='example'||!positiveInputs.has(recordIdentity(values[index].input))));
 if(!passedRole('example'))coverageIssues.push('Add a passing positive example.');
 if(!passedRole('held-out'))coverageIssues.push('Add a passing completed held-out example with different input.');
 if(!cases.some((check,index)=>check.role==='counterexample'&&check.passed&&(check.actual.status==='abstained'||check.actual.status==='invalid-input'&&check.actual.stage==='input')&&!positiveInputs.has(recordIdentity(values[index].input))))coverageIssues.push('Add a passing negative counterexample with different input.');
 for(const condition of plan.preconditions){
  if(!cases.some(check=>(check.role==='counterexample'||check.role==='exception')&&check.passed&&check.actual.status==='abstained'&&check.actual.code==='precondition'&&check.actual.haltedStepId===condition.id))coverageIssues.push(`Exercise precondition ${condition.id} with its expected abstention.`);
 }
 function checkExceptions(step:SemanticStep):void {
  switch(step.kind){
   case 'assign':checkExceptions(step.next);return;
   case 'branch':checkExceptions(step.then);checkExceptions(step.else);return;
   case 'return':return;
   case 'abstain':
    if(!cases.some(check=>check.role==='exception'&&check.passed&&check.actual.status==='abstained'&&check.actual.code==='explicit-stop'&&check.actual.haltedStepId===step.id))coverageIssues.push(`Exercise exception ${step.id} with its expected abstention.`);
    return;
   default:{const exhaustive:never=step;return exhaustive;}
  }
 }
 checkExceptions(plan.root);
 return {passed:coverageIssues.length===0&&cases.every(check=>check.passed),activationAuthorized:false,independentHeldOutVerified:false,effectAuthority:'none',coverageIssues,cases};
}
