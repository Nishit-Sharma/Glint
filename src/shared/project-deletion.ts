import {Schema} from 'effect';
import type {Task} from '../core/types';
import {LOCAL_CODE_MIME} from './code-workspace';

const Id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const Digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
const Revision=Schema.Int.pipe(Schema.positive(),Schema.filter(Number.isSafeInteger));
const Member=Schema.Struct({taskId:Id,snapshot:Digest});
const Members=Schema.Array(Member).pipe(Schema.filter(items=>new Set(items.map(item=>item.taskId)).size===items.length));
const Mode=Schema.Literal('keep-tasks','delete-tasks');
export const ProjectDeleteCommandSchema=Schema.Struct({type:Schema.Literal('projects.delete'),projectId:Id,intentId:Id,expectedRevision:Revision,expectedSnapshot:Digest,mode:Mode,members:Members,confirmed:Schema.Literal('delete-local-project')});
export type ProjectDeleteCommand=typeof ProjectDeleteCommandSchema.Type;
export const ProjectDeletePreviewSchema=Schema.Struct({projectId:Id,revision:Revision,snapshot:Digest,name:Id,sharedSources:Schema.Int,memoryFacts:Schema.Int,members:Schema.Array(Schema.Struct({...Member.fields,title:Id,blocker:Schema.NullOr(Schema.String)}))});
export type ProjectDeletePreview=typeof ProjectDeletePreviewSchema.Type;
export const ProjectDeleteResultSchema=Schema.Struct({kind:Schema.Literal('deleted'),projectId:Id,mode:Mode,taskIds:Schema.Array(Id),draftCleanup:Schema.optional(Schema.Literal('unconfirmed')),viewCleanup:Schema.optional(Schema.Literal('unconfirmed'))});
export type ProjectDeleteResult=typeof ProjectDeleteResultSchema.Type;
export function readProjectDeleteResult(command:ProjectDeleteCommand,value:unknown):ProjectDeleteResult{
 const result=Schema.decodeUnknownSync(ProjectDeleteResultSchema,{onExcessProperty:'error'})(value);
 const expected=command.members.map(member=>member.taskId).sort();
 if(result.projectId!==command.projectId||result.mode!==command.mode||JSON.stringify([...result.taskIds].sort())!==JSON.stringify(expected))throw Error('Project deletion was not confirmed. Check the same deletion again.');
 return result;
}
export function taskDeletionBlocker(task:Task):string|null{
 if(task.requests.some(request=>request.kind==='browser'&&request.status==='running'))return 'Stop and review the running browser work before deleting this task.';
 if(task.session?.runs.some(run=>run.operations.some(operation=>operation.status==='executing'||operation.status==='uncertain')))return 'Resolve the uncertain browser actions before deleting this task.';
 if(task.actions.some(action=>action.status==='executing'||action.status==='uncertain'))return 'Inspect the unresolved export outcome before deleting this task.';
 if(task.artifacts.some(artifact=>artifact.revisions.some(revision=>revision.mimeType===LOCAL_CODE_MIME)))return 'This task has linked local code files. Keep the task so its file history and write receipts remain inspectable.';
 return null;
}
