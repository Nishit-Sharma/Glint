import {Schema} from 'effect';
import type {BotState} from './bot-catalog';
import type {StudyProgressEvent} from './study-workbench';
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200)),key=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(1600));
const number=(minimum:number,maximum:number)=>Schema.Int.pipe(Schema.between(minimum,maximum));
const reference=Schema.Struct({artifactId:id,revision:number(1,Number.MAX_SAFE_INTEGER),digest:id});
export const NotificationPreferencesSchema=Schema.Struct({
 completion:Schema.Literal('never','background','always'),input:Schema.Boolean,suppressVisible:Schema.Boolean,meaningfulOnly:Schema.Boolean,
 breakReminder:Schema.Struct({enabled:Schema.Boolean,minutes:number(1,480)}),
 quiet:Schema.Struct({enabled:Schema.Boolean,days:Schema.Array(number(0,6)).pipe(Schema.maxItems(7)),start:number(0,1439),end:number(0,1439)}),
});
export type NotificationPreferences=typeof NotificationPreferencesSchema.Type;
export const defaultNotificationPreferences=():NotificationPreferences=>({completion:'background',input:true,suppressVisible:true,meaningfulOnly:true,breakReminder:{enabled:false,minutes:60},quiet:{enabled:false,days:[1,2,3,4,5],start:22*60,end:7*60}});
const noticeBase={id:key,createdAt:number(0,Number.MAX_SAFE_INTEGER),dismissed:Schema.Boolean,delivered:Schema.Boolean,deliveredAt:Schema.optional(number(0,Number.MAX_SAFE_INTEGER)),deliveryReason:Schema.optional(Schema.String.pipe(Schema.maxLength(200)))};
export const TaskNoticeSchema=Schema.Union(
 Schema.Struct({...noticeBase,kind:Schema.Literal('needs-input','completed'),taskId:id,deckRef:reference,attemptId:id,cardId:Schema.optional(id),meaning:key}),
 Schema.Struct({...noticeBase,kind:Schema.Literal('break','quiet')}),
);
export type TaskNotice=typeof TaskNoticeSchema.Type;
export const NotificationSavedSchema=Schema.Struct({revision:number(0,Number.MAX_SAFE_INTEGER),preferences:NotificationPreferencesSchema,observed:Schema.Array(key).pipe(Schema.maxItems(10000)),meanings:Schema.Array(key).pipe(Schema.maxItems(10000)),notices:Schema.Array(TaskNoticeSchema).pipe(Schema.maxItems(500)),usage:Schema.Struct({date:Schema.String.pipe(Schema.maxLength(10)),milliseconds:number(0,86_400_000),snoozeUntil:number(0,Number.MAX_SAFE_INTEGER),breakDismissed:Schema.Boolean})});
export type NotificationSaved=typeof NotificationSavedSchema.Type;
export const freshNotifications=():NotificationSaved=>({revision:0,preferences:defaultNotificationPreferences(),observed:[],meanings:[],notices:[],usage:{date:'',milliseconds:0,snoozeUntil:0,breakDismissed:false}});
export type NotificationState={kind:'available';current:NotificationSaved}|{kind:'unavailable';message:string};
const change=Schema.Union(
 Schema.Struct({kind:Schema.Literal('settings'),expectedRevision:number(0,Number.MAX_SAFE_INTEGER),preferences:NotificationPreferencesSchema}),
 Schema.Struct({kind:Schema.Literal('dismiss'),noticeId:key}),
 Schema.Struct({kind:Schema.Literal('snooze'),minutes:Schema.Literal(5,15,60)}),
);
export type NotificationChange=typeof change.Type;
export const readNotificationChange=Schema.decodeUnknownSync(change,{onExcessProperty:'error'});
const command=Schema.Union(
 Schema.Struct({type:Schema.Literal('notifications.get')}),
 Schema.Struct({type:Schema.Literal('notifications.change'),change}),
 Schema.Struct({type:Schema.Literal('notifications.context'),taskId:Schema.NullOr(id)}),
 Schema.Struct({type:Schema.Literal('notifications.opened')}),
 Schema.Struct({type:Schema.Literal('notifications.copy'),noticeId:key}),
);
export type NotificationCommand=typeof command.Type;
export const readNotificationCommand=Schema.decodeUnknownSync(command,{onExcessProperty:'error'});
export const readNotificationSaved=Schema.decodeUnknownSync(NotificationSavedSchema,{onExcessProperty:'error'});
export const localDate=(now:number)=>{const date=new Date(now);return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');};
export function quietHoursActive(now:number,quiet:NotificationPreferences['quiet']):boolean{
 if(!quiet.enabled)return false;const date=new Date(now),day=date.getDay(),minute=date.getHours()*60+date.getMinutes();
 if(quiet.start===quiet.end)return quiet.days.includes(day);
 if(quiet.start<quiet.end)return quiet.days.includes(day)&&minute>=quiet.start&&minute<quiet.end;
 return quiet.days.includes(day)&&minute>=quiet.start||quiet.days.includes((day+6)%7)&&minute<quiet.end;
}
export type LocalStudyEvent=StudyProgressEvent&{botId?:string;outputDigest?:string};
export const studyEventKey=(event:StudyProgressEvent)=>JSON.stringify([event.taskId,event.deckRef.artifactId,event.deckRef.revision,event.deckRef.digest,event.attemptId,event.kind,event.kind==='needs-input'?event.question?.cardId??'submit':null]);
/** Same saved material and score is repeated output even when a fresh attempt has a different ID. */
export const studyMeaning=(event:LocalStudyEvent)=>JSON.stringify([event.taskId,event.deckRef.artifactId,event.deckRef.digest,event.kind,event.kind==='completed'?[event.score?.correct,event.score?.total,event.outputDigest??null]:[event.attemptId,event.question?.cardId??'submit']]);
export function studyEventBlocked(event:StudyProgressEvent):string|undefined{
 if('applicable' in event&&event.applicable===true)return;
 return 'blockedReason' in event&&typeof event.blockedReason==='string'?event.blockedReason:'The current saved source basis is unavailable. You can inspect this retained study work.';
}
export function notificationDelivery(event:LocalStudyEvent,preferences:NotificationPreferences,scope:{focused:boolean;visibleTaskId:string|null;mutedBotIds:readonly string[]|null},novel:boolean):{deliver:boolean;reason:string}{
 const blocked=studyEventBlocked(event);if(blocked)return {deliver:false,reason:blocked.slice(0,200)};
 if(scope.mutedBotIds===null)return {deliver:false,reason:'Companion notification settings are unavailable.'};
 if(event.botId&&scope.mutedBotIds.includes(event.botId))return {deliver:false,reason:'Companion notifications are off.'};
 if(event.kind==='needs-input'&&!preferences.input)return {deliver:false,reason:'Input notices are off.'};
 if(event.kind==='completed'&&(preferences.completion==='never'||preferences.completion==='background'&&scope.focused))return {deliver:false,reason:'Completion timing excludes this state.'};
 if(preferences.suppressVisible&&scope.focused&&scope.visibleTaskId===event.taskId)return {deliver:false,reason:'This task is already visible.'};
 if(preferences.meaningfulOnly&&event.kind==='completed'&&!novel)return {deliver:false,reason:'The same saved study material and score was already observed.'};
 return {deliver:true,reason:event.kind==='needs-input'?'This saved attempt needs your input.':'This saved study result is new.'};
}

export type NotificationToastAction={kind:'open'|'dismiss';noticeId:string};

export const notificationMuteScope=(state:BotState):readonly string[]|null=>state.kind==='available'&&state.current.kind==='ready'?state.current.bots.filter(bot=>bot.hidden||bot.notificationsEnabled===false).map(bot=>bot.id):null;
export const notificationVisibleTask=(surface:'anchor'|'workspace'|'companion',taskId:string|undefined,conversationVisible:boolean):string|null=>surface!=='anchor'&&conversationVisible?taskId??null:null;
