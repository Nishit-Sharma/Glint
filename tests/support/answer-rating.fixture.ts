import {createHash} from 'node:crypto';
import type {Task} from '../../src/core/types';
import type {AnswerRatingSelection} from '../../src/shared/answer-rating';
export const ratingHash=(text:string)=>createHash('sha256').update(text).digest('hex');
export function ratingTask(id='rating-owner'):Task{
 const at='2026-11-02T05:00:00.000Z',content='Exact original saved answer 雪\r\n';
 return {id,title:'Private rating owner',goal:'',status:'active',createdAt:at,updatedAt:at,sources:[],artifacts:[{id:'answer-file',revisions:[{revision:1,title:'Original answer',content,mimeType:'text/markdown',digest:ratingHash(content),sourceRefs:[],createdAt:at},{revision:2,title:'Later edited document',content:'LATER FILE CONTENT',mimeType:'text/markdown',digest:ratingHash('LATER FILE CONTENT'),sourceRefs:[],createdAt:at}]}],requests:[{id:'recorded-request',kind:'explain',prompt:'PRIVATE ORIGINAL QUESTION',digest:ratingHash('recorded-request'),status:'completed',sourceRefs:[],startedAt:at,finishedAt:at,artifactId:'answer-file',answer:{artifactId:'answer-file',revision:1,digest:ratingHash(content)}}],procedures:[],checkpoints:[],actions:[],memory:{enabled:false},session:{revision:4,draft:'PRIVATE UNSENT DRAFT',runs:[],moduleStates:[]}};
}
export function ratingSelection(task:Task):AnswerRatingSelection{const request=task.requests[0];return {taskId:task.id,requestId:request.id,requestDigest:request.digest,answer:{...request.answer!}};}
