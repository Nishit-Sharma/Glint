import {Schema} from 'effect';
import type {Project} from './projects';

export const MEMORY_FACT_LIMIT=800;
export const MEMORY_FACT_COUNT=40;
export const MEMORY_HISTORY_LIMIT=1000;
export const MEMORY_REQUEST_FACTS=8;
export const MEMORY_REQUEST_CHARACTERS=4_000;
export const MEMORY_CHANGED='Memory changed. Send a new question using the current memory. An earlier request may already have reached the service.';
const revision=Schema.Number.pipe(Schema.int(),Schema.between(0,Number.MAX_SAFE_INTEGER));
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const text=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(MEMORY_FACT_LIMIT),Schema.filter(value=>!!value.trim()&&!value.includes('\0')));
const topic=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(60),Schema.filter(value=>!!value.trim()&&!value.includes('\0')));
const topics=Schema.mutable(Schema.Array(topic).pipe(Schema.maxItems(8)));
export const MemoryFactSchema=Schema.Struct({id,revision,text,topics});
const positiveRevision=revision.pipe(Schema.positive());
const utc=Schema.String.pipe(Schema.filter(value=>{try{return new Date(value).toISOString()===value;}catch{return false;}}));
export const MemoryHistoryEventSchema=Schema.Struct({factId:id,revision:positiveRevision,factRevision:positiveRevision,at:utc,kind:Schema.Literal('added','modified'),fields:Schema.mutable(Schema.Array(Schema.Literal('text','topics')).pipe(Schema.minItems(1),Schema.maxItems(2),Schema.filter(fields=>new Set(fields).size===fields.length)))}).pipe(Schema.filter(event=>event.factRevision===event.revision&&(event.kind!=='added'||event.fields.length===2)));
export type MemoryHistoryEvent=typeof MemoryHistoryEventSchema.Type;
export const UserMemorySchema=Schema.Struct({revision,enabled:Schema.Boolean,facts:Schema.mutable(Schema.Array(MemoryFactSchema).pipe(Schema.maxItems(MEMORY_FACT_COUNT))),history:Schema.optional(Schema.mutable(Schema.Array(MemoryHistoryEventSchema).pipe(Schema.maxItems(MEMORY_HISTORY_LIMIT))))}).pipe(Schema.filter(value=>new Set(value.facts.map(fact=>fact.id)).size===value.facts.length&&value.facts.every(fact=>fact.revision<=value.revision)&&(value.history??[]).every((event,index,events)=>event.revision<=value.revision&&(!index||events[index-1].revision<event.revision)&&value.facts.some(fact=>fact.id===event.factId&&event.factRevision<=fact.revision))));
const ref=Schema.Struct({id,revision});
const useFields={revision,status:Schema.Literal('off','included','no-match'),facts:Schema.mutable(Schema.Array(ref).pipe(Schema.maxItems(MEMORY_REQUEST_FACTS))),omitted:Schema.Number.pipe(Schema.int(),Schema.between(0,MEMORY_FACT_COUNT))};
const validUse=(value:{status:string;facts:readonly unknown[]})=>value.status==='included'?value.facts.length>0:value.facts.length===0;
export const ProjectMemoryUseSchema=Schema.Struct({projectId:id,projectName:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200)),...useFields}).pipe(Schema.filter(validUse));
export const MemoryUseSchema=Schema.Struct({...useFields,project:Schema.optional(ProjectMemoryUseSchema)}).pipe(Schema.filter(value=>validUse(value)&&(!value.project||validUse(value.project))&&value.facts.length+(value.project?.facts.length??0)<=MEMORY_REQUEST_FACTS));
export const MemoryChangeSchema=Schema.Struct({expectedRevision:revision,change:Schema.Union(
 Schema.Struct({kind:Schema.Literal('enabled'),enabled:Schema.Boolean}),
 Schema.Struct({kind:Schema.Literal('save'),id:Schema.optional(id),text,topics}),
 Schema.Struct({kind:Schema.Literal('forget'),id}),
)});
export type UserMemory=typeof UserMemorySchema.Type;
export type MemoryFact=typeof MemoryFactSchema.Type;
export type MemoryUse=typeof MemoryUseSchema.Type;
export type MemoryChange=typeof MemoryChangeSchema.Type;
export type MemoryCommit={kind:'saved'|'conflict';current:UserMemory};
export const readUserMemory=Schema.decodeUnknownSync(UserMemorySchema,{onExcessProperty:'error'});
export const readMemoryUse=Schema.decodeUnknownSync(MemoryUseSchema,{onExcessProperty:'error'});
export const readMemoryChange=Schema.decodeUnknownSync(MemoryChangeSchema,{onExcessProperty:'error'});
export const readMemoryCommit=Schema.decodeUnknownSync(Schema.Struct({kind:Schema.Literal('saved','conflict'),current:UserMemorySchema}),{onExcessProperty:'error'});
export const emptyUserMemory=():UserMemory=>({revision:0,enabled:false,facts:[]});
const words=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[\s\p{Cc}\p{Cf}()\[\]{},;:!?“”"'`<>\/\\]+/gu,' ').split(' ').map(token=>token.replace(/\.+$/u,'')).filter(Boolean).join(' ');

export function selectUserMemory(memory:UserMemory,question:{title:string;goal:string;prompt:string},project?:Pick<Project,'useAccountMemory'>):{facts:MemoryFact[];receipt:MemoryUse}{
 if(!memory.enabled||project?.useAccountMemory===false)return {facts:[],receipt:{revision:memory.revision,status:'off',facts:[],omitted:0}};
 const context=' '+words([question.title,question.goal,question.prompt].join(' '))+' ';
 const matches=memory.facts.filter(fact=>!fact.topics.length||fact.topics.some(topic=>{const term=words(topic);return !!term&&context.includes(' '+term+' ');}));
 const ordered=[...matches.filter(fact=>fact.topics.length),...matches.filter(fact=>!fact.topics.length)];
 const facts:MemoryFact[]=[];let length=0;
 for(const fact of ordered){if(facts.length<MEMORY_REQUEST_FACTS&&length+fact.text.length<=MEMORY_REQUEST_CHARACTERS){facts.push(fact);length+=fact.text.length;}}
 return {facts,receipt:{revision:memory.revision,status:facts.length?'included':'no-match',facts:facts.map(({id,revision})=>({id,revision})),omitted:matches.length-facts.length}};
}
export function memoryConsent(selection:ReturnType<typeof selectUserMemory>,project?:Pick<Project,'useAccountMemory'>):string{
 const {facts,receipt}=selection;
 if(project?.useAccountMemory===false)return 'Account memory is off for this project. No saved account memory facts are included.';
 if(receipt.status==='off')return 'Memory is off. No saved memory facts are included.';
 if(!facts.length)return 'Memory is on. No saved facts match this question.';
 return `Memory is on. These ${facts.length} user-authored facts will be sent as guidance for this response:\n${facts.map((fact,index)=>`${index+1}. ${fact.text}`).join('\n')}\nEnd of memory facts.${receipt.omitted?` ${receipt.omitted} other matching facts are omitted by the memory limit.`:''}`;
}
