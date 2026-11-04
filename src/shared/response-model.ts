import {Schema} from 'effect';
import {RequestInferenceSelectionSchema,sameRequestInference,type RequestInferenceSelection} from './request-inference';

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const answer=Schema.Struct({artifactId:id,revision:Schema.Int.pipe(Schema.between(1,Number.MAX_SAFE_INTEGER)),digest:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))});
const codexFields={...RequestInferenceSelectionSchema.fields,requestId:id,confirmation:Schema.Literal('accepted-thread-and-completed-turn')};
const reportedModel=Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/));
export const readMetaReportedModel=(value:unknown):string|null=>Schema.is(reportedModel)(value)?value:null;
const metaFields={requestId:id,provider:Schema.Literal('meta'),profile:Schema.Literal('meta-direct','baseten-hackathon'),requestedModel:reportedModel,model:Schema.NullOr(reportedModel),confirmation:Schema.Literal('completed-text-response')};
export const ProviderModelReceiptSchema=Schema.Union(Schema.Struct(codexFields),Schema.Struct(metaFields));
export type ProviderModelReceipt=typeof ProviderModelReceiptSchema.Type;
export const ResponseModelReceiptSchema=Schema.Union(Schema.Struct({...codexFields,answer}),Schema.Struct({...metaFields,answer}));
export type ResponseModelReceipt=typeof ResponseModelReceiptSchema.Type;
export const readProviderModelReceipt=Schema.decodeUnknownSync(ProviderModelReceiptSchema,{onExcessProperty:'error'});
type ResponseOwner={id:string;status:string;inference?:RequestInferenceSelection;answer?:typeof answer.Type;responseModel?:ResponseModelReceipt};
export function confirmedResponseModel(request:ResponseOwner):ResponseModelReceipt|undefined{
 const receipt=request.responseModel,answer=request.answer;
 if(request.status!=='completed'||!receipt||!answer||receipt.requestId!==request.id||receipt.answer.artifactId!==answer.artifactId||receipt.answer.revision!==answer.revision||receipt.answer.digest!==answer.digest)return;
 if(request.inference&&(receipt.provider!=='codex'||!sameRequestInference(request.inference,{provider:receipt.provider,model:receipt.model,effort:receipt.effort,tier:receipt.tier})))return;
 return receipt;
}
