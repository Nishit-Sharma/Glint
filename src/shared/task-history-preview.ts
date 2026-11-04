import {Schema} from 'effect';

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const refs=Schema.mutable(Schema.Array(Schema.Struct({sourceId:id,version:Schema.Int.pipe(Schema.between(1,Number.MAX_SAFE_INTEGER)),digest:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))})).pipe(Schema.maxItems(64)));
const command=Schema.Struct({type:Schema.Literal('history.preview'),taskId:id,sourceIds:Schema.mutable(Schema.Array(id).pipe(Schema.maxItems(64))),expectedSourceRefs:refs});
const preview=Schema.Struct({taskId:id,taskUpdatedAt:Schema.String,sessionRevision:Schema.Int,sourceRefs:refs,history:Schema.String.pipe(Schema.maxLength(40_000))});
export type TaskHistoryPreviewCommand=typeof command.Type;
export type TaskHistoryPreview=typeof preview.Type;
export const readTaskHistoryPreviewCommand=Schema.decodeUnknownSync(command,{onExcessProperty:'error'});
export const readTaskHistoryPreview=Schema.decodeUnknownSync(preview,{onExcessProperty:'error'});
