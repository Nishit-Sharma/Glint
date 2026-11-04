import {Schema} from 'effect';
import {TaskMemoryPolicySchema,type TaskMemoryPolicy} from './task-memory-policy';
import {emptyUserMemory,selectUserMemory,memoryConsent,MemoryFactSchema,MemoryUseSchema,MemoryChangeSchema,UserMemorySchema,MemoryHistoryEventSchema,MEMORY_FACT_COUNT,MEMORY_HISTORY_LIMIT,MEMORY_REQUEST_FACTS,MEMORY_REQUEST_CHARACTERS,type UserMemory,type MemoryFact,type MemoryUse} from './user-memory';

export const ProjectMemoryDeadlineSchema=Schema.String.pipe(Schema.filter(value=>{try{return new Date(value).toISOString()===value;}catch{return false;}}));
export const ProjectMemoryFactSchema=Schema.Struct({...MemoryFactSchema.fields,expiresAt:Schema.optional(ProjectMemoryDeadlineSchema)});
export type ProjectMemoryFact=typeof ProjectMemoryFactSchema.Type;
export const ProjectMemorySchema=Schema.Struct({revision:MemoryFactSchema.fields.revision,enabled:Schema.Boolean,facts:Schema.mutable(Schema.Array(ProjectMemoryFactSchema).pipe(Schema.maxItems(MEMORY_FACT_COUNT))),history:Schema.optional(Schema.mutable(Schema.Array(MemoryHistoryEventSchema).pipe(Schema.maxItems(MEMORY_HISTORY_LIMIT))))}).pipe(Schema.filter(value=>Schema.is(UserMemorySchema)({...value,facts:value.facts.map(({expiresAt,...fact})=>fact)})));
export type ProjectMemory=typeof ProjectMemorySchema.Type;
export const ProjectMemoryChangeSchema=Schema.Struct({expectedRevision:MemoryChangeSchema.fields.expectedRevision,change:Schema.Union(
 Schema.Struct({kind:Schema.Literal('enabled'),enabled:Schema.Boolean}),
 Schema.Struct({kind:Schema.Literal('save'),id:Schema.optional(MemoryFactSchema.fields.id),text:MemoryFactSchema.fields.text,topics:MemoryFactSchema.fields.topics,expiresAt:Schema.optional(ProjectMemoryDeadlineSchema)}),
 Schema.Struct({kind:Schema.Literal('forget'),id:MemoryFactSchema.fields.id}),
)});
export type ProjectMemoryChange=typeof ProjectMemoryChangeSchema.Type;
export const readProjectMemory=Schema.decodeUnknownSync(ProjectMemorySchema,{onExcessProperty:'error'});
export const readProjectMemoryCommit=Schema.decodeUnknownSync(Schema.Struct({kind:Schema.Literal('saved','conflict'),current:ProjectMemorySchema}),{onExcessProperty:'error'});
export const projectMemoryFactActive=(fact:ProjectMemoryFact,now:number)=>fact.expiresAt===undefined||Date.parse(fact.expiresAt)>now;
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const project=Schema.Struct({id,name:id,enabled:Schema.Boolean,useAccountMemory:Schema.Boolean});
const facts=Schema.mutable(Schema.Array(MemoryFactSchema).pipe(Schema.maxItems(MEMORY_REQUEST_FACTS)));
const projectFacts=Schema.mutable(Schema.Array(ProjectMemoryFactSchema).pipe(Schema.maxItems(MEMORY_REQUEST_FACTS)));
const matches=(values:readonly MemoryFact[],refs:readonly {id:string;revision:number}[])=>values.length===refs.length&&values.every((value,index)=>value.id===refs[index].id&&value.revision===refs[index].revision);
export const MemoryPreviewSchema=Schema.Struct({taskPolicy:Schema.optional(TaskMemoryPolicySchema),facts,projectFacts,receipt:MemoryUseSchema,globalEnabled:Schema.Boolean,project:Schema.optional(project)}).pipe(Schema.filter(value=>{
 const scoped=value.receipt.project;
 return value.facts.length+value.projectFacts.length<=MEMORY_REQUEST_FACTS&&[...value.facts,...value.projectFacts].reduce((length,fact)=>length+fact.text.length,0)<=MEMORY_REQUEST_CHARACTERS&&matches(value.facts,value.receipt.facts)&&matches(value.projectFacts,scoped?.facts??[])&&(!scoped?!value.project:!!value.project&&value.project.id===scoped.projectId&&value.project.name===scoped.projectName)&&(!value.globalEnabled||value.taskPolicy?.mode==='off'?value.facts.length+value.projectFacts.length===0:true);
}));
export type TaskMemorySelection=typeof MemoryPreviewSchema.Type;
export interface ProjectMemoryScope {id:string;name:string;memory?:ProjectMemory;useAccountMemory?:boolean}
const MemoryPreviewInputSchema=Schema.Struct({taskId:Schema.optional(id),prompt:Schema.String.pipe(Schema.maxLength(16000),Schema.filter(value=>!value.includes('\0')))});
export type MemoryPreviewInput=typeof MemoryPreviewInputSchema.Type;
export const readMemoryPreviewInput=Schema.decodeUnknownSync(MemoryPreviewInputSchema,{onExcessProperty:'error'});
export const readMemoryPreview=Schema.decodeUnknownSync(MemoryPreviewSchema,{onExcessProperty:'error'});

