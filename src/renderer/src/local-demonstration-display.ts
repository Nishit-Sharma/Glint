import type {ProcedureStage,StagedValue} from '../../learning/staged-procedure';
import type {TypedAtom,TypedField} from '../../learning/typed-procedure';
import type {SemanticProcedure,SemanticStep,SemanticPredicate} from '../../learning/semantic-procedure';
import type {HelperOperation} from '../../learning/text-operation';
type Stage=Exclude<ProcedureStage,{kind:'decide'}>;
const named=(name:string)=>`“${name}”`;
const literal=(value:string|number|boolean)=>typeof value==='string'?`the text ${named(value)}`:`the value ${String(value)}`;
const calculation=(operator:'add'|'subtract'|'multiply'|'divide',left:string,right:string,field:string)=>`${operator==='subtract'?`Subtract ${right} from ${left}`:operator==='add'?`Add ${left} and ${right}`:operator==='multiply'?`Multiply ${left} by ${right}`:`Divide ${left} by ${right}`} to produce ${named(field)}.`;
function transform(operation:HelperOperation,input:string,field:string){
 const action=operation.kind==='replace-literal'?`Replace each exact ${named(operation.find)} with ${named(operation.replacement)} in ${input}`:operation.kind==='trim'?`Trim the edges of ${input}`:operation.kind==='collapse-spaces'?`Collapse spaces and tabs in ${input}`:`Convert ${input} to ${operation.kind==='lowercase'?'lowercase':'uppercase'}`;
 return `${action} to produce ${named(field)}.`;
}
const rawAtom=(atom:TypedAtom,kind:TypedField['kind'])=>atom.source==='literal'?kind==='string'?literal(atom.value):`the ${kind==='number'?'number':'value'} ${atom.value||'(not entered)'}`:`${atom.source==='input'?'input':'earlier result'} ${named(atom.value)}`;
function rawValue(value:StagedValue,field:TypedField):string{
 if(value.source==='calculate')return calculation(value.operator,rawAtom(value.left,'number'),rawAtom(value.right,'number'),field.name);
 if(value.source==='text-transform')return transform(value.operation,rawAtom(value.input,'string'),field.name);
 return `${value.source==='literal'?'Set':'Copy'} ${rawAtom(value,field.kind)} ${value.source==='literal'?'as':'to'} ${named(field.name)}.`;
}
const comparison={eq:'equals',ne:'does not equal',gt:'is greater than',gte:'is at least',lt:'is less than',lte:'is at most'} as const;
/** Display is local user content, never a model-safety or action-authority boundary. */
export function localActionDescription(stage:Stage):string{
 if(stage.kind==='assign')return rawValue(stage.value,stage.field);
 return `Continue only when ${stage.condition.source==='input'?'input':'earlier result'} ${named(stage.condition.field)} ${comparison[stage.condition.operator]} ${named(stage.condition.value)}. Otherwise stop for review.`;
}
/** Only an empty new note gets a visible operation description; existing notes are never rewritten. */
export function withLocalActionNote<T extends Stage>(stage:T):T{return stage.label===''?{...stage,label:localActionDescription(stage)}:stage;}
export function localProcedureDescriptions(procedure:SemanticProcedure):ReadonlyMap<string,string>{
 const result=new Map<string,string>();
 const operand=(value:Extract<SemanticPredicate,{kind:'compare'}>['left']):string=>value.kind==='literal'?literal(value.value):`${value.kind==='input'?'input':'earlier result'} ${named(value.field)}`;
 const visit=(step:SemanticStep):void=>{
  if(step.kind==='assign'){
   const value=step.value,description=value.kind==='arithmetic'?calculation(value.operator,operand(value.left),operand(value.right),step.field):value.kind==='text-transform'?transform(value.operation,operand(value.input),step.field):`${value.kind==='literal'?'Set':'Copy'} ${operand(value)} ${value.kind==='literal'?'as':'to'} ${named(step.field)}.`;
   result.set(step.id,description);visit(step.next);
  }else if(step.kind==='branch'){
   const condition=step.predicate;if(condition.kind==='compare')result.set(step.id,`Check whether ${operand(condition.left)} ${comparison[condition.operator]} ${operand(condition.right)}.`);
   visit(step.then);visit(step.else);
  }
 };
 visit(procedure.root);return result;
}
