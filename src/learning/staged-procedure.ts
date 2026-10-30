import {Schema} from 'effect';
import {HelperOperationSchema,type HelperOperation} from './text-operation';
import {parseSemanticProcedure,type SemanticProcedure,type SemanticPredicate,type SemanticStep} from './semantic-procedure';
import {typedScalar,type TypedAtom,type TypedField,type TypedValue} from './typed-procedure';

export type StagedCondition={source:'input'|'output';field:string;operator:'eq'|'ne'|'gt'|'gte'|'lt'|'lte';value:string};
export type StagedValue=TypedValue|{source:'text-transform';input:TypedAtom;operation:HelperOperation};
export type ProcedureStage=
 | {kind:'assign';label:string;field:TypedField;value:StagedValue}
 | {kind:'decide';label:string;field:TypedField;condition:StagedCondition;whenTrue:StagedValue;whenFalse:StagedValue}
 | {kind:'checkpoint';label:string;condition:StagedCondition;reason:string};
export type StagedProcedureDraft={format:'staged-record-v1';name:string;intent:string;inputs:TypedField[];requirements:StagedCondition[];stages:ProcedureStage[]};
export const stagedProcedureLimits=Object.freeze({inputs:6,stages:6,decisions:2,requirements:4});
const text=Schema.String.pipe(Schema.maxLength(500));
export const StagedFieldSchema=Schema.Struct({name:text,kind:Schema.Literal('string','number','boolean')});
const atom=Schema.Struct({source:Schema.Literal('literal','input','output'),value:text});
const value=Schema.Union(atom,Schema.Struct({source:Schema.Literal('calculate'),operator:Schema.Literal('add','subtract','multiply','divide'),left:atom,right:atom}),Schema.Struct({source:Schema.Literal('text-transform'),input:atom,operation:HelperOperationSchema}));
const condition=Schema.Struct({source:Schema.Literal('input','output'),field:text,operator:Schema.Literal('eq','ne','gt','gte','lt','lte'),value:text});
const stage=Schema.Union(
 Schema.Struct({kind:Schema.Literal('assign'),label:text,field:StagedFieldSchema,value}),
 Schema.Struct({kind:Schema.Literal('decide'),label:text,field:StagedFieldSchema,condition,whenTrue:value,whenFalse:value}),
 Schema.Struct({kind:Schema.Literal('checkpoint'),label:text,condition,reason:text}),
);
export const DemonstratedStageSchema=Schema.Union(
 Schema.Struct({kind:Schema.Literal('assign'),label:text,field:StagedFieldSchema,value}),
 Schema.Struct({kind:Schema.Literal('checkpoint'),label:text,condition,reason:text}),
);
const raw=Schema.Struct({format:Schema.Literal('staged-record-v1'),name:text,intent:text,inputs:Schema.Array(StagedFieldSchema).pipe(Schema.minItems(1),Schema.maxItems(6)),requirements:Schema.Array(condition).pipe(Schema.maxItems(4)),stages:Schema.Array(stage).pipe(Schema.minItems(1),Schema.maxItems(6))});
/** Incomplete edits remain raw; the existing interpreter validates a saved definition. */
export function parseStagedProcedureDraft(text:string):StagedProcedureDraft{
 return structuredClone(Schema.decodeUnknownSync(raw,{onExcessProperty:'error'})(JSON.parse(text))) as StagedProcedureDraft;
}
export const stagedResults=(draft:StagedProcedureDraft):TypedField[]=>draft.stages.flatMap(stage=>stage.kind==='checkpoint'?[]:[stage.field]);
const spec=(field:TypedField)=>field.kind==='string'?{...field,minLength:0,maxLength:160}:field.kind==='number'?{...field,minimum:-1000000,maximum:1000000}:field;

