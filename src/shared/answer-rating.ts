import {Schema} from 'effect';

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0'))),digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),revision=Schema.Int.pipe(Schema.between(0,Number.MAX_SAFE_INTEGER));
export const AnswerRatingSelectionSchema=Schema.Struct({taskId:id,requestId:id,requestDigest:digest,answer:Schema.Struct({artifactId:id,revision:Schema.Int.pipe(Schema.between(1,Number.MAX_SAFE_INTEGER)),digest})});
export type AnswerRatingSelection=typeof AnswerRatingSelectionSchema.Type;
const rating=Schema.Literal('up','down');
export const AnswerRatingSavedSchema=Schema.Struct({schemaVersion:Schema.Literal(1),entries:Schema.Array(Schema.Struct({selection:AnswerRatingSelectionSchema,revision:Schema.Int.pipe(Schema.between(1,Number.MAX_SAFE_INTEGER)),rating})).pipe(Schema.maxItems(1000))});
export type AnswerRatingSaved=typeof AnswerRatingSavedSchema.Type;
const commands=Schema.Union(Schema.Struct({type:Schema.Literal('answerRating.read'),selection:AnswerRatingSelectionSchema}),Schema.Struct({type:Schema.Literal('answerRating.set'),selection:AnswerRatingSelectionSchema,expectedRevision:revision,rating}));
export type AnswerRatingCommand=typeof commands.Type;
export const readAnswerRatingCommand=Schema.decodeUnknownSync(commands,{onExcessProperty:'error'});
const state=Schema.Union(Schema.Struct({kind:Schema.Literal('available'),selection:AnswerRatingSelectionSchema,revision,rating:Schema.NullOr(rating)}),Schema.Struct({kind:Schema.Literal('unavailable'),selection:AnswerRatingSelectionSchema,message:Schema.String}));
export type AnswerRatingState=typeof state.Type;
export const readAnswerRatingState=Schema.decodeUnknownSync(state,{onExcessProperty:'error'});
export const answerRatingKey=(selection:AnswerRatingSelection)=>JSON.stringify([selection.taskId,selection.requestId,selection.requestDigest,selection.answer.artifactId,selection.answer.revision,selection.answer.digest]);
