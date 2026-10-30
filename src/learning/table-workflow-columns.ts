import {Schema} from 'effect';
import type {TableWorkflowStep} from './table-workflow';
import {TableInputNameSchema} from './table-workflow-inputs';
import {pickingCanonical,pickingDigest} from '../shared/picking-digest';

const column=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(80),Schema.filter(value=>value===value.trim()&&!value.includes('\0')));
export const TableColumnRoleSchema=Schema.Struct({name:TableInputNameSchema,column,targetsDigest:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))});
export const TableColumnRolesSchema=Schema.Array(TableColumnRoleSchema).pipe(Schema.maxItems(6));
export type TableColumnRole=typeof TableColumnRoleSchema.Type;
export const TableColumnMappingsSchema=Schema.Array(Schema.Struct({name:TableInputNameSchema,column:Schema.String.pipe(Schema.maxLength(80))})).pipe(Schema.maxItems(6));
export type TableColumnMappings=typeof TableColumnMappingsSchema.Type;
type Slot='filter-column'|'left-column'|'right-column'|'sum-column'|'group-column';
type Target={stepIndex:number;slot:Slot;stepDigest:string};

/** Track original-column lineage; generated outputs never become source-column roles. */
export function tableColumnTargets(steps:readonly TableWorkflowStep[],originalHeaders:readonly string[]){
 let origins=new Map(originalHeaders.map(header=>[header,header]));const targets=new Map<string,Target[]>();
 steps.forEach((step,stepIndex)=>{
  const add=(header:string,slot:Slot)=>{const original=origins.get(header);if(original!==undefined){const items=targets.get(original)??[];items.push({stepIndex,slot,stepDigest:pickingDigest(step)});targets.set(original,items);}};
  if(step.kind==='filter')add(step.column,'filter-column');
  else if(step.kind==='calculate'){if(step.left.kind==='column')add(step.left.column,'left-column');if(step.right.kind==='column')add(step.right.column,'right-column');origins.delete(step.output);}
  else{add(step.column,'sum-column');if(step.groupBy!==null)add(step.groupBy,'group-column');const group=step.groupBy===null?undefined:origins.get(step.groupBy);origins=new Map(group===undefined||step.groupBy===null?[]:[[step.groupBy,group]]);origins.delete(step.output);}
 });
 return [...targets].map(([column,targets])=>({column,targets,targetsDigest:pickingDigest({column,targets})}));
}
export function tableColumnContract(steps:readonly TableWorkflowStep[],roles:readonly TableColumnRole[],originalHeaders:readonly string[]){
 const targets=tableColumnTargets(steps,originalHeaders),names=new Set<string>(),columns=new Set<string>();
 return roles.map(role=>{const target=targets.find(item=>item.column===role.column);if(!target||target.targetsDigest!==role.targetsDigest)throw Error(`Column role “${role.name}” no longer matches its exact applied input references. Remove and review that role again.`);if(names.has(role.name)||columns.has(role.column))throw Error('Each column role name and original input column must be unique.');names.add(role.name);columns.add(role.column);return {...role,targets:target.targets};});
}
function replace(step:TableWorkflowStep,slot:Slot,column:string):TableWorkflowStep{
 if(step.kind==='filter'&&slot==='filter-column')return {...step,column};
 if(step.kind==='calculate'&&slot==='left-column')return {...step,left:{kind:'column',column}};
 if(step.kind==='calculate'&&slot==='right-column')return {...step,right:{kind:'column',column}};
 if(step.kind==='summarize'&&slot==='sum-column')return {...step,column};
 if(step.kind==='summarize'&&slot==='group-column')return {...step,groupBy:column};
 throw Error('This column role target is unsupported.');
}
/** Resolve only explicit roles, before stop rules or any processing; no header inference. */
export function bindTableColumns(original:readonly TableWorkflowStep[],bound:readonly TableWorkflowStep[],roles:readonly TableColumnRole[],mappings:TableColumnMappings,originalHeaders:readonly string[],currentHeaders:readonly string[]){
 const contract=tableColumnContract(original,roles,originalHeaders),provided=new Map<string,string>();
 for(const mapping of mappings){if(provided.has(mapping.name))throw Error(`Column role “${mapping.name}” is duplicated.`);if(!contract.some(role=>role.name===mapping.name))throw Error(`Column role “${mapping.name}” is not declared by this checked workflow.`);provided.set(mapping.name,mapping.column);}
 for(const role of contract){const header=provided.get(role.name);if(!header)throw Error(`Required column role “${role.name}” has no selected header.`);if(!currentHeaders.includes(header))throw Error(`Column role “${role.name}” selects an unavailable exact header.`);}
 const assigned=new Map<string,string>();for(const target of tableColumnTargets(original,originalHeaders)){const role=contract.find(item=>item.column===target.column),header=role?provided.get(role.name)!:target.column;if([...assigned.values()].includes(header))throw Error('Different original input columns must map to different headers.');assigned.set(target.column,header);}
 let steps=structuredClone(bound) as TableWorkflowStep[];
 for(const role of contract)for(const target of role.targets)steps[target.stepIndex]=replace(steps[target.stepIndex],target.slot,provided.get(role.name)!);
 if(contract.length){
  let headers=[...currentHeaders];for(const step of steps){const needs=step.kind==='filter'?[step.column]:step.kind==='calculate'?[step.left,step.right].flatMap(value=>value.kind==='column'?[value.column]:[]):[step.column,...(step.groupBy===null?[]:[step.groupBy])];if(needs.some(header=>!headers.includes(header)))throw Error('An exact required column is unavailable after mapping. No table was processed.');if(step.kind==='calculate'){if(headers.includes(step.output)||headers.length>=12)throw Error('A mapped input conflicts with a generated output column or column limit.');headers.push(step.output);}else if(step.kind==='summarize'){if(step.groupBy===step.output)throw Error('A mapped group conflicts with the total output column.');headers=[...(step.groupBy===null?[]:[step.groupBy]),step.output];}}
 }
 return steps;
}
export const tableColumnIdentity=(mappings:TableColumnMappings)=>pickingCanonical([...mappings].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0));