export function selectTaskMemory(memory:UserMemory,question:{title:string;goal:string;prompt:string},scope?:ProjectMemoryScope,policy?:TaskMemoryPolicy,now=Date.now()):TaskMemorySelection{
 const account=selectUserMemory({...memory,enabled:memory.enabled&&policy?.mode!=='off'&&scope?.useAccountMemory!==false},question),saved=scope?.memory??emptyUserMemory();
 const own=scope?selectUserMemory({...saved,facts:saved.facts.filter(fact=>projectMemoryFactActive(fact,now)),enabled:memory.enabled&&policy?.mode!=='off'&&saved.enabled},question):undefined,projectFacts=(own?.facts??[]) as ProjectMemoryFact[];
 let count=projectFacts.length,length=projectFacts.reduce((sum,fact)=>sum+fact.text.length,0);const selected:MemoryFact[]=[];
 for(const fact of account.facts)if(count<MEMORY_REQUEST_FACTS&&length+fact.text.length<=MEMORY_REQUEST_CHARACTERS){selected.push(fact);count++;length+=fact.text.length;}
 const receipt:MemoryUse={...account.receipt,status:account.receipt.status==='off'?'off':selected.length?'included':'no-match',facts:selected.map(({id,revision})=>({id,revision})),omitted:account.receipt.omitted+account.facts.length-selected.length,...(scope&&own?{project:{projectId:scope.id,projectName:scope.name,...own.receipt}}:{})};
 return {...(policy?{taskPolicy:policy}:{}),facts:selected,projectFacts,receipt,globalEnabled:memory.enabled,...(scope?{project:{id:scope.id,name:scope.name,enabled:saved.enabled,useAccountMemory:scope.useAccountMemory!==false}}:{})};
}

export function taskMemoryConsent(selection:TaskMemorySelection):string{
 if(selection.taskPolicy?.mode==='off')return 'Saved memory is off for this task. No saved account or project memory facts are included. Global Memory settings are unchanged.';
 const scope=selection.project;
 const account=scope?.useAccountMemory===false?'Account memory is off for this project. No saved account memory facts are included.':!selection.facts.length&&selection.receipt.omitted?'Matching account facts are omitted by the shared memory limit.':memoryConsent(selection);
 if(!scope)return account;
 const own=!selection.globalEnabled?'Memory is off. No project memory facts are included.':!scope.enabled?'Project memory is off. No project memory facts are included.':!selection.projectFacts.length?'Project memory is on. No saved project facts match this question.':`These ${selection.projectFacts.length} user-authored project facts will be sent as guidance:\n${selection.projectFacts.map((fact,index)=>`${index+1}. ${fact.text}`).join('\n')}\nEnd of project memory facts.${selection.receipt.project?.omitted?` ${selection.receipt.project.omitted} other matching project facts are omitted.`:''}`;
 return `${account}\n\nProject memory: ${scope.name}\n${own}`;
}
