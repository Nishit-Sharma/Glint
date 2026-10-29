import {Schema} from 'effect';
import {runSemanticProcedure,parseSemanticProcedure,type SemanticProcedure,type SemanticPredicate,type SemanticStep,type SemanticScalar,type SemanticRecord} from '../../learning/semantic-procedure';

export type TypedField={name:string;kind:'string'|'number'|'boolean'};
export type TypedCondition={field:string;operator:'eq'|'ne'|'gt'|'gte'|'lt'|'lte';value:string};
export type TypedAtom={source:'literal'|'input'|'output';value:string};
export type TypedValue=TypedAtom|{source:'calculate';operator:'add'|'subtract'|'multiply'|'divide';left:TypedAtom;right:TypedAtom};
export type TypedOutcome={kind:'return'|'stop';reason:string;values:TypedValue[]};
export type TypedRule={label:string;match:'all'|'any';conditions:TypedCondition[];outcome:TypedOutcome};
export type TypedProcedureDraft={name:string;intent:string;inputs:TypedField[];outputs:TypedField[];requirements:TypedCondition[];rules:TypedRule[];fallback:TypedOutcome};
export const typedProcedureLimits=Object.freeze({inputs:6,outputs:3,rules:4,conditions:4});
const rawText=Schema.String.pipe(Schema.maxLength(500));
const rawField=Schema.Struct({name:rawText,kind:Schema.Literal('string','number','boolean')});
const rawCondition=Schema.Struct({field:rawText,operator:Schema.Literal('eq','ne','gt','gte','lt','lte'),value:rawText});
const rawAtom=Schema.Struct({source:Schema.Literal('literal','input','output'),value:rawText});
const rawValue=Schema.Union(rawAtom,Schema.Struct({source:Schema.Literal('calculate'),operator:Schema.Literal('add','subtract','multiply','divide'),left:rawAtom,right:rawAtom}));
const rawOutcome=Schema.Struct({kind:Schema.Literal('return','stop'),reason:rawText,values:Schema.Array(rawValue).pipe(Schema.maxItems(3))});
const rawDraft=Schema.Struct({name:rawText,intent:rawText,inputs:Schema.Array(rawField).pipe(Schema.minItems(1),Schema.maxItems(6)),outputs:Schema.Array(rawField).pipe(Schema.minItems(1),Schema.maxItems(3)),requirements:Schema.Array(rawCondition).pipe(Schema.maxItems(4)),rules:Schema.Array(Schema.Struct({label:rawText,match:Schema.Literal('all','any'),conditions:Schema.Array(rawCondition).pipe(Schema.maxItems(4)),outcome:rawOutcome})).pipe(Schema.maxItems(4)),fallback:rawOutcome});
/** Controls keep unfinished names and values; semantic validation happens on Save. */
export function parseTypedProcedureDraft(text:string):TypedProcedureDraft{
 const value=Schema.decodeUnknownSync(rawDraft,{onExcessProperty:'error'})(JSON.parse(text));
 return {name:value.name,intent:value.intent,inputs:value.inputs.map(field=>({...field})),outputs:value.outputs.map(field=>({...field})),requirements:value.requirements.map(item=>({...item})),rules:value.rules.map(rule=>({...rule,conditions:rule.conditions.map(item=>({...item})),outcome:{...rule.outcome,values:rule.outcome.values.map(item=>({...item}))}})),fallback:{...value.fallback,values:value.fallback.values.map(item=>({...item}))}};
}