/** Compile to the same bounded, value-only interpreter used by existing helpers. */
export function stagedProcedure(draft:StagedProcedureDraft,id='staged-record-helper'):SemanticProcedure{
 draft=parseStagedProcedureDraft(JSON.stringify(draft));
 const outputs=stagedResults(draft);
 if(!outputs.length)throw Error('Add a result stage before saving.');
 const firstDecision=draft.stages.findIndex(stage=>stage.kind==='decide');
 if(firstDecision>=0&&draft.stages.slice(firstDecision+1).some(stage=>stage.kind==='checkpoint'))throw Error('Place checkpoints before the first decision. A checkpoint after a decision cannot be checked independently on every branch.');
 if(draft.stages.filter(stage=>stage.kind==='decide').length>stagedProcedureLimits.decisions)throw Error('Use at most two decision stages.');
 const predicate=(item:StagedCondition,available:readonly TypedField[],inputOnly=false):SemanticPredicate=>{
  const field=(item.source==='input'?draft.inputs:available).find(field=>field.name===item.field);
  if(!field||inputOnly&&item.source!=='input')throw Error('Conditions must use an available input or an earlier result.');
  return {kind:'compare',operator:item.operator,left:{kind:item.source,field:item.field},right:{kind:'literal',value:typedScalar(field.kind,item.value)}};
 };
 const operand=(item:TypedAtom,kind:TypedField['kind'])=>item.source==='literal'?{kind:'literal' as const,value:typedScalar(kind,item.value)}:{kind:item.source,field:item.value};
 const assigned=(item:StagedValue,field:TypedField):Extract<SemanticStep,{kind:'assign'}>['value']=>item.source==='calculate'?{kind:'arithmetic',operator:item.operator,left:operand(item.left,'number'),right:operand(item.right,'number')}:item.source==='text-transform'?{kind:'text-transform',operation:item.operation,input:operand(item.input,'string')}:operand(item,field.kind);
 function compile(index:number,path:string,available:readonly TypedField[]):SemanticStep{
  const stage=draft.stages[index],identity=`stage-${index+1}${path}`;
  if(!stage)return {kind:'return',id:`staged-done${path}`,intent:'Return the checked procedure results.'};
  if(stage.kind==='checkpoint')return {kind:'branch',id:identity,intent:stage.label,predicate:predicate(stage.condition,available),then:compile(index+1,path,available),else:{kind:'abstain',id:identity+'-stop',intent:'Stop at this checkpoint.',reason:stage.reason}};
  const next=[...available,stage.field];
  if(stage.kind==='assign')return {kind:'assign',id:identity,intent:stage.label,field:stage.field.name,value:assigned(stage.value,stage.field),next:compile(index+1,path,next)};
  return {kind:'branch',id:identity,intent:stage.label,predicate:predicate(stage.condition,available),then:{kind:'assign',id:identity+'-yes',intent:stage.label,field:stage.field.name,value:assigned(stage.whenTrue,stage.field),next:compile(index+1,path+'y',next)},else:{kind:'assign',id:identity+'-no',intent:stage.label,field:stage.field.name,value:assigned(stage.whenFalse,stage.field),next:compile(index+1,path+'n',next)}};
 }
 return parseSemanticProcedure({schemaVersion:1,id,version:1,intent:draft.intent,target:'local-record',input:{name:draft.name,fields:draft.inputs.map(spec)},output:{name:'staged-result',fields:outputs.map(spec)},preconditions:draft.requirements.map((item,index)=>({id:`staged-required-${index+1}`,reason:`Required condition ${index+1} is not met.`,predicate:predicate(item,[],true)})),postconditions:outputs.map((field,index)=>({id:`staged-result-${index+1}`,reason:`${field.name} must satisfy its declared type and bounds.`,predicate:{kind:'compare',operator:'eq',left:{kind:'output',field:field.name},right:{kind:'output',field:field.name}}})),root:compile(0,'',[])});
}

