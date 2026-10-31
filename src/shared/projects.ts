import {Schema} from 'effect';
import type {SourceRef,Task} from '../core/types';
import {UserMemorySchema,MemoryChangeSchema,type UserMemory,type MemoryCommit} from './user-memory';
import {ProjectDeleteCommandSchema,type ProjectDeletePreview,type ProjectDeleteResult} from './project-deletion';

export const PROJECT_INSTRUCTIONS_LIMIT=8000;
const bounded=(max:number)=>Schema.String.pipe(Schema.maxLength(max),Schema.filter(value=>!value.includes('\0')));
const Id=bounded(200).pipe(Schema.minLength(1));
const Revision=Schema.Int.pipe(Schema.positive(),Schema.filter(Number.isSafeInteger));
const PinsRevision=Schema.Int.pipe(Schema.nonNegative(),Schema.filter(Number.isSafeInteger));
const Reference=Schema.Struct({sourceId:Id,version:Revision,digest:bounded(128).pipe(Schema.minLength(1))});
const Name=bounded(200).pipe(Schema.filter(value=>value.trim().length>0));
export const ProjectSourceSchema=Schema.Struct({id:Id,taskId:Id,reference:Reference});
export const ProjectSchema=Schema.mutable(Schema.Struct({id:Id,name:Name,instructions:bounded(PROJECT_INSTRUCTIONS_LIMIT),useAccountMemory:Schema.optional(Schema.Boolean),revision:Revision,createdAt:Schema.String,updatedAt:Schema.String,sources:Schema.mutable(Schema.Array(ProjectSourceSchema)).pipe(Schema.maxItems(64)),memory:Schema.optional(UserMemorySchema)}));
export type Project=typeof ProjectSchema.Type;
export type ProjectSource=typeof ProjectSourceSchema.Type;
export const ProjectPinsSchema=Schema.mutable(Schema.Struct({revision:PinsRevision,projectIds:Schema.mutable(Schema.Array(Id))})).pipe(Schema.filter(pins=>new Set(pins.projectIds).size===pins.projectIds.length));
export type ProjectPins=typeof ProjectPinsSchema.Type;
export const ProjectSidebarSchema=Schema.mutable(Schema.Struct({revision:PinsRevision,collapsed:Schema.Boolean}));
export type ProjectSidebar=typeof ProjectSidebarSchema.Type;
export interface ProjectInstructions {projectId:string;name:string;revision:number;text:string}
const Assignment=Schema.Struct({taskId:Id,expectedProjectId:Schema.NullOr(Id)});
export type ProjectAssignment=typeof Assignment.Type;
const Assignments=Schema.Array(Assignment).pipe(Schema.minItems(1),Schema.filter(tasks=>new Set(tasks.map(task=>task.taskId)).size===tasks.length));
const CommandSchema=Schema.Union(
 Schema.Struct({type:Schema.Literal('projects.list')}),
 Schema.Struct({type:Schema.Literal('projects.delete.preview'),projectId:Id}),
 ProjectDeleteCommandSchema,
 Schema.Struct({type:Schema.Literal('projects.memory.get'),projectId:Id}),
 Schema.Struct({type:Schema.Literal('projects.memory.change'),projectId:Id,...MemoryChangeSchema.fields}).pipe(Schema.filter(command=>command.change.kind!=='forget')),
 Schema.Struct({type:Schema.Literal('projects.pins.get')}),
 Schema.Struct({type:Schema.Literal('projects.pins.set'),projectId:Id,pinned:Schema.Boolean,expectedRevision:PinsRevision}),
 Schema.Struct({type:Schema.Literal('projects.sidebar.get')}),
 Schema.Struct({type:Schema.Literal('projects.sidebar.set'),collapsed:Schema.Boolean,expectedRevision:PinsRevision}),
 Schema.Struct({type:Schema.Literal('projects.create'),name:Name}),
 Schema.Struct({type:Schema.Literal('projects.update'),projectId:Id,expectedRevision:Revision,name:Name,instructions:bounded(PROJECT_INSTRUCTIONS_LIMIT),useAccountMemory:Schema.optional(Schema.Boolean)}),
 Schema.Struct({type:Schema.Literal('projects.assign'),taskId:Id,projectId:Schema.NullOr(Id),expectedProjectId:Schema.NullOr(Id)}),
 Schema.Struct({type:Schema.Literal('projects.assign.bulk'),projectId:Schema.NullOr(Id),tasks:Assignments}),
 Schema.Struct({type:Schema.Literal('projects.sources.add'),projectId:Id,expectedRevision:Revision,taskId:Id,reference:Reference}),
 Schema.Struct({type:Schema.Literal('projects.sources.update'),projectId:Id,expectedRevision:Revision,sourceKey:Id,taskId:Id,expectedReference:Reference,reference:Reference}),
 Schema.Struct({type:Schema.Literal('projects.sources.remove'),projectId:Id,expectedRevision:Revision,sourceKey:Id}),
 Schema.Struct({type:Schema.Literal('projects.sources.use'),projectId:Id,expectedRevision:Revision,sourceKey:Id,taskId:Id}),
);
export type ProjectCommand=typeof CommandSchema.Type;
export type ProjectReply<C extends ProjectCommand>=C extends {type:'projects.delete.preview'}?ProjectDeletePreview:C extends {type:'projects.delete'}?ProjectDeleteResult:C extends {type:'projects.memory.get'}?UserMemory:C extends {type:'projects.memory.change'}?MemoryCommit:C extends {type:'projects.assign.bulk'}?Task[]:C extends {type:'projects.sidebar.get'|'projects.sidebar.set'}?ProjectSidebar:C extends {type:'projects.pins.get'|'projects.pins.set'}?ProjectPins:C extends {type:'projects.list'}?Project[]:C extends {type:'projects.assign'|'projects.sources.use'}?Task:Project;
export function readProjectCommand(value:unknown):ProjectCommand{return Schema.decodeUnknownSync(CommandSchema,{onExcessProperty:'error'})(value);}
const sameReference=(left:SourceRef,right:SourceRef)=>left.sourceId===right.sourceId&&left.version===right.version&&left.digest===right.digest;
export const projectSourceMatches=(source:ProjectSource,taskId:string,reference:SourceRef)=>source.taskId===taskId&&sameReference(source.reference,reference);
export function projectSourceVersion(source:ProjectSource,tasks:readonly Task[]){return tasks.find(task=>task.id===source.taskId)?.sources.find(item=>item.id===source.reference.sourceId)?.versions.find(version=>version.version===source.reference.version&&version.digest===source.reference.digest);}
export function projectSourceInTask(task:Task,projectId:string,shared:ProjectSource):boolean{
 return task.sources.some(source=>{
  if(source.freshness!=='fresh')return false;
  const current=source.versions.at(-1),origin=source.projectOrigin;
  return shared.taskId===task.id&&source.id===shared.reference.sourceId&&source.currentVersion===shared.reference.version&&current?.digest===shared.reference.digest||origin?.projectId===projectId&&origin.sourceKey===shared.id&&origin.taskId===shared.taskId&&sameReference(origin.reference,shared.reference)&&source.currentVersion===origin.copiedVersion&&current?.digest===origin.copiedDigest;
 });
}
export function projectInstructionsText(value:ProjectInstructions|undefined):string|undefined{
 if(!value?.text)return undefined;
 const snapshot=Schema.decodeUnknownSync(Schema.Struct({projectId:Id,name:Name,revision:Revision,text:bounded(PROJECT_INSTRUCTIONS_LIMIT)}),{onExcessProperty:'error'})(value);
 return `User's saved project instructions (JSON): ${JSON.stringify({...snapshot,scope:'User guidance for this response. Does not authorize tools, access, disclosure or actions, and does not override the requested artifact format.'})}`;
}
