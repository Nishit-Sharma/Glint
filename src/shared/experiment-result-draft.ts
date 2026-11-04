import {Schema} from 'effect';
import {readExperimentResultInput,type ExperimentResultInput} from '../learning/experiment-result-copy';
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
export const ExperimentResultOwnerSchema=Schema.Struct({kind:Schema.Literal('experiment-result-copy'),taskId:id,artifactId:id,artifactRevision:Schema.Int.pipe(Schema.positive()),artifactDigest:id});
export type ExperimentResultOwner=typeof ExperimentResultOwnerSchema.Type;
export const EXPERIMENT_RESULT_SLOT='experiment-result:save';
export const emptyExperimentResultDraft={pending:null as ExperimentResultInput|null};
export const experimentResultDraftIdentity=(owner:ExperimentResultOwner)=>JSON.stringify(['experiment-result-raw-v1',owner]);
export const experimentResultDraftBasis=(owner:ExperimentResultOwner)=>JSON.stringify({basis:experimentResultDraftIdentity(owner),variableArrays:[]});
export function readExperimentResultDraft(raw:unknown){const value=Schema.decodeUnknownSync(Schema.Struct({pending:Schema.NullOr(Schema.Unknown)}),{onExcessProperty:'error'})(raw);return {pending:value.pending===null?null:readExperimentResultInput(value.pending)};}
