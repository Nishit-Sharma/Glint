import {Schema} from 'effect';
import type {SourceRef,RequestStatus} from '../core/types';

export const INSTRUCTION_SKILL_MIME='application/vnd.glint.instruction-skill+json';
const bounded=(max:number)=>Schema.String.pipe(Schema.maxLength(max),Schema.filter(value=>!value.includes('\0')));
const id=bounded(200).pipe(Schema.minLength(1)),revision=Schema.Int.pipe(Schema.between(1,Number.MAX_SAFE_INTEGER)),counter=Schema.Int.pipe(Schema.between(0,Number.MAX_SAFE_INTEGER));
const text=(max:number)=>bounded(max).pipe(Schema.filter(value=>!!value.trim()));
const source=Schema.Struct({sourceId:id,version:revision,digest:id});
export const InstructionSkillReferenceSchema=Schema.Struct({ownerTaskId:id,artifactId:id,revision,digest:id});
export type InstructionSkillReference=typeof InstructionSkillReferenceSchema.Type;
export const InstructionSkillSelectionSchema=Schema.Struct({revision:counter,selection:Schema.NullOr(InstructionSkillReferenceSchema)});
export type InstructionSkillSelection=typeof InstructionSkillSelectionSchema.Type;
export const InstructionSkillBodySchema=Schema.Struct({kind:Schema.Literal('instruction-skill'),schemaVersion:Schema.Literal(1),creationId:id,name:text(200),description:bounded(1000),instructions:text(16000),resources:Schema.Array(source).pipe(Schema.maxItems(8))});
export type InstructionSkillBody=typeof InstructionSkillBodySchema.Type;
export const readInstructionSkillBody=Schema.decodeUnknownSync(InstructionSkillBodySchema,{onExcessProperty:'error'});
const saveFields={taskId:id,intentId:id,artifactId:Schema.optional(id),expectedRevision:Schema.optional(revision),name:text(200),description:bounded(1000),instructions:text(16000),resources:Schema.Array(source).pipe(Schema.maxItems(8))};
const save=Schema.Struct(saveFields).pipe(Schema.filter(value=>(value.artifactId!==undefined)===(value.expectedRevision!==undefined)&&new Set(value.resources.map(ref=>ref.sourceId)).size===value.resources.length));
export type InstructionSkillSave=typeof save.Type;
export const readInstructionSkillSave=Schema.decodeUnknownSync(save,{onExcessProperty:'error'});
export type InstructionSkillResource={reference:SourceRef;label:string;content:string};
export type InstructionSkillSnapshot={reference:InstructionSkillReference;name:string;description:string;instructions:string;resources:InstructionSkillResource[]};
export type InstructionSkillEntry=InstructionSkillSnapshot&{current:boolean};
export type InstructionSkillUnavailable={reference:InstructionSkillReference;name:string;reason:string};
export const INSTRUCTION_SKILL_ACTIVITY_LIMIT=50;
export type InstructionSkillRequestActivity={reference:InstructionSkillReference;name:string|null;taskId:string;taskTitle:string;requestId:string;status:RequestStatus;startedAt:string|null;finishedAt:string|null};
export type InstructionSkillCatalog={entries:InstructionSkillEntry[];unavailable:InstructionSkillUnavailable[];invocation:InstructionSkillSelection;activity?:{records:InstructionSkillRequestActivity[];total:number}};
export const instructionSkillSelection=(session?:{instructionSkill?:InstructionSkillSelection}):InstructionSkillSelection=>session?.instructionSkill??{revision:0,selection:null};
export const sameInstructionSkill=(a:InstructionSkillReference|null|undefined,b:InstructionSkillReference|null|undefined)=>JSON.stringify(a??null)===JSON.stringify(b??null);
const commands=Schema.Union(
 Schema.Struct({type:Schema.Literal('skills.list'),taskId:id}),
 Schema.Struct({type:Schema.Literal('skills.save'),...saveFields}),
 Schema.Struct({type:Schema.Literal('skills.use'),taskId:id,expectedRevision:counter,selection:Schema.NullOr(InstructionSkillReferenceSchema)}),
 Schema.Struct({type:Schema.Literal('skills.preview'),taskId:id,prompt:bounded(16000),expectedRevision:counter,sourceIds:Schema.Array(id).pipe(Schema.maxItems(64))}),
);
export type InstructionSkillCommand=typeof commands.Type;
export const isInstructionSkillCommand=(value:{type:string}):value is InstructionSkillCommand=>value.type.startsWith('skills.');
export const readInstructionSkillCommand=(value:unknown)=>{const result=Schema.decodeUnknownSync(commands,{onExcessProperty:'error'})(value);if(result.type==='skills.save'){const {type:_type,...input}=result;readInstructionSkillSave(input);}return result;};
