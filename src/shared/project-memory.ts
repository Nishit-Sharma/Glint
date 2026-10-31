import {Schema} from 'effect';
import {emptyUserMemory,selectUserMemory,memoryConsent,MemoryFactSchema,MemoryUseSchema,MEMORY_REQUEST_FACTS,MEMORY_REQUEST_CHARACTERS,type UserMemory,type MemoryFact,type MemoryUse} from './user-memory';

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const project=Schema.Struct({id,name:id,enabled:Schema.Boolean,useAccountMemory:Schema.Boolean});
const facts=Schema.mutable(Schema.Array(MemoryFactSchema).pipe(Schema.maxItems(MEMORY_REQUEST_FACTS)));
const matches=(values:readonly MemoryFact[],refs:readonly {id:string;revision:number}[])=>values.length===refs.length&&values.every((value,index)=>value.id===refs[index].id&&value.revision===refs[index].revision);
export const MemoryPreviewSchema=Schema.Struct({facts,projectFacts:facts,receipt:MemoryUseSchema,globalEnabled:Schema.Boolean,project:Schema.optional(project)}).pipe(Schema.filter(value=>{
 const scoped=value.receipt.project;
 return value.facts.length+value.projectFacts.length<=MEMORY_REQUEST_FACTS&&[...value.facts,...value.projectFacts].reduce((length,fact)=>length+fact.text.length,0)<=MEMORY_REQUEST_CHARACTERS&&matches(value.facts,value.receipt.facts)&&matches(value.projectFacts,scoped?.facts??[])&&(!scoped?!value.project:!!value.project&&value.project.id===scoped.projectId&&value.project.name===scoped.projectName)&&(!value.globalEnabled?value.facts.length+value.projectFacts.length===0:true);
}));
export type TaskMemorySelection=typeof MemoryPreviewSchema.Type;
export interface ProjectMemoryScope {id:string;name:string;memory?:UserMemory;useAccountMemory?:boolean}
const MemoryPreviewInputSchema=Schema.Struct({taskId:Schema.optional(id),prompt:Schema.String.pipe(Schema.maxLength(16000),Schema.filter(value=>!value.includes('\0')))});
export type MemoryPreviewInput=typeof MemoryPreviewInputSchema.Type;
export const readMemoryPreviewInput=Schema.decodeUnknownSync(MemoryPreviewInputSchema,{onExcessProperty:'error'});
export const readMemoryPreview=Schema.decodeUnknownSync(MemoryPreviewSchema,{onExcessProperty:'error'});

export function selectTaskMemory(memory:UserMemory,question:{title:string;goal:string;prompt:string},scope?:ProjectMemoryScope):TaskMemorySelection{
 const account=selectUserMemory({...memory,enabled:memory.enabled&&scope?.useAccountMemory!==false},question),saved=scope?.memory??emptyUserMemory();
 const own=scope?selectUserMemory({...saved,enabled:memory.enabled&&saved.enabled},question):undefined,projectFacts=own?.facts??[];
 let count=projectFacts.length,length=projectFacts.reduce((sum,fact)=>sum+fact.text.length,0);const selected:MemoryFact[]=[];
 for(const fact of account.facts)if(count<MEMORY_REQUEST_FACTS&&length+fact.text.length<=MEMORY_REQUEST_CHARACTERS){selected.push(fact);count++;length+=fact.text.length;}
 const receipt:MemoryUse={...account.receipt,status:account.receipt.status==='off'?'off':selected.length?'included':'no-match',facts:selected.map(({id,revision})=>({id,revision})),omitted:account.receipt.omitted+account.facts.length-selected.length,...(scope&&own?{project:{projectId:scope.id,projectName:scope.name,...own.receipt}}:{})};
 return {facts:selected,projectFacts,receipt,globalEnabled:memory.enabled,...(scope?{project:{id:scope.id,name:scope.name,enabled:saved.enabled,useAccountMemory:scope.useAccountMemory!==false}}:{})};
}

export function taskMemoryConsent(selection:TaskMemorySelection):string{
 const scope=selection.project;
 const account=scope?.useAccountMemory===false?'Account memory is off for this project. No saved account memory facts are included.':!selection.facts.length&&selection.receipt.omitted?'Matching account facts are omitted by the shared memory limit.':memoryConsent(selection);
 if(!scope)return account;
 const own=!selection.globalEnabled?'Memory is off. No project memory facts are included.':!scope.enabled?'Project memory is off. No project memory facts are included.':!selection.projectFacts.length?'Project memory is on. No saved project facts match this question.':`These ${selection.projectFacts.length} user-authored project facts will be sent as guidance:\n${selection.projectFacts.map((fact,index)=>`${index+1}. ${fact.text}`).join('\n')}\nEnd of project memory facts.${selection.receipt.project?.omitted?` ${selection.receipt.project.omitted} other matching project facts are omitted.`:''}`;
 return `${account}\n\nProject memory: ${scope.name}\n${own}`;
}
