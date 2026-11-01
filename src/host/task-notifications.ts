import type {Task} from '../core/types';
import {createHash} from 'node:crypto';
import {studyProgressEvents,studyDeck} from '../core/study-workbench';
import type {StudyProgressEvent} from '../shared/study-workbench';
import {localDate,notificationDelivery,quietHoursActive,studyEventKey,studyMeaning,type LocalStudyEvent,type NotificationSaved,type NotificationState,type TaskNotice} from '../shared/task-notifications';
import type {TaskViewPreferences} from './task-view-preferences';
export type NotificationView=NotificationState extends infer S?S extends {kind:'available'}?S&{notices:{notice:TaskNotice;event?:StudyProgressEvent;taskTitle?:string}[];pending:StudyProgressEvent[]}:S:never;
type Scope={focused:boolean;visibleTaskId:string|null;mutedBotIds:readonly string[]|null};
/** Local notices consume saved Study events; they never run work or send data. */
export class TaskNotifications{
 private closing=false;private initialized=false;private pendingUsage=0;private usageDate='';private lastTick:number;private timer:ReturnType<typeof setInterval>|undefined;private queue=Promise.resolve();private visibleTaskId:string|null=null;
 constructor(private readonly preferences:Pick<TaskViewPreferences,'readNotifications'|'mutateNotifications'>,private readonly tasks:()=>Promise<Task[]>,private readonly scope:()=>Omit<Scope,'visibleTaskId'>|Promise<Omit<Scope,'visibleTaskId'>>,private readonly changed:()=>void,private readonly now=Date.now,private readonly alert?:(notice:TaskNotice,event?:StudyProgressEvent)=>void){this.lastTick=this.now();}
 context(taskId:string|null){this.visibleTaskId=taskId;return this.poll();}
 private async collect(){const tasks=await this.tasks(),events:LocalStudyEvent[]=[];for(const task of tasks){if(task.archive)continue;for(const event of studyProgressEvents(task)){let outputDigest:string|undefined;if(event.kind==='completed'){const attempt=studyDeck(task,event.deckRef,false).state.attempts.find(attempt=>attempt.id===event.attemptId);if(attempt)outputDigest=createHash('sha256').update(JSON.stringify([...attempt.results].sort((a,b)=>a.cardId.localeCompare(b.cardId)).map(result=>[result.cardId,result.correct]))).digest('hex');}events.push({...event,botId:task.assignedBotId,...(outputDigest?{outputDigest}:{})});}}return {tasks,events};}
 private enqueue<T>(work:()=>Promise<T>):Promise<T>{const result=this.queue.then(work);this.queue=result.then(()=>{},()=>{});return result;}
 start(){if(this.timer)return;void this.poll().catch(()=>{});this.timer=setInterval(()=>void this.poll().catch(()=>{}),1000);}
 resume(){this.closing=false;this.lastTick=this.now();this.start();}
 async close(){this.closing=true;if(this.timer)clearInterval(this.timer);this.timer=undefined;await this.poll(false,true).catch(()=>{});await this.queue;}
 poll(opened=false,flushUsage=false){return this.enqueue(async()=>{
  const at=this.now(),elapsed=Math.max(0,Math.min(5000,at-this.lastTick));this.lastTick=at;const {events}=await this.collect(),scope={...await this.scope(),visibleTaskId:this.visibleTaskId};let changed=false;const deliveries:{notice:TaskNotice;event?:StudyProgressEvent}[]=[];
  const date=localDate(at);if(date!==this.usageDate){this.usageDate=date;this.pendingUsage=0;}if(scope.focused)this.pendingUsage+=elapsed;
  const result=await this.preferences.mutateNotifications(before=>{
   const usage=before.usage.date===date?{...before.usage}:{date,milliseconds:0,snoozeUntil:0,breakDismissed:false};
   // Count time only while this local app is visible and focused, never wall time while closed.
   usage.milliseconds=Math.min(86_400_000,usage.milliseconds+this.pendingUsage);
   let observed=[...before.observed],meanings=[...before.meanings],notices=[...before.notices];
   if(!this.initialized){for(const event of events){const key=studyEventKey(event),meaning=studyMeaning(event);if(!observed.includes(key))observed.push(key);if(!meanings.includes(meaning))meanings.push(meaning);}}
   for(const event of events){
    const key=studyEventKey(event),meaning=studyMeaning(event),newEvent=!observed.includes(key),novel=!meanings.includes(meaning);if(newEvent){observed.push(key);notices.push({id:key,kind:event.kind,taskId:event.taskId,deckRef:event.deckRef,attemptId:event.attemptId,...(event.question?{cardId:event.question.cardId}:{}),meaning,createdAt:at,dismissed:false,delivered:false});}
    const index=notices.findIndex(notice=>notice.id===key),notice=index<0?undefined:notices[index];
    // A newly pending question suppressed while visible can alert after leaving it.
    // Old startup records are only reconstructed in the pending list, never replayed as fresh notices.
    if(notice&&!notice.dismissed&&!notice.delivered&&(newEvent||event.kind==='needs-input')){
     const decision=this.closing?{deliver:false,reason:'Glint is closing; review the saved activity when reopened.'}:notificationDelivery(event,before.preferences,scope,novel);notices[index]={...notice,deliveryReason:decision.reason,...(decision.deliver?{delivered:true,deliveredAt:at}:{})};if(decision.deliver)deliveries.push({notice:notices[index],event});
    }
    if(newEvent&&!meanings.includes(meaning))meanings.push(meaning);
   }
   if(!this.closing&&opened&&quietHoursActive(at,before.preferences.quiet))deliveries.push({notice:{id:`quiet:${at}`,kind:'quiet',createdAt:at,dismissed:false,delivered:true,deliveredAt:at,deliveryReason:'Opened during your configured quiet hours.'}});if(deliveries.at(-1)?.notice.kind==='quiet')notices.push(deliveries.at(-1)!.notice);
   const breakDue=before.preferences.breakReminder.enabled&&usage.milliseconds>=before.preferences.breakReminder.minutes*60_000&&!usage.breakDismissed&&at>=usage.snoozeUntil;
   if(!this.closing&&breakDue){const key=`break:${date}:${usage.snoozeUntil}`;if(!notices.some(notice=>notice.id===key))deliveries.push({notice:{id:key,kind:'break',createdAt:at,dismissed:false,delivered:true,deliveredAt:at,deliveryReason:'Your daily active-use reminder threshold was reached.'}});if(deliveries.at(-1)?.notice.kind==='break')notices.push(deliveries.at(-1)!.notice);}
   const next={...before,observed:observed.slice(-10000),meanings:meanings.slice(-10000),notices:notices.slice(-500),usage};
   // Persist usage in 15-second increments, while events/open reminders are durable immediately.
   const onlyUsage=JSON.stringify({...next,usage:before.usage})===JSON.stringify(before),writeUsage=Math.floor(usage.milliseconds/15000)!==Math.floor(before.usage.milliseconds/15000)||usage.date!==before.usage.date;
   if(onlyUsage&&!writeUsage&&!flushUsage)return before;changed=JSON.stringify(next)!==JSON.stringify(before);return next;
  });
  this.initialized=true;if(changed&&result.kind==='available')this.pendingUsage=0;if(changed)this.changed();if(result.kind==='available'&&!this.closing)for(const delivery of deliveries)this.alert?.(delivery.notice,delivery.event);return result;
 });}
 async view():Promise<NotificationView>{await this.poll();const state=await this.preferences.readNotifications();if(state.kind==='unavailable')return state;const {tasks,events}=await this.collect();return {...state,notices:state.current.notices.map(notice=>({notice,event:notice.kind==='needs-input'||notice.kind==='completed'?events.find(event=>studyEventKey(event)===notice.id):undefined,taskTitle:'taskId'in notice?tasks.find(task=>task.id===notice.taskId)?.title:undefined})),pending:events.filter(event=>event.kind==='needs-input')};}
}
