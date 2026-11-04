import type {RequestRecord} from '../../../core/types';
import {confirmedResponseModel} from '../../../shared/response-model';
import {MUSE_PROFILES} from '../../../shared/muse-connection';

export function ResponseModelDetails({request}:{request:RequestRecord}){
 const receipt=confirmedResponseModel(request);
 return <details className="response-model tiny break"><summary>Response model · {receipt?.model??(receipt?'unknown':'unavailable')}</summary>{receipt?.provider==='meta'?<><p>{receipt.model?'The service reported this logical model for the completed response. Physical backend weights are not identified.':'The response model could not be confirmed from available metadata. The requested model is not confirmation of the model used.'}</p><p>Submitted to {receipt.profile==='baseten-hackathon'?'Baseten hackathon':'Meta Model API'} · {MUSE_PROFILES[receipt.profile].endpoint} · requested {receipt.requestedModel}</p></>:receipt?<><p>Codex reported this logical model for the completed response. Physical backend weights are not identified.</p><p>{receipt.model} · {receipt.effort} reasoning · {receipt.tier==='priority'?'Fast':'Standard'} speed</p></>:<p>No provider-confirmed model receipt is available for this response.</p>}</details>;
}
