import type {RequestRecord} from '../../../core/types';
import {confirmedResponseModel} from '../../../shared/response-model';

export function ResponseModelDetails({request}:{request:RequestRecord}){
 const receipt=confirmedResponseModel(request);
 return <details className="response-model tiny"><summary>Response model · {receipt?receipt.model:'unavailable'}</summary>{receipt?<><p>Codex reported this logical model for the completed response. Physical backend weights are not identified.</p><p>{receipt.model} · {receipt.effort} reasoning · {receipt.tier==='priority'?'Fast':'Standard'} speed</p></>:<p>No provider-confirmed model receipt is available for this response.</p>}</details>;
}
