import {Schema} from 'effect';

const revision=Schema.Int.pipe(Schema.between(0,Number.MAX_SAFE_INTEGER));
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const sourceIds=Schema.mutable(Schema.Array(id).pipe(Schema.maxItems(64),Schema.filter(values=>new Set(values).size===values.length)));
export const SourceSelectionSchema=Schema.Struct({revision,sourceIds});
const command=Schema.Struct({type:Schema.Literal('source-selection.set'),taskId:id,expectedRevision:revision,sourceIds});
export type SourceSelectionCommand=typeof command.Type;
export const readSourceSelectionCommand=Schema.decodeUnknownSync(command,{onExcessProperty:'error'});