export function typedScalar(kind:TypedField['kind'],value:string):SemanticScalar{
 if(kind==='string')return value;
 if(kind==='boolean'){if(value==='true')return true;if(value==='false')return false;throw Error('Choose yes or no.');}
 if(!value.trim()||!Number.isFinite(Number(value)))throw Error('Enter a finite number.');
 return Number(value);
}
export function typedInput(fields:readonly TypedField[],values:Readonly<Record<string,string>>):SemanticRecord{
 return Object.fromEntries(fields.map(field=>{if(typeof values[field.name]!=='string')throw Error(`Enter ${field.name}.`);return [field.name,typedScalar(field.kind,values[field.name])];}));
}
/** A declared negative test changes one scalar type; it never grants effects. */
export function typedNegativeInput(procedure:SemanticProcedure,input:SemanticRecord,name:string):SemanticRecord{
 const baseline=runSemanticProcedure(procedure,input);if(baseline.status==='invalid-input')throw Error('Start with valid input in every case field before changing one type.');
 const field=procedure.input.fields.find(field=>field.name===name);if(!field)throw Error('Choose an existing field for the invalid-type check.');
 return {...input,[name]:field.kind==='string'?0:'invalid'};
}
export function typedOutcomeKind(value:TypedOutcome,kind:TypedOutcome['kind'],outputs:readonly TypedField[]):TypedOutcome{
 return {...value,kind,values:outputs.map(field=>({source:'literal',value:field.kind==='boolean'?'false':field.kind==='number'?'0':''}))};
}
export function renameTypedField(draft:TypedProcedureDraft,side:'inputs'|'outputs',index:number,name:string):{kind:'accepted';value:TypedProcedureDraft}|{kind:'refused';message:string}{
 const old=draft[side][index]?.name;
 if(old===undefined)return {kind:'refused',message:'This field is no longer available.'};
 if(draft[side].some((field,i)=>i!==index&&field.name===old))return {kind:'refused',message:'This earlier draft has duplicate field names. Their references cannot be reassigned safely. Discard this unsaved form through Unfinished practice and re-enter unique names.'};
 if(draft[side].some((field,i)=>i!==index&&field.name===name))return {kind:'refused',message:'That field name already exists. Choose a unique name; all references were kept.'};
 const next={...draft,[side]:draft[side].map((field,i)=>i===index?{...field,name}:field)};
 const atom=(item:TypedAtom):TypedAtom=>item.source===(side==='inputs'?'input':'output')&&item.value===old?{...item,value:name}:item,renamed=(item:TypedValue):TypedValue=>item.source==='calculate'?{...item,left:atom(item.left),right:atom(item.right)}:atom(item);
 const conditions=(items:TypedCondition[])=>side==='inputs'?items.map(item=>item.field===old?{...item,field:name}:item):items,outcome=(item:TypedOutcome)=>({...item,values:item.values.map(renamed)});
 next.requirements=conditions(next.requirements);next.rules=next.rules.map(rule=>({...rule,conditions:conditions(rule.conditions),outcome:outcome(rule.outcome)}));next.fallback=outcome(next.fallback);
 return {kind:'accepted',value:next};
}
export function typedInputIsReferenced(draft:TypedProcedureDraft,name:string):boolean{
 const referenced=(value:TypedAtom)=>value.source==='input'&&value.value===name;
 const copied=(outcome:TypedOutcome)=>outcome.kind==='return'&&outcome.values.some(value=>value.source==='calculate'?referenced(value.left)||referenced(value.right):referenced(value));
 return draft.requirements.some(item=>item.field===name)||draft.rules.some(rule=>rule.conditions.some(item=>item.field===name)||copied(rule.outcome))||copied(draft.fallback);
}
const atoms=(value:TypedValue):readonly TypedAtom[]=>value.source==='calculate'?[value.left,value.right]:[value];
export function typedOutputIsReferenced(draft:TypedProcedureDraft,name:string):boolean{
 return [...draft.rules.map(rule=>rule.outcome),draft.fallback].some(outcome=>outcome.kind==='return'&&outcome.values.some(value=>atoms(value).some(atom=>atom.source==='output'&&atom.value===name)));
}
export function moveTypedOutput(draft:TypedProcedureDraft,index:number,direction:-1|1):{kind:'accepted';value:TypedProcedureDraft}|{kind:'refused';message:string}{
 const target=index+direction;if(!draft.outputs[index]||!draft.outputs[target])return {kind:'refused',message:'Choose an available result step.'};
 const order=draft.outputs.map((_,i)=>i);[order[index],order[target]]=[order[target],order[index]];
 const reorder=(outcome:TypedOutcome):TypedOutcome=>({...outcome,values:order.map(i=>outcome.values[i])});
 const next={...draft,outputs:order.map(i=>draft.outputs[i]),rules:draft.rules.map(rule=>({...rule,outcome:rule.outcome.kind==='return'?reorder(rule.outcome):rule.outcome})),fallback:reorder(draft.fallback)};
 for(const outcome of [...next.rules.map(rule=>rule.outcome),next.fallback])if(outcome.kind==='return')for(const [i,value] of outcome.values.entries()){
  if(!value||atoms(value).some(atom=>atom.source==='output'&&!next.outputs.slice(0,i).some(field=>field.name===atom.value)))return {kind:'refused',message:'This move would place a result before a step it uses. Change the earlier-result binding first; all fields were kept.'};
 }
 return {kind:'accepted',value:next};
}
export function typedInputDefaults(fields:readonly TypedField[]):Record<string,string>{return Object.fromEntries(fields.map(field=>[field.name,field.kind==='boolean'?'false':field.kind==='number'?'0':'']));}
const fieldSpec=(field:TypedField)=>field.kind==='string'?{name:field.name,kind:field.kind,minLength:0,maxLength:160}:field.kind==='number'?{name:field.name,kind:field.kind,minimum:-1000000,maximum:1000000}:{name:field.name,kind:field.kind};
const atomFor=(field:TypedField,value:TypedAtom)=>{if(value.source!=='literal')return {kind:value.source,field:value.value};const scalar=typedScalar(field.kind,value.value);if(typeof scalar==='number'&&Math.abs(scalar)>1000000)throw Error('Numeric constants must be between -1,000,000 and 1,000,000.');return {kind:'literal' as const,value:scalar};};
const valueFor=(field:TypedField,value:TypedValue):Extract<SemanticStep,{kind:'assign'}>['value']=>{if(value.source!=='calculate')return atomFor(field,value);if(field.kind!=='number')throw Error('Calculated results must use a numeric result field.');return {kind:'arithmetic',operator:value.operator,left:atomFor(field,value.left),right:atomFor(field,value.right)};};
const calculationLabel=(value:TypedValue)=>{const atom=(operand:TypedAtom)=>operand.source==='literal'?String(typedScalar('number',operand.value)):(operand.source==='output'?'earlier result ':'')+operand.value;return value.source==='calculate'?` using ${atom(value.left)} ${{add:'plus',subtract:'minus',multiply:'times',divide:'divided by'}[value.operator]} ${atom(value.right)}`:'';};
export function typedProcedure(draft:TypedProcedureDraft,id='typed-record-helper'):SemanticProcedure{
 if(draft.inputs.length<1||draft.inputs.length>typedProcedureLimits.inputs||draft.outputs.length<1||draft.outputs.length>typedProcedureLimits.outputs||draft.rules.length>typedProcedureLimits.rules||draft.requirements.length>typedProcedureLimits.conditions)throw Error('Keep within the displayed field and rule limits.');
 const predicate=(condition:TypedCondition):SemanticPredicate=>{const field=draft.inputs.find(field=>field.name===condition.field);if(!field)throw Error('Choose an existing input field for every condition.');return {kind:'compare',operator:condition.operator,left:{kind:'input',field:field.name},right:{kind:'literal',value:typedScalar(field.kind,condition.value)}};};
 const outcome=(value:TypedOutcome,prefix:string):SemanticStep=>{
  if(value.kind==='stop')return {kind:'abstain',id:prefix+'-stop',intent:'Stop for review.',reason:value.reason};
  if(value.values.length!==draft.outputs.length)throw Error('Give every result field a value.');
  let next:SemanticStep={kind:'return',id:prefix+'-done',intent:'Return the checked result.'};
  for(let index=draft.outputs.length-1;index>=0;index--){
   const assigned=value.values[index],field=draft.outputs[index];
   next={kind:'assign',id:`${prefix}-output-${index+1}`,intent:assigned.source==='calculate'?`Calculate ${field.name}${calculationLabel(assigned)}`:assigned.source==='output'?`Copy earlier result ${assigned.value} into ${field.name}.`:`Set ${field.name}.`,field:field.name,value:valueFor(field,assigned),next};
  }
  return next;
 };
 if(draft.fallback.kind!=='return')throw Error('The otherwise result must return values.');
 let root=outcome(draft.fallback,'otherwise');
 for(let index=draft.rules.length-1;index>=0;index--){const rule=draft.rules[index];if(rule.conditions.length<1||rule.conditions.length>typedProcedureLimits.conditions)throw Error('Each rule needs one to four conditions.');root={kind:'branch',id:`rule-${index+1}`,intent:rule.label,predicate:{kind:rule.match,terms:rule.conditions.map(predicate)},then:outcome(rule.outcome,`rule-${index+1}`),else:root};}
 const returned=[...draft.rules.map(rule=>rule.outcome),draft.fallback].filter(value=>value.kind==='return');
 return parseSemanticProcedure({schemaVersion:1,id,version:1,intent:draft.intent,target:'local-record',input:{name:draft.name,fields:draft.inputs.map(fieldSpec)},output:{name:'result',fields:draft.outputs.map(fieldSpec)},
  preconditions:draft.requirements.map((condition,index)=>({id:`required-${index+1}`,reason:`Required condition ${index+1} is not met.`,predicate:predicate(condition)})),
  postconditions:draft.outputs.map((field,index)=>{if(returned.some(value=>value.values[index]?.source==='calculate')){if(field.kind!=='number')throw Error('Calculated results must be numeric.');return {id:`result-${index+1}`,reason:`${field.name} must stay inside its numeric output range.`,predicate:{kind:'all',terms:[{kind:'compare',operator:'gte',left:{kind:'output',field:field.name},right:{kind:'literal',value:-1000000}},{kind:'compare',operator:'lte',left:{kind:'output',field:field.name},right:{kind:'literal',value:1000000}}]}};}return {id:`result-${index+1}`,reason:`${field.name} must use one of the declared values.`,predicate:{kind:'any',terms:returned.map(value=>{const assigned=value.values[index];if(assigned.source==='calculate')throw Error('Review the numeric result.');return {kind:'compare',operator:'eq',left:{kind:'output',field:field.name},right:atomFor(field,assigned)};})}};}),root});
}
/** Recognize only this editor's exact shape; other existing definitions stay intact. */
export function typedDraftFromProcedure(procedure:SemanticProcedure):TypedProcedureDraft|null{
 try{
  const inputs=procedure.input.fields.map(field=>({name:field.name,kind:field.kind})),outputs=procedure.output.fields.map(field=>({name:field.name,kind:field.kind}));
  const condition=(value:SemanticPredicate):TypedCondition=>{if(value.kind!=='compare'||value.left.kind!=='input'||value.right.kind!=='literal')throw Error();return {field:value.left.field,operator:value.operator,value:String(value.right.value)};};
  const outcome=(start:SemanticStep):TypedOutcome=>{
   if(start.kind==='abstain')return {kind:'stop',reason:start.reason,values:outputs.map(()=>({source:'literal',value:''}))};
   const values:TypedValue[]=[];let step:SemanticStep=start;
   const atom=(value:{kind:'input'|'output';field:string}|{kind:'literal';value:SemanticScalar}):TypedAtom=>value.kind==='literal'?{source:'literal',value:String(value.value)}:{source:value.kind,value:value.field};
   while(step.kind==='assign'){values.push(step.value.kind==='arithmetic'?{source:'calculate',operator:step.value.operator,left:atom(step.value.left),right:atom(step.value.right)}:atom(step.value));step=step.next;}
   if(step.kind!=='return')throw Error();return {kind:'return',reason:'',values};
  };
  const rules:TypedRule[]=[];let step=procedure.root;
  while(step.kind==='branch'){if(step.predicate.kind!=='all'&&step.predicate.kind!=='any')throw Error();rules.push({label:step.intent,match:step.predicate.kind,conditions:step.predicate.terms.map(condition),outcome:outcome(step.then)});step=step.else;}
  const draft={name:procedure.input.name,intent:procedure.intent,inputs,outputs,requirements:procedure.preconditions.map(item=>condition(item.predicate)),rules,fallback:outcome(step)};
  if(JSON.stringify(typedProcedure(draft,procedure.id))!==JSON.stringify(parseSemanticProcedure({...procedure,version:1})))return null;
  return draft;
 }catch{return null;}
}
export function typedProcedureExample():TypedProcedureDraft{
 const result=(route:string):TypedOutcome=>({kind:'return',reason:'',values:[{source:'input',value:'item'},{source:'literal',value:route}]});
 return {name:'return',intent:'Route an equipment return using its condition and age.',inputs:[{name:'item',kind:'string'},{name:'condition',kind:'string'},{name:'days',kind:'number'},{name:'approved',kind:'boolean'},{name:'recalled',kind:'boolean'}],outputs:[{name:'item',kind:'string'},{name:'route',kind:'string'}],requirements:[{field:'approved',operator:'eq',value:'true'}],rules:[
  {label:'Stop a recalled item',match:'all',conditions:[{field:'recalled',operator:'eq',value:'true'}],outcome:{kind:'stop',reason:'A recalled item requires specialist review.',values:[{source:'literal',value:''},{source:'literal',value:''}]}},
  {label:'Restock a recent working item',match:'all',conditions:[{field:'condition',operator:'eq',value:'working'},{field:'days',operator:'lte',value:'30'}],outcome:result('restock')},
  {label:'Repair damaged or very old items',match:'any',conditions:[{field:'condition',operator:'eq',value:'damaged'},{field:'days',operator:'gt',value:'90'}],outcome:result('repair')},
 ],fallback:result('review')};
}