/** Exact round-trip recognition avoids converting or silently weakening older definitions. */
export function stagedDraftFromProcedure(procedure:SemanticProcedure):StagedProcedureDraft|null{
 try{
  const inputs=procedure.input.fields.map(({name,kind})=>({name,kind})),outputs=procedure.output.fields;
  const condition=(predicate:SemanticPredicate):StagedCondition=>{if(predicate.kind!=='compare'||predicate.left.kind==='literal'||predicate.right.kind!=='literal')throw Error();return {source:predicate.left.kind,field:predicate.left.field,operator:predicate.operator,value:String(predicate.right.value)};};
  const atom=(value:Exclude<Extract<SemanticStep,{kind:'assign'}>['value'],{kind:'arithmetic'|'text-transform'}>):TypedAtom=>value.kind==='literal'?{source:'literal',value:String(value.value)}:{source:value.kind,value:value.field};
  const value=(value:Extract<SemanticStep,{kind:'assign'}>['value']):StagedValue=>value.kind==='arithmetic'?{source:'calculate',operator:value.operator,left:atom(value.left),right:atom(value.right)}:value.kind==='text-transform'?{source:'text-transform',input:atom(value.input),operation:value.operation}:atom(value);
  const resultField=(name:string)=>{const field=outputs.find(field=>field.name===name);if(!field)throw Error();return {name:field.name,kind:field.kind};};
  const stages:ProcedureStage[]=[];let step=procedure.root;
  while(step.kind!=='return'){
   if(stages.length>=6)throw Error();
   if(step.kind==='assign'){stages.push({kind:'assign',label:step.intent,field:resultField(step.field),value:value(step.value)});step=step.next;}
   else if(step.kind==='branch'&&step.else.kind==='abstain'){stages.push({kind:'checkpoint',label:step.intent,condition:condition(step.predicate),reason:step.else.reason});step=step.then;}
   else if(step.kind==='branch'&&step.then.kind==='assign'&&step.else.kind==='assign'&&step.then.field===step.else.field){stages.push({kind:'decide',label:step.intent,field:resultField(step.then.field),condition:condition(step.predicate),whenTrue:value(step.then.value),whenFalse:value(step.else.value)});step=step.then.next;}
   else throw Error();
  }
  const draft:StagedProcedureDraft={format:'staged-record-v1',name:procedure.input.name,intent:procedure.intent,inputs,requirements:procedure.preconditions.map(item=>condition(item.predicate)),stages};
  return JSON.stringify(stagedProcedure(draft,procedure.id))===JSON.stringify(parseSemanticProcedure({...procedure,version:1}))?draft:null;
 }catch{return null;}
}
export function stagedProcedureExample():StagedProcedureDraft{
 return {format:'staged-record-v1',name:'shipment',intent:'Calculate available stock, check the result, and choose how to handle the remainder.',inputs:[{name:'stock',kind:'number'},{name:'reserved',kind:'number'},{name:'requested',kind:'number'},{name:'approved',kind:'boolean'}],requirements:[{source:'input',field:'approved',operator:'eq',value:'true'}],stages:[
  {kind:'assign',label:'Calculate available stock.',field:{name:'available',kind:'number'},value:{source:'calculate',operator:'subtract',left:{source:'input',value:'stock'},right:{source:'input',value:'reserved'}}},
  {kind:'checkpoint',label:'Check stock after reservations.',condition:{source:'output',field:'available',operator:'gte',value:'0'},reason:'Reservations exceed stock. Review the source values.'},
  {kind:'assign',label:'Calculate the stock remaining after this request.',field:{name:'remaining',kind:'number'},value:{source:'calculate',operator:'subtract',left:{source:'output',value:'available'},right:{source:'input',value:'requested'}}},
  {kind:'decide',label:'Choose the next step from the calculated remainder.',field:{name:'route',kind:'string'},condition:{source:'output',field:'remaining',operator:'gte',value:'0'},whenTrue:{source:'literal',value:'ready'},whenFalse:{source:'literal',value:'review'}},
 ]};
}

export function renameStagedField(draft:StagedProcedureDraft,source:'input'|'output',old:string,name:string):StagedProcedureDraft{
 const fields=source==='input'?draft.inputs:stagedResults(draft);
 if(name!==old&&fields.some(field=>field.name===name))throw Error('This field name is already used. Choose a unique name; your fields and references were kept.');
 if(fields.filter(field=>field.name===old).length!==1)throw Error('Resolve duplicate field names before renaming references.');
 const renameAtom=(atom:TypedAtom):TypedAtom=>atom.source===source&&atom.value===old?{...atom,value:name}:atom;
 const value=(value:StagedValue):StagedValue=>value.source==='calculate'?{...value,left:renameAtom(value.left),right:renameAtom(value.right)}:value.source==='text-transform'?{...value,input:renameAtom(value.input)}:renameAtom(value);
 const condition=(item:StagedCondition)=>item.source===source&&item.field===old?{...item,field:name}:item;
 return {...draft,inputs:draft.inputs.map(field=>source==='input'&&field.name===old?{...field,name}:field),requirements:draft.requirements.map(condition),stages:draft.stages.map(stage=>stage.kind==='checkpoint'?{...stage,condition:condition(stage.condition)}:{...stage,field:source==='output'&&stage.field.name===old?{...stage.field,name}:stage.field,...(stage.kind==='assign'?{value:value(stage.value)}:{condition:condition(stage.condition),whenTrue:value(stage.whenTrue),whenFalse:value(stage.whenFalse)})})};
}
