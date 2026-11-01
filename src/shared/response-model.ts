import {Schema} from 'effect';
import {RequestInferenceSelectionSchema,sameRequestInference,type RequestInferenceSelection} from './request-inference';

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const answer=Schema.Struct({artifactId:id,revision:Schema.Int.pipe(Schema.between(1,Number.MAX_SAFE_INTEGER)),digest:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))});
export const ProviderModelReceiptSchema=Schema.Struct({...RequestInferenceSelectionSchema.fields,requestId:id,confirmation:Schema.Literal('accepted-thread-and-completed-turn')});
export type ProviderModelReceipt=typeof ProviderModelReceiptSchema.Type;
export const ResponseModelReceiptSchema=Schema.Struct({...ProviderModelReceiptSchema.fields,answer});
export type ResponseModelReceipt=typeof ResponseModelReceiptSchema.Type;
export const readProviderModelReceipt=Schema.decodeUnknownSync(ProviderModelReceiptSchema,{onExcessProperty:'error'});
type ResponseOwner={id:string;status:string;inference?:RequestInferenceSelection;answer?:typeof answer.Type;responseModel?:ResponseModelReceipt};
export function confirmedResponseModel(request:ResponseOwner):ResponseModelReceipt|undefined{
 const receipt=request.responseModel,answer=request.answer;
 if(request.status!=='completed'||!receipt||!answer||receipt.requestId!==request.id||receipt.answer.artifactId!==answer.artifactId||receipt.answer.revision!==answer.revision||receipt.answer.digest!==answer.digest)return;
 const {provider,model,effort,tier}=receipt;
 if(request.inference&&!sameRequestInference(request.inference,{provider,model,effort,tier}))return;
 return receipt;
}
