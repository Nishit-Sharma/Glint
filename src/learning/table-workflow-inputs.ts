import {Schema} from 'effect';
import type {TableWorkflowStep} from './table-workflow';
import {pickingCanonical,pickingDigest} from '../shared/picking-digest';

const name=Schema.String.pipe(Schema.pattern(/^[A-Za-z][A-Za-z0-9 _-]{0,39}$/),Schema.filter(value=>value===value.trim()));
export const TableInputValuesSchema=Schema.Array(Schema.Struct({name,value:Schema.String.pipe(Schema.maxLength(160))})).pipe(Schema.maxItems(6));
export type TableInputValues=typeof TableInputValuesSchema.Type;
export const TableInputSlotSchema=Schema.Literal('filter-value','left-number','right-number');
export type TableInputSlot=typeof TableInputSlotSchema.Type;
export const TableInputBindingSchema=Schema.Struct({name,kind:Schema.Literal('text','number'),stepIndex:Schema.Int.pipe(Schema.between(0,7)),slot:TableInputSlotSchema,stepDigest:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))});
export type TableInputBinding=typeof TableInputBindingSchema.Type;
export const TableInputBindingsSchema=Schema.Array(TableInputBindingSchema).pipe(Schema.maxItems(6));
export const TableInputNameSchema=name;

/** Only explicit literal slots are eligible. Column references never become run inputs. */
export function tableInputTargets(steps:readonly TableWorkflowStep[]){
 return steps.flatMap((step,stepIndex)=>{
  const target=(slot:TableInputSlot,kind:'text'|'number',literal:string|number)=>({stepIndex,slot,kind,literal,stepDigest:pickingDigest(step)});
  if(step.kind==='filter')return [target('filter-value',step.operator==='eq'||step.operator==='ne'?'text':'number',step.value)];
  if(step.kind!=='calculate')return [];
  return [...(step.left.kind==='number'?[target('left-number','number',step.left.value)]:[]),...(step.right.kind==='number'?[target('right-number','number',step.right.value)]:[])];
 });
}
export function tableInputContract(steps:readonly TableWorkflowStep[],bindings:readonly TableInputBinding[]=[]){
 const names=new Map<string,'text'|'number'>(),targets=new Set<string>();
 for(const binding of bindings){
  const target=tableInputTargets(steps).find(item=>item.stepIndex===binding.stepIndex&&item.slot===binding.slot);
  if(!target||target.stepDigest!==binding.stepDigest||target.kind!==binding.kind)throw Error(`Input “${binding.name}” no longer matches its exact applied step. Remove and review that binding again.`);
  const key=`${binding.stepIndex}:${binding.slot}`;
  if(targets.has(key))throw Error('Each literal slot can have only one named input.');targets.add(key);
  if(names.has(binding.name)&&names.get(binding.name)!==binding.kind)throw Error(`Input “${binding.name}” has conflicting types.`);
  names.set(binding.name,binding.kind);
 }
 return [...names].map(([name,kind])=>({name,kind}));
}
function finite(value:string){
 const clean=value.trim();
 if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(clean)||!Number.isFinite(Number(clean))||Math.abs(Number(clean))>1e12)throw Error('Use a finite decimal within ±1,000,000,000,000.');
 return Object.is(Number(clean),-0)?0:Number(clean);
}
export function bindTableInputs(steps:readonly TableWorkflowStep[],bindings:readonly TableInputBinding[],values:TableInputValues){
 const contract=tableInputContract(steps,bindings),provided=new Map<string,string>();
 for(const item of values){if(provided.has(item.name))throw Error(`Input “${item.name}” is duplicated.`);provided.set(item.name,item.value);}
 for(const name of provided.keys())if(!contract.some(item=>item.name===name))throw Error(`Input “${name}” is not declared by this checked workflow.`);
 const resolved=new Map<string,string|number>();
 for(const input of contract){const value=provided.get(input.name);if(value===undefined||value==='')throw Error(`Required input “${input.name}” is missing or empty.`);try{resolved.set(input.name,input.kind==='number'?finite(value):value);}catch(cause){throw Error(`Input “${input.name}”: ${cause instanceof Error?cause.message:'Review this value.'}`);}}
 const bound=structuredClone(steps) as TableWorkflowStep[];
 for(const binding of bindings){const step=bound[binding.stepIndex],value=resolved.get(binding.name)!;
  if(binding.slot==='filter-value'&&step.kind==='filter')bound[binding.stepIndex]={...step,value:String(value)};
  else if(step.kind==='calculate'&&binding.slot==='left-number')bound[binding.stepIndex]={...step,left:{kind:'number',value:Number(value)}};
  else if(step.kind==='calculate'&&binding.slot==='right-number')bound[binding.stepIndex]={...step,right:{kind:'number',value:Number(value)}};
  else throw Error('This named input target is unsupported.');
 }
 return bound;
}

export const tableInputIdentity=(values:TableInputValues)=>pickingCanonical([...values].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0));

export function resolvedTableInputIdentity(values:TableInputValues,contract:readonly {name:string;kind:'text'|'number'}[]){return pickingCanonical(contract.map(input=>{const value=values.find(item=>item.name===input.name)!.value;return {name:input.name,value:input.kind==='number'?finite(value):value};}));}
