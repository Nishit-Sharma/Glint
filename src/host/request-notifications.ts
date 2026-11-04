import {randomUUID} from 'node:crypto';
import type {LocalResearchPreview} from '../shared/local-research-suggestions';
import type {Task} from '../core/types';
import type {TaskViewPreferences} from './task-view-preferences';
import type {DesktopRequestTransport} from './desktop-request-notifications';
import {readRequestQuestionReply,type RequestQuestionBinding,type RequestQuestionReply} from '../shared/request-question';
import {freshRequestNotifications,questionBinding,readRequestNotificationCommand,requestNoticeHeading,requestNoticeKey,requestNoticeOwnerMatches,requestNoticeTargetMatches,requestNoticeTaskId,requestNotificationDecision,savedRequestQuestions,type RequestNotice,type RequestNoticeOwner,type RequestNoticeResolution,type RequestNoticeTarget,type RequestNotificationCommand,type RequestNotificationsSaved,type RequestNotificationView} from '../shared/request-notifications';

type Active={category:'question'|'permission';target:Extract<RequestNoticeTarget,{kind:'host'}>;validate?:()=>void|Promise<void>};
type Scope={focused:boolean;mutedBotIds:readonly string[]|null};
type Event={category:RequestNotice['category'];target:RequestNoticeTarget;terminal?:RequestNotice['terminal'];pending:boolean};
/** Observes saved requests and existing human prompts; it has no approval, answer or execution capability. */
export class RequestNotifications{
 private initialized=false;private closing=false;private policy=0;private visibleTaskId:string|null=null;private queue:Promise<unknown>=Promise.resolve();private timer:ReturnType<typeof setInterval>|undefined;private active=new Map<string,Active>();
 private research:Extract<RequestNoticeTarget,{kind:'research'}>|undefined;private researchTimer:ReturnType<typeof setTimeout>|undefined;
 constructor(private readonly options:{preferences:Pick<TaskViewPreferences,'readNotifications'|'mutateNotifications'>;tasks:()=>Promise<Task[]>;scope:()=>Scope|Promise<Scope>;changed:()=>void;desktop:DesktopRequestTransport;inspectQuestion?:(binding:RequestQuestionBinding)=>Promise<RequestQuestionReply|undefined>;researchPreview?:(target:Extract<RequestNoticeTarget,{kind:'research'}>)=>Promise<LocalResearchPreview|undefined>;now?:()=>number}){}
 retireResearch(){this.policy++;const target=this.research;this.research=undefined;if(this.researchTimer)clearTimeout(this.researchTimer);this.researchTimer=undefined;if(target)this.options.desktop.retire([requestNoticeKey('research',target)]);}
 registerResearch(view:LocalResearchPreview){
  if(!view.request||!view.candidates.length||this.closing)return;const target={kind:'research' as const,taskId:view.taskId,requestId:view.request.id,requestDigest:view.request.digest,binding:view.binding,preferenceRevision:view.preferenceRevision};
  if(JSON.stringify(target)===JSON.stringify(this.research))return;this.retireResearch();this.research=target;
  if(view.expiresAt){const arm=()=>{const remaining=Date.parse(view.expiresAt!)-this.now();if(remaining<=0){this.retireResearch();void this.poll().catch(()=>{});return;}this.researchTimer=setTimeout(arm,Math.min(remaining,2_147_483_647));this.researchTimer.unref();};arm();}
  void this.poll().catch(()=>{});
 }
 private async researchCurrent(target:Extract<RequestNoticeTarget,{kind:'research'}>){const registered=this.research;if(!registered||requestNoticeKey('research',registered)!==requestNoticeKey('research',target))return false;try{const view=await this.options.researchPreview?.(target);return this.research===registered&&view?.binding===target.binding&&view.preferenceRevision===target.preferenceRevision&&!!view.candidates.length;}catch{return false;}}
 private now(){return (this.options.now??Date.now)();}
 private async mutate(update:(saved:RequestNotificationsSaved)=>RequestNotificationsSaved){return this.options.preferences.mutateNotifications(before=>{const current=before.requestNotifications??freshRequestNotifications(),next=update(current);return !before.requestNotifications&&JSON.stringify(next)===JSON.stringify(current)?before:{...before,requestNotifications:next};});}
 private async collect(){
  const tasks=await this.options.tasks(),events:Event[]=[];
  for(const task of tasks){
   if(task.archive)continue;
   for(const request of task.requests){
    if(request.status!=='running')events.push({category:'completion',target:{kind:'request',taskId:task.id,requestId:request.id,requestDigest:request.digest},terminal:request.status,pending:false});
    for(const question of savedRequestQuestions(request))if(question.status==='waiting'&&request.status==='running'&&task.status==='active'){
     const target={kind:'question' as const,taskId:task.id,requestId:request.id,requestDigest:request.digest,questionId:question.id,questionDigest:question.digest};
     try{const reply=await this.options.inspectQuestion?.(questionBinding(target));if(reply&&readRequestQuestionReply(reply).active)events.push({category:'question',target,pending:true});}catch{/* An unavailable waiter is never presented as active input. */}
    }
   }
  }
  for(const [token,entry]of this.active){try{await entry.validate?.();}catch{if(this.active.get(token)===entry)this.active.delete(token);try{this.options.desktop.retire([requestNoticeKey(entry.category,entry.target)]);}catch{}continue;}if(this.active.get(token)===entry&&tasks.some(task=>!task.archive&&requestNoticeOwnerMatches(task,entry.target.owner)))events.push({category:entry.category,target:entry.target,pending:true});}
  const research=this.research;if(research){if(await this.researchCurrent(research))events.push({category:'research',target:research,pending:true});else if(this.research===research)this.retireResearch();}
  return {tasks,events};
 }
 /** The observer is deliberately outside the decision path. Native options/results and guards stay with the caller. */
 async observe<T>(category:'question'|'permission',owner:RequestNoticeOwner,purpose:string,work:()=>Promise<T>,signal?:AbortSignal,validate?:()=>void|Promise<void>):Promise<T>{
  const token=randomUUID(),target={kind:'host' as const,owner:structuredClone(owner),token,purpose},entry={category,target,validate};
  const retire=()=>{if(this.active.get(token)!==entry)return;this.active.delete(token);try{this.options.desktop.retire([requestNoticeKey(category,target)]);}catch{}void this.poll().catch(()=>{});};
  if(!this.closing&&!signal?.aborted){this.active.set(token,entry);signal?.addEventListener('abort',retire,{once:true});void this.poll().catch(()=>{});}
  try{return await work();}finally{signal?.removeEventListener('abort',retire);retire();}
 }
 async context(taskId:string|null){this.policy++;this.visibleTaskId=taskId;await this.poll();}
 scopeChanged(){this.policy++;void this.poll().catch(()=>{});}
 start(){if(this.timer)return;void this.poll().catch(()=>{});this.timer=setInterval(()=>void this.poll().catch(()=>{}),1000);}
 resume(){this.closing=false;this.options.desktop.resume();this.start();}
 async close(){this.policy++;this.closing=true;this.retireResearch();if(this.timer)clearInterval(this.timer);this.timer=undefined;this.active.clear();this.options.desktop.close();await this.poll().catch(()=>{});await this.queue;}
 private live(notice:RequestNotice,events:readonly Event[]){return events.some(event=>requestNoticeKey(event.category,event.target)===notice.id);}
 poll():Promise<void>{
  const result=this.queue.then(async()=>{
   const {tasks,events}=await this.collect(),scope={...await this.options.scope(),visibleTaskId:this.visibleTaskId},deliveries:RequestNotice[]=[],retired:string[]=[];let changed=false;
   const saved=await this.mutate(before=>{
    const observed=new Set(before.observed),notices=before.notices.map(notice=>{
     if(notice.state!=='pending'||this.live(notice,events))return notice;retired.push(notice.id);return {...notice,state:tasks.some(task=>requestNoticeTargetMatches(task,notice.target))?'resolved' as const:'stale' as const};
    });
    for(const event of events){
     const id=requestNoticeKey(event.category,event.target),fresh=!observed.has(id);if(fresh)observed.add(id);
     if(fresh&&!this.initialized&&event.category==='completion')continue;
     let index=notices.findIndex(notice=>notice.id===id);if(fresh){notices.push({id,category:event.category,target:event.target,createdAt:this.now(),dismissed:false,state:event.pending?'pending':'finished',delivery:'none',reason:'Recorded locally.',...(event.terminal?{terminal:event.terminal}:{})});index=notices.length-1;}
     const notice=notices[index];if(!notice||notice.dismissed||!['none','suppressed'].includes(notice.delivery)||!fresh&&!event.pending)continue;
     const task=tasks.find(task=>task.id===requestNoticeTaskId(notice.target)),decision=this.closing?{deliver:false,reason:'Glint is closing; no desktop alert was requested.'}:requestNotificationDecision(notice,before.preferences,scope,task?.assignedBotId);
     const next={...notice,delivery:decision.deliver?'unconfirmed' as const:'suppressed' as const,reason:decision.deliver?'Desktop delivery attempt recorded; its outcome is not confirmed.':decision.reason};notices[index]=next;if(decision.deliver)deliveries.push(next);
    }
    const next={...before,observed:[...observed],notices:notices.slice(-500)};changed=JSON.stringify(next)!==JSON.stringify(before);return next;
   });
   if(saved.kind!=='available')return;this.initialized=true;this.options.desktop.retire(retired);if(changed)this.options.changed();
   for(const notice of deliveries){
    if(this.closing)break;
    // Persistence precedes the effect; recheck active prompts after every deferred read.
    const policy=this.policy,current=await this.collect(),saved=await this.options.preferences.readNotifications(),scope={...await this.options.scope(),visibleTaskId:this.visibleTaskId},retained=saved.kind==='available'?saved.current.requestNotifications?.notices.find(item=>item.id===notice.id):undefined;
    const task=current.tasks.find(task=>requestNoticeTargetMatches(task,notice.target)),active=notice.target.kind==='host'?this.active.has(notice.target.token):notice.state!=='pending'||this.live(notice,current.events);
    if(this.closing||policy!==this.policy||!retained||retained.dismissed||!task||!active){await this.delivery(notice.id,'suppressed','The exact notice, owner or active prompt changed before delivery.');continue;}
    const decision=requestNotificationDecision(retained,saved.kind==='available'?(saved.current.requestNotifications??freshRequestNotifications()).preferences:freshRequestNotifications().preferences,scope,task.assignedBotId);if(!decision.deliver){await this.delivery(notice.id,'suppressed',decision.reason);continue;}
    let producerActive=true;
    if(notice.target.kind==='question'){try{const reply=await this.options.inspectQuestion?.(questionBinding(notice.target));producerActive=!!reply&&readRequestQuestionReply(reply).active;}catch{producerActive=false;}}
    else if(notice.target.kind==='host'){const entry=this.active.get(notice.target.token);try{await entry?.validate?.();producerActive=!!entry&&this.active.get(notice.target.token)===entry;}catch{producerActive=false;}}
    const latestTask=(await this.options.tasks()).find(task=>!task.archive&&requestNoticeTargetMatches(task,notice.target));
    if(notice.target.kind==='question'&&latestTask){const target=notice.target,request=latestTask.requests.find(request=>request.id===target.requestId&&request.digest===target.requestDigest);producerActive=producerActive&&latestTask.status==='active'&&request?.status==='running'&&savedRequestQuestions(request).some(question=>question.id===target.questionId&&question.digest===target.questionDigest&&question.status==='waiting');}
    if(notice.target.kind==='host')producerActive=producerActive&&this.active.has(notice.target.token);
    if(notice.target.kind==='research')producerActive=await this.researchCurrent(notice.target);
    if(!latestTask||!producerActive||this.closing||policy!==this.policy){await this.delivery(notice.id,'suppressed','The exact owner, active producer or alert rules changed before desktop publication.');continue;}
    const outcome=await this.options.desktop.show(notice,()=>{void this.delivery(notice.id,'failed','The OS reported that this desktop alert failed. No automatic retry was scheduled.').catch(()=>{});});await this.delivery(notice.id,outcome,outcome==='requested'?'Desktop alert requested; OS permission, Focus settings and actual display are not verified.':outcome==='unsupported'?'System notifications are unavailable. Review this retained notice in Glint.':'The desktop alert failed. It will not be retried automatically.');
   }
  });this.queue=result.then(()=>{},()=>{});return result;
 }
 private async delivery(id:string,delivery:RequestNotice['delivery'],reason:string){const saved=await this.mutate(before=>({...before,notices:before.notices.map(notice=>notice.id===id&&!(delivery==='requested'&&notice.delivery==='failed')?{...notice,delivery,reason}:notice)}));if(saved.kind==='available')this.options.changed();}
 async view():Promise<RequestNotificationView>{await this.poll();const saved=await this.options.preferences.readNotifications();if(saved.kind==='unavailable')return saved;const current=saved.current.requestNotifications??freshRequestNotifications(),tasks=await this.options.tasks();return {kind:'available',current,native:this.options.desktop.status(),notices:current.notices.map(notice=>({notice,taskTitle:tasks.find(task=>task.id===requestNoticeTaskId(notice.target))?.title,available:tasks.some(task=>requestNoticeTargetMatches(task,notice.target))}))};}
 async resolve(noticeId:string):Promise<RequestNoticeResolution>{
  const state=await this.options.preferences.readNotifications();if(state.kind==='unavailable')return state;const notice=state.current.requestNotifications?.notices.find(notice=>notice.id===noticeId);if(!notice)return {kind:'unavailable',message:'This exact request notice is no longer retained.'};const task=(await this.options.tasks()).find(task=>requestNoticeTargetMatches(task,notice.target));if(!task)return {kind:'unavailable',message:'The original conversation or exact request is unavailable. No replacement was opened.'};
  let active=false;if(notice.target.kind==='host'){const entry=this.active.get(notice.target.token);try{await entry?.validate?.();active=!!entry&&this.active.get(notice.target.token)===entry;}catch{}if(!active)return {kind:'unavailable',message:'This original question or permission prompt has closed. Its retained history grants no new action.'};}
  else if(notice.target.kind==='question'){try{const reply=await this.options.inspectQuestion?.(questionBinding(notice.target));active=!!reply&&readRequestQuestionReply(reply).active;}catch{}if(!active)return {kind:'unavailable',message:'This exact question is no longer awaiting input. No other question was opened.'};}
  else if(notice.target.kind==='research'){active=await this.researchCurrent(notice.target);if(!active)return {kind:'unavailable',message:'These exact local research suggestions are no longer current. Open the current task and recompute.'};}
  const latestTask=(await this.options.tasks()).find(task=>requestNoticeTargetMatches(task,notice.target));if(!latestTask)return {kind:'unavailable',message:'The original owner changed during inspection. No replacement was opened.'};
  if(notice.target.kind==='host'&&(!this.active.has(notice.target.token)||latestTask.archive))return {kind:'unavailable',message:'The original prompt has closed. No replacement was opened.'};
  if(notice.target.kind==='question'){const target=notice.target,request=latestTask.requests.find(request=>request.id===target.requestId&&request.digest===target.requestDigest);if(latestTask.archive||latestTask.status!=='active'||request?.status!=='running'||!savedRequestQuestions(request).some(question=>question.id===target.questionId&&question.digest===target.questionDigest&&question.status==='waiting'))return {kind:'unavailable',message:'The original question closed during inspection. No replacement was opened.'};}
  if(notice.target.kind==='research'&&!await this.researchCurrent(notice.target))return {kind:'unavailable',message:'The local research suggestion changed during inspection.'};
  return {kind:'available',notice:structuredClone(notice),task:latestTask,active};
 }
 async command(value:RequestNotificationCommand):Promise<unknown>{
  const command=readRequestNotificationCommand(value);
  if(command.type==='request-notifications.context'){await this.context(command.taskId);return null;}
  if(command.type==='request-notifications.resolve')return this.resolve(command.noticeId);
  if(command.type==='request-notifications.get')return this.view();
  this.policy++;
  const saved=await this.mutate(before=>{
   if(command.type==='request-notifications.settings'){if(command.expectedRevision!==before.revision)throw Error('Desktop request settings changed. Reload before saving.');if(before.revision===Number.MAX_SAFE_INTEGER)throw Error('The preference revision limit was reached.');return {...before,revision:before.revision+1,preferences:command.preferences};}
   if(!before.notices.some(notice=>notice.id===command.noticeId))throw Error('This request notice is no longer retained.');return {...before,notices:before.notices.map(notice=>notice.id===command.noticeId?{...notice,dismissed:true}:notice)};
  });if(saved.kind==='unavailable')throw Error(saved.message);if(command.type==='request-notifications.dismiss')this.options.desktop.retire([command.noticeId]);this.options.changed();return this.view();
 }
}
