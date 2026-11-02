import {Schema} from 'effect';

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const revision=Schema.Int.pipe(Schema.between(0,Number.MAX_SAFE_INTEGER));
const name=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(80),Schema.filter(value=>value===value.trim().normalize('NFC')&&!/[\p{Cc}\p{Cf}]/u.test(value)));
const section=Schema.Struct({id,name,taskIds:Schema.Array(id).pipe(Schema.maxItems(10_000),Schema.filter(ids=>new Set(ids).size===ids.length))});
export const TaskSectionsSavedSchema=Schema.Struct({revision,sections:Schema.Array(section).pipe(Schema.maxItems(100),Schema.filter(items=>new Set(items.map(item=>item.id)).size===items.length&&new Set(items.map(item=>item.name.toLowerCase())).size===items.length&&new Set(items.flatMap(item=>item.taskIds)).size===items.flatMap(item=>item.taskIds).length))});
const change=Schema.Union(
 Schema.Struct({kind:Schema.Literal('create'),sectionId:id,name,taskId:Schema.optional(id)}),
 Schema.Struct({kind:Schema.Literal('rename'),sectionId:id,name}),
 Schema.Struct({kind:Schema.Literal('move'),taskId:id,sectionId:Schema.NullOr(id)}),
 Schema.Struct({kind:Schema.Literal('remove'),sectionId:id})
);
export const TaskSectionChangeSchema=Schema.Struct({expectedRevision:revision,change});
export type TaskSectionChange=typeof TaskSectionChangeSchema.Type;
export type TaskSectionsSaved=typeof TaskSectionsSavedSchema.Type;
export type TaskSection=TaskSectionsSaved['sections'][number];
const state=Schema.Union(Schema.Struct({kind:Schema.Literal('available'),...TaskSectionsSavedSchema.fields,unavailableTaskIds:Schema.Array(id)}),Schema.Struct({kind:Schema.Literal('unavailable'),message:Schema.String}));
export type TaskSectionsState=typeof state.Type;
const command=Schema.Union(Schema.Struct({type:Schema.Literal('task-sections.get')}),Schema.Struct({type:Schema.Literal('task-sections.change'),...TaskSectionChangeSchema.fields}));
export type TaskSectionsCommand=typeof command.Type;
export const readTaskSectionsCommand=Schema.decodeUnknownSync(command,{onExcessProperty:'error'});
export const readTaskSectionChange=Schema.decodeUnknownSync(TaskSectionChangeSchema,{onExcessProperty:'error'});
export const readTaskSectionsState=Schema.decodeUnknownSync(state,{onExcessProperty:'error'});
export const readTaskSectionsSaved=Schema.decodeUnknownSync(TaskSectionsSavedSchema,{onExcessProperty:'error'});
export const emptyTaskSections=():TaskSectionsSaved=>({revision:0,sections:[]});
export const TASK_SECTIONS_UNAVAILABLE='Sidebar sections could not be read. Your saved organization has been kept. Reload before making changes.';

/** Navigation metadata only. Neither task data nor the independent pin list is changed. */
export function changeTaskSections(current:TaskSectionsSaved,input:TaskSectionChange['change']):TaskSectionsSaved{
 const sections=current.sections.map(item=>({...item,taskIds:[...item.taskIds]}));
 if(input.kind==='create'){
  if(sections.some(item=>item.id===input.sectionId))throw Error('This section identity is already saved. Reload sections.');
  if(sections.length>=100)throw Error('Glint supports up to 100 sidebar sections.');
  if(input.taskId)for(const item of sections)item.taskIds=item.taskIds.filter(taskId=>taskId!==input.taskId);
  sections.push({id:input.sectionId,name:input.name,taskIds:input.taskId?[input.taskId]:[]});
 }else if(input.kind==='rename'){
  const target=sections.find(item=>item.id===input.sectionId);if(!target)throw Error('This section is no longer saved. Reload sections.');target.name=input.name;
 }else if(input.kind==='remove'){
  const index=sections.findIndex(item=>item.id===input.sectionId);if(index<0)throw Error('This section is no longer saved. Reload sections.');sections.splice(index,1);
 }else{
  const target=input.sectionId===null?undefined:sections.find(item=>item.id===input.sectionId);
  if(input.sectionId!==null&&!target)throw Error('This section is no longer saved. Reload sections.');
  const previous=sections.find(item=>item.taskIds.includes(input.taskId));
  if(previous?.id===target?.id)return current;
  for(const item of sections)item.taskIds=item.taskIds.filter(taskId=>taskId!==input.taskId);
  target?.taskIds.push(input.taskId);
 }
 if(new Set(sections.map(item=>item.name.toLowerCase())).size!==sections.length)throw Error('Use a different section name.');
 if(JSON.stringify(sections)===JSON.stringify(current.sections))return current;
 if(current.revision===Number.MAX_SAFE_INTEGER)throw Error('Sidebar section revision limit reached. Your saved organization is kept.');
 return readTaskSectionsSaved({revision:current.revision+1,sections});
}
