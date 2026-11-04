import {Schema} from 'effect';
import type {RequestRecord,Task} from '../core/types';
import {RequestQuestionRecordSchema,type RequestQuestionRecord,type RequestQuestionBinding} from './request-question';

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0'))),key=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(1600)),integer=Schema.Int.pipe(Schema.between(0,Number.MAX_SAFE_INTEGER));
const request={taskId:id,requestId:id,requestDigest:id};
export const RequestNoticeOwnerSchema=Schema.Union(
 Schema.Struct({kind:Schema.Literal('request'),...request}),
 Schema.Struct({kind:Schema.Literal('export'),taskId:id,actionId:id,proposalDigest:id}),
 Schema.Struct({kind:Schema.Literal('task'),taskId:id,intentId:Schema.optional(id)}),
);
export type RequestNoticeOwner=typeof RequestNoticeOwnerSchema.Type;
export type RequestNoticeProducer={taskId:string;requestId?:string;actionId?:string};
export type RequestNoticeObserver=<T>(category:'question'|'permission',owner:RequestNoticeProducer,purpose:string,work:()=>Promise<T>,signal?:AbortSignal,validate?:()=>void|Promise<void>)=>Promise<T>;
export const RequestNoticeTargetSchema=Schema.Union(
 Schema.Struct({kind:Schema.Literal('research'),...request,binding:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),preferenceRevision:integer}),
 Schema.Struct({kind:Schema.Literal('request'),...request}),
 Schema.Struct({kind:Schema.Literal('question'),...request,questionId:id,questionDigest:id}),
 Schema.Struct({kind:Schema.Literal('host'),owner:RequestNoticeOwnerSchema,token:id,purpose:id}),
);
export type RequestNoticeTarget=typeof RequestNoticeTargetSchema.Type;
export const RequestNotificationPreferencesSchema=Schema.Struct({completion:Schema.Literal('never','background','always'),questions:Schema.Boolean,permissions:Schema.Boolean,suppressVisible:Schema.Boolean});
export type RequestNotificationPreferences=typeof RequestNotificationPreferencesSchema.Type;
export const defaultRequestNotificationPreferences=():RequestNotificationPreferences=>({completion:'never',questions:false,permissions:false,suppressVisible:true});
export const RequestNoticeSchema=Schema.Struct({id:key,category:Schema.Literal('completion','question','permission','research'),target:RequestNoticeTargetSchema,createdAt:integer,dismissed:Schema.Boolean,state:Schema.Literal('pending','resolved','finished','stale'),delivery:Schema.Literal('none','suppressed','requested','failed','unsupported','unconfirmed'),reason:Schema.String.pipe(Schema.maxLength(400)),terminal:Schema.optional(Schema.Literal('completed','failed','cancelled','interrupted'))}).pipe(Schema.filter(value=>(value.category==='research')===(value.target.kind==='research')));
export type RequestNotice=typeof RequestNoticeSchema.Type;
export const RequestNotificationsSavedSchema=Schema.Struct({revision:integer,preferences:RequestNotificationPreferencesSchema,observed:Schema.Array(key),notices:Schema.Array(RequestNoticeSchema).pipe(Schema.maxItems(500))});
export type RequestNotificationsSaved=typeof RequestNotificationsSavedSchema.Type;
export const freshRequestNotifications=():RequestNotificationsSaved=>({revision:0,preferences:defaultRequestNotificationPreferences(),observed:[],notices:[]});
const command=Schema.Union(
 Schema.Struct({type:Schema.Literal('request-notifications.get')}),
 Schema.Struct({type:Schema.Literal('request-notifications.settings'),expectedRevision:integer,preferences:RequestNotificationPreferencesSchema}),
 Schema.Struct({type:Schema.Literal('request-notifications.context'),taskId:Schema.NullOr(id)}),
 Schema.Struct({type:Schema.Literal('request-notifications.dismiss'),noticeId:key}),
 Schema.Struct({type:Schema.Literal('request-notifications.resolve'),noticeId:key}),
);
export type RequestNotificationCommand=typeof command.Type;
export const readRequestNotificationCommand=Schema.decodeUnknownSync(command,{onExcessProperty:'error'});
export const readRequestNotificationsSaved=Schema.decodeUnknownSync(RequestNotificationsSavedSchema,{onExcessProperty:'error'});
export const requestNoticeTaskId=(target:RequestNoticeTarget)=>target.kind==='host'?target.owner.taskId:target.taskId;
export const requestNoticeKey=(category:RequestNotice['category'],target:RequestNoticeTarget)=>'request:'+JSON.stringify([category,target]);
export const requestNoticeHeading=(notice:RequestNotice)=>notice.category==='research'?'Local research suggestions are ready':notice.category==='permission'?'Permission review is waiting':notice.category==='question'?'A question is waiting':notice.terminal==='completed'?'Response finished':notice.terminal==='failed'?'Response failed':notice.terminal==='cancelled'?'Request stopped':'Request interrupted';
export function requestNoticeOwnerMatches(task:Task,owner:RequestNoticeOwner):boolean{
 if(task.id!==owner.taskId)return false;
 if(owner.kind==='task')return true;
 if(owner.kind==='export')return task.actions.some(action=>action.proposal.id===owner.actionId&&action.proposal.digest===owner.proposalDigest);
 return task.requests.some(request=>request.id===owner.requestId&&request.digest===owner.requestDigest);
}
/** Reads the published P108 contract; it never infers questions from answer prose. */
export function savedRequestQuestions(request:RequestRecord):readonly RequestQuestionRecord[]{
 const value=(request as RequestRecord&{questions?:unknown}).questions;if(value===undefined)return [];
 try{return Schema.decodeUnknownSync(Schema.Array(RequestQuestionRecordSchema),{onExcessProperty:'error'})(value) as readonly RequestQuestionRecord[];}catch{return [];}
}
export const questionBinding=(target:Extract<RequestNoticeTarget,{kind:'question'}>):RequestQuestionBinding=>({taskId:target.taskId,requestId:target.requestId,requestDigest:target.requestDigest,questionId:target.questionId,questionDigest:target.questionDigest});
export function requestNoticeTargetMatches(task:Task,target:RequestNoticeTarget):boolean{
 if(target.kind==='host')return requestNoticeOwnerMatches(task,target.owner);
 if(target.kind==='research'){if(task.id!==target.taskId)return false;const request=task.requests.at(-1);return task.status==='active'&&!task.archive&&request?.status==='completed'&&request.id===target.requestId&&request.digest===target.requestDigest;}
 const request=task.requests.find(request=>task.id===target.taskId&&request.id===target.requestId&&request.digest===target.requestDigest);if(!request)return false;
 return target.kind==='request'||savedRequestQuestions(request).some(question=>question.id===target.questionId&&question.digest===target.questionDigest);
}
export type RequestNotificationNativeStatus={supported:boolean;permission:'not-verified';message:string};
export type RequestNotificationView={kind:'available';current:RequestNotificationsSaved;native:RequestNotificationNativeStatus;notices:{notice:RequestNotice;taskTitle?:string;available:boolean}[]}|{kind:'unavailable';message:string};
export type RequestNoticeResolution={kind:'available';notice:RequestNotice;task:Task;active:boolean}|{kind:'unavailable';message:string};
export function requestNotificationDecision(notice:RequestNotice,preferences:RequestNotificationPreferences,scope:{focused:boolean;visibleTaskId:string|null;mutedBotIds:readonly string[]|null},botId?:string):{deliver:boolean;reason:string}{
 if(scope.mutedBotIds===null)return {deliver:false,reason:'Companion notification settings are unavailable.'};
 if(botId&&scope.mutedBotIds.includes(botId))return {deliver:false,reason:'Companion notifications are off.'};
 if(notice.category==='permission'&&!preferences.permissions)return {deliver:false,reason:'Desktop permission alerts are off.'};
 if(notice.category==='question'&&!preferences.questions)return {deliver:false,reason:'Desktop question alerts are off.'};
 if(notice.category==='completion'&&(preferences.completion==='never'||preferences.completion==='background'&&scope.focused))return {deliver:false,reason:'Desktop completion timing excludes this state.'};
 // Research opt-in and its exact bounded projection are checked by the host collector.
 if(preferences.suppressVisible&&scope.focused&&scope.visibleTaskId===requestNoticeTaskId(notice.target))return {deliver:false,reason:'This conversation is already visible and focused.'};
 return {deliver:true,reason:'Desktop alert requested. System permission and delivery are not verified.'};
}
