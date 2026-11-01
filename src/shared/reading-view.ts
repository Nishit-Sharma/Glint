import {Schema} from 'effect';

const revision=Schema.Int.pipe(Schema.between(0,Number.MAX_SAFE_INTEGER));
export const ReadingOptionsSchema=Schema.Struct({textSize:Schema.Literal(18,22,26,30),lineSpacing:Schema.Literal(1.5,1.8,2.2),theme:Schema.Literal('paper','dim','contrast'),focus:Schema.Literal('all','passage')});
export const ReadingPreferencesSchema=Schema.Struct({revision,...ReadingOptionsSchema.fields});
export type ReadingOptions=typeof ReadingOptionsSchema.Type;
export type ReadingPreferences=typeof ReadingPreferencesSchema.Type;
export const defaultReadingPreferences=():ReadingPreferences=>({revision:0,textSize:22,lineSpacing:1.8,theme:'paper',focus:'all'});
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const command=Schema.Union(Schema.Struct({type:Schema.Literal('reading.preferences.get'),taskId:id}),Schema.Struct({type:Schema.Literal('reading.preferences.set'),taskId:id,expectedRevision:revision,preferences:ReadingOptionsSchema}));
export type ReadingCommand=typeof command.Type;
export type ReadingCommit={kind:'saved'|'conflict';current:ReadingPreferences};
export const isReadingCommand=(value:{type:string}):value is ReadingCommand=>value.type.startsWith('reading.preferences.');
export const readReadingCommand=(value:unknown):ReadingCommand=>Schema.decodeUnknownSync(command,{onExcessProperty:'error'})(value);
