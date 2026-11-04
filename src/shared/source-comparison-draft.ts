import {Schema} from 'effect';
import {SourceComparisonIntentSchema} from './source-comparison';

export const SOURCE_COMPARISON_SLOT='source-comparison:notes';
export const SOURCE_COMPARISON_BASIS='source-comparison-local-v1';
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
export const SourceComparisonOwnerSchema=Schema.Struct({kind:Schema.Literal('source-comparison'),taskId:id});
export const sourceComparisonOwner=(taskId:string)=>({kind:'source-comparison' as const,taskId});
const ref=Schema.Struct({sourceId:id,version:Schema.Int.pipe(Schema.between(1,Number.MAX_SAFE_INTEGER)),digest:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))});
const raw=Schema.Struct({refs:Schema.Tuple(Schema.NullOr(ref),Schema.NullOr(ref)),question:Schema.String.pipe(Schema.maxLength(200)),comparison:Schema.String.pipe(Schema.maxLength(6000)),uncertainty:Schema.String.pipe(Schema.maxLength(6000)),saveIntent:Schema.optional(SourceComparisonIntentSchema)});
export type SourceComparisonDraft={refs:[{sourceId:string;version:number;digest:string}|null,{sourceId:string;version:number;digest:string}|null];question:string;comparison:string;uncertainty:string;saveIntent?:{id:string;binding:string}};
export const emptySourceComparisonDraft:SourceComparisonDraft={refs:[null,null],question:'',comparison:'',uncertainty:''};
/** Raw private fields only: selected historical refs confer no freshness or publication authority. */
export function readSourceComparisonDraft(value:unknown):SourceComparisonDraft{
 const parsed=Schema.decodeUnknownSync(raw,{onExcessProperty:'error'})(value);
 return {...parsed,refs:[...parsed.refs]};
}
