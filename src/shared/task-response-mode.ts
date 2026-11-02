import {Schema} from 'effect';
import type {Task} from '../core/types';

export const ResponseModeSchema=Schema.Literal('ordinary','plan');
export type ResponseMode=typeof ResponseModeSchema.Type;
export const TaskResponseModeSchema=Schema.Struct({mode:ResponseModeSchema,revision:Schema.Int.pipe(Schema.between(0,Number.MAX_SAFE_INTEGER))});
export type TaskResponseMode=typeof TaskResponseModeSchema.Type;
const command=Schema.Struct({type:Schema.Literal('response-mode.set'),taskId:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0'))),expectedRevision:Schema.Int.pipe(Schema.between(0,Number.MAX_SAFE_INTEGER)),mode:ResponseModeSchema});
export type TaskResponseModeCommand=typeof command.Type;
export const readTaskResponseModeCommand=Schema.decodeUnknownSync(command,{onExcessProperty:'error'});
export const taskResponseMode=(session?:{responseMode?:TaskResponseMode}):TaskResponseMode=>session?.responseMode??{mode:'ordinary',revision:0};
export const PLAN_RESPONSE_GUIDANCE='Plan mode: provide a planning-only response. Explain the proposed approach, ordered steps, assumptions, open questions and checks. Do not implement the plan, execute commands, use tools or claim that changes have been made. This is an ordinary text response and grants no execution authority.';
export const planResponsePrompt=(prompt:string,mode?:ResponseMode)=>mode==='plan'?`${PLAN_RESPONSE_GUIDANCE}\n\nUser request:\n${prompt}`:prompt;

/** Reconcile only this saved preference; keep every incoming draft, source and history field. */
export function reconcileTaskResponseModes(incoming:Task[],known:readonly Task[]):Task[]{
 return incoming.map(task=>{const matches=known.filter(item=>item.id===task.id),saved=matches.length===1?matches[0]:undefined;if(!saved||taskResponseMode(saved.session).revision<=taskResponseMode(task.session).revision)return task;return {...task,session:{revision:0,draft:'',runs:[],moduleStates:[],...task.session,responseMode:taskResponseMode(saved.session)}};});
}
